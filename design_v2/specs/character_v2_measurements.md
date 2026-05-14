# SUI Combats — Character Page · Full Element Inspection Report

**Source:** `design_v2/latest/ui_kits/web_game/index.html`
**Viewport:** 1460 × 842 px
**Status:** Authoritative spec for the v2 Character/Loadout port. Every measurement, color, and font value is source of truth.
**Tolerance:** ±2 px on measurements. Colors and fonts must match exactly.

---

## Section 1 — Top navigation bar

**Region:** x=57–1130, y=75–145 · **BG:** `#0a0d12` (gunmetal black) · **Height:** ~70 px · **Bottom border:** 2 px solid `#c89a3f`

### [1] Logo — "SUI" text
- Position: x≈57–116, y≈91–124
- Font: Slackey, 32 px, weight 400
- Color: `#e8e2d4` (parchment)
- Size: 252.625 × 32 px (shared element width with "COMBATS")
- Effects: no border, no background

### [2] Logo — "COMBATS" text
- Position: x≈116–330, y≈91–124
- Font: Slackey, 32 px, weight 400
- Color: `#b53d2c` (blood red)
- Size: 252.625 × 32 px
- Effects: text rendered in bold red; forms wordmark with SUI

### [3] Player avatar badge
- Position: x≈360–396, y≈91–127
- Size: 36 × 36 px
- Fill: `#1a1f28` (dark steel blue)
- Border: 1 px solid `#c89a3f`
- Radius: 4 px
- Layout: flexbox, gap 0, row, justify/align center
- Content: Frog emoji avatar

### [4] Player name — "Ponke_the_Brawler"
- Position: x≈400–548, y≈88–105
- Font: Poppins, 14 px, weight 800
- Color: `#e8e2d4`
- Size: 147.594 × 15.39 px
- Line: 1.1 · Tracking: 0 px

### [5] Level badge — "LV 14" (in nav)
- Position: x≈400–452, y≈108–130
- Font: Poppins, 10 px, weight 700
- Color: `#0a0d12` (text on bronze)
- Fill: `#c89a3f`
- Size: 51.73 × 22 px
- Padding: T 3, R 9, B 3, L 9 px
- Tracking: 1.4 px

### [6] ELO badge — "2134" (in nav)
- Position: x≈454–502, y≈108–130
- Font: Poppins, 10 px, weight 700
- Color: `#0a0d12`
- Fill: `#c89a3f`
- Size: 47.89 × 22 px
- Padding: T 3, R 9, B 3, L 9 px

### [7] Nav link — "Character" (ACTIVE)
- Position: x≈530–640, y≈88–167
- Font: Poppins, 14 px, weight 800
- Color: `#c89a3f` (bronze — active state)
- Size: 101.312 × 79 px
- Padding: T 8, R 12, B 8, L 12 px
- Tracking: 0.28 px

### [8] Nav link — "Arena"
- Position: x≈630–715, y≈88–167
- Font: Poppins, 14 px, weight 797.5
- Color: `#e6e0d1` (parchment, inactive)
- Size: 69.984 × 79 px
- Padding: T 8, R 12, B 8, L 12 px

### [9] Nav link — "Market"
- Position: x≈715–795, y≈88–167
- Font: Poppins, 14 px, weight 799
- Color: `#e7e1d3`
- Size: 78.125 × 79 px

### [10] Nav link — "Tavern"
- Position: x≈795–862, y≈88–167
- Font: Poppins, 14 px, weight 799
- Color: `#e7e1d3`
- Size: 77.234 × 79 px

### [11] Nav link — "Hall of Fame"
- Position: x≈862–910, y≈88–167
- Font: Poppins, 14 px, weight 799
- Color: `#e7e1d3`
- Size: 66.063 × 79 px

