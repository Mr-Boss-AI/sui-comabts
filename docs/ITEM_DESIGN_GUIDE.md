# Item Design Guide (v5.3 — levels + stats, no rarity)

> Items have **only a level and stats**. No Common / Rare / Legendary.
> Every slot comes in **build variants of equal power** (STR sword, DEX
> dagger, INT rune blade, heavy vs light armour, …) — players decide how to
> build their character; the numbers keep it fair.
>
> All numbers come from the real server combat engine:
> `cd server && npx tsx ../scripts/item-catalog.ts` regenerates §6.
> Build balance: `scripts/stat-balance.ts`, fighting styles: `scripts/offhand-balance.ts`.

---

## 1. Gear slots

| Slot | `item_type` | `slot_type` | Notes |
|---|---|---|---|
| Weapon (1-hand) | 1 | 0 | Main hand, or offhand for dual-wield. |
| Weapon (2-hand) | 1 | 2 | Takes both hands. ×1.5 landed damage. |
| Shield | 2 | 1 | Offhand only. |
| Helmet | 3 | 0 | |
| Chest | 4 | 0 | |
| Gloves | 5 | 0 | |
| Boots | 6 | 0 | |
| Belt | 7 | 0 | |
| Ring (×3 slots) | 8 | 0 | |
| Necklace | 9 | 0 | |
| Legs | 10 | 0 | Chain name `pants`. |
| Bracers | 11 | 0 | Chain name `bracelets`. |
| Earrings | — | — | **Not on chain yet** — needs a 14th slot (your call). |

`class_req` = 0 for every item.

---

## 2. What each stat does

| Stat (mint field) | Effect |
|---|---|
| `min_damage` / `max_damage` | Weapon damage; the average is added to every hit. |
| `attack_bonus` (ATK) | +flat damage on every hit. |
| `armor_bonus` (ARM) | −flat damage on every hit taken (crits ignore 20% of it). |
| `defense_bonus` (DEF) | −flat damage on every hit taken. |
| `hp_bonus` (HP) | +max HP. |
| `strength_bonus` (STR) | +0.5 damage, −0.3% enemy evasion per point. |
| `dexterity_bonus` (DEX) | +0.8% evasion, +0.15 damage per point. |
| `intuition_bonus` (INT) | +1.25% crit chance, +0.02× crit damage per point. |
| `endurance_bonus` (END) | +3 HP, +0.1 defense, −0.3% enemy crit chance per point. |
| `crit_chance_bonus` (CRIT%) | +1% crit chance (cap 30%). |
| `crit_multiplier_bonus` (CRITDMG) | +0.01× crit damage per point (10 = +0.10×). |
| `evasion_bonus` (EVA%) | +1% dodge chance (cap 35%). |
| `anti_crit_bonus` (ANTICRIT%) | −1% to the **enemy's** crit chance. |
| `anti_evasion_bonus` (ANTIEVA%) | −1% to the **enemy's** evasion. |

- **Crit through block:** a critical strike into a guarded zone still lands 10% of its crit damage.
- Base crit damage is ×1.5.

---

## 3. On-chain rules (item.move — the contract rejects anything else)

1. `level_req` 1–20. **Weapons and shields need level 3+** (levels 1–2 fight bare-handed).
2. **Flat power limit** — each point costs its fight value:
   `HP×1 + ARM×7 + DEF×7 + ATK×7 + max_damage×6 + STR×5 + DEX×3 + END×7 ≤ cap(level)`
3. **Chance points limit** — `INT×2 + CRIT% + EVA% + ANTICRIT% + ANTIEVA% + CRITDMG÷10 ≤ 20` per item.

The limits only stop broken items (e.g. ARM +100 at level 1). The tables in §6 already fit them.

