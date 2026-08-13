// Context — Options page

(function () {
  "use strict";

  const S = globalThis.CtxStorage;

  let state = { destinations: [] };
  const destsEl = document.getElementById("destinations");
  const shortcutsEl = document.getElementById("shortcuts");
  const statusEl = document.getElementById("status");

  const uid = S.uid;

  function flash(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("visible");
    setTimeout(() => statusEl.classList.remove("visible"), 1500);
  }

  async function persist() {
    await S.saveSettings(state);
    flash("Saved");
  }

  // ---- Rendering ----

  function render() {
    renderDestinations();
    renderShortcuts();
  }

  function renderDestinations() {
    destsEl.innerHTML = "";
    if (!state.destinations.length) {
      destsEl.innerHTML = `<div class="empty">No destinations yet.</div>`;
      return;
    }
    state.destinations.forEach((dest, idx) => {
      const row = document.createElement("div");
      row.className = "dest-card";
      const slot = idx < 4 ? `<span class="slot-badge" title="Quick-search slot ${idx + 1}">⌨ slot ${idx + 1}</span>` : "";
      row.innerHTML = `
        <div class="dest-top">
          <input class="f-label" placeholder="Label" />
          <input class="f-icon" placeholder="Icon" maxlength="2" title="Paste any emoji or symbol" />
          <select class="f-encoding" title="How to encode {term} in the URL">
            <option value="plain">Plain (URL-encode)</option>
            <option value="salesforce">Salesforce componentDef (base64)</option>
            <option value="raw">Raw (no encoding)</option>
          </select>
          ${slot}
          <button class="del" title="Delete">✕</button>
        </div>
        <label class="field">
          <span class="field-label">URL template</span>
          <input class="f-template" placeholder="https://example.com/search?q={term}" />
        </label>
        <div class="dest-bottom">
          <label class="switch" title="Open in a new tab every time (don't reuse existing)">
            <input type="checkbox" class="f-newtab-cb" />
            <span class="switch-track"><span class="switch-thumb"></span></span>
            <span class="switch-label">Always open new tab</span>
          </label>
        </div>
      `;
      const label = row.querySelector(".f-label");
      const icon = row.querySelector(".f-icon");
      const tpl = row.querySelector(".f-template");
      const enc = row.querySelector(".f-encoding");
      const nt = row.querySelector(".f-newtab-cb");
      label.value = dest.label || "";
      icon.value = dest.icon || "";
      tpl.value = dest.urlTemplate || "";
      enc.value = dest.encoding || "plain";
      nt.checked = dest.openMode === "new";

      const bind = (el, key, isBool, transform) => {
        el.addEventListener(isBool ? "change" : "input", () => {
          const value = isBool ? el.checked : el.value;
          state.destinations[idx][key] = transform ? transform(value) : value;
          persist();
        });
      };
      bind(label, "label");
      bind(icon, "icon");
      bind(tpl, "urlTemplate");
      bind(enc, "encoding");
      bind(nt, "openMode", true, (v) => (v ? "new" : "reuse"));

      row.querySelector(".del").addEventListener("click", () => {
        state.destinations.splice(idx, 1);
        persist().then(render);
      });
      destsEl.appendChild(row);
    });
  }

  // ---- Shortcuts (read-only; Chrome owns the bindings) ----

  async function renderShortcuts() {
    const commands = await chrome.commands.getAll();
    shortcutsEl.innerHTML = "";

    const labelFor = (name) => {
      // _execute_action is Chrome's built-in "activate the extension" command;
      // for Context that toggles the widget (pre-filled with any selection).
      if (name === "_execute_action") return "Toggle widget on this tab";
      const slot = name.match(/^quick-search-([1-4])$/);
      if (slot) {
        const dest = state.destinations[Number(slot[1]) - 1];
        return dest
          ? `Quick-search: ${dest.icon || "→"} ${dest.label || "(unnamed)"}`
          : `Quick-search slot ${slot[1]} — no destination yet`;
      }
      return null;
    };

    for (const c of commands) {
      const label = labelFor(c.name);
      if (!label) continue; // skip unknowns
      const row = document.createElement("div");
      row.className = "shortcut-row";
      row.innerHTML = `
        <span class="shortcut-label"></span>
        <span class="shortcut-key"></span>
      `;
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

  // ---- Actions ----

  document.getElementById("add-dest").addEventListener("click", () => {
    state.destinations.push({
      id: uid("dest"),
      label: "New",
      icon: "→",
      urlTemplate: "https://example.com/search?q={term}",
      openMode: "reuse",
      encoding: "plain",
    });
    persist().then(render);
  });

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

  function pickAndImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await S.importBackup(data);
        state = await S.getSettings();
        render();
        flash("Imported");
      } catch (e) {
        flash("Import failed: " + e.message);
      }
    });
    input.click();
  }

  document.getElementById("export-settings").addEventListener("click", async () => {
    download(`context-settings-${dateStamp()}.json`, await S.exportSettingsBackup());
  });
  document.getElementById("import-settings").addEventListener("click", pickAndImport);

  // ---- Init ----

  (async () => {
    state = await S.seedDefaultsIfEmpty();
    if (!state.destinations) state.destinations = [];
    render();
  })();
})();
