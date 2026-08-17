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

      // The first five destinations own the quick-search slots, so the binding
      // belongs on the row rather than in a separate list that repeats it.
      if (i < SLOT_COUNT) {
        const badge = document.createElement("span");
        badge.className = slotKeys[i] ? "slot-badge" : "slot-badge unset";
        badge.textContent = slotKeys[i] || "no shortcut";
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

  function closeDestForm() {
    destFormSection.hidden = true;
    editingId = null;
  }

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

  document.getElementById("form-cancel").addEventListener("click", closeDestForm);

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
    closeDestForm();
    renderDestList();
  });

  deleteBtn.addEventListener("click", async () => {
    const dest = state.destinations.find((d) => d.id === editingId);
    if (!dest) return;
    const name = dest.label || "this destination";
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    state.destinations = state.destinations.filter((d) => d.id !== editingId);
    await S.saveSettings(state);
    flash("Deleted");
    closeDestForm();
    renderDestList();
  });

  // ---- Shortcuts (read-only; chrome.commands has no setter by design) ----

  // Quick-search bindings live on the destination rows as badges; all that's
  // left here is the one shortcut with no destination of its own.
  function renderOpenShortcut(cmds) {
    shortcutsEl.innerHTML = "";
    const open = cmds.find((c) => c.name === "_execute_action");
    if (!open) return;

    if (open.shortcut) document.getElementById("k-open").textContent = open.shortcut;

    const row = document.createElement("div");
    row.className = "shortcut-row";

    const label = document.createElement("span");
    label.className = "shortcut-label";
    label.append("Open the Context panel");
    const note = document.createElement("span");
    note.className = "shortcut-note";
    note.textContent = " (highlighted text appears as the search term)";
    label.append(note);

    const key = document.createElement("span");
    key.className = open.shortcut ? "shortcut-key" : "shortcut-key unset";
    key.textContent = open.shortcut || "not set";

    row.append(label, key);
    shortcutsEl.appendChild(row);
  }

  document.getElementById("open-shortcuts").addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  // ---- Init ----

  (async () => {
    state = await S.seedDefaultsIfEmpty();
    if (!state.destinations) state.destinations = [];

    let cmds = [];
    try {
      cmds = await chrome.commands.getAll();
    } catch (_) {
      /* commands unavailable — rows just render without keys */
    }
    slotKeys = Array.from({ length: SLOT_COUNT }, (_, i) => {
      const c = cmds.find((x) => x.name === `quick-search-${i + 1}`);
      return c && c.shortcut ? c.shortcut : "";
    });

    renderDestList();
    renderOpenShortcut(cmds);
  })();
})();
