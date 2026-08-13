// Context — On-demand widget
// Injected into the active tab (under an activeTab grant) when the user
// summons Context via a keyboard command or the toolbar icon. Nothing runs
// on any page until then, and the injection dies with the page on
// navigation — there is no persistent content script and no host access.
//
// The background worker injects storage.js + this file, then calls
// globalThis.__ctxWidget.toggle() in a second executeScript. This file only
// defines the widget (idempotently); it takes no action on its own. Opening
// the widget pre-fills any highlighted text. Escape or ✕ dismisses it.

(function () {
  "use strict";

  if (globalThis.__ctxWidget) return;

  const S = globalThis.CtxStorage;

  let panel = null;

  // Gmail (and other apps) install document-level keyboard handlers in the
  // capture phase that swallow keys like Enter before they reach our inputs.
  // Intercept at window level first. Escape closes the widget.
  const shield = (e) => {
    if (!panel || !(e.target instanceof Node) || !panel.contains(e.target)) return;
    if (e.type === "keydown" && e.key === "Escape") {
      destroy();
      e.preventDefault();
    }
    e.stopImmediatePropagation();
  };
  for (const ev of ["keydown", "keypress", "keyup"]) {
    window.addEventListener(ev, shield, true);
  }

  function destroy() {
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  function openOrReuseTab(url, matchDomain) {
    chrome.runtime.sendMessage({ type: "OPEN_OR_REUSE_TAB", url, matchDomain });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  async function show() {
    // Read the selection BEFORE rendering — focusing our input clears it.
    const sel = String(window.getSelection()).trim();
    const settings = await S.getSettings();
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ctx-panel";
      document.body.appendChild(panel);
    }

    if (!settings.destinations || !settings.destinations.length) {
      panel.innerHTML = `
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

    panel.innerHTML = `
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

    const input = panel.querySelector(".ctx-search-input");
    const cb = panel.querySelector(".ctx-domain-cb");
    const grid = panel.querySelector(".ctx-btn-grid");

    function go(dest) {
      const raw = input.value.trim();
      if (!raw) {
        input.classList.add("ctx-shake");
        setTimeout(() => input.classList.remove("ctx-shake"), 400);
        return;
      }
      const term = cb.checked ? S.domainOf(raw) : raw;
      const md = dest.openMode === "new" ? "" : S.matchDomainFor(dest.urlTemplate);
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

    if (sel) input.value = sel;
    attachHeaderHandlers();
    input.focus();
  }

  function attachHeaderHandlers() {
    if (!panel) return;
    const hideBtn = panel.querySelector(".ctx-hide-btn");
    if (hideBtn) hideBtn.addEventListener("click", destroy);

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

  async function toggle() {
    if (panel) destroy();
    else await show();
  }

  globalThis.__ctxWidget = { toggle };
})();
