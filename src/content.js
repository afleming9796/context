// Context — Content Script
// Shows a floating search panel on pages matching user-configured sources.
// Each row runs a search against a user-configured destination.
//
// Visibility is binary ("expanded" or "hidden") and is persisted per source
// in chrome.storage.local. The widget is open by default on every configured
// source until the user closes it, and that close is remembered across tabs
// and sessions. The toggle keyboard shortcut and ✕ button flip the state.

(function () {
  "use strict";

  const S = globalThis.CtxStorage;

  let panel = null;
  let lastUrl = location.href;
  let settings = { sources: [], destinations: [], shortcuts: {} };
  let activeSource = null;
  // Current visibility for the active source URL: "expanded" | "hidden"
  let visibility = "expanded";

  // ---- Visibility persistence ----
  // Stored in chrome.storage.local under VISIBILITY_KEY, keyed by source ID.
  // Persists across tabs and sessions: close the widget on one Gmail tab and
  // it stays closed on every other Gmail tab (same matched source) until you
  // reopen it (e.g. via the toggle keyboard shortcut). Default is "expanded"
  // for any source without a saved value.

  function setVisibility(value) {
    visibility = value;
    if (activeSource) {
      S.saveVisibility(activeSource.id, value).catch((e) => {
        if (isContextInvalidated(e)) dispose();
      });
    }
    applyVisibility();
  }

  function applyVisibility() {
    if (!activeSource || visibility === "hidden") {
      destroyPanel();
      return Promise.resolve();
    }
    return renderFull();
  }

  // ---- Tab reuse (ask background) ----

  function openOrReuseTab(url, matchDomain) {
    chrome.runtime.sendMessage({ type: "OPEN_OR_REUSE_TAB", url, matchDomain });
  }

  // ---- Companion signal ----
  // Context itself stores no search history. But on every search — from the
  // widget, the grab-and-search shortcut, the per-destination quick-search
  // shortcut, or the right-click menu — it emits the raw term as a
  // fire-and-forget window message so an OPTIONAL companion extension
  // (context-memory) can remember it. No new permissions, nothing persisted
  // here. Nothing listens by default, so this is a no-op on its own.
  function broadcastSearch(rawTerm, domainOnly) {
    const term = (rawTerm || "").trim();
    if (!term) return;
    try {
      window.postMessage(
        { source: "context", kind: "search", term, domainOnly: !!domainOnly },
        "*"
      );
    } catch (_) {}
  }

  // ---- DOM helpers ----

  function getOrCreatePanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "ctx-panel";
    document.body.appendChild(panel);
    return panel;
  }

  function destroyPanel() {
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  // Gmail (and other apps) install document-level keyboard shortcut
  // handlers in the capture phase that swallow keys like Enter before
  // they reach our inputs. Intercept at window level first.
  function installKeyShield() {
    const shield = (e) => {
      if (panel && e.target instanceof Node && panel.contains(e.target)) {
        e.stopImmediatePropagation();
      }
    };
    for (const ev of ["keydown", "keypress", "keyup"]) {
      window.addEventListener(ev, shield, true);
    }
  }
  installKeyShield();

  // ---- Keyboard shortcuts ----
  // Capture-phase listener on document so we run before site shortcuts.
  // Crucially, per-destination shortcuts work WITHOUT the widget needing
  // to be open or even a source matching the current URL (when
  // shortcuts.everywhere is true). Toggle and grab-selection still need
  // a matched source since they manipulate the widget.

  document.addEventListener("keydown", (e) => {
    if (disposed) return;
    // Don't intercept when typing in the panel's own search input
    if (panel && e.target instanceof Node && panel.contains(e.target)) return;

    const sc = settings.shortcuts || {};
    const everywhere = sc.everywhere !== false;

    // Toggle widget — only meaningful when there's an active source
    if (activeSource && S.matchesShortcut(e, sc.toggle)) {
      e.preventDefault();
      e.stopPropagation();
      setVisibility(visibility === "hidden" ? "expanded" : "hidden");
      return;
    }

    // Grab selection into search bar — needs the widget, so needs a source.
    // Capture the selection synchronously (it's cleared once we focus our
    // own input), then wait for the render to finish before populating.
    // renderFull() is async (it awaits chrome.storage), so a fixed
    // requestAnimationFrame delay races the render and drops the text on
    // the first press when the widget starts hidden — hence issue #10.
    if (activeSource && S.matchesShortcut(e, sc.grabSelection)) {
      e.preventDefault();
      e.stopPropagation();
      const sel = window.getSelection().toString().trim();
      if (!sel) return;
      visibility = "expanded";
      if (activeSource) {
        S.saveVisibility(activeSource.id, "expanded").catch((err) => {
          if (isContextInvalidated(err)) dispose();
        });
      }
      applyVisibility().then(() => {
        const input = panel?.querySelector(".ctx-search-input");
        if (input) {
          input.value = sel;
          input.dispatchEvent(new Event("input"));
          input.focus();
        }
      });
      return;
    }

    // Per-destination quick-search — works on ANY url when `everywhere`
    // is true, even if the widget isn't visible or no source matches.
    if (!settings.destinations) return;
    const allowDestShortcuts = activeSource || everywhere;
    if (!allowDestShortcuts) return;

    for (const dest of settings.destinations) {
      if (!dest.shortcut || !S.matchesShortcut(e, dest.shortcut)) continue;
      e.preventDefault();
      e.stopPropagation();
      const sel = window.getSelection().toString().trim();
      if (!sel) return;
      executeQuickSearch(dest, sel);
      return;
    }
  }, true);

  // Stand-alone search execution that doesn't require the widget to exist.
  // Uses the source's domainOnlyDefault if we're on a matching page,
  // otherwise just searches the raw selection.
  function executeQuickSearch(dest, rawTerm) {
    const domainOnly = activeSource ? !!activeSource.domainOnlyDefault : false;
    const term = domainOnly ? S.domainOf(rawTerm) : rawTerm;
    const md = dest.openMode === "new" ? "" : S.matchDomainFor(dest.urlTemplate);
    broadcastSearch(rawTerm, domainOnly);
    openOrReuseTab(S.buildDestinationUrl(dest, term), md);
  }

  // ---- Rendering ----

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  async function renderFull() {
    const p = getOrCreatePanel();

    if (!settings.destinations.length) {
      p.innerHTML = `
        <div class="ctx-header">
          <span class="ctx-title">Context</span>
          <button class="ctx-options-btn" title="Open settings">⚙</button>
          <button class="ctx-hide-btn" title="Close widget">✕</button>
        </div>
        <div class="ctx-body">
          <div class="ctx-empty">No destinations configured. Open settings to add one.</div>
        </div>
      `;
      attachHeaderHandlers();
      return;
    }

    const domainDefault = activeSource ? !!activeSource.domainOnlyDefault : false;

    p.innerHTML = `
      <div class="ctx-header">
        <span class="ctx-title">Context</span>
        <button class="ctx-options-btn" title="Open settings">⚙</button>
        <button class="ctx-hide-btn" title="Close widget">✕</button>
      </div>
      <div class="ctx-body">
        <div class="ctx-search-top">
          <input
            type="text"
            class="ctx-search-input"
            placeholder="search term"
            spellcheck="false"
            autocomplete="off"
          />
          <label class="ctx-switch" data-tip="domain only">
            <input type="checkbox" class="ctx-domain-cb" />
            <span class="ctx-switch-track"><span class="ctx-switch-thumb"></span></span>
          </label>
        </div>
        <div class="ctx-btn-grid"></div>
      </div>
    `;

    const input = p.querySelector(".ctx-search-input");
    const cb = p.querySelector(".ctx-domain-cb");
    const grid = p.querySelector(".ctx-btn-grid");
    cb.checked = domainDefault;

    function go(dest) {
      const raw = input.value.trim();
      if (!raw) {
        input.classList.add("ctx-shake");
        setTimeout(() => input.classList.remove("ctx-shake"), 400);
        return;
      }
      const term = cb.checked ? S.domainOf(raw) : raw;
      const md = dest.openMode === "new" ? "" : S.matchDomainFor(dest.urlTemplate);
      broadcastSearch(raw, cb.checked);
      openOrReuseTab(S.buildDestinationUrl(dest, term), md);
    }

    for (const dest of settings.destinations) {
      const btn = document.createElement("button");
      btn.className = "ctx-action-btn ctx-search-btn";
      btn.title = dest.label;
      btn.innerHTML = `<span class="ctx-btn-icon">${escapeHtml(dest.icon || "→")}</span> ${escapeHtml(dest.label)}`;
      btn.addEventListener("click", () => go(dest));
      grid.appendChild(btn);
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && settings.destinations.length) go(settings.destinations[0]);
    });

    attachHeaderHandlers();
  }

  function attachHeaderHandlers() {
    if (!panel) return;
    const hideBtn = panel.querySelector(".ctx-hide-btn");
    if (hideBtn) hideBtn.addEventListener("click", () => setVisibility("hidden"));

    const openOptions = () => chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
    const optBtn = panel.querySelector(".ctx-options-btn");
    if (optBtn) optBtn.addEventListener("click", openOptions);
    const title = panel.querySelector(".ctx-title");
    if (title) {
      title.style.cursor = "pointer";
      title.title = "Open settings";
      title.addEventListener("click", openOptions);
    }
  }

  // ---- Page scan ----

  // When the extension is reloaded, old content scripts in existing tabs
  // lose their connection to the extension runtime. Any further chrome.*
  // call throws "Extension context invalidated." Detect that and stop.
  let disposed = false;
  function isContextInvalidated(err) {
    return (
      !chrome.runtime?.id ||
      (err && /Extension context invalidated/i.test(String(err.message || err)))
    );
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    try { observer.disconnect(); } catch (_) {}
    if (pollId) clearInterval(pollId);
    destroyPanel();
  }

  async function onPageChange() {
    if (disposed) return;
    try {
      settings = await S.getSettings();
    } catch (e) {
      if (isContextInvalidated(e)) return dispose();
      throw e;
    }
    const match = S.matchSource(location.href, settings.sources);
    if (!match) {
      activeSource = null;
      destroyPanel();
      return;
    }
    activeSource = match;
    try {
      visibility = await S.getVisibility(match.id);
    } catch (e) {
      if (isContextInvalidated(e)) return dispose();
      visibility = "expanded";
    }
    applyVisibility();
  }

  // ---- SPA navigation detection ----

  function checkUrl() {
    if (disposed) return;
    if (!chrome.runtime?.id) return dispose();
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onPageChange();
    }
  }

  const observer = new MutationObserver(checkUrl);
  observer.observe(document.body, { childList: true, subtree: true });
  const pollId = setInterval(checkUrl, 1500);

  // Re-render only when settings change (and mirror visibility flips from
  // other tabs, below).
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (disposed) return;
      if (area !== "local") return;
      if (changes[S.SETTINGS_KEY]) return onPageChange();
      // If visibility flipped in another tab, mirror it here without
      // re-fetching settings or rebuilding state.
      if (changes[S.VISIBILITY_KEY] && activeSource) {
        const next = changes[S.VISIBILITY_KEY].newValue?.[activeSource.id];
        const newVis = next === "hidden" ? "hidden" : "expanded";
        if (newVis !== visibility) {
          visibility = newVis;
          applyVisibility();
        }
      }
    });
  } catch (e) {
    if (isContextInvalidated(e)) dispose();
  }

  // Toggle requests from the background service worker (toolbar icon click).
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (disposed) return;
      // The right-click "Search in …" menu runs in the background worker,
      // which has no page window to post from. It relays the term here so we
      // can emit the same companion signal as the in-page search paths.
      if (msg?.type === "SEARCH_TERM") {
        broadcastSearch(msg.term, activeSource ? !!activeSource.domainOnlyDefault : false);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type !== "TOGGLE_WIDGET") return;
      if (!activeSource) {
        sendResponse({ ok: false, reason: "no-active-source" });
        return;
      }
      setVisibility(visibility === "hidden" ? "expanded" : "hidden");
      sendResponse({ ok: true });
    });
  } catch (e) {
    if (isContextInvalidated(e)) dispose();
  }

  // ---- Init ----

  onPageChange();
})();