### [12] SUI balance button — "⊙ 4.82 SUI"
- Position: x≈933–1035, y≈90–124
- Font: JetBrains Mono, 13 px, weight 700
- Color: `#e8e2d4`
- Fill: `#c89a3f` (bronze background)
- Size: 112.609 × 31 px
- Layout: row, gap 6 px, justify flex-start, align center
- Padding: T 5, R 12 px

---

## Section 2 — Loadout banner (sub-header bar)

**Region:** x=57–1130, y=145–265 · **BG:** `#c89a3f` (bronze/gold) · **Height:** ~126 px · **Border-bottom:** 2 px solid `#e8e2d4`

### [13] Banner heading — "Loadout"
- Position: x≈80–580, y≈165–220
- Font: Poppins, 48 px, weight 800
- Color: `#e8e2d4`
- Size: 496.797 × 55.19 px
- Tracking: -0.96 px (tight, bold impact)

### [14] Banner subtitle — "Slot in your gear. The chain commits when you Save Loadout."
- Position: x≈80–600, y≈222–250
- Font: Poppins, 16 px, weight 400
- Color: `#e8e2d4`
- Size: full width, ~16 px height

### [15] "ON CHAIN" button
- Position: x≈983–1100, y≈185–222
- Font: Poppins, 14 px, weight 700
- Color: `#c89a3f`
- Fill: `#0a0d12`
- Size: 116.062 × 37.594 px
- Padding: T 8, R 14, B 8, L 14 px
- Border: 1 px solid all sides
- Style: solid border, dark button with bronze label

---

## Section 3 — Left panel: equipment frame

**Region:** x=57–370, y=265–770 · **BG:** dark (inherits)

### [16] Class label — "Bruiser"
- Position: x≈135–260, y≈293–320
- Font: Slackey, 26 px, weight 400
- Color: `#c89a3f`
- Size: 121.938 × 26 px
- Tracking: 0.52 px

### [17] Level display — "[14]"
- Cluster: x≈245–305, y≈295–340
- Font: JetBrains Mono, 18 px, weight 700
- Color: `#c89a3f`
- Opacity: 0.85
- Size: 43.234 × 23 px

### [18] ⓘ info icon
- Size: 300 × 46 px container (grouped element)
- Layout: flex row, gap 10 px, justify/align center
- Padding: T 10, B 10 px

### [19] HP bar badge — "240/240"
- Position: x≈185–260, y≈342–362
- Font: Poppins, mixed sizes
- Size: 300 × 46 px group
- Padding: T 10, B 10 px
- Layout: flex row center

### [20] Slot — Helmet (top-left, equipped)
- Position: x≈74–175, y≈330–435
- Image: `../../assets/items/Skullsplitter_Helm.png`
- Fit: contain
- Size: 92 × 104 px
- Padding: 4 px
- Border: highlighted (selected equipment slot)
- Effect: purple glow border on equipped item

### [21] Slot — Left ring (row of 3 small slots)
- Position: x≈255–280, y≈455–495
- Image: `../../assets/items/Phantom_Loop.png`
- Size: 24 × 40 px

### [22] Slot — Ring 2 (empty SVG icon)
- Position: x≈285–310, y≈455–495
- SVG: fill none, stroke `#8a8474`
- Stroke width: 2.2 px
- Size: 18.469 × 18.469 px

### [23] Slot — Ring 3 (empty SVG icon)
- Position: x≈316–345, y≈455–495
- SVG: fill none, stroke `#5e5a52`
- Stroke width: 2.2 px
- Size: 18.469 × 18.469 px

### [24] NFT portrait placeholder (center column)
- Position: x≈175–260, y≈355–740
- Text: "PLACE YOUR NFT HERE\nClick to choose a portrait — cosmetic only"
- Fill: `#0a0d12`, opacity 0.45
- Padding: 0 px
- Radius: 2 px
- Layout: flex row, justify/align center
- Font: JetBrains Mono (label text), mixed sizes

