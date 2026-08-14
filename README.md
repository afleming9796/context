# Context

A Chrome extension for parameterized shortcuts/bookmarks: highlight "Tommy" anywhere, press a key, and search for "Tommy" in Gmail — in a new tab or the one you already have open.

Context is keyboard-first and permission-light. Nothing runs on any page until you invoke it, and it needs no access to your browsing data at install.

## Features

- **A panel in your toolbar**: click the Context icon (or press the shortcut) to open a search box with your highlighted text already filled in, then pick where to send it.
- **Configurable destinations**: URL templates with a `{term}` placeholder, each with its own label and icon. Add and edit them right in the panel.
- **Quick-search shortcuts**: highlight text and press a slot shortcut to search one of your first five destinations without opening anything.
- **Right-click context menu**: highlight text on any page → search it in any configured destination.
- **Tab reuse**: Context reopens the destination in an existing tab on that site instead of piling up duplicates. Toggle it off per destination.
- **Domain-only toggle**: strip `user@acme.com` to `acme.com` before searching.

Context deliberately keeps no history of what you search — it just opens URLs.

## Permissions

Context uses `activeTab`: it can only read a page at the moment you invoke it, on that one tab, and the grant expires on navigation. There are no host permissions and no content scripts. The `tabs` permission is used solely to find an existing tab to reuse instead of opening a duplicate.

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked** and select the project folder
5. Pin the Context icon in your Chrome toolbar (puzzle-piece menu → pin Context)

Google and Gmail are seeded as default destinations so the panel does something useful immediately, and the settings page opens on first install with a walkthrough.

To pick up new changes after a `git pull`, go to `chrome://extensions` and click the reload icon on the Context card.

## Using it

1. **Add a destination** — open the panel, go to **Destinations**, press **+**. The URL template is the trick: run a search on the site, copy the resulting URL, and replace your search words with `{term}`.
   - `https://www.google.com/search?q={term}`
   - `https://mail.google.com/mail/u/0/#search/{term}`
   - `https://github.com/search?q={term}&type=issues`
2. **Highlight text on any page** — a name, an email address, a ticket ID.
3. **Search it** — open the panel (your selection is pre-filled) and click a destination, or right-click → **Context**, or press a quick-search shortcut.

The quick-search shortcuts also work *inside* the panel: type or edit a term in the box and press `⌥1`/`⌥2`/`⌥3` to send it straight to that destination — no tabbing or clicking. `Enter` sends it to your first destination.

Rebind a slot and the panel follows — it reads the live bindings rather than assuming the defaults.

Some keys can't be caught inside the panel, though, and the panel says which rather than leaving you with a key that appears to do nothing:

- **macOS menu shortcuts** — `⌘H`, `⌥⌘H`, `⌘M`, `⌘W`, `⌘Q`. From a page these fire the quick-search, because Chrome checks extension bindings ahead of the menu bar inside a browser window. The panel is its own window, with no such hook, so the menu bar gets there first and Chrome hides or minimises instead. (`⌘G` isn't a menu item, which is why it works in both places.)
- **Media keys** — Chrome never delivers them to an extension window. They still work from a page.
- **A binding with no modifier** — it would fire while you type in the box.
- **`⌘Space` and `Alt+F4`** — the operating system takes these before Chrome sees them at all, so the slot won't fire anywhere.

### Keyboard shortcuts

Chrome owns these bindings — that's why Context needs no access to the sites you visit. View them on the settings page; change them at `chrome://extensions/shortcuts`. Defaults:

- **Open the Context panel** — `Ctrl+M` (`⌘M` on Mac; if macOS reserves it for window-minimize, rebind it)
- **Quick-search slots 1–3** — `Alt+1` / `Alt+2` / `Alt+3` (`⌥1`–`⌥3` on Mac)
- **Quick-search slots 4 and 5** — unbound by default; assign keys (e.g. `Alt+4` / `Alt+5`) if you want them

Chrome allows an extension to suggest at most four default keys, and Context spends them on opening the panel plus the first three slots — hence slots 4 and 5 arriving unbound rather than unavailable.

Quick-search slots map to your first five destinations, in panel order. They fire both from any page (using the highlighted text) and from inside the panel (using whatever is in the search box).

### Destination options

- **Label** + **Icon** — how the destination looks in the panel. Icon is just a character — paste any emoji (`Cmd+Ctrl+Space` on Mac, `Win+.` on Windows) or symbol from [emojipedia.org](https://emojipedia.org).
- **URL template** — a URL with `{term}` as the search placeholder.
- **Encoding** — how `{term}` is encoded into the URL:
  - **Plain** (URL-encode) — works for most search URLs
  - **Salesforce componentDef (base64)** — wraps the term in a Lightning search payload and base64-encodes it. Use with a template like `https://YOUR-INSTANCE.lightning.force.com/one/one.app#{term}`.
  - **Raw** — substitute the term verbatim
- **Always open a new tab** — off by default, so Context reuses an existing tab on that hostname.

## Layout

- `manifest.json` — MV3 manifest: popup, background worker, and the Chrome-managed commands.
- `src/popup.*` — the toolbar panel: search, destination list, and the add/edit form.
- `src/options.*` — settings page: getting started and shortcut bindings.
- `src/background.js` — context menus, quick-search commands, tab reuse.
- `src/storage.js` — shared settings/URL helpers.
- `src/shortcuts.js` — reads Chrome's quick-search bindings back into something a keypress can be matched against.
