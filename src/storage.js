// Context — Shared storage helpers
// Loaded as a classic script (no modules) from the popup, the background
// worker, and the settings page.
// Exposes everything on globalThis.CtxStorage.

(function () {
  "use strict";

  if (globalThis.CtxStorage) return;

  const SETTINGS_KEY = "settings";

  // Seeded on install so the panel does something useful before the user has
  // configured anything — and so the first two quick-search slots are live.
  const DEFAULT_SETTINGS = {
    destinations: [
      {
        id: "google",
        label: "Google",
        urlTemplate: "https://www.google.com/search?q={term}",
        encoding: "plain",
        openMode: "reuse",
      },
      {
        id: "gmail",
        label: "Gmail",
        urlTemplate: "https://mail.google.com/mail/u/0/#search/{term}",
        encoding: "plain",
        openMode: "reuse",
      },
    ],
  };

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(SETTINGS_KEY, (result) => {
        resolve(result[SETTINGS_KEY] || { destinations: [] });
      });
    });
  }

  function saveSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [SETTINGS_KEY]: settings }, resolve);
    });
  }

  async function seedDefaultsIfEmpty() {
    const existing = await new Promise((resolve) => {
      chrome.storage.local.get(SETTINGS_KEY, (r) => resolve(r[SETTINGS_KEY]));
    });
    if (!existing) {
      await saveSettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    return existing;
  }

  // Wraps a raw term in the Salesforce Lightning search componentDef
  // payload and base64-encodes it. The caller pastes this into a
  // urlTemplate like `https://INSTANCE/one/one.app#{term}`.
  function salesforcePayload(term) {
    const payload = {
      componentDef: "forceSearch:searchPageDesktop",
      attributes: {
        term: String(term),
        scopeMap: { type: "TOP_RESULTS" },
        context: {},
      },
      state: {},
    };
    // btoa is available in injected scripts, options pages, and service workers.
    return btoa(JSON.stringify(payload));
  }

  // Derive the match domain from a URL template by extracting the hostname.
  function matchDomainFor(urlTemplate) {
    try {
      // Replace {term} so URL constructor doesn't choke on the placeholder
      return new URL(urlTemplate.replace(/\{term\}/g, "_")).hostname;
    } catch (_) {
      return "";
    }
  }

  function buildDestinationUrl(dest, term) {
    const tpl = dest.urlTemplate || "";
    let encoded;
    switch (dest.encoding) {
      case "salesforce":
        encoded = salesforcePayload(term);
        break;
      case "raw":
        encoded = String(term);
        break;
      case "plain":
      default:
        encoded = encodeURIComponent(term);
        break;
    }
    if (tpl.includes("{term}")) {
      return tpl.replace(/\{term\}/g, encoded);
    }
    return tpl + encoded;
  }

  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 9);
  }

  globalThis.CtxStorage = {
    DEFAULT_SETTINGS,
    SETTINGS_KEY,
    getSettings,
    saveSettings,
    seedDefaultsIfEmpty,
    matchDomainFor,
    buildDestinationUrl,
    uid,
  };
})();