| Item level | Flat power cap |
|---|---|
| 1 | 15 |
| 2 | 21 |
| 3 | 28 |
| 4 | 36 |
| 5 | 45 |
| 6 | 55 |
| 7 | 66 |
| 8 | 78 |
| 9 | 91 |
| 10 | 104 |
| 11 | 119 |
| 12 | 134 |
| 13 | 151 |
| 14 | 168 |
| 15 | 187 |
| 16 | 206 |
| 17 | 227 |
| 18 | 248 |
| 19 | 270 |
| 20 | 294 |

---

## 4. Build variants — every build is fair

Four themed full sets (weapon + shield + armour + jewellery of that build), same level, win rate of the first build:

| Level | STR vs DEX | STR vs INT | STR vs END | DEX vs INT | DEX vs END | INT vs END |
|---|---|---|---|---|---|---|
| 3 | 47% | 44% | 45% | 52% | 49% | 55% |
| 6 | 53% | 51% | 54% | 54% | 46% | 51% |
| 10 | 49% | 48% | 49% | 51% | 45% | 57% |
| 15 | 46% | 53% | 48% | 52% | 46% | 58% |
| 20 | 43% | 48% | 45% | 47% | 45% | 64% |

- Every build wins 43–58% against the others, except INT vs END at level 20 (64%) — INT gear pulls ahead late.
- Without gear, the pure stat builds (STR / DEX / INT / END / balanced) all win 49–51%.

Levels matter more than anything else:

| Level | full set vs no gear | full set vs set 2 levels lower (same level fighters) |
|---|---|---|
| 3 | 99% | 95% |
| 6 | 100% | 65% |
| 10 | 100% | 65% |
| 15 | 100% | 61% |
| 20 | 100% | 54% |

---

## 5. Fighting styles

| Style | Gear | Strikes | Guards | Rule |
|---|---|---|---|---|
| Sword & shield | 1-hand + shield | 1 | 3 (line) | — |
| Dual-wield | two 1-hand weapons | 2 (may hit the same zone twice) | 2 | Each strike lands 72.5%; offhand adds 50% of its damage + its stats. |
| Two-hander | 2-hand weapon | 1 | 2 | ×1.5 landed damage. |

Same-level gear: every style wins 42–54% against the others (levels 3–18).

---

## 6. Item tables — copy a cell into the mint call

`DMG a-b` → `min_damage = a`, `max_damage = b`. Everything else maps to its `*_bonus` field; unlisted = 0.
`—` = not allowed at that level. For dual-wield, put a second 1-hand weapon in the offhand.
Levels between two columns: use the lower column (or interpolate).

### Weapon (1-hand)

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Sword — STR | — | — | DMG 2-3, STR +1 | DMG 2-4, STR +2 | DMG 2-4, STR +2 | DMG 3-5, STR +2 | DMG 3-6, STR +2 |
| Dagger — DEX | — | — | DMG 2-3, DEX +3 | DMG 2-3, DEX +4 | DMG 2-4, DEX +4 | DMG 2-5, DEX +4 | DMG 3-5, DEX +4 |
| Rune blade — INT | — | — | DMG 2-3, INT +5 | DMG 2-3, INT +5 | DMG 2-4, INT +4 | DMG 2-5, INT +4 | DMG 3-5, INT +4 |
| Mace — END | — | — | DMG 2-3, END +1 | DMG 2-3, END +2 | DMG 2-4, END +2 | DMG 2-5, END +2 | DMG 3-5, END +3 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Sword — STR | DMG 4-7, STR +3 | DMG 5-10, STR +4 | DMG 6-11, STR +4 | DMG 8-14, STR +5 | DMG 10-19, STR +5 | DMG 12-22, STR +5 | DMG 13-24, STR +6 |
| Dagger — DEX | DMG 3-6, DEX +4 | DMG 5-9, DEX +5 | DMG 6-11, DEX +4 | DMG 7-13, DEX +5 | DMG 10-18, DEX +5 | DMG 11-21, DEX +5 | DMG 12-23, DEX +5 |
| Rune blade — INT | DMG 3-6, INT +4 | DMG 5-9, INT +4 | DMG 6-11, INT +4 | DMG 7-13, INT +4 | DMG 10-18, INT +4 | DMG 11-21, INT +4 | DMG 12-23, INT +4 |
| Mace — END | DMG 3-6, END +3 | DMG 5-9, END +4 | DMG 6-11, END +5 | DMG 7-13, END +6 | DMG 10-18, END +7 | DMG 11-21, END +8 | DMG 12-23, END +8 |


