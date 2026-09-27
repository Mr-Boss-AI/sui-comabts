# Item Design Guide (v5.3)

> How to design fair items for SUI Combats. You make the PNG, pick a row from
> the tables in §7, and the item is balanced against every other item at the
> same level and rarity.
>
> Every number here comes from the **real server combat engine**, not guesswork:
> `scripts/item-balance.ts` runs thousands of simulated fights per level and
> regenerates these tables (`cd server && npx tsx ../scripts/item-balance.ts`).
> Re-run it after any combat change.

---

## 1. The 13 gear slots (+1 pending)

| Slot | `item_type` | `slot_type` | Notes |
|---|---|---|---|
| Weapon (1-hand) | 1 | 0 | Main hand. A 1-hand weapon can also go in the offhand (dual-wield). |
| Weapon (2-hand) | 1 | 2 | Takes weapon **and** offhand slot. See warning in §6. |
| Shield | 2 | 1 | Offhand only. |
| Helmet | 3 | 0 | |
| Chest | 4 | 0 | |
| Gloves | 5 | 0 | |
| Boots | 6 | 0 | |
| Belt | 7 | 0 | |
| Ring (×3 slots) | 8 | 0 | Same type fits Ring I / II / III. |
| Necklace | 9 | 0 | |
| Legs | 10 | 0 | Chain calls it `pants`. |
| Bracers | 11 | 0 | Chain calls it `bracelets`. |
| Earrings | — | — | **Not on chain yet.** Needs a 14th slot in the v5.3 publish (your call). |

`class_req` = 0 for every item (no classes). `level_req` = 1–20.

---

## 2. What each stat does in a fight

| Stat (mint field) | Effect | Notes |
|---|---|---|
| `min_damage` / `max_damage` | Weapon damage; the average is added to every hit | Weapon only. `max_damage` counts toward the budget, `min_damage` does not. |
| `attack_bonus` (ATK) | +flat damage on every hit | |
| `armor_bonus` (ARM) | −flat damage on every hit you take (halved against crits) | Very strong: flat reduction on **every** hit. |
| `defense_bonus` (DEF) | −flat damage on every hit you take | |
| `hp_bonus` (HP) | +max HP | Cheapest per point — about 7× weaker than ARM per point. |
| `strength_bonus` (STR) | +0.5 dmg per point, lowers enemy evasion 0.3% per point | Best core stat. |
| `dexterity_bonus` (DEX) | +0.5% evasion, +0.15 dmg per point | |
| `intuition_bonus` (INT) | +0.5% crit chance, +0.01× crit dmg per point | **Currently very weak** — see §6. |
| `endurance_bonus` (END) | +3 HP, +0.3 defense, lowers enemy crit 0.3% per point | Strong. |
| `crit_chance_bonus` (CRIT%) | +1% crit chance per point (cap 25%) | Fixed in v5.3 — used to wrongly multiply crit damage. |
| `crit_multiplier_bonus` (CRITDMG) | +0.01× crit damage per point (10 = +0.10×) | Only matters if you crit. |
| `evasion_bonus` (EVA%) | +1% chance to dodge per point (cap 30%) | |
| `anti_crit_bonus` (ANTICRIT%) | −1% to the **enemy's** crit chance per point | Counter stat. |
| `anti_evasion_bonus` (ANTIEVA%) | −1% to the **enemy's** evasion per point | Counter stat. |

### How strong one point is ("edge unit")
Amount of ONE stat that turns an even fight into a **60/40** win. Smaller = stronger per point.

| Stat | Lv1 | Lv5 | Lv10 | Lv15 | Lv20 |
|---|---|---|---|---|---|
| HP | 6.2 | 13.5 | 33.0 | 60.9 | 92.8 |
| ARM | 0.8 | 2.1 | 4.2 | 7.0 | 10.8 |
| DEF | 0.9 | 1.9 | 4.4 | 7.1 | 10.6 |
| ATK | 0.8 | 1.9 | 4.7 | 8.1 | 11.1 |
| DMG | 0.9 | 2.0 | 4.9 | 7.9 | 11.3 |
| STR | 1.7 | 3.3 | 6.8 | 10.5 | 11.3 |
| DEX | 4.0 | 7.7 | 10.5 | 12.8 | 13.0 |
| END | 1.2 | 2.3 | 5.2 | 7.4 | 12.2 |
| CRIT% | 15.2 | 16.5 | 15.4 | 13.9 | 13.5 |
| EVA% | 8.3 | 9.2 | 8.0 | 7.9 | 8.0 |

