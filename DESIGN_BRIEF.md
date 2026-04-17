# SUI Combats — Visual Redesign Brief

> **For AI design tools (Claude Artifacts, v0, Lovable, Midjourney, etc.).**
> Input this document as-is when prompting for frontend mockups, component redesigns, or full-screen hero art. It describes the target aesthetic: **meme battles on Sui.**

---

## 1. The One-Line Pitch

> *PONKE, LOFI, and other Sui/Solana meme coins formed PvP guilds and now they fight each other in a 5-zone arena. Frogs in plate mail. Dogs with laser swords. Apes dual-wielding pixel daggers. All locked on-chain. All extremely loud.*

Think **Axie Infinity × PONKE × old Flash games × Stick Fight**. The whole product reads like a meme-coin fandom mixed with an early-2010s browser arena game — but built on 2026 tech.

We are **deliberately** abandoning the medieval-fantasy RPG default. No gothic serifs. No parchment. No Skyrim palette. No gritty oil-painted portraits. The current UI uses amber/zinc/black "tavern wood" styling — **replace all of it.**

---

## 2. Core Pillars

1. **Meme energy over realism.** Expressive > accurate. A frog holding a flaming sword beats a well-rendered knight every time.
2. **Saturated, not sepia.** The browser tab should look like a candy bowl, not a coal mine.
3. **Everything is juicy.** Buttons bounce. Numbers pop. Crits shake the screen. Level-ups throw confetti. If it moves, it over-moves.
4. **Chunky and readable.** Thick outlines, bold borders, high-contrast text. Readable at arm's length from a couch laptop.
5. **On-chain is a flex, not a chore.** Wallet popups, tx confirmations, and NFT ownership moments are celebration moments — not legal paperwork.

---

## 3. Color Palette

### Primary (UI core)

| Swatch | Hex | Use |
|---|---|---|
| **Electric Grape** | `#7C3AED` → `#A855F7` | Primary action, crit stat, epic-tier highlights |
| **Neon Slime** | `#22C55E` → `#84CC16` | Success, level-up, Sui chain references |
| **Hot Pink Bubblegum** | `#EC4899` → `#F472B6` | Secondary action, meme accents, "girly" flex |
| **Banana Gold** | `#FACC15` → `#FDE047` | SUI amounts, wagers, legendary rarity, victory |
| **Arcade Cyan** | `#06B6D4` → `#22D3EE` | Evasion stat, dex, "cool" flex |
| **Lava Red** | `#EF4444` → `#F97316` | HP, damage numbers, danger, angry |

### Background

- **Off-black canvas**: `#0A0A14` (not pure black — slight blue-purple tint so neon colors pop harder)
- **Panel surface**: `#14121F` with a 1-2px gradient border in a primary accent
- **Checkered / dotted / squiggly wallpaper textures** behind major panels — subtle but present, like a meme coin's website background
- **Never** use earthy browns, olive, warm beige, slate gray. Those say "medieval dungeon" and we're not that.

### Rarity Ramp (items)

| Rarity | Color | Vibe |
|---|---|---|
| Common | `#9CA3AF` (cool gray) | Doge sticker |
| Uncommon | `#22C55E` slime green | A little swag |
| Rare | `#06B6D4` arcade cyan | Flex |
| Epic | `#A855F7` grape | Serious flex |
| Legendary | Gold gradient with rainbow shimmer | God-tier meme energy |

---

## 4. Visual Style

### Overall

- **Cartoony, expressive, thick outlines** (3-4px black or dark-purple outlines on all characters and major icons)
- **Slight hand-drawn wobble** — think "crayon drawn by a confident child." Lines aren't perfectly straight. Circles aren't perfectly round. This is deliberate, not sloppy.
- **Saturated flat fills with one layer of shading** — no realistic gradients or specular highlights. Cel-shaded max.
- **Big-head / chibi proportions** for character portraits (head ~40% of body height). Hands and feet oversized for comedy.
- **Background parallax** with stickers, sparkles, and tiny pixelated meme motifs (coins, lightning bolts, fire emojis, kekw faces)

### Panels & Cards

- Thick **2-3px colored borders** with a slight **drop shadow offset** (like the panel is a sticker peeled halfway off the page)
- Rounded corners: **8-16px radius**, never sharp
- Occasional **rotated-by-1-degree** cards for energy (not every card — sparingly, for emphasis)
- **Embossed inner highlight** on the top edge (1px lighter line) to feel "pressable"

### Character Portraits

**NO knights. NO warriors. NO orcs.** Instead, meme-inspired archetypes:

| Archetype | Base | Armor / Gear Flavor |
|---|---|---|
| **Frog** (PONKE-coded) | wide-mouth green frog | Paper crown, plastic sword, oversized goggles |
| **Shiba / Doge** | classic Doge face | Tactical vest with "VERY ARMOR" text, knight helm two sizes too big |
| **Ape** | cartoon gorilla, bloodshot eyes | Dual-wield rubber chickens, backwards cap, chain necklace with SUI logo |
| **Cat** | grumpy cartoon cat | Plate mail with "NO" embroidered, tiny dagger, tuna can shield |
| **Pepe-adjacent** | original non-IP amphibian | Moon-themed everything, lunar helmet, telescope staff |
| **Moon Coin Wizard** | generic robed wizard with coin face | Staff with spinning SUI droplet, star cape |

Portraits should be **reactive** — they change expression on crit (😲), block (😤), take damage (😵), win (😎 with sunglasses drop), die (💀 cross-eye).

### Weapons & Gear

- **Swords glow.** All weapons have a soft 2-4px neon outer glow matching their rarity color
- **Shields have faces.** A wooden shield might have a grumpy cat meme carved into it. A legendary shield has a screaming Doge.
- **Armor is oversized.** Pauldrons bigger than heads. Helmets that don't fit. Gauntlets like boxing gloves.
- **Particle VFX on equip** — confetti burst + cartoon "ding!" star + screen-edge sparkle
- **Weapon idle animations** — swords pulse subtly, axes rotate ~5° on idle, staffs have floating particles

### Iconography

- **Thick-line icons**, 2-3px stroke, **filled with gradient**. Never outlined-only.
- Emojis are **welcome** in buttons and badges (but render them as custom cartoon variants, not system emoji — consistent style)
- Stat icons: STR = cartoon flexed bicep, DEX = lightning bolt, INT = wide-eye with spiral, END = shield with heart

---

## 5. Animation Style

Every interaction is an animation. **Juicy** is the keyword — overshoot, bounce, settle.

| Event | Animation |
|---|---|
| **Button hover** | Scale 1.05, tiny 2° tilt, shadow grows |
| **Button click** | Scale 0.92 snap, ripple burst of particles matching button color |
| **Damage number** | Pops up at 1.5× size, wobbles once, fades up and out over 800ms; crits do 2.5× and shake |
| **Crit hit** | Full-screen red vignette pulse + screen shake (15px over 200ms) + cartoon "BANG!" comic-book star overlay |
| **Block** | Blue shield sparks at impact point, "CLANK" comic text |
| **Dodge** | Cartoon dust puff + ghost trail where the character was + "WHOOSH" text |
| **Level-up** | Screen-covering confetti burst (grape + pink + gold), character portrait does 360° spin, slot machine sound, "LEVEL UP!" in chunky wavy text |
| **Win** | Fireworks in background, character does victory pose, coins rain from top of screen, "KO!" or "GG!" banner slides in from left |
| **Lose** | Character face-plants, screen briefly desaturates (only desaturation allowed), "REKT." banner drops from top |
| **XP bar fill** | Smooth ease-out fill + shimmer pass + tiny pop at the end |
| **New item** | Item card flies in from above, bounces once on land, rarity glow pulses 3 times |
| **Wallet popup opens** | Fake slot-machine "lock-in" sound, border glows gold |
| **Wager accepted** | Coin explosion, both players' portraits slam together with a shockwave |

All motion should use **spring physics, not linear easing**. Overshoot ~10%. Settle in ~400ms for most interactions.

---

## 6. Combat UI — Specific Direction

- **HP bars**: chunky, segmented (like old-school fighting games), with a subtle scrolling shine. Gradient from green → yellow → red as they empty. Numbers overlaid in white with a thick black outline.
- **Zone selector**: 5 zones rendered as **chunky cartoon body parts** on a stickman-style silhouette — head as a big oval, chest as a box, etc. Glow when hovered. Attack zones pulse red on selection; block zones pulse blue.
- **Turn timer**: big circular clock that loses pie slices, turns red when < 10s, starts wobbling when < 5s
- **Battle log**: speech-bubble style entries, each action gets a cartoon icon (⚔️ for attack, 🛡️ for block, 💫 for dodge, 💥 for crit)
- **Fighters on screen**: full-body cartoon sprites, idle-animated, playing hit/block/dodge animations synced with log entries
- **LOCK IN button**: massive, chunky, pulses when ready. On press, satisfying latch-click sound + spring-bounce.

---

## 7. Typography

**Mix chunky display fonts with clean sans-serif for body.**

### Display (headings, buttons, damage numbers)
- **Pixel-adjacent chunky fonts**: e.g. *Bungee*, *Rubik Mono One*, *Silkscreen*, *Lilita One*, *Pixelify Sans*
- Extra-bold, letter-spaced tight, often colored gradient with a dark outline
- Always uppercase for buttons: "LOCK IN", "ENTER QUEUE", "LEVEL UP!"