### Weapon (2-hand)

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Greatsword — STR | — | — | DMG 2-3, STR +1 | DMG 2-4, STR +2 | DMG 3-5, STR +2 | DMG 4-7, STR +2 | DMG 4-8, STR +3 |
| War staff — INT | — | — | DMG 2-4, INT +9 | DMG 3-5, INT +8 | DMG 3-6, INT +8 | DMG 3-6, INT +7 | DMG 4-7, INT +7 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Greatsword — STR | DMG 5-10, STR +3 | DMG 7-14, STR +4 | DMG 10-18, STR +4 | DMG 12-22, STR +6 | DMG 15-27, STR +6 | DMG 19-34, STR +6 | DMG 20-38, STR +7 |
| War staff — INT | DMG 4-8, INT +7 | DMG 6-12, INT +7 | DMG 8-14, INT +7 | DMG 10-18, INT +6 | DMG 13-24, INT +7 | DMG 15-28, INT +7 | DMG 17-31, INT +6 |


### Shield

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Heater shield | — | — | ARM +1, HP +1 | ARM +1, HP +2 | ARM +1, DEF +1, HP +2 | ARM +1, DEF +1, HP +3 | ARM +1, DEF +1, HP +3 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Heater shield | ARM +2, DEF +1, HP +4 | ARM +2, DEF +1, HP +6 | ARM +3, DEF +2, HP +8 | ARM +3, DEF +2, HP +9 | ARM +4, DEF +2, HP +12 | ARM +5, DEF +3, HP +16 | ARM +5, DEF +3, HP +17 |


### Helmet

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Helm — heavy | HP +2 | HP +2 | HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | ARM +1, HP +6 | ARM +1, HP +7 |
| Hood — light | EVA% +3, HP +2 | EVA% +3, HP +2 | EVA% +3, HP +3 | EVA% +3, HP +4 | EVA% +3, HP +5 | EVA% +3, HP +6 | EVA% +3, HP +7 |
| Circlet — mystic | INT +3, HP +2 | INT +3, HP +2 | INT +3, HP +3 | INT +3, HP +4 | INT +3, HP +5 | INT +3, HP +6 | INT +2, HP +7 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Helm — heavy | ARM +1, HP +8 | ARM +2, HP +12 | ARM +2, HP +16 | ARM +3, HP +19 | ARM +3, HP +24 | ARM +4, HP +31 | ARM +4, HP +35 |
| Hood — light | EVA% +3, HP +8 | EVA% +3, HP +12 | EVA% +3, HP +16 | EVA% +3, HP +19 | EVA% +3, HP +24 | EVA% +3, HP +31 | EVA% +3, HP +35 |
| Circlet — mystic | INT +2, HP +8 | INT +3, HP +12 | INT +2, HP +16 | INT +2, HP +19 | INT +2, HP +24 | INT +2, HP +31 | INT +2, HP +35 |