---

## 3. Rarity rules (on-chain)

The contract rejects an item if **all stat fields + `max_damage`** add up to more than its rarity budget:

| Rarity | `rarity` | Chain budget (max) | Recommended power (full set) |
|---|---|---|---|
| Common | 1 | 20 | 5.0 edge units |
| Uncommon | 2 | 40 | 6.5 |
| Rare | 3 | 70 | 8.2 |
| Epic | 4 | 110 | 10.2 |
| Legendary | 5 | 160 | 12.8 |

The tables in §7 already fit these budgets (1 cell marked ⚠️ is the only exception).

---

## 4. Slot recipes (what each slot is "for")

| Slot | Share of set power | Stat mix |
|---|---|---|
| Weapon (1-hand) | 22% | 75% weapon damage, 25% STR |
| Chest | 14% | 60% ARM, 40% HP |
| Shield | 10% | 50% ARM, 30% DEF, 20% HP |
| Helmet | 8% | 50% ARM, 50% HP |
| Legs | 8% | 50% ARM, 50% HP |
| Gloves | 6% | 60% ATK, 40% CRIT% |
| Boots | 6% | 50% ARM, 50% EVA% |
| Belt | 5% | 60% END, 40% HP |
| Bracers | 5% | 50% DEF, 50% STR |
| Necklace | 5% | 50% CRIT%, 50% ANTICRIT% |
| Rings | 3.7% each | one core stat (STR / END / DEX) |

You can swap stats inside an item **at the same power**. Use the edge table in §2:
e.g. at level 10, 1 ARM ≈ 7 HP ≈ 1.3 STR. Keep the swap even and it stays fair.

---

## 5. Proof it's fair (simulated, 2 500 fights per cell)

Full set of each rarity vs the rarity below it, same level:

| Level | Common set vs naked | Uncommon vs Common | Rare vs Uncommon | Epic vs Rare | Legendary vs Epic |
|---|---|---|---|---|---|
| 1 | 97% | 58% | 73% | 58% | 72% |
| 5 | 98% | 70% | 65% | 70% | 72% |
| 10 | 99% | 60% | 62% | 70% | 65% |
| 15 | 99% | 62% | 63% | 67% | 72% |
| 20 | 99% | 63% | 65% | 64% | 75% |

- Each rarity step wins **58–75%**: a clear upgrade, never unbeatable.
- A full Common set beats a naked fighter ~98% of the time. Give new players a free Common starter set.

---

## 6. ⚠️ Balance problems found in the engine (not item problems)

| Level | Empty shield (0 stats) vs no shield | Rare 2-hander set vs Rare 1-hand+shield set |
|---|---|---|
| 1 | 85% | 14% |
| 10 | 86% | 15% |
| 20 | 87% | 13% |

1. **Shields are too strong.** A shield with *zero stats* wins ~86% against no shield, because it blocks 3 zones instead of 2. Dual-wield is balanced against shields (≈49%).
2. **Two-handed weapons are useless.** A Rare 2-hander loses ~86% against Rare 1-hand + shield, even with 60% more damage. Don't mint 2-handers until combat gives them a real bonus.
3. **INT is a trap stat.** ~20 INT ≈ 1.4 STR at level 1. INT builds lose most fights.
4. **Chain budget ignores level.** A Level 1 Legendary may legally hold 160 points (e.g. ARM +100) — unbeatable at level 1. Stick to the tables, or fix it on-chain in the v5.3 publish with a level-scaled budget.

These need a combat / contract decision before v5.3 ships (see chat).

---

## 7. Item tables (copy a cell into the mint call)

`DMG a-b` → `min_damage = a`, `max_damage = b`. Everything else maps to its `*_bonus` field. Unlisted fields = 0.
Small numbers at low levels are intentional: at level 1 one point of ARM already swings a fight by ~12%.