### Body (descriptions, chat, tables)
- Clean geometric sans: *Inter*, *DM Sans*, or *Space Grotesk* at 14-16px
- High contrast white-ish (`#EDEDF5`) on dark. No low-contrast gray-on-gray.

### Stat numbers
- **Monospace**, bold: *JetBrains Mono* or *Space Mono*
- Always display stat deltas in green (`+N`) or red (`-N`) with a little arrow

---

## 8. UI Elements — Chunky Specifications

### Buttons

- **Primary**: thick 2-3px dark border, gradient fill, inner 1px highlight line on top, shadow 4-6px offset down-right. Font: uppercase display.
- **Secondary**: transparent fill, thick border in accent color, fills on hover
- **Danger**: pink-to-red gradient, slight wobble animation on hover
- Corner radius: 8-12px
- Minimum tap target: 44×44px

### Cards / Panels

- Rounded 12-16px
- 2px border in subtle gradient (darker on top, lighter on bottom — looks slightly embossed)
- Backdrop `#14121F`
- Optional slight rotation for emphasis (`rotate(-1deg)` on hover states)

### Badges

- Pill-shaped, chunky outline, uppercase display font
- Rarity badges glow softly with their rarity color
- Level badges stamped-looking with a slight serif pixel font

### Modals

- Dark backdrop with slight **scrolling pattern** (not just flat blur)
- Modal itself: thick colored border, rounded 16px, entry animation = bounce-in from below
- Close button: big pink circle X in top-right with hover rotation

### Inputs

- Thick 2-3px border, pill-rounded, font matches body
- Focus state: border glows in accent color, slight scale-up
- Placeholder in italic light gray

---

## 9. Sound Design Direction

Every interaction has **arcade-y, satisfying audio**. Think:

| Event | Sound Flavor |
|---|---|
| Button click | Short bright click, slightly pitched-up |
| Button hover | Subtle tick / blip |
| Coin / SUI earned | Classic 8-bit coin "cha-ching" (Mario-adjacent but not copyright) |
| Damage taken | "Bonk!" cartoon thud |
| Crit | Glass shatter + deep bass hit |
| Block | Metallic clank |
| Dodge | Airy whoosh + slide-whistle tail |
| Level up | Slot machine cascade + angelic choir sting (but 8-bit) |
| Victory | Trumpet fanfare — slightly off-key for meme energy |
| Defeat | Sad trombone (4 notes) |
| Queue match found | Bright ding-dong chime |
| Wallet popup | Vault / slot-machine lock mechanism |
| Wager locked | Coin drop into metal cup |
| Wager won | Jackpot cascade |

Background in tavern / town: **lo-fi hip-hop beats** (think LOFI coin branding). Chill, loopable, non-distracting.

Background in fight: **hype chiptune battle loop**, BPM ~140, with drum fills on crit hits.

---

## 10. Specific Page / Screen Direction

### Landing (wallet not connected)
- Giant wordmark: "SUI**COMBATS**" — SUI in Sui cyan, COMBATS in electric grape
- Animated background: silhouettes of meme characters brawling in a stylized arena, looping
- Connect Wallet button: chunky, pulsing, rainbow-border gradient on hover
- Floating sticker clusters around the hero: tiny Doge, frog, ape portraits with "PVP" speech bubbles

### Character Tab
- Left: **big cartoon portrait** of the player's chosen archetype with equipment overlay doll (still click-to-equip), reactive expression based on context
- Stats displayed as **chunky colored bars** with animated fills, each stat icon on the left
- XP bar: rainbow shimmer when close to level-up, pulses when unallocated points available
- Fight history: speech-bubble feed style, each entry has opponent portrait thumbnail + emoji result

### Arena Tab
- Three fight-type cards: **giant**, **rounded**, **each a different color**:
  - Friendly: cyan with "chill vibes only" energy
  - Ranked: grape with a crown emoji
  - Wager: gold with a visible coin pile and "$$$" floating
- Wager lobby: each entry is a **trading-card-shaped slot** with opponent's portrait, level, ELO, stake, and a giant "ACCEPT" button
- On entry-hover: card tilts 2° and glows with opponent's dominant stat color
- Queue-waiting state: animated character in a little waiting room, doing idle fidget animations

### Marketplace Tab
- **Grid of item cards** like Hearthstone / trading cards — art on top 60%, stats + price on bottom 40%
- Rarity glow animated, Legendary items have scrolling rainbow frame
- "LIST" and "BUY" buttons are both chunky and satisfying
- Filter sidebar: pill-shaped toggles, checked state = filled pill, unchecked = hollow

