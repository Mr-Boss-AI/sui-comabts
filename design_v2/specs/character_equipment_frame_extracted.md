# Character Equipment Frame — Extracted Spec

**Source:** Live React state read via Claude Chrome extension against `CharacterScreen.jsx` + `App.jsx` from the canonical mockup.
**Status:** Authoritative. Measurements, CSS variables, shadow recipes, grid templates all came straight from the design-tool React source.
**Companion spec:** `design_v2/specs/character_v2_measurements.md` (overall page 73-element report).
**Reference screenshot:** `design_v2/screenshopts/character_equipment_target.png`.

---

## Critical diagnostic

> "The reason it looks off in the CLI port is mainly those dynamic tweak values — `bigSlotH: 108` makes the slots noticeably tall rectangles, the `colGap: 8` / `slotGap: 6` keeps everything tight, and the **center column is `1fr`** (stretches to fill). If your CLI renderer is treating that grid column as a fixed width rather than a flex fraction, the portrait and slots will collapse or misalign."

The pre-existing implementation used `grid-template-columns: ${BIG}px ${CENTER}px ${BIG}px` with `CENTER = round(462 * scale)` — a fixed pixel center. That's the root cause. The center column **must** stay `1fr`.

---

## Outer container — EquipmentFrame

| Property | Value |
|---|---|
| `display` | `grid` |
| `grid-template-columns` | `${colWidth}px ${colGap}px 1fr ${colGap}px ${colWidth}px` |
| `background` | `var(--sc-panel)` (#15191f) |
| `border` | `2px solid var(--sc-bronze-deep)` |
| `box-shadow` | `0 0 0 1px var(--sc-rim)` + inset plate shadow |
| `padding` | `12px` (framePad) |
| `align-items` | `stretch` |

---

## Tweakable size defaults (from App.jsx `TWEAK_DEFAULTS`)

| Variable | Default | Usage |
|---|---|---|
| `bigSlotW` | `96` | width of all main slots |
| `bigSlotH` | `108` | height of main slots (Helm, Weapon, Chest, Necklace, Gloves, Off-hand, Boots) |
| `ringSlotSize` | `44` | width AND height of Ring1 / Ring2 / Ring3 |
| `beltSlotH` | `56` | height of Belt (same width as bigSlotW) |
| `colGap` | `8` | gap between left / center / right columns |
| `slotGap` | `6` | vertical gap between slots within a column |
| `framePad` | `12` | doll panel inner padding |
| `statRowPad` | `4` | stat rows in the right attribute panel |

---

## Slot layout structure

```
LEFT COLUMN  |  CENTER (HP + Portrait + Ornament)  |  RIGHT COLUMN
─────────────────────────────────────────────────
Helmet       |  HpBar (h:22)                       |  Necklace
Shoulders*   |  PortraitFrame (flex:1)             |  [Ring1 / Ring2 / Ring3*]
Weapon       |  Ornament (h:56)                    |  Gloves
Chest        |                                     |  Off-hand
Belt (h:56)  |                                     |  Pants* / Boots
```

`*` = future-contract slots (disabled/dimmed today, opacity 0.45 + v5.1 lock badge).

---

## SlotTile

| Property | Value |
|---|---|
| `border` | `2px solid {rarityColor}` (filled) / `var(--sc-rim-2)` (empty) |
| `border-radius` | `2px` |
| `padding` | `0` |
| `background` | empty → `var(--sc-panel-2)` / future → `var(--sc-page)` |
| `opacity` (future slot) | `0.45` |
| `box-shadow` (dirty/equipped) | `0 0 0 1px var(--sc-bronze)` |
| `box-shadow` (empty) | `inset 0 1px 0 rgba(255,255,255,.05), inset 0 -1px 0 rgba(0,0,0,.55), 1px 1px 0 rgba(0,0,0,.6)` |
| `transition` | `transform .15s, border-color .15s, box-shadow .15s` |
| Item image | `width:100%, height:100%, objectFit:contain, padding:4` + drop-shadow filter |
| Empty icon | IconComp at `Math.min(w, h) * 0.42` |

---

## HpBar

| Property | Value |
|---|---|
| `height` | `22px` |
| `background` | `var(--sc-page)` |
| `border` | `2px solid var(--sc-bronze)` |
| `box-shadow` | `inset 0 1px 0 rgba(255,255,255,.06), inset 0 -2px 0 rgba(0,0,0,.55)` |
| Fill gradient | `linear-gradient(180deg, #7ba84a 0%, #5a8a3a 50%, #3f6b29 100%)` |
| Text | JetBrains Mono, 13px, weight 700, `var(--sc-parchment)`, letter-spacing 0.06em |

---

## PortraitFrame (center NFT slot)

| Property | Value |
|---|---|
| `width` | 100% of center column |
| `min-height` | `0` (`flex: 1`, grows to fill) |
| `background` (empty) | `#0a0a0c` |
| `border` | `2px solid var(--sc-bronze)` |
| `border-radius` | `0` |
| `box-shadow` | `inset 0 0 0 1px rgba(0,0,0,.4), inset 0 2px 4px rgba(0,0,0,.6)` |
| "Portrait" badge | `var(--sc-bronze)` bg, `rgba(10,13,18,.85)` text, padding `3px 8px`, `1px solid var(--sc-bronze)` border |
| Plus icon (empty) | 60×60, `2px solid var(--sc-bronze)`, opacity 0.55, IPlus size 36 |
| "Place your NFT here" | font-ui, 14px, weight 800, uppercase, `var(--sc-ash)` |
| Subtitle | font-ui, 11px, `var(--sc-ash-2)`, max-width 200, line-height 1.45 |

---

## Ornament panel (below portrait)

| Property | Value |
|---|---|
| `height` | `56px` |
| `background` | `var(--sc-panel-3)` |
| `border` | `1px solid var(--sc-rim-2)` |
| `box-shadow` | `inset 0 1px 0 rgba(255,255,255,.04), inset 0 -1px 0 rgba(0,0,0,.55)` |
| Content | SVG tribal/heraldic decoration, bronze strokes |

---

## FrameTitle bar (above frame)

| Property | Value |
|---|---|
| `padding` | `10px 0` |
| Archetype text | font-display, 26px, line-height 1, `var(--sc-bronze)`, letter-spacing 0.02em |
| Level text | font-mono, 18px, weight 700, `var(--sc-bronze)`, opacity 0.85 |
| Build info "i" button | 22×22px, `var(--sc-steel)` bg, `1px solid var(--sc-steel-deep)` border, serif italic 13px |

---

## Required CSS tokens (verified or to add)

`--sc-panel`, `--sc-panel-2`, `--sc-panel-3`, `--sc-page`,
`--sc-bronze`, `--sc-bronze-deep`,
`--sc-rim`, `--sc-rim-2`,
`--sc-ash`, `--sc-ash-2`, `--sc-parchment`,
`--sc-steel`, `--sc-steel-deep`.

All confirmed present in `frontend/src/styles/design-tokens-v2.css`.