### Level 1 items (level_req = 1)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 1-1 | DMG 1-1, STR +1 | DMG 1-2, STR +1 | DMG 1-2, STR +1 | DMG 1-2, STR +1 |
| Shield | HP +1 | HP +1 | HP +1 | HP +1 | ARM +1, HP +2 |
| Helmet | HP +1 | HP +2 | HP +2 | HP +3 | HP +3 |
| Chest | HP +2 | HP +2 | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +4 |
| Gloves | CRIT% +2 | CRIT% +2 | CRIT% +3 | CRIT% +4 | CRIT% +5 |
| Boots | EVA% +1 | EVA% +2 | EVA% +2 | EVA% +3 | EVA% +3 |
| Belt | HP +1 | HP +1 | HP +1 | HP +1 | HP +2 |
| Legs | HP +1 | HP +2 | HP +2 | HP +3 | HP +3 |
| Bracers | HP +2 | HP +2 | HP +3 | HP +3 | STR +1 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +5, ANTICRIT% +5 |
| Ring (Strength) | HP +1 | HP +1 | STR +1 | STR +1 | STR +1 |
| Ring (Endurance) | HP +1 | HP +1 | HP +2 | HP +2 | END +1 |
| Ring (Dexterity) | DEX +1 | DEX +1 | DEX +1 | DEX +1 | DEX +2 |
| Weapon (2-hand, no shield) | DMG 1-1, STR +1 | DMG 1-2, STR +1 | DMG 1-2, STR +1 | DMG 2-3, STR +1 | DMG 2-4, STR +1 |
| Offhand weapon (dual-wield) | CRIT% +4 | CRIT% +5 | CRIT% +6 | CRIT% +8 | ATK +1, CRIT% +10 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 2 items (level_req = 2)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 1-1, STR +1 | DMG 1-1, STR +1 | DMG 1-2, STR +1 | DMG 1-2, STR +1 | DMG 2-3, STR +1 |
| Shield | HP +1 | HP +1 | HP +1 | HP +1 | ARM +1, HP +2 |
| Helmet | HP +1 | HP +2 | HP +2 | HP +3 | HP +3 |
| Chest | HP +2 | ARM +1, HP +2 | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +5 |
| Gloves | CRIT% +2 | CRIT% +3 | CRIT% +3 | CRIT% +4 | CRIT% +5 |
| Boots | EVA% +1 | EVA% +2 | EVA% +2 | EVA% +3 | EVA% +3 |
| Belt | HP +1 | HP +1 | HP +1 | HP +1 | END +1, HP +2 |
| Legs | HP +1 | HP +2 | HP +2 | HP +3 | HP +3 |
| Bracers | HP +2 | HP +2 | HP +3 | STR +1 | STR +1 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +5, ANTICRIT% +5 |
| Ring (Strength) | HP +1 | HP +2 | STR +1 | STR +1 | STR +1 |
| Ring (Endurance) | HP +1 | HP +2 | HP +2 | END +1 | END +1 |
| Ring (Dexterity) | DEX +1 | DEX +1 | DEX +1 | DEX +2 | DEX +2 |
| Weapon (2-hand, no shield) | DMG 1-2, STR +1 | DMG 1-2, STR +1 | DMG 2-3, STR +1 | DMG 2-4, STR +1 | DMG 2-4, STR +2 |
| Offhand weapon (dual-wield) | CRIT% +4 | CRIT% +5 | CRIT% +7 | ATK +1, CRIT% +8 | ATK +1, CRIT% +10 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 3 items (level_req = 3)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 1-1, STR +1 | DMG 1-2, STR +1 | DMG 1-2, STR +1 | DMG 2-3, STR +1 | DMG 2-4, STR +2 |
| Shield | HP +1 | HP +1 | ARM +1, HP +1 | ARM +1, HP +2 | ARM +1, DEF +1, HP +2 |
| Helmet | HP +2 | HP +2 | HP +3 | ARM +1, HP +3 | ARM +1, HP +4 |
| Chest | ARM +1, HP +2 | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | ARM +1, HP +6 |
| Gloves | CRIT% +2 | CRIT% +3 | CRIT% +3 | CRIT% +4 | ATK +1, CRIT% +5 |
| Boots | EVA% +1 | EVA% +2 | EVA% +2 | EVA% +3 | EVA% +3 |
| Belt | HP +1 | HP +1 | HP +1 | END +1, HP +2 | END +1, HP +2 |
| Legs | HP +2 | HP +2 | HP +3 | ARM +1, HP +3 | ARM +1, HP +4 |
| Bracers | HP +2 | HP +3 | HP +3 | STR +1 | STR +1 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +5, ANTICRIT% +5 |
| Ring (Strength) | HP +2 | STR +1 | STR +1 | STR +1 | STR +1 |
| Ring (Endurance) | HP +2 | HP +2 | END +1 | END +1 | END +1 |
| Ring (Dexterity) | DEX +1 | DEX +1 | DEX +2 | DEX +2 | DEX +3 |
| Weapon (2-hand, no shield) | DMG 1-2, STR +1 | DMG 2-3, STR +1 | DMG 2-4, STR +1 | DMG 3-5, STR +2 | DMG 3-6, STR +2 |
| Offhand weapon (dual-wield) | CRIT% +4 | CRIT% +5 | ATK +1, CRIT% +7 | ATK +1, CRIT% +8 | ATK +1, CRIT% +10 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 4 items (level_req = 4)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 1-2, STR +1 | DMG 1-2, STR +1 | DMG 2-3, STR +1 | DMG 2-4, STR +2 | DMG 2-5, STR +2 |
| Shield | HP +1 | ARM +1, HP +1 | ARM +1, HP +2 | ARM +1, HP +2 | ARM +1, DEF +1, HP +3 |
| Helmet | HP +2 | HP +3 | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +5 |
| Chest | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | ARM +1, HP +6 | ARM +2, HP +8 |
| Gloves | CRIT% +2 | CRIT% +3 | CRIT% +3 | ATK +1, CRIT% +4 | ATK +1, CRIT% +5 |
| Boots | EVA% +1 | EVA% +2 | EVA% +2 | ARM +1, EVA% +3 | ARM +1, EVA% +3 |
| Belt | HP +1 | HP +1 | HP +2 | END +1, HP +2 | END +1, HP +3 |
| Legs | HP +2 | HP +3 | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +5 |
| Bracers | HP +3 | HP +3 | STR +1 | STR +1 | STR +1 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +5, ANTICRIT% +5 |
| Ring (Strength) | STR +1 | STR +1 | STR +1 | STR +1 | STR +1 |
| Ring (Endurance) | HP +2 | HP +3 | END +1 | END +1 | END +1 |
| Ring (Dexterity) | DEX +1 | DEX +2 | DEX +2 | DEX +2 | DEX +3 |
| Weapon (2-hand, no shield) | DMG 2-3, STR +1 | DMG 2-4, STR +1 | DMG 2-5, STR +2 | DMG 3-6, STR +2 | DMG 4-7, STR +2 |
| Offhand weapon (dual-wield) | CRIT% +4 | ATK +1, CRIT% +5 | ATK +1, CRIT% +7 | ATK +1, CRIT% +8 | ATK +1, CRIT% +11 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 5 items (level_req = 5)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 1-2, STR +1 | DMG 2-3, STR +1 | DMG 2-4, STR +1 | DMG 2-4, STR +2 | DMG 3-6, STR +2 |
| Shield | ARM +1, HP +1 | ARM +1, HP +2 | ARM +1, HP +2 | ARM +1, DEF +1, HP +3 | ARM +1, DEF +1, HP +3 |
| Helmet | HP +3 | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | ARM +1, HP +7 |
| Chest | ARM +1, HP +4 | ARM +1, HP +5 | ARM +1, HP +6 | ARM +2, HP +8 | ARM +2, HP +10 |
| Gloves | CRIT% +2 | CRIT% +3 | ATK +1, CRIT% +3 | ATK +1, CRIT% +4 | ATK +1, CRIT% +5 |
| Boots | EVA% +1 | EVA% +2 | ARM +1, EVA% +2 | ARM +1, EVA% +3 | ARM +1, EVA% +4 |
| Belt | HP +1 | HP +2 | END +1, HP +2 | END +1, HP +3 | END +1, HP +3 |
| Legs | HP +3 | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | ARM +1, HP +7 |
| Bracers | HP +3 | STR +1 | STR +1 | STR +1 | DEF +1, STR +1 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +5, ANTICRIT% +5 |
| Ring (Strength) | STR +1 | STR +1 | STR +1 | STR +1 | STR +2 |
| Ring (Endurance) | HP +2 | END +1 | END +1 | END +1 | END +1 |
| Ring (Dexterity) | DEX +1 | DEX +2 | DEX +2 | DEX +3 | DEX +4 |
| Weapon (2-hand, no shield) | DMG 2-3, STR +1 | DMG 2-4, STR +1 | DMG 3-6, STR +2 | DMG 4-7, STR +2 | DMG 5-9, STR +3 |
| Offhand weapon (dual-wield) | CRIT% +4 | ATK +1, CRIT% +5 | ATK +1, CRIT% +7 | ATK +1, CRIT% +8 | ATK +1, CRIT% +11 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 6 items (level_req = 6)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 1-3, STR +1 | DMG 2-3, STR +1 | DMG 2-4, STR +2 | DMG 3-5, STR +2 | DMG 4-7, STR +3 |
| Shield | ARM +1, HP +2 | ARM +1, HP +2 | ARM +1, DEF +1, HP +3 | ARM +1, DEF +1, HP +3 | ARM +2, DEF +1, HP +4 |
| Helmet | HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | ARM +1, HP +7 | ARM +1, HP +8 |
| Chest | ARM +1, HP +5 | ARM +1, HP +6 | ARM +2, HP +8 | ARM +2, HP +9 | ARM +3, HP +12 |
| Gloves | CRIT% +2 | ATK +1, CRIT% +3 | ATK +1, CRIT% +3 | ATK +1, CRIT% +4 | ATK +1, CRIT% +5 |
| Boots | EVA% +1 | EVA% +2 | ARM +1, EVA% +2 | ARM +1, EVA% +3 | ARM +1, EVA% +4 |
| Belt | HP +2 | END +1, HP +2 | END +1, HP +3 | END +1, HP +3 | END +1, HP +4 |
| Legs | HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | ARM +1, HP +7 | ARM +1, HP +8 |
| Bracers | STR +1 | STR +1 | STR +1 | DEF +1, STR +1 | DEF +1, STR +1 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +4, ANTICRIT% +4 | CRIT% +5, ANTICRIT% +5 |
| Ring (Strength) | STR +1 | STR +1 | STR +1 | STR +2 | STR +2 |
| Ring (Endurance) | END +1 | END +1 | END +1 | END +1 | END +1 |
| Ring (Dexterity) | DEX +2 | DEX +2 | DEX +3 | DEX +3 | DEX +4 |
| Weapon (2-hand, no shield) | DMG 2-4, STR +1 | DMG 3-5, STR +2 | DMG 4-7, STR +2 | DMG 4-8, STR +3 | DMG 6-10, STR +3 |
| Offhand weapon (dual-wield) | ATK +1, CRIT% +4 | ATK +1, CRIT% +6 | ATK +1, CRIT% +7 | ATK +1, CRIT% +9 | ATK +2, CRIT% +11 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 8 items (level_req = 8)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 2-4, STR +2 | DMG 3-5, STR +2 | DMG 4-7, STR +3 | DMG 4-8, STR +3 | DMG 6-10, STR +4 |
| Shield | ARM +1, HP +2 | ARM +1, DEF +1, HP +3 | ARM +1, DEF +1, HP +4 | ARM +2, DEF +1, HP +4 | ARM +2, DEF +1, HP +6 |
| Helmet | ARM +1, HP +4 | ARM +1, HP +6 | ARM +1, HP +7 | ARM +1, HP +9 | ARM +2, HP +11 |
| Chest | ARM +1, HP +6 | ARM +2, HP +8 | ARM +2, HP +10 | ARM +3, HP +12 | ARM +3, HP +15 |
| Gloves | ATK +1, CRIT% +2 | ATK +1, CRIT% +3 | ATK +1, CRIT% +3 | ATK +1, CRIT% +4 | ATK +2, CRIT% +5 |
| Boots | EVA% +1 | ARM +1, EVA% +2 | ARM +1, EVA% +2 | ARM +1, EVA% +3 | ARM +1, EVA% +3 |
| Belt | END +1, HP +2 | END +1, HP +3 | END +1, HP +4 | END +1, HP +4 | END +2, HP +6 |
| Legs | ARM +1, HP +4 | ARM +1, HP +6 | ARM +1, HP +7 | ARM +1, HP +9 | ARM +2, HP +11 |
| Bracers | STR +1 | DEF +1, STR +1 | DEF +1, STR +1 | DEF +1, STR +1 | DEF +1, STR +2 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +4, ANTICRIT% +4 | CRIT% +6, ANTICRIT% +6 |
| Ring (Strength) | STR +1 | STR +1 | STR +2 | STR +2 | STR +3 |
| Ring (Endurance) | END +1 | END +1 | END +1 | END +1 | END +2 |
| Ring (Dexterity) | DEX +2 | DEX +2 | DEX +3 | DEX +4 | DEX +5 |
| Weapon (2-hand, no shield) | DMG 3-6, STR +2 | DMG 4-8, STR +2 | DMG 6-10, STR +3 | DMG 7-13, STR +4 | DMG 9-16, STR +5 |
| Offhand weapon (dual-wield) | ATK +1, CRIT% +4 | ATK +1, CRIT% +6 | ATK +1, CRIT% +7 | ATK +2, CRIT% +9 | ATK +2, CRIT% +11 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 10 items (level_req = 10)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 3-5, STR +2 | DMG 4-7, STR +2 | DMG 5-9, STR +3 | DMG 6-11, STR +4 | DMG 7-13, STR +5 |
| Shield | ARM +1, DEF +1, HP +3 | ARM +1, DEF +1, HP +4 | ARM +2, DEF +1, HP +5 | ARM +2, DEF +1, HP +7 | ARM +3, DEF +2, HP +8 |
| Helmet | ARM +1, HP +7 | ARM +1, HP +9 | ARM +1, HP +11 | ARM +2, HP +13 | ARM +2, HP +17 |
| Chest | ARM +2, HP +9 | ARM +2, HP +12 | ARM +3, HP +15 | ARM +4, HP +19 | ARM +4, HP +24 |
| Gloves | ATK +1, CRIT% +2 | ATK +1, CRIT% +2 | ATK +1, CRIT% +3 | ATK +2, CRIT% +4 | ATK +2, CRIT% +5 |
| Boots | ARM +1, EVA% +1 | ARM +1, EVA% +2 | ARM +1, EVA% +2 | ARM +1, EVA% +2 | ARM +2, EVA% +3 |
| Belt | END +1, HP +3 | END +1, HP +4 | END +1, HP +5 | END +2, HP +7 | END +2, HP +8 |
| Legs | ARM +1, HP +7 | ARM +1, HP +9 | ARM +1, HP +11 | ARM +2, HP +13 | ARM +2, HP +17 |
| Bracers | DEF +1, STR +1 | DEF +1, STR +1 | DEF +1, STR +1 | DEF +1, STR +2 | DEF +1, STR +2 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +5, ANTICRIT% +5 |
| Ring (Strength) | STR +1 | STR +2 | STR +2 | STR +3 | STR +3 |
| Ring (Endurance) | END +1 | END +1 | END +2 | END +2 | END +2 |
| Ring (Dexterity) | DEX +2 | DEX +2 | DEX +3 | DEX +4 | DEX +5 |
| Weapon (2-hand, no shield) | DMG 4-8, STR +2 | DMG 6-11, STR +3 | DMG 7-13, STR +4 | DMG 9-17, STR +4 | DMG 11-21, STR +6 |
| Offhand weapon (dual-wield) | ATK +1, CRIT% +4 | ATK +2, CRIT% +5 | ATK +2, CRIT% +6 | ATK +2, CRIT% +8 | ATK +3, CRIT% +10 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 12 items (level_req = 12)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 3-6, STR +2 | DMG 4-8, STR +3 | DMG 6-10, STR +4 | DMG 7-13, STR +5 | DMG 9-16, STR +6 |
| Shield | ARM +1, DEF +1, HP +4 | ARM +2, DEF +1, HP +6 | ARM +2, DEF +1, HP +7 | ARM +3, DEF +2, HP +9 | ARM +3, DEF +2, HP +11 |
| Helmet | ARM +1, HP +9 | ARM +1, HP +12 | ARM +2, HP +15 | ARM +2, HP +18 | ARM +3, HP +23 |
| Chest | ARM +2, HP +12 | ARM +3, HP +16 | ARM +4, HP +20 | ARM +4, HP +25 | ARM +6, HP +32 |
| Gloves | ATK +1, CRIT% +2 | ATK +1, CRIT% +2 | ATK +2, CRIT% +3 | ATK +2, CRIT% +4 | ATK +3, CRIT% +5 |
| Boots | ARM +1, EVA% +1 | ARM +1, EVA% +2 | ARM +1, EVA% +2 | ARM +2, EVA% +3 | ARM +2, EVA% +3 |
| Belt | END +1, HP +4 | END +1, HP +6 | END +2, HP +7 | END +2, HP +9 | END +2, HP +11 |
| Legs | ARM +1, HP +9 | ARM +1, HP +12 | ARM +2, HP +15 | ARM +2, HP +18 | ARM +3, HP +23 |
| Bracers | DEF +1, STR +1 | DEF +1, STR +1 | DEF +1, STR +2 | DEF +1, STR +2 | DEF +2, STR +3 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +5, ANTICRIT% +5 |
| Ring (Strength) | STR +2 | STR +2 | STR +3 | STR +3 | STR +4 |
| Ring (Endurance) | END +1 | END +2 | END +2 | END +2 | END +3 |
| Ring (Dexterity) | DEX +2 | DEX +3 | DEX +4 | DEX +5 | DEX +6 |
| Weapon (2-hand, no shield) | DMG 5-10, STR +3 | DMG 7-13, STR +4 | DMG 9-16, STR +5 | DMG 11-20, STR +6 | DMG 14-25, STR +7 |
| Offhand weapon (dual-wield) | ATK +1, CRIT% +4 | ATK +2, CRIT% +5 | ATK +2, CRIT% +6 | ATK +3, CRIT% +8 | ATK +4, CRIT% +9 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 15 items (level_req = 15)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 5-8, STR +3 | DMG 6-11, STR +4 | DMG 7-14, STR +5 | DMG 9-17, STR +6 | DMG 12-22, STR +7 |
| Shield | ARM +2, DEF +1, HP +6 | ARM +2, DEF +1, HP +8 | ARM +3, DEF +2, HP +10 | ARM +4, DEF +2, HP +12 | ARM +4, DEF +3, HP +16 |
| Helmet | ARM +1, HP +12 | ARM +2, HP +16 | ARM +2, HP +20 | ARM +3, HP +25 | ARM +4, HP +31 |
| Chest | ARM +3, HP +17 | ARM +4, HP +22 | ARM +5, HP +28 | ARM +6, HP +35 | ARM +8, HP +44 |
| Gloves | ATK +1, CRIT% +2 | ATK +2, CRIT% +2 | ATK +2, CRIT% +3 | ATK +3, CRIT% +3 | ATK +4, CRIT% +4 |
| Boots | ARM +1, EVA% +1 | ARM +1, EVA% +2 | ARM +2, EVA% +2 | ARM +2, EVA% +2 | ARM +3, EVA% +3 |
| Belt | END +1, HP +6 | END +1, HP +8 | END +2, HP +10 | END +2, HP +12 | END +3, HP +16 |
| Legs | ARM +1, HP +12 | ARM +2, HP +16 | ARM +2, HP +20 | ARM +3, HP +25 | ARM +4, HP +31 |
| Bracers | DEF +1, STR +1 | DEF +1, STR +2 | DEF +1, STR +2 | DEF +2, STR +3 | DEF +2, STR +3 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +4, ANTICRIT% +4 |
| Ring (Strength) | STR +2 | STR +3 | STR +3 | STR +4 | STR +5 |
| Ring (Endurance) | END +1 | END +2 | END +2 | END +3 | END +4 |
| Ring (Dexterity) | DEX +2 | DEX +3 | DEX +4 | DEX +5 | DEX +6 |
| Weapon (2-hand, no shield) | DMG 7-13, STR +3 | DMG 9-17, STR +4 | DMG 12-22, STR +5 | DMG 14-27, STR +7 | DMG 18-34, STR +9 |
| Offhand weapon (dual-wield) | ATK +2, CRIT% +3 | ATK +3, CRIT% +5 | ATK +3, CRIT% +6 | ATK +4, CRIT% +7 | ATK +5, CRIT% +9 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 18 items (level_req = 18)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 6-11, STR +3 | DMG 8-14, STR +4 | DMG 10-18, STR +5 | DMG 12-23, STR +6 | DMG 15-29, STR +7 |
| Shield | ARM +2, DEF +1, HP +9 | ARM +3, DEF +2, HP +11 | ARM +4, DEF +2, HP +14 | ARM +5, DEF +3, HP +18 | ARM +6, DEF +4, HP +23 |
| Helmet | ARM +2, HP +18 | ARM +3, HP +23 | ARM +3, HP +29 | ARM +4, HP +36 | ARM +5, HP +45 |
| Chest | ARM +4, HP +16 | ARM +5, HP +32 | ARM +7, HP +40 | ARM +8, HP +50 | ARM +11, HP +63 |
| Gloves | ATK +2, CRIT% +2 | ATK +2, CRIT% +2 | ATK +3, CRIT% +3 | ATK +4, CRIT% +3 | ATK +4, CRIT% +4 |
| Boots | ARM +1, EVA% +1 | ARM +2, EVA% +1 | ARM +2, EVA% +2 | ARM +3, EVA% +2 | ARM +4, EVA% +3 |
| Belt | END +2, HP +9 | END +2, HP +11 | END +3, HP +14 | END +4, HP +18 | END +4, HP +23 |
| Legs | ARM +2, HP +18 | ARM +3, HP +23 | ARM +3, HP +29 | ARM +4, HP +36 | ARM +5, HP +45 |
| Bracers | DEF +1, STR +1 | DEF +2, STR +2 | DEF +2, STR +2 | DEF +2, STR +3 | DEF +3, STR +3 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 | CRIT% +4, ANTICRIT% +4 |
| Ring (Strength) | STR +2 | STR +3 | STR +3 | STR +4 | STR +5 |
| Ring (Endurance) | END +2 | END +3 | END +4 | END +4 | END +5 |
| Ring (Dexterity) | DEX +2 | DEX +3 | DEX +4 | DEX +5 | DEX +6 |
| Weapon (2-hand, no shield) | DMG 9-17, STR +3 | DMG 12-22, STR +4 | DMG 15-28, STR +6 | DMG 19-35, STR +7 | DMG 24-44, STR +9 |
| Offhand weapon (dual-wield) | ATK +2, CRIT% +3 | ATK +3, CRIT% +4 | ATK +4, CRIT% +6 | ATK +5, CRIT% +7 | ATK +6, CRIT% +9 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 |

