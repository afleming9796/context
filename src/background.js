// Link-a-roo — Background Service Worker
// - Rebuilds the right-click "Link-a-roo" submenu from configured destinations.
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
    console.warn("Link-a-roo: rebuildContextMenus failed", e)
  );
  return rebuildChain;
}

async function doRebuildContextMenus() {
  const settings = await S.getSettings();
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  if (!settings.destinations || !settings.destinations.length) return;

  chrome.contextMenus.create({
    id: "context-parent",
    title: "Link-a-roo",
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

// ---- Legacy data cleanup ----

// Keys written by earlier versions and never read since. "lastSearch" is the
// important one: the remember-searches feature was split out into a separate
// companion extension, but the search terms it had already written stayed in
// local storage. The extension has no use for them and claims to keep no
// search history, so clear them out rather than carrying them forever.
const LEGACY_KEYS = ["lastSearch", "visibility", "panelSlots"];

function purgeLegacyKeys() {
  // Removing absent keys is a no-op, so this is safe to run repeatedly.
  return chrome.storage.local.remove(LEGACY_KEYS);
}

// First install: open the settings page, which is where the getting-started
// walkthrough lives. Without this, a new user has an icon and no idea what a
// "destination" is.
chrome.runtime.onInstalled.addListener(async (details) => {
  await purgeLegacyKeys();
  await S.seedDefaultsIfEmpty();
  rebuildContextMenus();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => {
  purgeLegacyKeys();
  rebuildContextMenus();
});
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
  await openOrReuseTab(S.buildDestinationUrl(dest, selectedText), md);
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
  await openOrReuseTab(S.buildDestinationUrl(dest, term), md);
}

// ---- Tab reuse ----

// Compare hosts, not raw URL substrings: "google.com" is a substring of
// "mail.google.com", so substring matching would send a Google search to the
// user's Gmail tab. www is ignored so example.com and www.example.com pair up.
function sameHost(a, b) {
  if (!a || !b) return false;
  const strip = (h) => h.replace(/^www\./, "");
  return strip(a) === strip(b);
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return "";
  }
}

// Awaitable so callers can keep the service worker alive until the tab has
// actually been opened or navigated. Any failure in the reuse path falls
// through to opening a new tab — a search should never silently go nowhere.
async function openOrReuseTab(url, matchDomain) {
  if (matchDomain) {
    try {
      const tabs = await chrome.tabs.query({});
      const existing = tabs.find((t) => sameHost(hostOf(t.url), matchDomain));
      if (existing) {
        await chrome.tabs.update(existing.id, { url, active: true });
        try {
          await chrome.windows.update(existing.windowId, { focused: true });
        } catch (_) {
          // Focusing is a nicety; the tab already navigated.
        }
        return;
      }
    } catch (e) {
      console.warn("Link-a-roo: could not reuse a tab, opening a new one", e);
    }
  }
  await chrome.tabs.create({ url });
}

// ---- Messages ----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OPEN_OR_REUSE_TAB") {
    // Respond only once the tab has actually opened. Answering immediately
    // marks the event handled, letting Chrome tear down the worker (and the
    // popup that sent this has already closed) before the navigation runs.
    openOrReuseTab(msg.url, msg.matchDomain)
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: String(e) }));
    return true;
  }
  if (msg.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }
});
