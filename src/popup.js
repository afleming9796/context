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

  let state = { destinations: [] };
  let editingId = null; // null = adding, otherwise the destination being edited
  // Real quick-search bindings, indexed by slot. Slots 3 and 4 ship unbound,
  // and any of them can be cleared by the user, so we never advertise a key
  // we haven't confirmed with Chrome.
  let slotKeys = [];

  const termEl = $("#term");
  const domainCb = $("#domain-cb");
  const destButtonsEl = $("#dest-buttons");
  const searchEmptyEl = $("#search-empty");
  const destListEl = $("#dest-list");
  const destSearchEl = $("#dest-search");
  const statusEl = $("#status");

  function flash(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("visible");
    setTimeout(() => statusEl.classList.remove("visible"), 1400);
  }

  // ---- View switching ----

  function showView(name) {
    for (const el of document.querySelectorAll(".tab-content")) {
      el.classList.toggle("active", el.id === `tab-${name}`);
    }
    // The form is a sub-view of Destinations; keep that tab lit while it's open.
    const lit = name === "form" ? "destinations" : name;
    for (const t of document.querySelectorAll(".tab[data-tab]")) {
      t.classList.toggle("active", t.dataset.tab === lit);
    }
  }

  for (const t of document.querySelectorAll(".tab[data-tab]")) {
    t.addEventListener("click", () => {
      showView(t.dataset.tab);
      if (t.dataset.tab === "search") termEl.focus();
      if (t.dataset.tab === "destinations") destSearchEl.focus();
    });
  }

  $("#open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // ---- Search ----

  function search(dest) {
    const raw = termEl.value.trim();
    if (!raw) {
      termEl.classList.add("shake");
      setTimeout(() => termEl.classList.remove("shake"), 400);
      termEl.focus();
      return;
    }
    const term = domainCb.checked ? S.domainOf(raw) : raw;
    const matchDomain = dest.openMode === "new" ? "" : S.matchDomainFor(dest.urlTemplate);
    chrome.runtime.sendMessage({
      type: "OPEN_OR_REUSE_TAB",
      url: S.buildDestinationUrl(dest, term),
      matchDomain,
    });
    window.close();
  }

  function renderSearch() {
    destButtonsEl.innerHTML = "";
    const has = state.destinations.length > 0;
    searchEmptyEl.hidden = has;
    destButtonsEl.hidden = !has;
    $("#domain-wrap").hidden = !has;
    termEl.disabled = !has;

    state.destinations.forEach((dest, i) => {
      const btn = document.createElement("button");
      btn.className = "dest-btn";
      btn.title = dest.urlTemplate || "";
      const icon = document.createElement("span");
      icon.textContent = dest.icon || "→";
      const label = document.createElement("span");
      label.textContent = dest.label || "(unnamed)";
      btn.append(icon, label);
      if (slotKeys[i]) {
        const slot = document.createElement("span");
        slot.className = "slot";
        slot.textContent = slotKeys[i];
        btn.appendChild(slot);
      }
      btn.addEventListener("click", () => search(dest));
      destButtonsEl.appendChild(btn);
    });
  }

  termEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && state.destinations.length) search(state.destinations[0]);
  });

  $("#empty-add").addEventListener("click", () => openForm(null));

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
      if (res && res.result && !termEl.value) termEl.value = res.result;
    } catch (_) {
      /* not scriptable — leave the box empty */
    }
  }

  // ---- Destinations list ----

  function renderList() {
    const q = destSearchEl.value.trim().toLowerCase();
    destListEl.innerHTML = "";

    const matches = state.destinations
      .map((d, i) => ({ d, i }))
      .filter(({ d }) =>
        !q ||
        (d.label || "").toLowerCase().includes(q) ||
        (d.urlTemplate || "").toLowerCase().includes(q)
      );

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "list-empty";
      empty.textContent = state.destinations.length
        ? "No destinations match that search."
        : "No destinations yet. Press + to add one.";
      destListEl.appendChild(empty);
      return;
    }

    for (const { d, i } of matches) {
      const li = document.createElement("li");
      li.className = "dest-item";
      li.innerHTML = `
        <span class="dest-icon"></span>
        <span class="dest-main">
          <span class="dest-label"></span>
          <div class="dest-url"></div>
        </span>
      `;
      li.querySelector(".dest-icon").textContent = d.icon || "→";
      li.querySelector(".dest-label").textContent = d.label || "(unnamed)";
      li.querySelector(".dest-url").textContent = d.urlTemplate || "";
      if (slotKeys[i]) {
        const slot = document.createElement("span");
        slot.className = "dest-slot";
        slot.textContent = slotKeys[i];
        li.appendChild(slot);
      }
      li.addEventListener("click", () => openForm(d.id));
      destListEl.appendChild(li);
    }
  }

  destSearchEl.addEventListener("input", renderList);
  $("#add-dest").addEventListener("click", () => openForm(null));

  // ---- Destination form ----

  const fIcon = $("#f-icon");
  const fLabel = $("#f-label");
  const fTemplate = $("#f-template");
  const fEncoding = $("#f-encoding");
  const fNewtab = $("#f-newtab");
  const saveBtn = $("#form-save");
  const deleteBtn = $("#form-delete");

  function validate() {
    const ok = fLabel.value.trim() && fTemplate.value.trim();
    saveBtn.disabled = !ok;
  }
  for (const el of [fLabel, fTemplate]) el.addEventListener("input", validate);

  // Which quick-search slot this destination occupies, and how to rebind it.
  // A new destination lands at the end, so its slot is the current length.
  function renderSlotHint(idx) {
    const el = $("#slot-hint");
    const n = idx + 1;
    const link = `<a href="#" class="link" data-shortcuts>Chrome shortcut settings</a>`;
    if (idx >= 4) {
      el.innerHTML =
        `Destination ${n}. Only the first four get a quick-search shortcut, ` +
        `so this one is reachable from the panel and the right-click menu.`;
      return;
    }
    const key = slotKeys[idx];
    el.innerHTML = key
      ? `Destination ${n}. Change keyboard shortcut from <code>${key}</code> in ${link}.`
      : `Destination ${n} has no keyboard shortcut yet. Assign one in ${link}.`;
  }

  // The link is rewritten on every open, so delegate rather than re-binding.
  // A plain href can't reach a chrome:// page — it has to go through tabs.
  $("#slot-hint").addEventListener("click", (e) => {
    if (!e.target.closest("[data-shortcuts]")) return;
    e.preventDefault();
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    window.close();
  });

  function openForm(id) {
    editingId = id;
    const dest = id ? state.destinations.find((d) => d.id === id) : null;
    const idx = id
      ? state.destinations.findIndex((d) => d.id === id)
      : state.destinations.length;
    $("#form-title").textContent = dest
      ? `Edit destination ${idx + 1}`
      : "New destination";
    renderSlotHint(idx);
    fIcon.value = dest ? dest.icon || "" : "";
    fLabel.value = dest ? dest.label || "" : "";
    fTemplate.value = dest ? dest.urlTemplate || "" : "";
    fEncoding.value = dest ? dest.encoding || "plain" : "plain";
    fNewtab.checked = dest ? dest.openMode === "new" : false;
    deleteBtn.hidden = !dest;
    validate();
    showView("form");
    (dest ? fLabel : fIcon).focus();
  }

  $("#form-cancel").addEventListener("click", () => showView("destinations"));

  saveBtn.addEventListener("click", async () => {
    const patch = {
      icon: fIcon.value.trim() || "→",
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
    renderAll();
    showView("destinations");
  });

  deleteBtn.addEventListener("click", async () => {
    state.destinations = state.destinations.filter((d) => d.id !== editingId);
    await S.saveSettings(state);
    flash("Deleted");
    renderAll();
    showView("destinations");
  });

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
    slotKeys = [1, 2, 3, 4].map((n) => {
      const c = cmds.find((x) => x.name === `quick-search-${n}`);
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
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // ---- Init ----

  function renderAll() {
    renderSearch();
    renderList();
  }

  (async () => {
    state = await S.seedDefaultsIfEmpty();
    if (!state.destinations) state.destinations = [];
    await loadShortcuts();
    renderAll();
    await renderTip();
    if (state.destinations.length) {
      termEl.focus();
      await prefillFromSelection();
      termEl.select();
    } else {
      showView("search");
    }
  })();
})();