### Level 20 items (level_req = 20)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 7-12, STR +3 | DMG 9-16, STR +4 | DMG 11-20, STR +5 | DMG 13-25, STR +6 | DMG 17-31, STR +8 |
| Shield | ARM +3, DEF +2, HP +9 | ARM +3, DEF +2, HP +12 | ARM +4, DEF +3, HP +15 | ARM +5, DEF +3, HP +19 | ARM +7, DEF +4, HP +24 |
| Helmet | ARM +2, HP +18 | ARM +3, HP +24 | ARM +4, HP +30 | ARM +4, HP +38 | ARM +6, HP +47 |
| Chest | ARM +5, HP +15 | ARM +6, HP +34 | ARM +7, HP +43 | ARM +9, HP +53 | ARM +12, HP +66 |
| Gloves | ATK +2, CRIT% +2 | ATK +3, CRIT% +2 | ATK +3, CRIT% +3 | ATK +4, CRIT% +3 | ATK +5, CRIT% +4 |
| Boots | ARM +2, EVA% +1 | ARM +2, EVA% +2 | ARM +3, EVA% +2 | ARM +3, EVA% +2 | ARM +4, EVA% +3 |
| Belt | END +2, HP +9 | END +2, HP +12 | END +3, HP +15 | END +4, HP +19 | END +5, HP +24 |
| Legs | ARM +2, HP +18 | ARM +3, HP +24 | ARM +4, HP +30 | ARM +4, HP +38 | ARM +6, HP +47 |
| Bracers | DEF +1, STR +1 | DEF +2, STR +2 | DEF +2, STR +2 | DEF +3, STR +3 | DEF +3, STR +4 |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 |
| Ring (Strength) | STR +2 | STR +3 | STR +3 | STR +4 | STR +5 |
| Ring (Endurance) | END +2 | END +3 | END +4 | END +5 | END +6 |
| Ring (Dexterity) | DEX +2 | DEX +3 | DEX +4 | DEX +5 | DEX +6 |
| Weapon (2-hand, no shield) | DMG 10-19, STR +4 ⚠️ over budget | DMG 13-25, STR +5 | DMG 17-31, STR +6 | DMG 21-39, STR +7 | DMG 26-48, STR +9 |
| Offhand weapon (dual-wield) | ATK +3, CRIT% +3 | ATK +4, CRIT% +4 | ATK +5, CRIT% +6 | ATK +6, CRIT% +7 | ATK +7, CRIT% +9 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