### Chest

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Plate / mail — heavy | ARM +1, HP +3 | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | ARM +1, HP +6 | ARM +2, HP +8 | ARM +2, HP +10 |
| Leather — light | EVA% +4, DEX +2, HP +2 | EVA% +4, DEX +2, HP +2 | EVA% +4, DEX +2, HP +3 | EVA% +4, DEX +3, HP +4 | EVA% +4, DEX +3, HP +5 | EVA% +4, DEX +3, HP +6 | EVA% +3, DEX +3, HP +7 |
| Robe — mystic | INT +5, HP +3 | INT +5, HP +4 | INT +5, HP +5 | INT +5, HP +6 | INT +5, HP +8 | INT +5, HP +11 | INT +4, HP +12 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Plate / mail — heavy | ARM +3, HP +12 | ARM +4, HP +16 | ARM +5, HP +23 | ARM +6, HP +26 | ARM +7, HP +34 | ARM +8, HP +44 | ARM +9, HP +49 |
| Leather — light | EVA% +3, DEX +3, HP +9 | EVA% +4, DEX +3, HP +12 | EVA% +4, DEX +3, HP +17 | EVA% +3, DEX +3, HP +19 | EVA% +3, DEX +4, HP +25 | EVA% +3, DEX +4, HP +33 | EVA% +3, DEX +4, HP +36 |
| Robe — mystic | INT +4, HP +15 | INT +5, HP +20 | INT +4, HP +28 | INT +4, HP +32 | INT +4, HP +42 | INT +4, HP +55 | INT +4, HP +61 |


### Gloves

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Gauntlets — striker | CRIT% +3 | CRIT% +3 | ATK +1, CRIT% +3 | ATK +1, CRIT% +3 | ATK +1, CRIT% +3 | ATK +1, CRIT% +2 | ATK +1, CRIT% +3 |
| Grips — precise | ANTIEVA% +2, DEX +1 | ANTIEVA% +2, DEX +1 | ANTIEVA% +2, DEX +1 | ANTIEVA% +2, DEX +2 | ANTIEVA% +2, DEX +2 | ANTIEVA% +2, DEX +2 | ANTIEVA% +2, DEX +2 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Gauntlets — striker | ATK +1, CRIT% +3 | ATK +2, CRIT% +3 | ATK +2, CRIT% +3 | ATK +3, CRIT% +2 | ATK +3, CRIT% +2 | ATK +3, CRIT% +2 | ATK +4, CRIT% +2 |
| Grips — precise | ANTIEVA% +2, DEX +2 | ANTIEVA% +2, DEX +2 | ANTIEVA% +2, DEX +2 | ANTIEVA% +2, DEX +2 | ANTIEVA% +2, DEX +2 | ANTIEVA% +2, DEX +2 | ANTIEVA% +2, DEX +2 |


### Boots

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Greaves — heavy | HP +1 | HP +2 | HP +2 | HP +3 | ARM +1, HP +3 | ARM +1, HP +5 | ARM +1, HP +5 |
| Soft boots — light | EVA% +3, DEX +1 | EVA% +3, DEX +1 | EVA% +3, DEX +1 | EVA% +3, DEX +1 | EVA% +3, DEX +1 | EVA% +3, DEX +1 | EVA% +2, DEX +2 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Greaves — heavy | ARM +1, HP +6 | ARM +1, HP +9 | ARM +2, HP +12 | ARM +2, HP +14 | ARM +2, HP +18 | ARM +3, HP +24 | ARM +3, HP +26 |
| Soft boots — light | EVA% +2, DEX +2 | EVA% +3, DEX +2 | EVA% +3, DEX +2 | EVA% +3, DEX +2 | EVA% +2, DEX +2 | EVA% +2, DEX +2 | EVA% +2, DEX +2 |


### Belt

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Girdle | HP +1 | HP +1 | END +1, HP +1 | END +1, HP +2 | END +1, HP +2 | END +1, HP +3 | END +1, HP +3 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Girdle | END +1, HP +4 | END +2, HP +6 | END +2, HP +8 | END +3, HP +9 | END +3, HP +12 | END +4, HP +16 | END +4, HP +17 |


