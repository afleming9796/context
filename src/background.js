// Context — Background Service Worker
// The brain of the activeTab model:
// - Handles the keyboard commands (toggle/grab/quick-search) and injects the
//   on-demand widget into the active tab under the activeTab grant.
// - Rebuilds the right-click "Context" submenu from configured destinations.
// - Reuses tabs (OPEN_OR_REUSE_TAB) and opens the options page (OPEN_OPTIONS).

importScripts("storage.js");

const S = globalThis.CtxStorage;

// ---- Context menus ----
// Serialize rebuilds so simultaneous callers (onInstalled + cold-start +
// onStartup + storage.onChanged) can't race into duplicate-id errors.

let rebuildChain = Promise.resolve();
function rebuildContextMenus() {
  rebuildChain = rebuildChain.then(doRebuildContextMenus).catch((e) =>
    console.warn("Context: rebuildContextMenus failed", e)
  );
  return rebuildChain;
}

async function doRebuildContextMenus() {
  const settings = await S.getSettings();
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  if (!settings.destinations || !settings.destinations.length) return;

  chrome.contextMenus.create({
    id: "context-parent",
    title: "Context",
    contexts: ["selection"],
  });
  for (const dest of settings.destinations) {
    chrome.contextMenus.create({
      id: `context-dest-${dest.id}`,
      parentId: "context-parent",
      title: `Search in ${dest.label}`,
      contexts: ["selection"],
    });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await S.seedDefaultsIfEmpty();
  rebuildContextMenus();
});

chrome.runtime.onStartup.addListener(rebuildContextMenus);
// Cold SW wake: ensure menus exist.
rebuildContextMenus();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[S.SETTINGS_KEY]) {
    rebuildContextMenus();
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;
  if (!info.menuItemId || !String(info.menuItemId).startsWith("context-dest-")) return;

  const destId = String(info.menuItemId).replace("context-dest-", "");
  const settings = await S.getSettings();
  const dest = settings.destinations.find((d) => d.id === destId);
  if (!dest) return;

  const md = dest.openMode === "new" ? "" : S.matchDomainFor(dest.urlTemplate);
  openOrReuseTab(S.buildDestinationUrl(dest, selectedText), md);
});

// ---- Widget injection ----
// Every entry point runs under an activeTab grant (keyboard command, toolbar
// click), so scripting works on the current tab without host permissions.
// The injected files are idempotent: widget.js defines globalThis.__ctxWidget
// once, and the second executeScript invokes the requested method.

async function widgetCall(tabId, method) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/widget.css"] });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/storage.js", "src/widget.js"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (m) => globalThis.__ctxWidget && globalThis.__ctxWidget[m](),
    args: [method],
  });
}

// ---- Keyboard commands ----
// The widget toggle has no custom command: Chrome's built-in _execute_action
// (bound to a key in the manifest) "clicks" the toolbar icon, which lands in
// action.onClicked below — one code path for keyboard and mouse. The widget
// itself pre-fills any highlighted text when it opens, so the only custom
// commands left are the quick-search slots.

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab || tab.id == null) return;
  try {
    const slot = command.match(/^quick-search-([1-4])$/);
    if (slot) await quickSearch(tab.id, Number(slot[1]) - 1);
  } catch (_) {
    // Restricted page (chrome://, Web Store, PDF viewer): nothing to inject into.
  }
});

// Quick-search slot N = the Nth configured destination, in options-page order.
async function quickSearch(tabId, index) {
  const settings = await S.getSettings();
  const dest = settings.destinations && settings.destinations[index];
  if (!dest) return;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => String(getSelection()).trim(),
  });
  const term = res && res.result;
  if (!term) return;
  const md = dest.openMode === "new" ? "" : S.matchDomainFor(dest.urlTemplate);
  openOrReuseTab(S.buildDestinationUrl(dest, term), md);
}

// ---- Tab reuse ----

function openOrReuseTab(url, matchDomain) {
  chrome.tabs.query({}, (tabs) => {
    const existing = matchDomain
      ? tabs.find((t) => t.url && t.url.includes(matchDomain))
      : null;
    if (existing) {
      chrome.tabs.update(existing.id, { url, active: true }, () => {
        chrome.windows.update(existing.windowId, { focused: true });
      });
    } else {
      chrome.tabs.create({ url });
    }
  });
}

// ---- Toolbar icon ----
// Click toggles the widget on the active tab. If we can't inject there
// (chrome:// pages, the Web Store), settings are the useful fallback.

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab && tab.id != null) {
      await widgetCall(tab.id, "toggle");
    } else {
      chrome.runtime.openOptionsPage();
    }
  } catch (_) {
    chrome.runtime.openOptionsPage();
  }
});

// ---- Messages ----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OPEN_OR_REUSE_TAB") {
    openOrReuseTab(msg.url, msg.matchDomain);
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }
});
