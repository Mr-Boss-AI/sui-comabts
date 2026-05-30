# SUI Combats — Design System

> Forged metal meets on-chain PvP. Gunmetal, bronze, blood — and a chunky comic wordmark over the top.

This design system re-skins **SUI Combats** — a browser-based PvP RPG
combat game on the Sui blockchain — in the visual language of a **dark
metal-forged arena**. Deep gunmetal panels, burnished bronze accents,
oxidized blood red for damage, steel blue for defense. Slackey display
lettering, Poppins for everything else. The comic-book panel framing
DNA is preserved; the meme-coin pop-art is gone.

The existing game ships with a dark "medieval tavern" UI (amber + zinc + black).
This system replaces that aesthetic wholesale without touching the underlying
game mechanics — every component is a 1:1 functional equivalent of a real
screen in the live frontend.

---

## Sources

- **Codebase** — `sui-comabts/` (mounted via File System Access).
  - Frontend: Next.js 16 + React + Tailwind, `frontend/src/`
  - Move contracts: `contracts/sources/`
  - Game design: [`SUI_COMBATS_GDD.md`](sui-comabts/SUI_COMBATS_GDD.md) (in source repo)
  - Existing visual brief (superseded by this system):
    [`DESIGN_BRIEF.md`](sui-comabts/DESIGN_BRIEF.md) (in source repo)
- **GitHub** — <https://github.com/Mr-Boss-AI/sui-comabts>
- **Aesthetic reference** — medieval combat MMORPGs (combats.ru,
  oldbk.ru, Tibia) crossed with chunky comic-book wordmark energy.
  Gunmetal `#0a0d12` canvas, burnished bronze `#c89a3f` accent,
  oxidized blood `#b53d2c` for damage / wager CTAs, steel blue
  `#6d8fa3` for armor and info, parchment `#e8e2d4` for body text.
- **Existing NFT art** — 30 PNG item illustrations from `sui-comabts/nft/`
  (copied into `assets/items/`).

---

## What's here — index

```
.
├── README.md                  ← this file
├── SKILL.md                   ← portable Claude-Code skill manifest
├── colors_and_type.css        ← the source of truth — CSS vars + recipes
├── assets/
│   ├── logo.svg               ← SUI COMBATS horizontal wordmark
│   ├── logo-stack.svg         ← stacked logo on gunmetal card
│   ├── sui-mark.svg           ← bronze SUI water-drop icon
│   └── items/                 ← 30 NFT item PNGs (real game assets)
├── preview/                   ← Design-System-tab cards (700px wide)
│   ├── colors-*.html          ← palette, stat colors, rarity ramp
│   ├── type-*.html            ← display, headings, body, mono, stamp
│   ├── spacing-*.html         ← radii, shadows, spacing scale
│   ├── components-*.html      ← buttons, badges, pills, inputs, etc.
│   └── brand-*.html           ← logo, wordmark, hero scrap
├── ui_kits/
│   └── web_game/
│       ├── index.html         ← interactive click-through prototype
│       ├── README.md
│       └── *.jsx              ← component recreations of every key screen
└── fonts/
    └── README.md              ← font sourcing notes (Slackey + Poppins
                                  loaded from Google Fonts; self-host plan)
```

---

## Content fundamentals

### Voice & tone

Loud, unselfconscious, **degen-coded**. Copy reads like a Twitter shitpost
written by someone who actually ships. Confidence > polish. No corporate
hedging.

- **Pronouns** — second-person, casual. "Mint your fighter." "Lock in."
  Never "users", never "players may".
- **Case** — **UPPERCASE** for action moments (buttons, banners, fight
  callouts: `FIGHT!`, `LOCK IN`, `KO!`, `GG`, `REKT`). **Title Case**
  for nav and section labels. **Sentence case** for body and tooltips.
- **Punctuation** — em-dashes and ellipses are fair game. Exclamation
  marks earn their place. Periods optional on labels and stamps.
- **Numbers** — always tabular-nums in stat blocks. SUI amounts in
  monospace with the `Ⓢ` mark or `SUI` suffix. Damage rolls and crit
  numbers POP big and bronze/blood, never neutral.