---

## 8. Making the NFT

1. **Art:** PNG, transparent background, square (512×512 or larger), same style as the grey slot placeholders in `frontend/public/v53/slots/` but in colour.
2. **Upload** the PNG to Pinata (or any IPFS pin). `image_url` = the gateway URL.
3. **Name:** medieval, ≤ 32 characters (e.g. "Iron Gladius", "Bronze Hoplon").
4. **Mint** with `item::mint_item_admin` (TREASURY + AdminCap). Field order:
   `name, image_url, item_type, class_req(0), level_req, rarity, slot_type, STR, DEX, INT, END, HP, ARM, DEF, ATK, CRIT%, CRITDMG, EVA%, ANTICRIT%, ANTIEVA%, min_damage, max_damage`.
5. **List in the store:** place + list in the TREASURY kiosk (existing marketplace flow). The 2.5% royalty applies automatically.

### Suggested store prices (testnet SUI)

| Rarity | Level 1 | Each extra level | Supply per design |
|---|---|---|---|
| Common | 0.1 | +0.02 | 20+ |
| Uncommon | 0.25 | +0.05 | 10 |
| Rare | 0.6 | +0.1 | 5 |
| Epic | 1.5 | +0.25 | 2–3 |
| Legendary | 4 | +0.6 | 1 |
