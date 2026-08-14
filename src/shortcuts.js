// Context — Quick-search binding helpers
//
// Chrome owns the quick-search bindings, and the user is free to rebind them
// to anything the commands API allows at chrome://extensions/shortcuts. The
// panel re-implements those bindings so a term typed into the search box can
// be fired at a destination, which means turning Chrome's display string
// ("Alt+1", "⌥1", "Ctrl+Shift+Comma", "⌥⇞") back into something a keydown can
// be compared against — and saying so plainly when a binding is one the panel
// cannot act on, rather than leaving a key that silently does nothing.
//
// Loaded as a classic script from the popup and the settings page, and via
// importScripts from the background worker. Exposes globalThis.CtxShortcuts.

(function () {
  "use strict";

  if (globalThis.CtxShortcuts) return;

  // Slots the open panel is intercepting itself. Written to storage.session by
  // the popup, read by the background worker so it only steps aside for the
  // commands the panel can actually see.
  const PANEL_SLOTS_KEY = "panelSlots";

  // Every non-alphanumeric key chrome://extensions/shortcuts accepts, mapped to
  // the KeyboardEvent.code the panel will see. Letters, digits and function
  // keys are derived below rather than listed here.
  const NAMED_CODES = {
    comma: "Comma",
    period: "Period",
    space: "Space",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    insert: "Insert",
    delete: "Delete",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  };

  // macOS renders the same bindings as glyphs instead of words.
  const MAC_GLYPHS = {
    "↑": "up",
    "↓": "down",
    "←": "left",
    "→": "right",
    "⇞": "pageup",
    "⇟": "pagedown",
    "↖": "home",
    "↘": "end",
    "⌦": "delete",
    "⌫": "delete",
    "⎀": "insert",
    "␣": "space",
    ",": "comma",
    ".": "period",
    "⏭": "medianexttrack",
    "⏯": "mediaplaypause",
    "⏮": "mediaprevtrack",
    "⏹": "mediastop",
  };

  // Split a binding into modifiers and a raw key token. Chrome uses symbols on
  // macOS ("⌥⇧1") and plus-form everywhere else ("Alt+Shift+1").
  function parseShortcut(str) {
    if (!str) return null;
    const mods = { meta: false, ctrl: false, alt: false, shift: false };
    let key = "";
    if (/[⌘⌥⌃⇧]/.test(str)) {
      for (const ch of str) {
        if (ch === "⌘") mods.meta = true;
        else if (ch === "⌥") mods.alt = true;
        else if (ch === "⌃") mods.ctrl = true;
        else if (ch === "⇧") mods.shift = true;
        else key += ch;
      }
    } else {
      const parts = str.split("+");
      key = parts.pop() || "";
      for (const p of parts) {
        const l = p.trim().toLowerCase();
        // "Search" is the ChromeOS launcher key, which arrives as metaKey.
        if (l === "command" || l === "meta" || l === "search") mods.meta = true;
        else if (l === "ctrl" || l === "control" || l === "macctrl") mods.ctrl = true;
        else if (l === "alt" || l === "option") mods.alt = true;
        else if (l === "shift") mods.shift = true;
      }
    }
    return { ...mods, key: key.trim() };
  }

  // Reduce a key token to a canonical lowercase name: "Comma", "⇞" and
  // "Page Up" all end up as recognisable single words.
  function canonicalKey(raw) {
    const token = String(raw || "").trim();
    if (!token) return "";
    if (MAC_GLYPHS[token]) return MAC_GLYPHS[token];
    return token.toLowerCase().replace(/[\s_-]/g, "");
  }

  function codeFor(key) {
    if (/^[0-9]$/.test(key)) return `Digit${key}`;
    if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
    if (/^f([1-9]|1[0-2])$/.test(key)) return key.toUpperCase();
    return NAMED_CODES[key] || "";
  }

  // Combinations something else claims before the key reaches us.
  //
  // The panel is its own window, and that's the whole difference. In a browser
  // window Chrome checks extension bindings ahead of the macOS menu bar, so
  // ⌘H fires the quick-search rather than hiding Chrome — which is why these
  // work from a page. The panel's window has no such hook, so the menu bar
  // gets there first and Chrome hides mid-keystroke. ⌘G isn't a menu item, so
  // it reaches the panel like any other key.
  //
  // Keep these lists to combinations that really are swallowed: calling a
  // working shortcut broken is worse than missing one.
  const MAC_RESERVED = {
    "meta+h": { why: "macOS takes ⌘H for Hide Chrome", scope: "panel" },
    "meta+alt+h": { why: "macOS takes ⌥⌘H for Hide Others", scope: "panel" },
    "meta+m": { why: "macOS takes ⌘M for Minimize", scope: "panel" },
    "meta+w": { why: "macOS takes ⌘W for Close Window", scope: "panel" },
    "meta+q": { why: "macOS takes ⌘Q for Quit", scope: "panel" },
    // Spotlight is system-wide: Chrome never sees this one either.
    "meta+space": { why: "macOS takes ⌘Space for Spotlight", scope: "everywhere" },
  };
  const RESERVED = {
    "alt+f4": { why: "Windows takes Alt+F4 for closing the window", scope: "everywhere" },
  };

  // macOS is the only platform Chrome renders bindings as glyphs on, so the
  // string itself is the tell — with the user agent as a backstop.
  function isMacBinding(shortcut) {
    if (/[⌘⌥⌃⇧]/.test(shortcut)) return true;
    const ua = (globalThis.navigator && navigator.userAgent) || "";
    return /Mac/i.test(ua);
  }

  function comboName(parsed, key) {
    return (
      (parsed.meta ? "meta+" : "") +
      (parsed.ctrl ? "ctrl+" : "") +
      (parsed.alt ? "alt+" : "") +
      (parsed.shift ? "shift+" : "") +
      key
    );
  }

  // Describe what the panel can do with one binding.
  //
  //   { shortcut, combo }           — the panel can match this on keydown
  //   { shortcut, error, scope }    — bound, but it won't do what you expect
  //   { shortcut: "", combo: null } — the slot is simply unbound
  //
  // scope says how far the problem reaches. "panel" means only the search box
  // misses out — the shortcut still searches highlighted text on a page, since
  // the background worker handles that. "everywhere" means the key never
  // reaches Chrome at all and the slot does nothing wherever you press it.
  function describeBinding(shortcut) {
    if (!shortcut) return { shortcut: "", combo: null, error: "", scope: "" };
    const parsed = parseShortcut(shortcut);
    const key = canonicalKey(parsed && parsed.key);
    const fail = (error, scope) => ({ shortcut, combo: null, error, scope });

    if (!key) return fail("Context can't tell which key this is", "panel");
    if (key.startsWith("media")) {
      return fail("Chrome doesn't deliver media keys to extension windows", "panel");
    }
    const code = codeFor(key);
    if (!code) {
      return fail(`Context doesn't recognise the "${parsed.key}" key`, "panel");
    }
    // Chrome's own UI won't let you bind a bare printable key, but a profile
    // synced from another build could still carry one, and it would fire on
    // every keystroke in the search box.
    const bare = !parsed.meta && !parsed.ctrl && !parsed.alt && !parsed.shift;
    if (bare && !/^f([1-9]|1[0-2])$/.test(key)) {
      return fail("a shortcut with no modifier would fire while you type", "panel");
    }
    const name = comboName(parsed, key);
    const taken =
      (isMacBinding(shortcut) ? MAC_RESERVED[name] : undefined) || RESERVED[name];
    if (taken) return fail(taken.why, taken.scope);

    return {
      shortcut,
      error: "",
      scope: "",
      combo: {
        meta: parsed.meta,
        ctrl: parsed.ctrl,
        alt: parsed.alt,
        shift: parsed.shift,
        code,
        key,
      },
    };
  }

  // Compare by KeyboardEvent.code, which survives what modifiers do to the
  // character: Option+1 on macOS reports e.key as "¡", and Option+Comma as "≤".
  // e.key is a second chance for layouts where the physical code doesn't line
  // up with the key Chrome bound; the modifiers have already had to match
  // exactly by then, so it can't fire on ordinary typing.
  function matches(e, combo) {
    if (!combo) return false;
    if (!!e.metaKey !== combo.meta || !!e.ctrlKey !== combo.ctrl) return false;
    if (!!e.altKey !== combo.alt || !!e.shiftKey !== combo.shift) return false;
    if (e.code && e.code === combo.code) return true;
    return String(e.key).toLowerCase() === combo.key;
  }

  globalThis.CtxShortcuts = {
    PANEL_SLOTS_KEY,
    parseShortcut,
    canonicalKey,
    describeBinding,
    matches,
  };
})();
