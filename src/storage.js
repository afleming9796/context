// Context — Shared storage helpers
// Loaded as a classic script (no modules) from content, background, and options.
// Exposes everything on globalThis.CtxStorage.

(function () {
  "use strict";

  const SETTINGS_KEY = "settings";
  const VISIBILITY_KEY = "visibility";

  const DEFAULT_SETTINGS = {
    sources: [
      {
        id: "src-gmail",
        label: "Gmail",
        urlPattern: "https://mail.google.com/*",
      },
    ],
    destinations: [
      {
        id: "gmail",
        label: "Gmail",
        icon: "✉",
        urlTemplate: "https://mail.google.com/mail/u/0/#search/{term}",
        encoding: "plain",
      },
    ],
    shortcuts: {
      // Cmd+M (Ctrl+M on non-Mac) is unused by most apps and avoids the
      // confusion of Cmd+X = Cut.
      toggle: "Meta+m",
      grabSelection: "Meta+b",
      // Per-destination quick-search shortcuts fire on any URL by default,
      // not just URLs matching a configured source. Toggle/grabSelection
      // still need a configured source page since they need the widget.
      everywhere: true,
    },
  };

  // ---- Shortcut helpers ----

  // Match a KeyboardEvent against a shortcut string like "Meta+x" or "Ctrl+Shift+1"
  function matchesShortcut(e, shortcutStr) {
    if (!shortcutStr) return false;
    const parts = shortcutStr.toLowerCase().split("+");
    const key = parts.pop();
    const mods = new Set(parts);
    return (
      e.key.toLowerCase() === key &&
      e.metaKey === mods.has("meta") &&
      e.ctrlKey === mods.has("ctrl") &&
      e.altKey === mods.has("alt") &&
      e.shiftKey === mods.has("shift")
    );
  }

  // Format a KeyboardEvent into a shortcut string for storage
  function shortcutFromEvent(e) {
    const parts = [];
    if (e.metaKey) parts.push("Meta");
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    // Ignore lone modifier key presses
    if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return null;
    parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    // Require at least one modifier
    if (!e.metaKey && !e.ctrlKey && !e.altKey) return null;
    return parts.join("+");
  }

  // Pretty-print a shortcut string for display (Mac-style symbols)
  function formatShortcut(shortcutStr) {
    if (!shortcutStr) return "";
    const map = { meta: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };
    return shortcutStr
      .split("+")
      .map((p) => map[p.toLowerCase()] || p.toUpperCase())
      .join("");
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(SETTINGS_KEY, (result) => {
        resolve(result[SETTINGS_KEY] || { sources: [], destinations: [] });
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

  // Glob (`*`) → RegExp. Mirrors the subset of chrome match patterns people
  // typically write by hand. Case-insensitive.
  function globToRegExp(glob) {
    const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp("^" + escaped + "$", "i");
  }

  function matchSource(url, sources) {
    if (!sources || !sources.length) return null;
    for (const s of sources) {
      if (!s.urlPattern) continue;
      try {
        if (globToRegExp(s.urlPattern).test(url)) return s;
      } catch (_) {
        // ignore bad patterns
      }
    }
    return null;
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
    // btoa is available in content scripts, options pages, and service workers.
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

  function domainOf(term) {
    const at = term.indexOf("@");
    return at >= 0 ? term.slice(at + 1) : term;
  }

  // ---- Visibility persistence (per source ID, persistent across tabs/sessions) ----

  function getAllVisibility() {
    return new Promise((resolve) => {
      chrome.storage.local.get(VISIBILITY_KEY, (r) => {
        resolve(r[VISIBILITY_KEY] || {});
      });
    });
  }

  // Returns "expanded" or "hidden". Default is "expanded" — the widget is
  // open by default on every configured source until the user closes it.
  async function getVisibility(sourceId) {
    if (!sourceId) return "expanded";
    const all = await getAllVisibility();
    const v = all[sourceId];
    return v === "hidden" ? "hidden" : "expanded";
  }

  async function saveVisibility(sourceId, value) {
    if (!sourceId) return;
    const all = await getAllVisibility();
    all[sourceId] = value === "hidden" ? "hidden" : "expanded";
    return new Promise((resolve) => {
      chrome.storage.local.set({ [VISIBILITY_KEY]: all }, resolve);
    });
  }

  function uid(prefix) {
    return prefix + "-" + Math.random().toString(36).slice(2, 9);
  }

  // Strip internal `id` from sources/destinations for cleaner exports.
  function stripInternals(settings) {
    return {
      sources: (settings.sources || []).map(
        ({ id, defaultState, ...rest }) => rest
      ),
      destinations: (settings.destinations || []).map(
        ({ id, matchDomain, ...rest }) => rest
      ),
    };
  }

  // Re-generate `id` on each source/destination when importing.
  function addIds(settings) {
    return {
      sources: (settings.sources || []).map((s) => ({ id: s.id || uid("src"), ...s })),
      destinations: (settings.destinations || []).map((d) => ({ id: d.id || uid("dest"), ...d })),
    };
  }

  async function exportSettingsBackup() {
    const settings = await getSettings();
    return {
      version: 1,
      kind: "settings",
      exportedAt: new Date().toISOString(),
      settings: stripInternals(settings),
    };
  }

  async function importBackup(data) {
    if (!data || typeof data !== "object") throw new Error("invalid backup");
    if (!data.settings) throw new Error("backup contains no settings");
    return new Promise((resolve) => {
      chrome.storage.local.set({ [SETTINGS_KEY]: addIds(data.settings) }, resolve);
    });
  }

  globalThis.CtxStorage = {
    DEFAULT_SETTINGS,
    SETTINGS_KEY,
    VISIBILITY_KEY,
    getVisibility,
    saveVisibility,
    getAllVisibility,
    getSettings,
    saveSettings,
    seedDefaultsIfEmpty,
    matchSource,
    matchDomainFor,
    buildDestinationUrl,
    domainOf,
    matchesShortcut,
    shortcutFromEvent,
    formatShortcut,
    uid,
    exportSettingsBackup,
    importBackup,
  };
})();