### [25] Slot — Weapon (left column, mid)
- Position: x≈74–175, y≈440–545
- Image: `../../assets/items/Skullcrusher_Maul.png`
- Fit: contain
- Size: 92 × 104 px
- Padding: 4 px
- Border: bronze (equipped)

### [26] Slot — Armor / chest (left column, lower)
- Position: x≈74–175, y≈550–660
- Image: `../../assets/items/mithril_breastplate.png`
- Fit: contain
- Size: 92 × 104 px
- Padding: 4 px

### [27] Slot — Legs / boots (left column, bottom)
- Position: x≈74–175, y≈665–770
- Image: (legs item)
- Size: 92 × 104 px

### [28] Slot — Right col top (Pendant of Wrath)
- Position: x≈257–355, y≈330–435
- Image: `../../assets/items/Pendant_of_Wrath.png`
- Fit: contain
- Size: 92 × 104 px
- Padding: 4 px
- Border: purple glow (equipped)

### [29] Slot — Right col mid (Bloodletter Gauntlets)
- Position: x≈257–355, y≈485–565
- Image: `../../assets/items/Bloodletter_Gauntlets.png`
- Fit: contain
- Size: 92 × 79 px
- Padding: 4 px

### [30] Slot — Empty slot (right col, small ring)
- Position: x≈257–355, y≈700–810
- Fill: `#0a0d12`, opacity 0.45
- Size: 96 × 108 px
- Layout: flex row, justify/align center
- Padding: 0 px · Radius: 2 px
- Font: JetBrains Mono, mixed
- Effect: dimmed empty slot with "v6" version label

---

## Section 4 — Center panel: character stats card

**Region:** x=375–893, y=265–715 · **BG:** `#1a1f28` · **Padding:** T 20, R 24, B 56, L 24 px

### [31] Class tag — "BRUISER" (pill badge)
- Position: x≈400–473, y≈302–324
- Font: Poppins, 10 px, weight 700
- Color: `#e8e2d4`
- Fill: `#b53d2c`
- Size: 71 × 22 px
- Padding: T 3, R 9, B 3, L 9 px
- Tracking: 1.4 px

### [32] "+ 2 PTS" button (top-right of card)
- Position: x≈792–875, y≈302–336
- Font: Poppins, 11 px, weight 700
- Color: `#e8e2d4`
- Fill: `#1a1f28`
- Size: 80.656 × 33 px
- Layout: flex row, gap 8, justify/align center
- Padding: T 6, R 12, B 6, L 12 px

### [33] Character name — "Ponke_the_Brawler"
- Position: x≈400–820, y≈330–367
- Font: Slackey, 36 px, weight 400
- Color: `#c89a3f`
- Size: 419.062 × 36 px
- Margin-top: 6 px

### [34] Level badge — "LV 14" (in stat card)
- Position: x≈400–452, y≈370–392
- Font: Poppins, 10 px, weight 700
- Color: `#0a0d12`
- Fill: `#c89a3f`
- Size: 51.73 × 22 px

### [35] ELO badge — "2134 ELO" (in stat card)
- Position: x≈454–528, y≈370–392
- Font: Poppins, 10 px, weight 700
- Color: `#0a0d12`
- Fill: `#c89a3f`
- Size: 73.656 × 22 px
- Padding: T 3, R 9, B 3, L 9 px

### [36] Record label — "47W · 21L · 69%"
- Position: x≈530–620, y≈372–390
- Font: Poppins, 12 px, weight 600
- Color: `#c8c1b0`
- Size: 86.625 × 18 px

### [37] Section header — "PRIMARY ATTRIBUTES"
- Position: x≈400–900, y≈407–423
- Font: Poppins, 10 px, weight 700
- Color: `#8a8474`
- Size: 499.719 × 16 px
- Tracking: 1 px

### [38] Attr label — "STR"
- Position: x≈404–432, y≈433–451
- Font: Poppins, 12 px, weight 800
- Color: `#b53d2c`
- Size: 25.516 × 18 px
- Tracking: 0.96 px

