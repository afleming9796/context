// Link-a-roo — Settings page

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

    // The step above hardcodes the suggested key. If Chrome didn't take it (or
    // the user cleared it), rewrite the step rather than telling them to press
    // a key that does nothing.
    if (open.shortcut) {
      document.getElementById("k-open").textContent = open.shortcut;
    } else {
      document.getElementById("way-panel").textContent =
        "Click the Link-a-roo toolbar icon to open the search panel (any " +
        "highlighted text will load in the search bar), then click or tab " +
        "over to one of your destinations.";
    }

    const row = document.createElement("div");
    row.className = "shortcut-row";

    const label = document.createElement("span");
    label.className = "shortcut-label";
    label.append("Open the Link-a-roo panel");
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

  // ---- Tab reuse (optional "tabs" permission) ----
  //
  // Reuse needs to read the addresses of open tabs, which is the one broad
  // thing this extension can ask for — so it is opt-in, and the grant itself
  // is the stored state. There is no separate settings flag to drift out of
  // sync with what Chrome actually allows.

  const TABS_PERM = { permissions: ["tabs"] };
  const reuseToggle = document.getElementById("reuse-toggle");
  const reuseExplainer = document.getElementById("reuse-explainer");
  const reuseNote = document.getElementById("reuse-note");

  async function syncReuseToggle() {
    let granted = false;
    try {
      granted = await chrome.permissions.contains(TABS_PERM);
    } catch (_) {
      /* treat an unreadable grant as "off" */
    }
    reuseToggle.checked = granted;
    reuseExplainer.hidden = true;
    reuseNote.hidden = true;
  }

  reuseToggle.addEventListener("change", async () => {
    if (reuseToggle.checked) {
      // Explain before Chrome's own prompt. The switch stays off until the
      // permission is actually granted, so it never shows a state we don't have.
      reuseToggle.checked = false;
      reuseExplainer.hidden = false;
      return;
    }
    reuseExplainer.hidden = true;

    // remove() reports whether Chrome actually released the permission. It can
    // refuse — notably when the grant predates this build, from back when
    // "tabs" was required rather than optional. Trusting the call instead of
    // its answer is what made the switch flip itself back on with no
    // explanation and a "Tab reuse off" toast that wasn't true.
    let removed = false;
    try {
      removed = await chrome.permissions.remove(TABS_PERM);
    } catch (_) {
      removed = false;
    }

    if (removed) {
      reuseToggle.checked = false;
      reuseNote.hidden = true;
      flash("Tab reuse off");
      return;
    }

    // Put the switch back where reality is, then say why it moved.
    await syncReuseToggle();
    reuseNote.hidden = false;
  });

  document.getElementById("reuse-continue").addEventListener("click", () => {
    // Must be the first call in the handler: awaiting anything first spends the
    // user gesture, and Chrome rejects a permission request without one.
    chrome.permissions
      .request(TABS_PERM)
      .then((granted) => {
        reuseExplainer.hidden = true;
        reuseToggle.checked = granted;
        flash(granted ? "Tab reuse on" : "Permission not granted");
      })
      .catch(() => {
        reuseExplainer.hidden = true;
        reuseToggle.checked = false;
      });
  });

  document.getElementById("reuse-cancel").addEventListener("click", () => {
    reuseExplainer.hidden = true;
    reuseToggle.checked = false;
  });

  // Keep the switch honest if the grant changes elsewhere — chrome://extensions
  // can revoke it while this page is open.
  if (chrome.permissions.onAdded) chrome.permissions.onAdded.addListener(syncReuseToggle);
  if (chrome.permissions.onRemoved) chrome.permissions.onRemoved.addListener(syncReuseToggle);

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
    await syncReuseToggle();
  })();
})();
