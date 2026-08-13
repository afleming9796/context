// Context — Settings page
// Destinations are managed in the popup; this page covers onboarding,
// the (Chrome-owned) shortcut bindings, and backup.

(function () {
  "use strict";

  const S = globalThis.CtxStorage;

  let state = { destinations: [] };
  const shortcutsEl = document.getElementById("shortcuts");
  const statusEl = document.getElementById("status");

  function flash(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("visible");
    setTimeout(() => statusEl.classList.remove("visible"), 1500);
  }

  // ---- Shortcuts (read-only; chrome.commands has no setter by design) ----

  async function renderShortcuts() {
    const commands = await chrome.commands.getAll();
    shortcutsEl.innerHTML = "";

    const labelFor = (name) => {
      if (name === "_execute_action") return "Open the Context panel";
      const slot = name.match(/^quick-search-([1-4])$/);
      if (!slot) return null;
      const dest = state.destinations[Number(slot[1]) - 1];
      return dest
        ? `Quick-search: ${dest.icon || "→"} ${dest.label || "(unnamed)"}`
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
      row.innerHTML = `<span class="shortcut-label"></span><span class="shortcut-key"></span>`;
      row.querySelector(".shortcut-label").textContent = label;
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

  // ---- Backup ----

  function download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  document.getElementById("export-settings").addEventListener("click", async () => {
    download(`context-destinations-${dateStamp()}.json`, await S.exportSettingsBackup());
  });

  document.getElementById("import-settings").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        await S.importBackup(JSON.parse(await file.text()));
        state = await S.getSettings();
        await renderShortcuts();
        flash("Imported");
      } catch (e) {
        flash("Import failed: " + e.message);
      }
    });
    input.click();
  });

  // ---- Init ----

  (async () => {
    state = await S.seedDefaultsIfEmpty();
    if (!state.destinations) state.destinations = [];
    await renderShortcuts();
  })();
})();
