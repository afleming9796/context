// Context — Settings page

(function () {
  "use strict";

  const S = globalThis.CtxStorage;

  let state = { destinations: [] };
  let editingId = null;
  let slotKeys = [];
  const SLOT_COUNT = 5;

  const shortcutsEl = document.getElementById("shortcuts");
  const destListEl = document.getElementById("dest-list");
  const destFormSection = document.getElementById("dest-form-section");
  const formTitleEl = document.getElementById("form-title");
  const fLabel = document.getElementById("f-label");
  const fTemplate = document.getElementById("f-template");
  const fEncoding = document.getElementById("f-encoding");
  const fNewtab = document.getElementById("f-newtab");
  const saveBtn = document.getElementById("form-save");
  const deleteBtn = document.getElementById("form-delete");
  const statusEl = document.getElementById("status");

  function flash(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("visible");
    setTimeout(() => statusEl.classList.remove("visible"), 1400);
  }

  // ---- Destinations list ----

  function renderDestList() {
    destListEl.innerHTML = "";

    if (!state.destinations.length) {
      const empty = document.createElement("p");
      empty.className = "dest-empty";
      empty.textContent = "No destinations yet. Press + Add to create one.";
      destListEl.appendChild(empty);
      return;
    }

    for (const [i, d] of state.destinations.entries()) {
      const row = document.createElement("div");
      row.className = "dest-row";

      const label = document.createElement("span");
      label.className = "dest-row-label";
      label.textContent = d.label || "(unnamed)";

      const url = document.createElement("span");
      url.className = "dest-row-url";
      url.textContent = d.urlTemplate || "";

      const right = document.createElement("div");
      right.className = "dest-row-right";

      if (slotKeys[i]) {
        const badge = document.createElement("span");
        badge.className = "slot-badge";
        badge.textContent = slotKeys[i];
        right.appendChild(badge);
      }

      const editBtn = document.createElement("button");
      editBtn.className = "secondary";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openDestForm(d.id));
      right.appendChild(editBtn);

      row.append(label, url, right);
      destListEl.appendChild(row);
    }
  }

  document.getElementById("add-dest").addEventListener("click", () => openDestForm(null));

  // ---- Destination form ----

  function validate() {
    saveBtn.disabled = !(fLabel.value.trim() && fTemplate.value.trim());
  }
  fLabel.addEventListener("input", validate);
  fTemplate.addEventListener("input", validate);

  function openDestForm(id) {
    editingId = id;
    const dest = id ? state.destinations.find((d) => d.id === id) : null;
    formTitleEl.textContent = dest ? "Edit destination" : "New destination";
    fLabel.value = dest ? dest.label || "" : "";
    fTemplate.value = dest ? dest.urlTemplate || "" : "";
    fEncoding.value = dest ? dest.encoding || "plain" : "plain";
    fNewtab.checked = dest ? dest.openMode === "new" : false;
    deleteBtn.hidden = !dest;
    validate();
    destFormSection.hidden = false;
    destFormSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    fLabel.focus();
  }

  document.getElementById("form-cancel").addEventListener("click", () => {
    destFormSection.hidden = true;
    editingId = null;
  });

  saveBtn.addEventListener("click", async () => {
    const patch = {
      label: fLabel.value.trim(),
      urlTemplate: fTemplate.value.trim(),
      encoding: fEncoding.value,
      openMode: fNewtab.checked ? "new" : "reuse",
    };
    if (editingId) {
      const dest = state.destinations.find((d) => d.id === editingId);
      Object.assign(dest, patch);
    } else {
      state.destinations.push({ id: S.uid("dest"), ...patch });
    }
    await S.saveSettings(state);
    flash("Saved");
    destFormSection.hidden = true;
    editingId = null;
    renderDestList();
    renderShortcuts();
  });

  deleteBtn.addEventListener("click", async () => {
    state.destinations = state.destinations.filter((d) => d.id !== editingId);
    await S.saveSettings(state);
    flash("Deleted");
    destFormSection.hidden = true;
    editingId = null;
    renderDestList();
    renderShortcuts();
  });

  // ---- Shortcuts (read-only; chrome.commands has no setter by design) ----

  async function renderShortcuts() {
    let commands = [];
    try { commands = await chrome.commands.getAll(); } catch (_) { return; }
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

    // Load slot keys for displaying shortcut badges on destinations.
    try {
      const cmds = await chrome.commands.getAll();
      slotKeys = Array.from({ length: SLOT_COUNT }, (_, i) => {
        const c = cmds.find((x) => x.name === `quick-search-${i + 1}`);
        return c && c.shortcut ? c.shortcut : "";
      });
    } catch (_) {}

    renderDestList();
    await renderShortcuts();
  })();
})();