- **Emoji** — used sparingly, only in **chat / DMs / tavern**, never in
  marketing buttons or stat blocks. The brand carries enough personality
  through type and metal-palette accents that emoji become noise outside
  chat. (The current frontend leans on emoji for nav icons and slot
  pictograms — this system replaces those with custom SVGs.)
- **Slang welcomed** — *degen*, *rekt*, *cooked*, *ngmi*, *wagmi*, *cope*,
  *based*, *mid*. Don't reach for them; let them land where they're
  already in the dev's mouth.

### Examples — what good copy looks like

```
✅  "Lock in your stake."
✅  "FIGHT!"
✅  "Loadout saved — 3 slots changed on chain."
✅  "Opponent disconnected. 90s grace remaining."
✅  "You got cooked. -12 ELO. Try the tavern."
✅  "Wager won — 1.9 SUI hits your wallet in ~3s."

❌  "Please connect your wallet to continue."     (too polite, too corporate)
❌  "Battle commencing!"                          (corny — say "FIGHT!")
❌  "Error: insufficient gas."                    (terse-and-cold; say "Out of SUI to pay gas.")
❌  "Welcome back, brave warrior!"                (corny — no)
```

### Examples — what bad copy looks like

Cut every word that smells like a Diablo 4 tutorial: *brave*, *valiant*,
*warrior*, *quest*, *forsooth*, *thy*. The game is on a blockchain, in
a browser tab, in 2026. Write like it. The aesthetic is medieval-arena,
but the **voice** is degen-trader. Don't conflate them.

---

## Visual foundations

### Color philosophy

Three accents on a gunmetal canvas. No gradients on chrome. The bronze
is **burnished, not gold-leaf shiny** — think hot iron in candlelight,
not a Steam achievement icon. The blood red is **oxidized**, not
fire-engine. The steel blue is **desaturated and cool**, not electric.

- **Bronze** `#c89a3f` = primary accent. Wordmark color, hype panel rims,
  select / OK / Lock In CTAs, legendary rarity. Use on dark fills with
  `#0a0d12` text for contrast.
- **Blood red** `#b53d2c` = secondary accent. Damage numbers, HP bars
  when low, wager / attack / pay CTAs, danger states. Use with
  parchment text.
- **Steel blue** `#6d8fa3` = tertiary cool. Armor stats, defense
  indicators, info badges, evasion. Counterbalance to the warm accents.
- **Parchment** `#e8e2d4` = primary text on dark. Warm off-white —
  never pure white, never sterile.
- **Gunmetal panels** `#0a0d12` (page) → `#15191f` (panel) → `#1a1f28`
  (nested) → `#222831` (focused). Four levels of dark, each one notch
  lighter than the last.
- **Steel rim** `#2c333d` = default 1–2px hard border on panels. Bronze
  rim on hype panels. Parchment ink-line only on the loud wordmark and
  CTAs that need the chunky comic outline.

**No purple gradients, no neon teal, no electric anything.** Gradients
are forbidden on chrome surfaces. The only acceptable color shift is
a 1px parchment highlight on the top edge of a forged plate.

### Typography

Two families do everything. **Slackey** is the chunky bubble-letter
display face — reserved for the wordmark and four kinds of in-game
splash text (`FIGHT!`, `WIN!`, `KO!`, `ROUND 1`). The Slackey wordmark
is treated with a bronze fill and a parchment stroke for the comic
outline — never solid bronze, never just stroked.

**Poppins** does every other piece of UI text — from the 64px hero
down to the 10px stat pill. JetBrains Mono shows up only for numbers
in stat tables, prices, and timers (tabular-nums on).

Headlines are tight (`letter-spacing: -0.02em`) and **800** weight.
Buttons are **700**, uppercase, with `0.06em` tracking. Stamps are
**700**, uppercase, with `0.14em` tracking. We never use Italic
except in disabled placeholder text.

### Layout & rhythm

