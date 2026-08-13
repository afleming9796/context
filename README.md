# Context

A Chrome extension for parameterized shortcuts/bookmarks, e.g. highlight "Tommy" and press a shortcut to search for "Tommy" in a new or existing Gmail tab.

Context is keyboard-first and permission-light: nothing runs on any page until you summon it, and it needs no access to site data at install.

## Features

- **Configurable destinations**: URL templates with a `{term}` placeholder, each with its own label/icon. Tab reuse comes for free.
- **Quick-search shortcuts**: highlight text on any page and press a slot shortcut to search it in one of your first four destinations — no widget needed.
- **On-demand widget**: press the toggle shortcut (or click the toolbar icon) to summon a search panel on the current tab; press Escape or ✕ to dismiss it. Grab the highlighted text into it with the grab shortcut.
- **Right-click context menu**: highlight text on any page → search it in any configured destination.
- **Domain-only toggle**: strip `user@acme.com` to `acme.com` before searching.
- **JSON backup / restore** for your settings.

Context deliberately keeps no history of what you search — it just opens URLs.

## Permissions

Context uses `activeTab`: it can only touch a page at the moment you invoke it, on that tab only, and the grant expires on navigation. There are no host permissions and no content scripts — nothing runs anywhere until you press a shortcut. The `tabs` permission is used solely to find an existing tab to reuse instead of opening a duplicate.

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked** and select the project folder
5. Pin the Context icon in your Chrome toolbar (puzzle-piece menu → pin Context) so you can click it to toggle the widget anywhere

Gmail is seeded as a default destination so Context is useful immediately. Add your own in the options page.

To pick up new changes after a `git pull`, go to `chrome://extensions` and click the reload icon on the Context card.

## Keyboard shortcuts

Shortcuts are managed by Chrome at `chrome://extensions/shortcuts` (the options page links there). Defaults:

- **Toggle widget** — `Ctrl+M` (`⌘M` on Mac; if macOS reserves it for window-minimize, rebind it)
- **Grab highlighted text into the widget** — `Ctrl+B` / `⌘B`
- **Quick-search slot 1 / 2** — `Ctrl+Shift+1` / `Ctrl+Shift+2` (`⌘⇧1` / `⌘⇧2` on Mac)
- **Quick-search slots 3 and 4** — unbound by default; assign keys in `chrome://extensions/shortcuts`

Quick-search slots map to your first four destinations, in options-page order.

## Configuring

Open the options page by clicking ⚙ in the widget, or via `chrome://extensions → Context → Details → Extension options`.

### Destinations — what Context searches

Each destination needs:

- **Label** + **Icon** — how the button looks in the widget. Icon is just a character — paste any emoji (`Cmd+Ctrl+Space` on Mac, `Win+.` on Windows) or symbol from [emojipedia.org](https://emojipedia.org).
- **URL template** — a URL with `{term}` as the search placeholder. Examples:
  - `https://mail.google.com/mail/u/0/#search/{term}`
  - `https://github.com/search?q={term}&type=issues`
  - `https://www.google.com/search?q={term}`
- **Encoding** — how `{term}` is encoded into the URL:
  - **Plain** (URL-encode) — works for most search URLs
  - **Salesforce componentDef (base64)** — wraps the term in a Lightning search payload and base64-encodes it. Use with a template like `https://YOUR-INSTANCE.lightning.force.com/one/one.app#{term}`.
  - **Raw** — substitute the term verbatim
- **Always open new tab** — by default Context reuses an existing tab matching the destination's hostname. Turn this on for destinations where you'd rather get a fresh tab every time.

## Backup

The options page can **Export / Import settings** — your destinations — as a JSON file. Share it with a coworker or move your config between machines. Back up before uninstalling — Chrome wipes local storage on a full uninstall/reinstall.
