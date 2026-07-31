# Context

A Chrome extension for parameterized shortcuts/bookmarks, e.g. highight "Tommy" and select cmd+g to search for "Tommy" in a new or existing gmail tab. 

## Features

- **Configurable sources**: URL patterns (with `*` wildcards) decide where the widget appears. The widget is hidden everywhere else.
- - **Persistent open/closed state**: close the widget on a source and it stays closed on every matching page across tabs and sessions.
- **Configurable destinations**: URL templates with a `{term}` placeholder, each with its own label/icon. Tab reuse comes for free.
- **Domain-only toggle**: strip `user@acme.com` to `acme.com` before searching. Default is per-source so it matches your workflow.
- **Right-click context menu**: highlight text on any page → search it in any configured destination.
- **Keyboard shortcuts** (configurable):
  - Toggle the widget open/closed (default: `Cmd+M`)
  - Grab highlighted text into the search bar (default: `Cmd+B`)
  - Quick-search a destination with the highlighted text — works on any URL, not just configured sources
- **Toolbar icon**: click the Context icon in your Chrome toolbar to toggle the widget on the current page.
- **JSON backup / restore** for your settings.

Context deliberately keeps no history of what you search — it just opens URLs. If you want the search bar to remember and pre-fill the last term per page, install the companion **[context-memory](https://github.com/afleming9796/context-memory)** extension alongside it; that keeps the stored-search-history surface out of Context itself.

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked** and select the project folder
5. Pin the Context icon in your Chrome toolbar (puzzle-piece menu → pin Context) so you can click it to toggle the widget anywhere

Gmail is seeded as a default source and destination so the widget is useful immediately. Add your own in the options page.

To pick up new changes after a `git pull`, go to `chrome://extensions` and click the reload icon on the Context card.

## Configuring

Open the options page either by clicking the Context toolbar icon on a non-source page, or via `chrome://extensions → Context → Details → Extension options`.

### Sources — where Context appears

Each source is a URL pattern. Use `*` as a wildcard. Examples:

- `https://github.com/*/issues*` — show on any GitHub repo's issues
- `https://*.atlassian.net/browse/*` — show on every Jira ticket page
- `https://mail.google.com/*` — show throughout Gmail

Per-source options:

- **Domain only by default** — set the domain-strip toggle to on by default for this source

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

### Keyboard shortcuts

In the options page, click any shortcut field and press a key combo to record it. Shortcuts require at least one modifier key (⌘, ⌃, ⌥). Click ✕ to clear.

Per-destination shortcuts grab the highlighted text on the page and search immediately — no widget interaction needed. By default they work on any URL, not just configured sources. Toggle that off in settings if you want them gated to source pages only.

## Backup

The options page can **Export / Import settings** — sources, destinations, and shortcut bindings — as a JSON file. Share it with a coworker or move your config between machines. Back up before uninstalling — Chrome wipes local storage on a full uninstall/reinstall.
