// Context — Settings page
// Destinations are managed in the popup; this page covers onboarding and
// the (Chrome-owned) shortcut bindings.

(function () {
  "use strict";

  const S = globalThis.CtxStorage;

  let state = { destinations: [] };
  const shortcutsEl = document.getElementById("shortcuts");

  // ---- Shortcuts (read-only; chrome.commands has no setter by design) ----

  async function renderShortcuts() {
    const commands = await chrome.commands.getAll();
    shortcutsEl.innerHTML = "";

    const labelFor = (name) => {
      if (name === "_execute_action") return "Open the Context panel";
      const slot = name.match(/^quick-search-([1-5])$/);
      if (!slot) return null;
      const dest = state.destinations[Number(slot[1]) - 1];
      return dest
        ? `Quick-search: ${dest.label || "(unnamed)"}`
        : `Quick-search slot ${slot[1]} — no destination yet`;
    };

    for (const c of commands) {
      const label = labelFor(c.name);
      if (!label) continue;
      // Mirror the real binding into the getting-started steps.
      if (c.name === "_execute_action" && c.shortcut) {
        const k = document.getElementById("k-open");
        if (k) k.textContent = c.shortcut;
      }
      const row = document.createElement("div");
      row.className = "shortcut-row";
      row.innerHTML = `<span class="shortcut-label"><span class="shortcut-note"></span></span><span class="shortcut-key"></span>`;
      const labelEl = row.querySelector(".shortcut-label");
      labelEl.prepend(label);
      if (c.name === "_execute_action") {
        labelEl.querySelector(".shortcut-note").textContent =
          " (Highlighted text appears as search term)";
      }
      const key = row.querySelector(".shortcut-key");
      if (c.shortcut) {
        key.textContent = c.shortcut;
      } else {
        key.textContent = "not set";
        key.classList.add("unset");
      }
      shortcutsEl.appendChild(row);
    }
  }

  document.getElementById("open-shortcuts").addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  // ---- Init ----

  (async () => {
    state = await S.seedDefaultsIfEmpty();
    if (!state.destinations) state.destinations = [];
    await renderShortcuts();
  })();
})();
