// Context — popup (the toolbar panel)
//
// This is Context's main surface. Opening it (toolbar click or the Chrome
// shortcut) grants activeTab, so we can read the current page's selection and
// pre-fill the search box — the same "grab the highlighted text" behaviour the
// old injected widget had, without running anything on the page until asked.

(function () {
  "use strict";

  const S = globalThis.CtxStorage;
  const K = globalThis.CtxShortcuts;
  const $ = (sel) => document.querySelector(sel);

  const TIPS_KEY = "tipsDismissed";
  // Quick-search slots, matching the quick-search-N commands in the manifest.
  // Chrome allows at most 4 suggested keys across all commands, so only slots
  // 1-3 ship bound (the fourth default goes to opening the panel); 4 and 5 are
  // there for the user to bind at chrome://extensions/shortcuts.
  const SLOT_COUNT = 5;
  const SHORTCUTS_URL = "chrome://extensions/shortcuts";

  let state = { destinations: [] };
  let editingId = null; // null = adding, otherwise the destination being edited
  // What Chrome says each slot is bound to, indexed by slot: either a combo the
  // panel can match on keydown, or the reason it can't. Slots 4 and 5 ship
  // unbound and any slot can be rebound or cleared, so nothing here is assumed.
  let slotBindings = [];

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

  async function search(dest) {
    const raw = termEl.value.trim();
    if (!raw) {
      termEl.classList.add("shake");
      setTimeout(() => termEl.classList.remove("shake"), 400);
      termEl.focus();
      return;
    }
    const term = domainCb.checked ? S.domainOf(raw) : raw;
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
      const binding = slotBindings[i];
      if (binding && binding.shortcut) {
        const slot = document.createElement("span");
        slot.className = "slot";
        slot.textContent = binding.shortcut;
        // A binding the panel can't intercept may still work on a page, so the
        // badge stays — the tooltip is where the caveat goes.
        if (binding.error) {
          slot.classList.add("slot-broken");
          slot.title =
            binding.scope === "everywhere"
              ? `This key never reaches Context — ${binding.error}.`
              : `Works on a page, but not from this box — ${binding.error}.`;
        }
        btn.appendChild(slot);
      }
      btn.addEventListener("click", () => search(dest));
      destButtonsEl.appendChild(btn);
    });
  }

  termEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && state.destinations.length) search(state.destinations[0]);
  });

  // Slot shortcuts work inside the panel too, so you can type a term and fire
  // it at a destination without reaching for the mouse. Bound on the document
  // so it works wherever focus sits, and handled from every view — while the
  // panel is up the background worker stands aside for the slots we claim, so
  // anything we ignore here would be a key that does nothing at all.
  //
  // Consuming the event is also what keeps this from double-firing: Chrome
  // only dispatches the command to the background once the panel has passed
  // the key back unhandled, and the worker's own popup check backstops that.
  document.addEventListener("keydown", (e) => {
    for (let i = 0; i < slotBindings.length; i++) {
      const binding = slotBindings[i];
      if (!binding || !binding.combo || !K.matches(e, binding.combo)) continue;
      e.preventDefault();
      fireSlot(i);
      return;
    }
  });

  function fireSlot(i) {
    // Searching from the form would close the panel over unsaved edits.
    if ($("#tab-form").classList.contains("active")) {
      flash("Finish or cancel this destination first");
      return;
    }
    const dest = state.destinations[i];
    if (!dest) {
      flash(`Nothing in quick-search slot ${i + 1} yet`);
      return;
    }
    // Fired from the Destinations tab, show what's about to be searched.
    showView("search");
    search(dest);
  }

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
      if (slotBindings[i] && slotBindings[i].shortcut) {
        const slot = document.createElement("span");
        slot.className = "dest-slot";
        slot.textContent = slotBindings[i].shortcut;
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
    if (idx >= SLOT_COUNT) {
      el.innerHTML =
        `Destination ${n}. Only the first ${SLOT_COUNT} get a quick-search ` +
        `shortcut, so this one is reachable from the panel and the ` +
        `right-click menu.`;
      return;
    }
    const binding = slotBindings[idx];
    if (!binding || !binding.shortcut) {
      el.innerHTML =
        `Destination ${n} has no keyboard shortcut yet. Assign one in ${link}.`;
      return;
    }
    if (!binding.error) {
      el.innerHTML =
        `Destination ${n}. Change keyboard shortcut from ` +
        `<code>${esc(binding.shortcut)}</code> in ${link}.`;
      return;
    }
    el.innerHTML =
      `Destination ${n}. <code>${esc(binding.shortcut)}</code> ` +
      (binding.scope === "everywhere"
        ? `never reaches Context — ${esc(binding.error)}.`
        : `searches highlighted text on a page, but can't search this ` +
          `panel's box — ${esc(binding.error)}.`) +
      ` Pick another key in ${link}.`;
  }

  // Binding strings and their failure reasons come from Chrome, but they land
  // in innerHTML next to the settings link, so don't let them carry markup.
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  // These links are rewritten whenever their card re-renders, so delegate from
  // the document rather than re-binding. A plain href can't reach a chrome://
  // page — it has to go through tabs.
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-shortcuts]")) return;
    e.preventDefault();
    chrome.tabs.create({ url: SHORTCUTS_URL });
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
    } catch (e) {
      console.warn("Context: could not read the shortcut bindings", e);
      return;
    }
    slotBindings = Array.from({ length: SLOT_COUNT }, (_, i) => {
      const c = cmds.find((x) => x.name === `quick-search-${i + 1}`);
      return K.describeBinding(c && c.shortcut ? c.shortcut : "");
    });

    for (const [i, b] of slotBindings.entries()) {
      if (!b.error) continue;
      console.error(
        `Context: quick-search slot ${i + 1} is bound to "${b.shortcut}" — ${b.error}. ` +
          (b.scope === "everywhere"
            ? "The slot won't fire from the panel or from a page. "
            : "It still searches the highlighted text on a page, but not this panel's box. ") +
          `Rebind it at ${SHORTCUTS_URL}.`
      );
    }
    await claimSlots();

    const open = cmds.find((c) => c.name === "_execute_action");
    $("#tip-key").textContent = open && open.shortcut ? open.shortcut : "the toolbar icon";

    // Only pitch the quick-search tip with keys that work from the box.
    const usable = slotBindings.filter((b) => b.combo).map((b) => b.shortcut);
    const line = $("#tip-slots");
    if (usable.length) {
      line.querySelector(".keys").textContent = usable.join(" / ");
    } else {
      line.hidden = true;
    }
  }

  // A bound-but-unusable slot is worth saying out loud: the key looks live on
  // the destination button, and pressing it in here would otherwise do nothing.
  function renderSlotWarning() {
    const el = $("#slot-warning");
    // Only for slots that actually point somewhere — an unusable binding on an
    // empty slot isn't costing anyone a search.
    const broken = slotBindings
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => b.error && state.destinations[i]);
    el.hidden = !broken.length;
    if (!broken.length) return;
    const items = broken
      .map(
        ({ b, i }) =>
          `<li><code>${esc(b.shortcut)}</code> (slot ${i + 1}) — ${esc(b.error)}, ` +
          (b.scope === "everywhere"
            ? `so this slot won't fire anywhere.`
            : `so it only searches highlighted text on a page.`) +
          `</li>`
      )
      .join("");
    el.innerHTML =
      `<b>These shortcuts can't search the box above.</b>` +
      `<ul>${items}</ul>` +
      `<a href="#" class="link" data-shortcuts>Rebind them →</a>`;
  }

  // Tell the worker which slots the panel is intercepting. It stays out of the
  // way for those while we're open — but a slot we can't see (a media key, or
  // one Chrome describes in a form we don't know) still has to work from the
  // page, so it must not blanket-ignore every slot.
  async function claimSlots() {
    const claimed = slotBindings
      .map((b, i) => (b.combo ? i : -1))
      .filter((i) => i >= 0);
    try {
      await chrome.storage.session.set({ [K.PANEL_SLOTS_KEY]: claimed });
    } catch (e) {
      console.warn("Context: could not report which slots the panel handles", e);
    }
  }

  // Belt and braces — the worker also checks whether a popup is open, so a
  // claim left behind by a closed panel is inert either way.
  window.addEventListener("pagehide", () => {
    try {
      chrome.storage.session.remove(K.PANEL_SLOTS_KEY);
    } catch (_) {
      /* nothing to clean up */
    }
  });

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
    // Adding or deleting a destination shifts which slots are in play.
    renderSlotWarning();
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