- **Container** — `max-width: 1280px`, side-padded `24px` minimum.
- **Cards** — 3px radius (sharp), 1–2px steel rim, flat plate shadow
  `3px 3px 0 0 #000` plus a 1px inset parchment highlight on top.
  Inner padding `16–22px` — tighter than the v1 Ponke direction.
- **Hype panels** — hard 90° corners (`--r-sharp: 0`), 2px bronze rim.
- **Vertical rhythm** — 3px base unit; spacings are 6 / 10 / 14 / 20 /
  28 / 40 / 56. Denser than airy SaaS marketing — closer to old
  browser-MMO information layouts.
- **Sections** — alternate `--bg-page` (gunmetal) ↔ `--bg-surface`
  (panel) ↔ `--bg-surface-3` (focused panel). Bronze + blood arrive
  only on accents or in CTAs — never as a full panel fill.
- **Full-bleed** — the fight screen is the only full-bleed surface.

### Backgrounds

- **No photographic imagery** in chrome. Surfaces are flat dark fills,
  optionally textured with the `.plate` class — a 1px repeating
  diagonal noise at ~1% opacity that gives the forged-plate feel
  without becoming visible texture.
- **Watermark layering** — large faded item / weapon PNGs sit behind
  the hero at 6–10% opacity, blended into the gunmetal.
- **No bright fills as background.** Bronze / blood / steel arrive
  as accents, borders, and small panels — never as full-bleed.

### Animation

Animations are **snappy, not floaty**. Most transitions are `200ms` on
`cubic-bezier(0.16, 1, 0.3, 1)` (ease-out). Interactive states use a
slight **overshoot** (`cubic-bezier(0.34, 1.56, 0.64, 1)`) so buttons
feel like physical plates being pressed.

- **Hover (nav links)** — font-weight transitions 400 → 800 with a
  hidden bold sibling preventing layout shift. Color shifts to parchment.
  Bronze underline draws in on the active link.
- **Hover (buttons)** — translate `−1 / −1`, shadow grows from `3 3 0`
  to `5 5 0`, fill brightens one notch (bronze → bronze-hot, blood →
  brighter blood). 200ms ease-pop.
- **Press (buttons)** — translate `+2 / +2`, shadow collapses to `2 2 0`,
  no color shift. 120ms ease-snap. Feels like a real button click.
- **Modal entry** — bounce-in from below, 320ms ease-pop, with a
  bronze flash sweep across the top edge.
- **Damage popups** — pop in at 1.5×, wobble once, fade up. Crits do
  2.5× and shake the parent 15px over 200ms.
- **Level-up** — confetti burst (bronze + blood + parchment), `LEVEL UP!`
  in Slackey with a wavy `transform: rotate()` keyframe.
- **No long animations.** Nothing crawls. Nothing has 800ms+ duration
  except deliberate celebration moments (level-up, win screen, jackpot).

### Hover & press states (chrome)

| Surface | Hover | Press |
|---|---|---|
| Primary blood button | translate −1 / −1, shadow grows, bg lightens | translate +2 / +2, shadow shrinks |
| Bronze CTA button | translate −1 / −1, bg lightens to `--sc-bronze-hot` | translate +2 / +2 |
| Nav link | weight 400 → 800, color → parchment, bronze underline draws in | (none) |
| Card | shadow `3 3 0` → `5 5 0`, lifts 2px | (none) |
| Equipment slot | rim brightens to bronze, scale 1.06 | scale 0.94 |
| Item card (marketplace) | tilt 1°, shadow grows | scale 0.97 |
| Tab / nav | bronze underline grows from center, weight 800 | (none) |

### Borders & shadows

- **Steel rim** — 1–2px solid `--sc-rim` (`#2c333d`) on every panel by
  default. One notch lighter than the panel itself — reads as a forged
  edge rather than a stark outline.
- **Bronze rim** — 2px solid `--sc-bronze` on hype panels, hero cards,
  active selections, the fight screen frame.
- **Parchment ink-line** — 2–3px solid `--sc-parchment` reserved for
  the loud comic outline on the wordmark, the Lock-In button, and the
  damage-popup text. Used sparingly.
