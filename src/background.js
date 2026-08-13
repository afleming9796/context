// Context — Background Service Worker
// - Rebuilds the right-click "Context" submenu from configured destinations.
// - Handles the quick-search keyboard slots (read the selection under an
//   activeTab grant, then open the destination).
// - Reuses tabs and opens the settings page on first install.
//
// The main UI is the toolbar popup (src/popup.html); nothing is injected into
// pages except the one-line selection read below, and only when invoked.

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

// First install: open the settings page, which is where the getting-started
// walkthrough lives. Without this, a new user has an icon and no idea what a
// "destination" is.
chrome.runtime.onInstalled.addListener(async (details) => {
  await S.seedDefaultsIfEmpty();
  rebuildContextMenus();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
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

// ---- Quick-search commands ----
// Invoking a commands-API shortcut grants activeTab on the current tab, which
// is what lets us read the selection without any host permission.

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab || tab.id == null) return;
  const slot = command.match(/^quick-search-([1-5])$/);
  if (!slot) return;
  try {
    await quickSearch(tab.id, Number(slot[1]) - 1);
  } catch (_) {
    // Restricted page (chrome://, Web Store, PDF viewer): nothing to read.
  }
});

// Quick-search slot N = the Nth configured destination, in panel order.
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
