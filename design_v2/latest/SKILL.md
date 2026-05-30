---
name: sui-combats-design
description: Use this skill to generate well-branded interfaces and assets for SUI Combats — a browser-based Sui-blockchain PvP RPG combat game in the Ponke meme-coin aesthetic (yellow + black + red, Slackey + Poppins, chunky pop-art outlines). Suitable for production frontend, throwaway prototypes, splash art, mockups, and marketing visuals.
user-invocable: true
---

# SUI Combats Design

This skill packages the SUI Combats design system: brand color tokens,
typography scale, component recipes, icon set, NFT item art, and a
React UI kit that recreates every screen in the game.

## Start here

1. **Read `README.md`** in the skill root. It has the full brand brief
   — content fundamentals (voice, casing, slang), visual foundations
   (color, type, layout, motion, hover/press states, borders, shadows,
   blur, radii, card anatomy), iconography rules, and known caveats.
2. **Skim `colors_and_type.css`** — the canonical token source.
   Every CSS variable in the system is defined there, plus a few
   semantic recipe classes (`.sc-h1`, `.sc-button`, etc.).
3. **Open `ui_kits/web_game/index.html`** in a browser. Click every
   nav link, the Connect-Wallet CTA, the three arena types, the
   marketplace filters, and the Fight transition. This is what the
   brand looks like in motion.
4. **Browse `preview/`** for atomic component cards if you need a
   visual reference for a single token or component (palette,
   buttons, zone selector, item card, etc.).

## When asked to design something

### For a visual artifact (slide, mock, throwaway prototype, splash, marketing graphic):

- **Copy** `colors_and_type.css` into your output's folder.
- **Copy** any NFT art you need from `assets/items/` and any icons
  you'll use. Don't link them from the skill folder — your output
  needs to be self-contained.
- **Compose** with the primitives — read `ui_kits/web_game/Primitives.jsx`
  to see how `<Button>`, `<Card>`, `<Stamp>`, `<Bar>`, `<Avatar>`,
  `<StatRow>` are built. Either re-create them in your output or
  inline the same patterns directly.
- **Apply the recipes**: 2px black border, 12px radius, flat 4px
  sticker shadow on every card/button/panel. Red = commit / attack;
  yellow = select / OK; black = text/outline.
- **Never** invent new colors. Never reach for gradients on chrome.
  Never use a serif. Never use frosted glass / backdrop-blur.

### For production frontend code:

- Replace the existing Tailwind/zinc/amber dark theme in
  `frontend/src/app/globals.css` with the contents of
  `colors_and_type.css`.
- Convert components one by one — `Button` → red/yellow sticker
  variants, `Card` → 2px border + sticker shadow, `Modal` → bounce-in
  + flat scrim, etc. The UI kit's JSX files are reference, not
  drop-in (they use plain CSS vars, not Tailwind).
- Keep the existing **logic** in place — only the visual layer
  changes. Equipment slots still have the same keys, ELO still
  renders next to level, fight log still resolves server-side.

### If invoked without specific guidance:

Ask the user what they want to build (a new screen? a marketing
graphic? a deck? a tweak to an existing screen?), what audience
it's for (degens / press / Sui Foundation grant reviewers / new
players?), and any constraints (size, format). Then either output
a static HTML artifact or a JSX patch into the existing codebase,
depending on the need.

## Key files (in this skill)

```
.
├── README.md                       ← full brand brief — read first
├── colors_and_type.css             ← canonical tokens
├── assets/
│   ├── logo.svg, logo-stack.svg, sui-mark.svg
│   └── items/*.png                 ← 30 NFT item PNGs (real game art)
├── preview/*.html                  ← atomic component cards
├── ui_kits/web_game/
│   ├── index.html                  ← click-thru prototype
│   ├── *.jsx                       ← every screen, modular
│   └── styles.css
└── fonts/README.md                 ← font sourcing + self-host plan
```

## Forbidden moves (will fail review)

- ❌ Medieval / parchment / "tavern wood" aesthetic
- ❌ Any color outside the documented palette (especially purple
  gradients, neon teal, slate gray)
- ❌ Serif body type
- ❌ Soft drop shadows or `backdrop-filter: blur()` on chrome
- ❌ 1px hairline borders on cards
- ❌ Emoji in marketing UI (chat-only)
- ❌ Hand-drawn SVG illustrations of fighters — use placeholders +
  flag for real art commission