### [39] STR progress bar fill
- Position: x≈460–734, y≈436–441
- Fill: `#b53d2c`
- Size: 274.203 × 5 px

### [40] STR value — "14"
- Position: x≈852–875, y≈434–450
- Font: JetBrains Mono, 12 px, weight 700
- Color: `#b53d2c`
- Align: right
- Size: 22 × 16 px

### [41] Attr label — "DEX"
- Position: x≈404–436, y≈457–475
- Font: Poppins, 12 px, weight 800
- Color: `#6d8fa3`
- Size: 27.156 × 18 px

### [42] DEX progress bar fill
- Position: x≈460–617, y≈460–465
- Fill: `#6d8fa3`
- Size: 156.688 × 5 px

### [43] DEX value — "8"
- Font: JetBrains Mono, 12 px, weight 700
- Color: same read scale — shows stat score (`#6d8fa3` per its semantic family; some captures showed `#b53d2c` for the value but the canonical pattern is colored to match the row)

### [44] Attr label — "INT"
- Position: x≈404–428, y≈482–500
- Font: Poppins, 12 px, weight 800
- Color: `#8a6abf`
- Size: 23.016 × 18 px

### [45] INT progress bar fill
- Position: x≈460–656, y≈484–489
- Fill: `#8a6abf`
- Size: 195.859 × 5 px

### [46] Attr label — "END"
- Position: x≈404–432, y≈507–525
- Font: Poppins, 12 px, weight 800
- Color: `#c89a3f`
- Size: 27.469 × 18 px

### [47] END progress bar fill
- Position: x≈460–695, y≈509–514
- Fill: `#c89a3f`
- Size: 235.031 × 5 px

### [48] Section header — "COMBAT STATS"
- Position: x≈400–504, y≈542–558
- Font: Poppins, 10 px, weight 700
- Color: `#8a8474`
- Size: 103.172 × 13 px

### [49] Stat cell — HP / "240"
- Position: x≈390–510, y≈565–615
- Label HP: Poppins, 10 px, `#8a8474`, size 103.172 × 13 px
- Value 240: JetBrains Mono, 16 px, weight 700, `#b53d2c`
- Size: 103.172 × 21 px

### [50] Stat cell — ATK / "38"
- Position: x≈512–630, y≈565–615
- Font: JetBrains Mono, 16 px, weight 700
- Color: `#b53d2c`

### [51] Stat cell — CRIT / "18%"
- Position: x≈632–750, y≈565–615
- Font: JetBrains Mono, 16 px, weight 700
- Color: `#8a6abf`

### [52] Stat cell — CRIT × / "1.75x"
- Position: x≈752–872, y≈565–615
- Font: JetBrains Mono, 16 px, weight 700
- Color: `#8a6abf`

### [53] Stat cell — EVADE / "9%"
- Position: x≈390–510, y≈618–658
- Combined Poppins label + JetBrains Mono value
- Size: 499.719 × 99 px (entire second row of cells)

### [54] Stat cell — ARMOR / "22"
- Position: x≈512–630, y≈618–658
- Color: default parchment value

### [55] Stat cell — DEF / "31"
- Position: x≈632–750, y≈618–658
- Color: `#b53d2c`

### [56] Stat cell — LV / "14"
- Position: x≈752–872, y≈618–658
- Color: `#e8e2d4`

### [57] XP bar row — "LV 14 → 15" & "4,820 / 7,200 XP"
- Position: x≈390–880, y≈660–680
- Left text: Poppins, 10 px, weight 700, `#8a8474`
- Right text: Poppins, 10 px, weight 700, `#8a8474`
- Size: 59.25 × 16 px (left label)

### [58] XP progress bar (multi-segment)
- Position: x≈390–878, y≈680–688
- Type: background-image gradient bar
- Size: 333.188 × 8 px (filled portion)
- BG image: 200% 100%, position 11.11%
- Effect: striped gold/amber XP fill