- **Plate shadow** — flat black offset, **no blur**. Default `3 3 0 #000`.
  Larger surfaces use `5 5 0 #000`. Combined with the 1px top-rim
  highlight (`inset 0 1px 0 rgba(255,255,255,.04)`) and 1px bottom-rim
  darkening, panels read as embossed forged plates.
- **No soft drop shadows** anywhere in chrome. Modals get an elevation
  shadow (`--sh-pop`) only because they float over content.

### Transparency & blur

- **Modal scrim** — `rgba(0,0,0,0.65)`, **no backdrop blur**. The
  forged-plate aesthetic looks wrong with frosted glass — just dim
  the back.
- **Watermark imagery** — 6–10% opacity, blended into gunmetal.
- **Disabled states** — 35% opacity, no blur, no desaturation tricks.

### Corner radii

Sharp. Combats.ru-density. **No friendly roundness.**

- **0px** — hype panels (hero card, fight-screen frame, Lock-In button).
  Hard 90° forged corners.
- **2px** — inputs, small chips, slot tiles.
- **3px** — every card, every standard button, every panel. Canonical.
  Reach for this first.
- **999px** — stamp pills only (category badges).

### Card anatomy

The most-used component. A card is:

1. Panel fill (`--bg-surface` `#15191f` or `--bg-surface-2` `#1a1f28`).
2. 1–2px steel-rim border (`--sc-rim` `#2c333d`).
3. 3px radius (sharp, not friendly).
4. Flat 3px plate shadow (`--sh-plate`).
5. 1px inset parchment highlight on the top edge + 1px inset darkening
   on the bottom — reads as embossed plate.
6. 16–22px of inner padding (denser than v1).
7. Optional uppercase stamp in the top-left for category labels.

Cards never use background gradients, never use bright fills, never
use rounded-left-border accent stripes (a tired AI trope).

---

## Iconography

The brand approach to icons mirrors the type system: **only as much
icon as the meaning needs, and never decorative slop**.

- **No icon font.** The codebase ships with no icon library; the
  frontend currently uses **Unicode emoji** as nav icons and slot
  pictograms (⚔ for weapon, 🛡 for offhand, etc.) — see
  `frontend/src/components/character/character-profile.tsx` and
  `frontend/src/components/layout/town-hub.tsx`. This system replaces
  those with custom monoline SVG icons in the forged-metal style.
- **Style** — 2–2.4px stroke, parchment, square line caps, no fill
  unless the icon is a stat indicator (then fill with its stat color).
  No multi-tone, no gradient fills, no detailed illustration.
- **Sizing** — 14px (inline), 20px (nav), 24px (CTA), 40px (slot doll).
- **Emoji** — allowed in **chat / DM / tavern messages only**, where
  they're user-generated content. Banned from UI chrome.
- **NFT art** — the 30 item PNGs in `assets/items/` are the real
  game's NFT art (minted on Sui testnet from Pinata CID
  `bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy`).
  Use them at native resolution wherever an item is shown — never
  redraw or substitute.
- **Sui logo** — `assets/sui-mark.svg` is a forged-bronze version of
  the Sui water-drop. Use in balance pills and Sui-amount badges;
  never alongside the real Sui Foundation mark.

### Custom icon set

Stroked 24×24 SVGs live inline in `ui_kits/web_game/Icons.jsx`. The
set covers: sword, shield, helm, gloves, boots, belt, ring, amulet,
heart (HP), bolt (DEX), spark (INT), shield-plus (END), coin (SUI),
swords-crossed (arena), store (market), mug (tavern), trophy
(hall of fame), user (character), x (close), check, chevron, plus,
minus, ellipsis, dot, sound, sound-off, info, warn, link-out.

If you need an icon not in the set, draw it monoline at 24×24,
2px stroke, parchment, no fill, square caps. Don't reach for Lucide /
Heroicons unless explicitly broadening the system later.

---

## Font substitution flag