### Tavern Tab
- Chat panel has a **faux-wooden tavern backdrop** but **meme-ified** — neon sign overhead, pixelated bartender NPC in the corner with idle animation
- Whispers appear in pink bubble with target name
- AI bot "Big Bad Claude" messages: distinct robot portrait, slight glitch animation on text
- Player list: each entry is a **mini-portrait card** with status dot (green/yellow/red/purple)

### Hall of Fame Tab
- Leaderboard rendered like a **fight card poster**: rank 1 gets a huge top slot with crown emoji, animated confetti behind
- Top 3: podium layout with pedestals
- Rest: scrolling list with alternating row tints

### Fight Screen
- **Full-bleed** arena background with parallax crowd silhouettes (memes in the stands, cheering, holding signs)
- Fighter sprites **huge** on screen, animated
- Damage log as rising speech bubbles
- Zone selector: chunky stickman with glowing zones
- Turn timer: circular clock with wobble
- Lock-In button: **bottom-center, massive, pulsing when armed**

---

## 11. What To AVOID

- ❌ **Generic medieval RPG aesthetic** — no parchment, no runes, no faux-Viking runic text
- ❌ **Dark fantasy / gritty tones** — no blood splatter, no grimdark, no "Berserk manga" vibes
- ❌ **Realistic human proportions / oil-painted portraits** — this is not Diablo or Elden Ring
- ❌ **Muted / desaturated palettes** — no washed-out browns, olives, deep burgundies
- ❌ **Thin hairline borders or 1px dividers** — everything should feel chunky and hand-cut
- ❌ **System fonts** (Times, Arial, Georgia) — we need personality
- ❌ **Realistic gradients and specular highlights** — we're cel-shaded, not PBR
- ❌ **Calm / corporate motion** — no slow fades. Everything bounces, overshoots, pops.
- ❌ **Skeuomorphic "wooden tavern planks"** — the current UI has some of this, throw it out
- ❌ **Serif-heavy typography** — keep serifs for ironic accents only
- ❌ **Muted neon** — our neons should hurt the eyes a little. In a fun way.
- ❌ **Crypto-chart / fintech dashboard aesthetic** — we're a game, not Uniswap

---

## 12. Reference Mood Board (for AI search / inspiration)

Search or scrape these names/terms when generating imagery:
- **PONKE** (Solana meme) — frog character design, neon green + magenta
- **LOFI coin** — chill hip-hop animal mascots
- **Bonk / BONK coin** — dog character, hammer motif
- **Axie Infinity** — chibi animal fighters, cartoon cel-shading
- **Stick Fight: The Game** — expressive stickman combat, over-the-top physics reactions
- **Cult of the Lamb** — chunky cartoon aesthetic with dark humor, cute but gnarly
- **Spelunky 2** — readable silhouettes, bright saturated palette, cartoon violence
- **Gang Beasts** — jelly-body character comedy, bright color-coded characters
- **Fall Guys** — chunky, saturated, juicy UI, prize/confetti moments
- **Old Newgrounds flash games** — circa 2005-2010, janky charm, bright
- **Adult Swim bumpers** — lo-fi brand art, hand-drawn type, weird energy
- **Vaporwave + Y2K aesthetic accents** — shiny gradients, chrome text, checkered floors (sparingly)

---

## 13. Output Hints for AI Tools

When using this brief with an AI design tool:

1. **Start with one page at a time** — don't ask for the whole app in one shot. Begin with the Character Tab or Landing.
2. **Reference specific components by name** from `FRONTEND_FUNCTIONS.md` — e.g. "redesign the `CharacterProfile` with the new art direction."
3. **Enforce the palette** — paste the hex codes from §3 explicitly in the prompt.
4. **Name the characters** — "PONKE the frog fighter" generates better than "a fighter character."
5. **Specify animation in words** — AI design tools often miss motion unless told explicitly: "button bounces on hover, scales to 1.05, tilts 2 degrees."
6. **Lean into absurdity** — the weirder the item names ("Rubber Chicken of +5 Cope", "Diamond Hands Gauntlets", "Paper Crown of the Memelord"), the more on-brand.
7. **Always include a reaction state** — portraits should have at least neutral / hit / crit / dead variants.
8. **Reject the first generic output** — if the tool returns medieval defaults, add "NO MEDIEVAL FANTASY. MEME COIN ENERGY." to the prompt and regenerate.

---

## 14. North Star

> If a Sui degen sees a screenshot of this game on Twitter, they should **immediately** want to play it — not because it looks "polished" or "premium," but because it looks **unhinged, loud, and fun.** The game should feel like it was made by the meme community, for the meme community. Every interaction should trigger dopamine. Every fight should feel like a livestream moment.
>
> If it could be mistaken for a 2013 medieval browser RPG, we failed.