---

## Section 5 — Right panel: inventory

**Region:** x=905–1130, y=265–770 · **BG:** inherits dark · no explicit panel fill

### [59] Inventory heading — "Inventory"
- Position: x≈910–1100, y≈285–328
- Font: Poppins, 36 px, weight 400
- Color: `#e8e2d4`
- Size: 176.344 × 41.391 px
- Tracking: -0.36 px

### [60] Inv slot — Weapon (Skullcrusher Maul)
- Position: x≈927–1017, y≈350–435
- Image: `../../assets/items/Skullcrusher_Maul.png`
- Fit: contain · Width 84.1406 px
- Size: 84.1406 × 84.1406 px
- Border: 1 px solid `#c89a3f`
- Label: "WEAPON" Poppins 8 px uppercase bronze

### [61] Inv slot — Gloves (Bloodletter Gauntlets)
- Position: x≈1020–1110, y≈350–435
- Image: `../../assets/items/Bloodletter_Gauntlets.png`
- Size: 84.1406 × 84.1406 px
- Border: 1 px solid `#8a6abf` (Epic rarity)
- Label: "GLOVES"

### [62] Inv slot — Necklace (Whisperwind Amulet)
- Position: x≈927–1017, y≈445–535
- Image: `../../assets/items/Whisperwind_Amulet.png`
- Size: 84.1406 × 84.1406 px
- Border: 1 px solid purple (rarity border)

### [63] Inv slot — Boots (Shadowstep Wraps)
- Position: x≈1020–1110, y≈445–535
- Image: `../../assets/items/Shadowstep_Wraps.png`
- Size: 84.1406 × 84.1406 px

### [64] Inv slot — Offhand (Dancer's Aegis)
- Position: x≈927–1017, y≈545–640
- Image: `../../assets/items/Dancers_Aegis.png`
- Size: 84.1406 × 84.1406 px

### [65] Inv slot — Necklace 2 (Pendant of Wrath)
- Position: x≈1020–1110, y≈545–640
- Image: `../../assets/items/Pendant_of_Wrath.png`
- Size: 84.1406 × 84.1406 px
- Label: "NECKLACE" Poppins 8 px bronze

### [66] Inv slot — Weapon 2 (Twin Stilettos)
- Position: x≈927–1017, y≈645–740
- Image: `../../assets/items/Twin_Stilettos.png`
- Size: 84.1406 × 84.1406 px

### [67] Inv slot — Chest (Mithril Breastplate)
- Position: x≈1020–1110, y≈645–740
- Image: `../../assets/items/mithril_breastplate.png`
- Fit: contain · Width 84.1406 px
- Size: 84.1406 × 84.1406 px
- Border: 1 px solid `#c89a3f` (equipped)

---

## Section 6 — Recent fights (below stats card)

**Region:** x=375–893, y=715–830+ (scrollable) · **BG:** dark panel

### [68] Section heading — "Recent fights"
- Position: x≈382–620, y≈715–757
- Font: Poppins, 36 px, weight 400
- Color: `#e8e2d4`
- Size: 238.438 × 41.391 px
- Tracking: -0.36 px

### [69] Fight row 1 — WIN vs BonkSmash
- WIN badge: Poppins 10/700, color `#e8e2d4`, fill `#5a8a3a`, size 60×22, border 1 px solid
- Opponent "vs BonkSmash": Poppins 13/700, `#e8e2d4`, size 223.719×20
- Score "+18": JetBrains Mono 13/700, `#5a8a3a`, size 80×17
- Result "KO round 4": Poppins 11/400, `#8a8474`, size 100×17, align right

### [70] Fight row 2 — WIN vs ApeKnocker
- Badge WIN: fill `#5a8a3a`
- Score "+12": JetBrains Mono, `#5a8a3a`
- Result "KO round 3": `#8a8474`

