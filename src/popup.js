// Context — popup (the toolbar panel)
//
// This is Context's main surface. Opening it (toolbar click or the Chrome
// shortcut) grants activeTab, so we can read the current page's selection and
// pre-fill the search box — the same "grab the highlighted text" behaviour the
// old injected widget had, without running anything on the page until asked.

(function () {
  "use strict";

  const S = globalThis.CtxStorage;
  const $ = (sel) => document.querySelector(sel);

  const TIPS_KEY = "tipsDismissed";
  const SLOT_COUNT = 5;

  let state = { destinations: [] };

  const termEl = $("#term");
  const destButtonsEl = $("#dest-buttons");
  const searchEmptyEl = $("#search-empty");

  // ---- Search ----

  async function search(dest) {
    // Collapse the whitespace a multi-line paste brings with it — a raw newline
    // encodes as %0A and most destinations choke on it.
    const term = termEl.value.trim().replace(/\s+/g, " ");
    if (!term) {
      termEl.classList.add("shake");
      setTimeout(() => termEl.classList.remove("shake"), 400);
      termEl.focus();
      return;
    }
    const matchDomain = dest.openMode === "new" ? "" : S.matchDomainFor(dest.urlTemplate);
    // Wait for the worker to confirm the tab opened before closing. Closing
    // the popup first destroys the sender mid-flight and the search is lost.
    try {
      await chrome.runtime.sendMessage({
        type: "OPEN_OR_REUSE_TAB",
        url: S.buildDestinationUrl(dest, term),
        matchDomain,
      });
    } catch (e) {
      console.warn("Context: search request failed", e);
    }
    window.close();
  }

  function renderSearch() {
    destButtonsEl.innerHTML = "";
    const has = state.destinations.length > 0;
    searchEmptyEl.hidden = has;
    destButtonsEl.hidden = !has;
    $("#shortcuts-tip").hidden = !has;
    termEl.disabled = !has;

    state.destinations.forEach((dest) => {
      const btn = document.createElement("button");
      btn.className = "dest-btn";
      btn.title = dest.urlTemplate || "";
      const label = document.createElement("span");
      label.textContent = dest.label || "(unnamed)";
      btn.append(label);
      btn.addEventListener("click", () => search(dest));
      destButtonsEl.appendChild(btn);
    });
  }

  // ---- Auto-growing search box ----
  //
  // The box is a textarea so a long selection or a pasted paragraph stays
  // readable instead of scrolling past inside a one-line input. It starts one
  // row tall and grows to fit, up to MAX_HEIGHT, after which it scrolls.

  const MAX_HEIGHT = 132; // ~6 lines at the popup's width

  // scrollHeight covers content + padding but not the border, and the box is
  // border-box, so the border has to be added back or the box lands 2px short
  // and shows a scrollbar it doesn't need.
  const borderY = (() => {
    const cs = getComputedStyle(termEl);
    return parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  })();

  function autoGrow() {
    termEl.style.height = "auto";
    termEl.style.height = Math.min(termEl.scrollHeight + borderY, MAX_HEIGHT) + "px";
  }

  termEl.addEventListener("input", autoGrow);

  termEl.addEventListener("keydown", (e) => {
    // Enter searches, as it did when this was an input. Shift+Enter is the
    // escape hatch for an actual newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (state.destinations.length) search(state.destinations[0]);
    }
  });

  function openSettings() {
    chrome.runtime.openOptionsPage();
    window.close();
  }

  $("#open-settings").addEventListener("click", openSettings);
  $("#empty-add").addEventListener("click", openSettings);

  // Pull the highlighted text off the active tab. Fails harmlessly on pages we
  // can't script (chrome://, the Web Store, PDFs) — the box just starts empty.
  async function prefillFromSelection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) return;
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => String(getSelection()).trim(),
      });
      if (res && res.result && !termEl.value) {
        termEl.value = res.result;
        autoGrow();
      }
    } catch (_) {
      /* not scriptable — leave the box empty */
    }
  }

  // ---- Tip card ----

  // Read the live bindings once. The user may have rebound or cleared any of
  // them, and Chrome silently drops a suggested key that clashes with its own.
  async function loadShortcuts() {
    let cmds = [];
    try {
      cmds = await chrome.commands.getAll();
    } catch (_) {
      return;
    }
    const slotKeys = Array.from({ length: SLOT_COUNT }, (_, i) => {
      const c = cmds.find((x) => x.name === `quick-search-${i + 1}`);
      return c && c.shortcut ? c.shortcut : "";
    });

    const open = cmds.find((c) => c.name === "_execute_action");
    $("#tip-key").textContent = open && open.shortcut ? open.shortcut : "the toolbar icon";

    // Only pitch the quick-search tip if at least one slot is actually bound.
    const bound = slotKeys.filter(Boolean);
    const line = $("#tip-slots");
    if (bound.length) {
      line.querySelector(".keys").textContent = bound.join(" / ");
    } else {
      line.hidden = true;
    }
  }

  async function renderTip() {
    const dismissed = await new Promise((r) =>
      chrome.storage.local.get(TIPS_KEY, (v) => r(!!v[TIPS_KEY]))
    );
    if (dismissed || !state.destinations.length) return;
    $("#tip").hidden = false;
  }

  $("#tip-close").addEventListener("click", () => {
    chrome.storage.local.set({ [TIPS_KEY]: true });
    $("#tip").hidden = true;
  });

  $("#tip-more").addEventListener("click", (e) => {
    e.preventDefault();
    openSettings();
  });

  $("#shortcuts-tip-link").addEventListener("click", (e) => {
    e.preventDefault();
    openSettings();
  });

  // ---- Init ----

  (async () => {
    state = await S.seedDefaultsIfEmpty();
    if (!state.destinations) state.destinations = [];
    await loadShortcuts();
    renderSearch();
    await renderTip();
    if (state.destinations.length) {
      termEl.focus();
      await prefillFromSelection();
      termEl.select();
    }
  })();
})();