### Legs

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Chausses — heavy | HP +2 | HP +2 | HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | ARM +1, HP +6 | ARM +1, HP +7 |
| Breeches — light | EVA% +3, HP +2 | EVA% +3, HP +2 | EVA% +3, HP +3 | EVA% +3, HP +4 | EVA% +3, HP +5 | EVA% +3, HP +6 | EVA% +3, HP +7 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Chausses — heavy | ARM +1, HP +8 | ARM +2, HP +12 | ARM +2, HP +16 | ARM +3, HP +19 | ARM +3, HP +24 | ARM +4, HP +31 | ARM +4, HP +35 |
| Breeches — light | EVA% +3, HP +8 | EVA% +3, HP +12 | EVA% +3, HP +16 | EVA% +3, HP +19 | EVA% +3, HP +24 | EVA% +3, HP +31 | EVA% +3, HP +35 |


### Bracers

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Vambraces — STR | HP +2 | HP +3 | STR +1 | STR +1 | STR +1 | DEF +1, STR +1 | DEF +1, STR +1 |
| Wraps — INT | CRIT% +3, INT +2 | CRIT% +3, INT +2 | CRIT% +3, INT +2 | CRIT% +3, INT +2 | CRIT% +3, INT +2 | CRIT% +3, INT +2 | CRIT% +3, INT +2 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Vambraces — STR | DEF +1, STR +1 | DEF +1, STR +2 | DEF +1, STR +2 | DEF +2, STR +2 | DEF +2, STR +2 | DEF +2, STR +2 | DEF +3, STR +3 |
| Wraps — INT | CRIT% +3, INT +2 | CRIT% +3, INT +2 | CRIT% +3, INT +1 | CRIT% +3, INT +1 | CRIT% +2, INT +1 | CRIT% +2, INT +1 | CRIT% +2, INT +1 |


### Necklace

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Amulet — crit | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 |
| Talisman — dodge | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Amulet — crit | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 |
| Talisman — dodge | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 | EVA% +2, ANTIEVA% +2 |


### Ring

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Ring of Strength | STR +1 | STR +1 | STR +1 | STR +1 | STR +1 | STR +1 | STR +2 |
| Ring of Dexterity | DEX +1 | DEX +2 | DEX +2 | DEX +2 | DEX +2 | DEX +2 | DEX +2 |
| Ring of Intuition | INT +3 | INT +3 | INT +3 | INT +3 | INT +3 | INT +2 | INT +2 |
| Ring of Endurance | HP +2 | END +1 | END +1 | END +1 | END +1 | END +1 | END +2 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Ring of Strength | STR +2 | STR +2 | STR +3 | STR +3 | STR +4 | STR +4 | STR +4 |
| Ring of Dexterity | DEX +2 | DEX +3 | DEX +2 | DEX +3 | DEX +3 | DEX +3 | DEX +3 |
| Ring of Intuition | INT +2 | INT +2 | INT +2 | INT +2 | INT +2 | INT +2 | INT +2 |
| Ring of Endurance | END +2 | END +2 | END +3 | END +3 | END +4 | END +4 | END +4 |


### Earrings (needs 14th slot)

| Variant | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 |
|---|---|---|---|---|---|---|---|
| Earrings | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 |

| Variant | Lv8 | Lv10 | Lv12 | Lv14 | Lv16 | Lv18 | Lv20 |
|---|---|---|---|---|---|---|---|
| Earrings | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 |

---

## 7. Making the NFT

1. **Art:** PNG, transparent background, square (512×512+), style like `frontend/public/v53/slots/` but in colour.
2. **Upload** to Pinata/IPFS → `image_url`.
3. **Name:** medieval, ≤ 32 characters.
4. **Mint** with `item::mint_item_admin` (TREASURY + AdminCap). Field order:
   `name, image_url, item_type, class_req(0), level_req, slot_type, STR, DEX, INT, END, HP, ARM, DEF, ATK, CRIT%, CRITDMG, EVA%, ANTICRIT%, ANTIEVA%, min_damage, max_damage`.
5. **List** in the TREASURY kiosk; the 2.5% royalty applies automatically.

### Suggested store prices (testnet SUI)

Price by level only: **0.05 + 0.05 × level** (Lv1 0.10 · Lv5 0.30 · Lv10 0.55 · Lv20 1.05). Raise it for limited-supply designs.