### [71] Fight row 3 — LOSS vs FrogLord420
- LOSS badge: fill `#b53d2c`, color `#e8e2d4`, size 60×22
- Score "-22": JetBrains Mono 13/700, `#b53d2c`
- Result "Cooked": `#8a8474`

### [72] Fight row 4 — WIN vs DogeKnight
- Badge WIN: fill `#5a8a3a` · Score "+9" green
- Result "Wager 0.5 SUI": `#8a8474`

### [73] Fight row 5 — LOSS vs MoonCatHiss
- Badge LOSS: fill `#b53d2c`
- Score "-15": JetBrains Mono, `#b53d2c`
- Result "Dodged every hit": `#8a8474`

---

## Global design tokens (observed across all elements)

### Colors
| Hex | Token | Use |
|---|---|---|
| `#0a0d12` | `--sc-page` | page bg, darkest panels |
| `#1a1f28` | `--sc-panel-2` | card backgrounds |
| `#c89a3f` | `--sc-bronze` | primary accent, active states |
| `#b53d2c` | `--sc-blood` | STR, HP, ATK, LOSS, danger |
| `#8a6abf` | `--sc-grape` | INT, CRIT, Epic rarity |
| `#6d8fa3` | `--sc-steel` | DEX bar |
| `#e8e2d4` | `--sc-parchment` | primary text |
| `#c8c1b0` | `--sc-parchment-dim` | secondary text |
| `#8a8474` | `--sc-muted` (alias `--fg-3`) | labels, metadata, inactive |
| `#5e5a52` | `--sc-dim` | empty slot outlines |
| `#5a8a3a` | `--sc-victory` | WIN badge, positive score |

### Typography
- **Slackey** — display / logo / character name (32–48 px, wt 400)
- **Poppins** — UI labels / body / badges (10–48 px, wt 400–800)
- **JetBrains Mono** — stats / numbers / code values (12–16 px, wt 700)

### Sizing system
- Slot tiles (equipment frame): 92 × 104 px
- Inventory slots: 84.14 × 84.14 px
- Pill badges: ~60 × 22 px (WIN/LOSS/LV/ELO)
- Attribute bars: 5 px height
- XP bar: 8 px height, gradient striped

### Effects / interactions
- Active nav text → `#c89a3f`
- Equipped item border → 1 px `#c89a3f`
- Epic rarity border → 1 px `#8a6abf`
- WIN outcome fill → `#5a8a3a`, text parchment
- LOSS outcome fill → `#b53d2c`, text parchment
- Empty slot fill → `#0a0d12`, opacity 0.45, radius 2 px
- COMBAT STATS color-coded by stat type (red / blue / purple / gold)
- Attribute bars semantic-colored (STR=red, DEX=blue, INT=purple, END=bronze)

---

## Acceptable deviations
- ±2 px tolerance on positions and sizes.
- Where inspector reported a Poppins weight like 797.5/799, render as 800 (font-weight is integer in CSS).
- Where slot sizes vary in the inspector (92×104 / 92×79 / 96×108), the canonical equipment-frame slot is **92×104**; smaller rectangles in the right column (e.g., 92×79) are anchored to the bottom of their row so the overall column heights stay aligned (mirrors `character_layout_reference.jpeg`).
- DEX value color in element [43] is rendered to match its row (`#6d8fa3`), not the alternate red reading.

## Anti-spec — explicitly NOT in scope
- Equip flow, save-loadout pipeline, stat-allocate modal logic, NFT picker modal, reducer dispatches, WebSocket plumbing, contract changes, test rewrites.
- "Place your NFT here" copy stays unchanged.
- Existing functional `--sc-*` tokens not listed above stay alive (backward-compat aliases).

## Index summary
- 6 sections, 73 elements, 11 canonical colors, 3 font families, 2 canonical tile sizes (92×104 equipment, 84.14 inventory).
