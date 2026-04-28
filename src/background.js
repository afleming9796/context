// Context — Background Service Worker
// - Rebuilds the right-click "Context" submenu from user-configured destinations.
// - Handles OPEN_OR_REUSE_TAB from content/options and OPEN_OPTIONS requests.

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

  const term = selectedText;
  const md = dest.openMode === "new" ? "" : S.matchDomainFor(dest.urlTemplate);
  openOrReuseTab(S.buildDestinationUrl(dest, term), md);
});

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
// Click the extension's toolbar icon to toggle the widget on the active tab.
// If the active tab doesn't match any configured source (so there's no widget
// to toggle), open the options page instead so the user can configure one.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    const settings = await S.getSettings();
    const matched = S.matchSource(tab.url || "", settings.sources);
    if (!matched) {
      chrome.runtime.openOptionsPage();
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_WIDGET" }, () => {
      // If the content script isn't listening (e.g. the page hasn't finished
      // loading or we don't have permission), fall back to options.
      if (chrome.runtime.lastError) chrome.runtime.openOptionsPage();
    });
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