⚠️ **Fonts are loaded from Google Fonts at runtime** rather than
self-hosted. Slackey and Poppins are both right for the brand —
Slackey gives the chunky comic wordmark, Poppins the clean UI body.
No substitution was needed. JetBrains Mono is used for tabular
numerics (timers, prices, stat rolls); also loaded from Google Fonts.

**Ask for updated font files** only if you want offline / self-hosted
builds (e.g. Walrus Sites decentralized deploy). In that case, drop
`.woff2` files into `fonts/` and replace the `@import` in
`colors_and_type.css` with `@font-face` declarations. See
`fonts/README.md` for the rewrite plan.

---

## Caveats & known compromises

- **Single product surface.** SUI Combats is a single browser app —
  there is no marketing site, mobile app, or docs site in the codebase
  yet. The UI kit covers the in-game surfaces only. If a public
  marketing site is added later, it should reuse the colors_and_type
  layer and add a `ui_kits/marketing/` peer.
- **No slide template provided** — `slides/` is omitted.
- **Sound design is intentionally out of scope.** The brief calls for
  arcade audio; the design system covers visual + copy only.
- **Character portraits are still emoji placeholders.** Real fighter
  art needs to be commissioned before launch. The brief now leans
  medieval-arena rather than chibi-meme, so portrait references
  should swing more toward Tibia / Path of Exile minimaps and away
  from Axie chibi.
- **Backward-compat aliases retained.** The v1 Ponke token names
  (`--sc-yellow`, `--sc-red`, `--sc-paper`, `--sc-night`) are kept
  as aliases pointing at the new metal tokens, so existing JSX keeps
  working. Prefer the new names (`--sc-bronze`, `--sc-blood`,
  `--sc-panel-2`, `--sc-page`) for new code.

---

## Quick start (for the next designer)

1. Open `ui_kits/web_game/index.html` — click-through prototype of
   the full game (Landing → Connect → Town → Arena → Fight → Market).
2. Browse the **Design System** tab — every token + component card
   in one place, organized by Colors / Type / Spacing / Components /
   Brand.
3. Edit `colors_and_type.css` to retune the palette; every artifact
   reads from those vars.
4. Build new screens by composing the JSX files in
   `ui_kits/web_game/` — they import the same CSS.

---

## Character screen — combats.ru frame (v2 layout)

The Character screen runs a **border-frame equipment arrangement**
inspired by combats.ru / oldbk.ru: 10 slots tucked tight around a
central NFT portrait, not floating in airy space.

```
              ┌────────┐
              │ HELMET │
   ┌────────┐ └────────┘ ┌────────┐
   │ WEAPON │            │ OFFHAND│
   ├────────┤  ┌──────┐  ├────────┤
   │ CHEST  │  │      │  │ GLOVES │
   ├────────┤  │ NFT  │  ├────────┤
   │ BOOTS  │  │      │  │ BELT   │
   └────────┘  └──────┘  └────────┘
       ┌────────┬────────┬─────────┐
       │ RING 1 │ RING 2 │ NECKLACE│
       └────────┴────────┴─────────┘
```

- **Portrait** — 200×280 (defaults; tweakable 160–260 × 220–340)
  bronze-rimmed frame in the center. Empty state shows a faint
  bronze plus + "Place your NFT here" stamp. Click → opens
  the **NFT Portrait Picker** modal. Choice persists in
  `localStorage` under `sui_combats_portrait_v1`.
- **Slots** — 52px squares (tweakable 44–64), 6px gap (tweakable
  2–16), 2px hard borders that turn rarity-colored when filled.
- **Cosmetic only** — portrait selection has zero stat impact;
  the modal makes that explicit in its subtitle.
- **Future-proofing** — the CSS grid can absorb +3 cosmetic slots
  (earrings, armlets, extra ring) and 1 pet slot below the rings
  without restructure. See the comment at the top of
  `ui_kits/web_game/CharacterScreen.jsx`.
- **Tweaks** — the floating Tweaks panel (toggle from the toolbar)
  exposes slot size, slot gap, portrait W/H, stat row padding,
  and a portrait-clickable toggle.
