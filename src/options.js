// Context — Options page

(function () {
  "use strict";

  const S = globalThis.CtxStorage;

  let state = { sources: [], destinations: [] };
  const sourcesEl = document.getElementById("sources");
  const destsEl = document.getElementById("destinations");
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
    renderSources();
    renderDestinations();
    renderShortcuts();
  }

  function renderSources() {
    sourcesEl.innerHTML = "";
    if (!state.sources.length) {
      sourcesEl.innerHTML = `<div class="empty">No sources yet. Add one to start showing the widget.</div>`;
      return;
    }
    state.sources.forEach((src, idx) => {
      const row = document.createElement("div");
      row.className = "source-card";
      row.innerHTML = `
        <div class="source-top">
          <input class="f-label" placeholder="Label (optional)" />
          <input class="f-pattern" placeholder="https://example.com/path/*" />
          <button class="del" title="Delete">✕</button>
        </div>
        <div class="source-bottom">
          <label class="switch" title="Default the domain toggle to on — strips user@acme.com to acme.com">
            <input type="checkbox" class="f-domain-cb" />
            <span class="switch-track"><span class="switch-thumb"></span></span>
            <span class="switch-label">Domain only by default</span>
          </label>
        </div>
      `;
      const label = row.querySelector(".f-label");
      const pattern = row.querySelector(".f-pattern");
      const domain = row.querySelector(".f-domain-cb");
      label.value = src.label || "";
      pattern.value = src.urlPattern || "";
      domain.checked = !!src.domainOnlyDefault;
      label.addEventListener("input", () => {
        state.sources[idx].label = label.value;
        persist();
      });
      pattern.addEventListener("input", () => {
        state.sources[idx].urlPattern = pattern.value;
        persist();
      });
      domain.addEventListener("change", () => {
        state.sources[idx].domainOnlyDefault = domain.checked;
        persist();
      });
      row.querySelector(".del").addEventListener("click", () => {
        state.sources.splice(idx, 1);
        persist().then(render);
      });
      sourcesEl.appendChild(row);
    });
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
      row.innerHTML = `
        <div class="dest-top">
          <input class="f-label" placeholder="Label" />
          <input class="f-icon" placeholder="Icon" maxlength="2" title="Paste any emoji or symbol" />
          <select class="f-encoding" title="How to encode {term} in the URL">
            <option value="plain">Plain (URL-encode)</option>
            <option value="salesforce">Salesforce componentDef (base64)</option>
            <option value="raw">Raw (no encoding)</option>
          </select>
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

  // ---- Shortcuts ----

  const shortcutsEl = document.getElementById("shortcuts");

  function renderShortcuts() {
    if (!state.shortcuts) state.shortcuts = {};
    const sc = state.shortcuts;
    shortcutsEl.innerHTML = "";

    const globals = [
      { key: "toggle", label: "Toggle widget open / closed" },
      { key: "grabSelection", label: "Grab highlighted text into search bar" },
    ];
    for (const g of globals) {
      const row = makeShortcutRow(g.label, sc[g.key] || "", (val) => {
        state.shortcuts[g.key] = val;
        persist();
      });
      shortcutsEl.appendChild(row);
    }

    if (state.destinations.length) {
      const sep = document.createElement("div");
      sep.className = "shortcut-sep";
      sep.textContent = "Per-destination quick search";
      shortcutsEl.appendChild(sep);

      // Global toggle: should per-destination shortcuts work everywhere
      // (default), or only on configured source pages?
      const everyRow = document.createElement("div");
      everyRow.className = "shortcut-row";
      everyRow.innerHTML = `
        <span class="shortcut-label">Quick-search shortcuts work on any URL</span>
        <label class="switch" title="When off, per-destination shortcuts only fire on pages matching a configured source">
          <input type="checkbox" class="f-everywhere-cb" />
          <span class="switch-track"><span class="switch-thumb"></span></span>
        </label>
      `;
      const everyCb = everyRow.querySelector(".f-everywhere-cb");
      everyCb.checked = sc.everywhere !== false;
      everyCb.addEventListener("change", () => {
        state.shortcuts.everywhere = everyCb.checked;
        persist();
      });
      shortcutsEl.appendChild(everyRow);
    }
    for (const dest of state.destinations) {
      const row = makeShortcutRow(
        `${dest.icon || "→"} ${dest.label}`,
        dest.shortcut || "",
        (val) => {
          dest.shortcut = val;
          persist();
        }
      );
      shortcutsEl.appendChild(row);
    }
  }

  function makeShortcutRow(label, value, onChange) {
    const row = document.createElement("div");
    row.className = "shortcut-row";
    row.innerHTML = `
      <span class="shortcut-label">${label}</span>
      <div class="shortcut-field">
        <input type="text" class="shortcut-input" readonly
               placeholder="Click to record" />
        <button class="shortcut-clear" title="Clear shortcut">✕</button>
      </div>
    `;
    const input = row.querySelector(".shortcut-input");
    const clear = row.querySelector(".shortcut-clear");
    input.value = S.formatShortcut(value);

    input.addEventListener("focus", () => {
      input.value = "";
      input.placeholder = "Press keys...";
      input.classList.add("recording");
    });

    input.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = S.shortcutFromEvent(e);
      if (!combo) return; // lone modifier, ignore
      input.value = S.formatShortcut(combo);
      input.classList.remove("recording");
      input.blur();
      onChange(combo);
    });

    input.addEventListener("blur", () => {
      input.classList.remove("recording");
      if (!input.value) input.value = S.formatShortcut(value);
      input.placeholder = "Click to record";
    });

    clear.addEventListener("click", () => {
      input.value = "";
      onChange("");
    });

    return row;
  }

  // ---- Actions ----

  document.getElementById("add-source").addEventListener("click", () => {
    state.sources.push({
      id: uid("src"),
      label: "",
      urlPattern: "",
    });
    persist().then(render);
  });

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
    render();
  })();
})();
