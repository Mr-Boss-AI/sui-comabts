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
| Weapon (1-hand) | 1 | 0 | Main hand, or offhand for dual-wield (§6). |
| Weapon (2-hand) | 1 | 2 | Takes weapon **and** offhand slot. ×1.4 landed damage (§6). |
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
| `intuition_bonus` (INT) | +1.25% crit chance, +0.02× crit dmg per point | Buffed in v5.3 (INT build 36% → 51%). Crits also pierce blocks (see below). |
| `endurance_bonus` (END) | +3 HP, +0.3 defense, lowers enemy crit 0.3% per point | Strong. |
| `crit_chance_bonus` (CRIT%) | +1% crit chance per point (cap 30%) | Fixed in v5.3 — used to wrongly multiply crit damage. |
| `crit_multiplier_bonus` (CRITDMG) | +0.01× crit damage per point (10 = +0.10×) | Only matters if you crit. |
| `evasion_bonus` (EVA%) | +1% chance to dodge per point (cap 30%) | |
| `anti_crit_bonus` (ANTICRIT%) | −1% to the **enemy's** crit chance per point | Counter stat. |
| `anti_evasion_bonus` (ANTIEVA%) | −1% to the **enemy's** evasion per point | Counter stat. |

**Crit through block (v5.3):** a critical strike into a guarded zone still lands 20% of its crit damage, ignoring armor.

### How strong one point is ("edge unit")
Amount of ONE stat that turns an even fight into a **60/40** win. Smaller = stronger per point.

| Stat | Lv1 | Lv5 | Lv10 | Lv15 | Lv20 |
|---|---|---|---|---|---|
| HP | 6.2 | 13.7 | 35.0 | 64.5 | 110.0 |
| ARM | 0.9 | 2.2 | 5.4 | 9.5 | 14.8 |
| DEF | 0.8 | 2.0 | 4.8 | 8.4 | 13.3 |
| ATK | 1.0 | 2.1 | 4.9 | 9.0 | 13.9 |
| DMG | 0.8 | 1.9 | 4.6 | 8.3 | 13.5 |
| STR | 1.7 | 4.1 | 7.6 | 11.9 | 15.1 |
| DEX | 4.1 | 7.7 | 11.9 | 13.5 | 14.3 |
| END | 1.1 | 2.6 | 6.0 | 8.5 | 11.3 |
| CRIT% | 11.3 | 12.2 | 11.0 | 10.6 | 8.8 |
| EVA% | 9.5 | 9.0 | 8.8 | 8.6 | 8.2 |

---

## 3. Rarity rules (on-chain)

The contract rejects an item if **all stat fields + `max_damage`** add up to more than its rarity budget:

| Rarity | `rarity` | Min `level_req` (on-chain) | Chain budget (max) | Recommended power (full set) |
|---|---|---|---|---|
| Common | 1 | 1 | 20 | 5.0 edge units |
| Uncommon | 2 | 3 | 40 | 6.5 |
| Rare | 3 | 5 | 70 | 8.2 |
| Epic | 4 | 8 | 110 | 10.2 |
| Legendary | 5 | 11 | 160 | 12.8 |

**Weapons and shields need `level_req` ≥ 3** — levels 1–2 fight bare-handed. The contract rejects any mint below these minimums (abort codes 8 / 9), so a Legendary can never appear at level 1. You still decide which levels to release items for.

The tables in §7 already fit these budgets and gates (cells marked ⚠️ are the only budget exceptions; — = not allowed at that level).

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
| 1 | 73% | — | — | — | — |
| 3 | 98% | 59% | — | — | — |
| 5 | 97% | 69% | 68% | — | — |
| 8 | 99% | 61% | 65% | 67% | — |
| 11 | 98% | 69% | 62% | 66% | 74% |
| 15 | 98% | 68% | 64% | 71% | 69% |
| 20 | 98% | 64% | 69% | 65% | 75% |

- Each rarity step wins **59–75%**: a clear upgrade, never unbeatable. — = rarity not allowed yet at that level.
- A full Common set beats a naked fighter ~98% of the time. Give new players a free Common starter set.

---

## 6. Fighting styles (v5.3 rules — balanced)

| Style | Gear | Strikes | Guards | Special |
|---|---|---|---|---|
| Sword & shield | 1-hand weapon + shield | 1 | 3 (a line) | Unchanged. |
| Dual-wield | 1-hand weapon in **both** hands | 2 — may hit the **same zone twice** | 2 | Each strike lands 67.5% damage; offhand weapon adds 50% of its damage + all its stats. Double strike into a guarded zone = both blocked (risk), into an open zone = both land (reward). |
| Two-hander | 2-hand weapon (`slot_type` 2) | 1 | 2 | Landed damage ×1.4. |

Tuned with `scripts/offhand-balance.ts` — same-rarity gear, win rate of the first style:

| Gear | Level | Dual vs shield | 2-hand vs shield | 2-hand vs dual |
|---|---|---|---|---|
| Common | 3 / 8 / 12 / 18 | 48 / 45 / 45 / 46% | 45 / 45 / 48 / 49% | 50 / 54 / 51 / 52% |
| Rare | 8 / 12 / 18 | 52 / 48 / 48% | 49 / 50 / 51% | 50 / 51 / 52% |
| Legendary | 12 / 18 | 54 / 52% | 50 / 52% | 49 / 51% |

- Every style wins 44–55% against the others at every level its gear is allowed.
- Leaving the offhand **empty** is simply weaker (a free slot unused), as intended.

### Build balance (v5.3)
Average win rate of each build vs the other four (half the points in the main stat), levels 3/8/14/20:

| STR | DEX | INT | END | BAL |
|---|---|---|---|---|
| 47% | 40% | 51% | 61% | 50% |

INT is fixed. **Still open:** END builds are strong (61%) and DEX builds weak (40%) — see chat.

---

## 7. Item tables (copy a cell into the mint call)

`DMG a-b` → `min_damage = a`, `max_damage = b`. Everything else maps to its `*_bonus` field. Unlisted fields = 0.
For dual-wield, put a second **Weapon (1-hand)** in the offhand. Small numbers at low levels are intentional: at level 1 one point of ARM already swings a fight by ~12%.

### Level 1 items (level_req = 1)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | — | — | — | — | — |
| Shield | — | — | — | — | — |
| Helmet | HP +1 | — | — | — | — |
| Chest | HP +2 | — | — | — | — |
| Gloves | CRIT% +1 | — | — | — | — |
| Boots | EVA% +1 | — | — | — | — |
| Belt | HP +1 | — | — | — | — |
| Legs | HP +1 | — | — | — | — |
| Bracers | HP +2 | — | — | — | — |
| Necklace | CRIT% +1, ANTICRIT% +1 | — | — | — | — |
| Ring (Strength) | HP +1 | — | — | — | — |
| Ring (Endurance) | HP +1 | — | — | — | — |
| Ring (Dexterity) | DEX +1 | — | — | — | — |
| Weapon (2-hand, no shield) | — | — | — | — | — |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 2 items (level_req = 2)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | — | — | — | — | — |
| Shield | — | — | — | — | — |
| Helmet | HP +1 | — | — | — | — |
| Chest | HP +2 | — | — | — | — |
| Gloves | CRIT% +1 | — | — | — | — |
| Boots | EVA% +1 | — | — | — | — |
| Belt | HP +1 | — | — | — | — |
| Legs | HP +1 | — | — | — | — |
| Bracers | HP +2 | — | — | — | — |
| Necklace | CRIT% +1, ANTICRIT% +1 | — | — | — | — |
| Ring (Strength) | HP +1 | — | — | — | — |
| Ring (Endurance) | HP +1 | — | — | — | — |
| Ring (Dexterity) | DEX +1 | — | — | — | — |
| Weapon (2-hand, no shield) | — | — | — | — | — |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 3 items (level_req = 3)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 1-1, STR +1 | DMG 1-2, STR +1 | — | — | — |
| Shield | HP +1 | HP +1 | — | — | — |
| Helmet | HP +2 | HP +2 | — | — | — |
| Chest | ARM +1, HP +3 | ARM +1, HP +3 | — | — | — |
| Gloves | CRIT% +1 | CRIT% +2 | — | — | — |
| Boots | EVA% +1 | EVA% +2 | — | — | — |
| Belt | HP +1 | HP +1 | — | — | — |
| Legs | HP +2 | HP +2 | — | — | — |
| Bracers | HP +2 | HP +3 | — | — | — |
| Necklace | CRIT% +1, ANTICRIT% +1 | CRIT% +2, ANTICRIT% +2 | — | — | — |
| Ring (Strength) | STR +1 | STR +1 | — | — | — |
| Ring (Endurance) | HP +2 | HP +2 | — | — | — |
| Ring (Dexterity) | DEX +1 | DEX +1 | — | — | — |
| Weapon (2-hand, no shield) | DMG 1-2, STR +1 | DMG 1-3, STR +1 | — | — | — |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 4 items (level_req = 4)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 1-2, STR +1 | DMG 1-2, STR +1 | — | — | — |
| Shield | HP +1 | ARM +1, HP +1 | — | — | — |
| Helmet | HP +2 | HP +3 | — | — | — |
| Chest | ARM +1, HP +3 | ARM +1, HP +4 | — | — | — |
| Gloves | CRIT% +1 | CRIT% +2 | — | — | — |
| Boots | EVA% +1 | EVA% +2 | — | — | — |
| Belt | HP +1 | HP +1 | — | — | — |
| Legs | HP +2 | HP +3 | — | — | — |
| Bracers | HP +3 | STR +1 | — | — | — |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | — | — | — |
| Ring (Strength) | STR +1 | STR +1 | — | — | — |
| Ring (Endurance) | HP +2 | HP +3 | — | — | — |
| Ring (Dexterity) | DEX +1 | DEX +2 | — | — | — |
| Weapon (2-hand, no shield) | DMG 1-3, STR +1 | DMG 2-3, STR +1 | — | — | — |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 5 items (level_req = 5)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 1-2, STR +1 | DMG 1-3, STR +1 | DMG 2-3, STR +2 | — | — |
| Shield | ARM +1, HP +1 | ARM +1, HP +2 | ARM +1, HP +2 | — | — |
| Helmet | HP +3 | ARM +1, HP +4 | ARM +1, HP +4 | — | — |
| Chest | ARM +1, HP +4 | ARM +1, HP +5 | ARM +2, HP +6 | — | — |
| Gloves | CRIT% +1 | CRIT% +2 | ATK +1, CRIT% +2 | — | — |
| Boots | EVA% +1 | EVA% +2 | ARM +1, EVA% +2 | — | — |
| Belt | HP +1 | END +1, HP +2 | END +1, HP +2 | — | — |
| Legs | HP +3 | ARM +1, HP +4 | ARM +1, HP +4 | — | — |
| Bracers | STR +1 | STR +1 | STR +1 | — | — |
| Necklace | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | — | — |
| Ring (Strength) | STR +1 | STR +1 | STR +1 | — | — |
| Ring (Endurance) | HP +3 | END +1 | END +1 | — | — |
| Ring (Dexterity) | DEX +1 | DEX +2 | DEX +2 | — | — |
| Weapon (2-hand, no shield) | DMG 2-3, STR +1 | DMG 2-4, STR +2 | DMG 3-5, STR +2 | — | — |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 6 items (level_req = 6)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 1-3, STR +1 | DMG 2-3, STR +2 | DMG 2-4, STR +2 | — | — |
| Shield | ARM +1, HP +2 | ARM +1, HP +2 | ARM +1, DEF +1, HP +3 | — | — |
| Helmet | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | — | — |
| Chest | ARM +1, HP +5 | ARM +1, HP +6 | ARM +2, HP +7 | — | — |
| Gloves | CRIT% +1 | ATK +1, CRIT% +2 | ATK +1, CRIT% +2 | — | — |
| Boots | EVA% +1 | ARM +1, EVA% +2 | ARM +1, EVA% +2 | — | — |
| Belt | HP +2 | END +1, HP +2 | END +1, HP +3 | — | — |
| Legs | ARM +1, HP +3 | ARM +1, HP +4 | ARM +1, HP +5 | — | — |
| Bracers | STR +1 | STR +1 | DEF +1, STR +1 | — | — |
| Necklace | CRIT% +1, ANTICRIT% +1 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | — | — |
| Ring (Strength) | STR +1 | STR +1 | STR +1 | — | — |
| Ring (Endurance) | END +1 | END +1 | END +1 | — | — |
| Ring (Dexterity) | DEX +2 | DEX +2 | DEX +3 | — | — |
| Weapon (2-hand, no shield) | DMG 2-4, STR +2 | DMG 3-5, STR +2 | DMG 4-7, STR +3 | — | — |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 8 items (level_req = 8)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 2-4, STR +2 | DMG 3-5, STR +2 | DMG 4-7, STR +3 | DMG 4-8, STR +3 | — |
| Shield | ARM +1, DEF +1, HP +3 | ARM +1, DEF +1, HP +3 | ARM +2, DEF +1, HP +4 | ARM +2, DEF +1, HP +5 | — |
| Helmet | ARM +1, HP +5 | ARM +1, HP +7 | ARM +1, HP +8 | ARM +2, HP +10 | — |
| Chest | ARM +2, HP +7 | ARM +2, HP +9 | ARM +3, HP +12 | ARM +3, HP +14 | — |
| Gloves | ATK +1, CRIT% +1 | ATK +1, CRIT% +2 | ATK +1, CRIT% +2 | ATK +1, CRIT% +3 | — |
| Boots | ARM +1, EVA% +1 | ARM +1, EVA% +2 | ARM +1, EVA% +2 | ARM +1, EVA% +3 | — |
| Belt | END +1, HP +3 | END +1, HP +3 | END +1, HP +4 | END +1, HP +5 | — |
| Legs | ARM +1, HP +5 | ARM +1, HP +7 | ARM +1, HP +8 | ARM +2, HP +10 | — |
| Bracers | STR +1 | DEF +1, STR +1 | DEF +1, STR +1 | DEF +1, STR +2 | — |
| Necklace | CRIT% +1, ANTICRIT% +1 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | — |
| Ring (Strength) | STR +1 | STR +1 | STR +2 | STR +2 | — |
| Ring (Endurance) | END +1 | END +1 | END +1 | END +2 | — |
| Ring (Dexterity) | DEX +2 | DEX +2 | DEX +3 | DEX +4 | — |
| Weapon (2-hand, no shield) | DMG 3-6, STR +2 | DMG 4-8, STR +3 | DMG 5-10, STR +3 | DMG 7-13, STR +4 | — |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 10 items (level_req = 10)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 3-5, STR +2 | DMG 3-6, STR +3 | DMG 4-8, STR +3 | DMG 5-10, STR +4 | — |
| Shield | ARM +1, DEF +1, HP +4 | ARM +2, DEF +1, HP +5 | ARM +2, DEF +1, HP +6 | ARM +3, DEF +1, HP +7 | — |
| Helmet | ARM +1, HP +7 | ARM +1, HP +9 | ARM +2, HP +11 | ARM +2, HP +14 | — |
| Chest | ARM +2, HP +10 | ARM +3, HP +13 | ARM +4, HP +16 | ARM +5, HP +20 | — |
| Gloves | ATK +1, CRIT% +1 | ATK +1, CRIT% +2 | ATK +1, CRIT% +2 | ATK +2, CRIT% +3 | — |
| Boots | ARM +1, EVA% +1 | ARM +1, EVA% +2 | ARM +1, EVA% +2 | ARM +2, EVA% +3 | — |
| Belt | END +1, HP +4 | END +1, HP +5 | END +1, HP +6 | END +2, HP +7 | — |
| Legs | ARM +1, HP +7 | ARM +1, HP +9 | ARM +2, HP +11 | ARM +2, HP +14 | — |
| Bracers | DEF +1, STR +1 | DEF +1, STR +1 | DEF +1, STR +2 | DEF +1, STR +2 | — |
| Necklace | CRIT% +1, ANTICRIT% +1 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | — |
| Ring (Strength) | STR +1 | STR +2 | STR +2 | STR +3 | — |
| Ring (Endurance) | END +1 | END +1 | END +2 | END +2 | — |
| Ring (Dexterity) | DEX +2 | DEX +3 | DEX +3 | DEX +4 | — |
| Weapon (2-hand, no shield) | DMG 4-8, STR +2 | DMG 5-10, STR +3 | DMG 7-13, STR +4 | DMG 8-16, STR +5 | — |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 12 items (level_req = 12)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 4-7, STR +2 | DMG 5-9, STR +3 | DMG 6-11, STR +4 | DMG 7-14, STR +5 | DMG 9-17, STR +6 |
| Shield | ARM +2, DEF +1, HP +5 | ARM +2, DEF +1, HP +6 | ARM +3, DEF +2, HP +8 | ARM +3, DEF +2, HP +10 | ARM +4, DEF +2, HP +12 |
| Helmet | ARM +1, HP +10 | ARM +2, HP +12 | ARM +2, HP +16 | ARM +3, HP +19 | ARM +3, HP +24 |
| Chest | ARM +3, HP +13 | ARM +4, HP +17 | ARM +5, HP +22 | ARM +6, HP +27 | ARM +7, HP +34 |
| Gloves | ATK +1, CRIT% +1 | ATK +1, CRIT% +2 | ATK +2, CRIT% +2 | ATK +2, CRIT% +3 | ATK +3, CRIT% +3 |
| Boots | ARM +1, EVA% +1 | ARM +1, EVA% +2 | ARM +2, EVA% +2 | ARM +2, EVA% +3 | ARM +3, EVA% +3 |
| Belt | END +1, HP +5 | END +1, HP +6 | END +2, HP +8 | END +2, HP +10 | END +3, HP +12 |
| Legs | ARM +1, HP +10 | ARM +2, HP +12 | ARM +2, HP +16 | ARM +3, HP +19 | ARM +3, HP +24 |
| Bracers | DEF +1, STR +1 | DEF +1, STR +1 | DEF +1, STR +2 | DEF +2, STR +2 | DEF +2, STR +3 |
| Necklace | CRIT% +1, ANTICRIT% +1 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +4, ANTICRIT% +4 |
| Ring (Strength) | STR +2 | STR +2 | STR +3 | STR +3 | STR +4 |
| Ring (Endurance) | END +1 | END +2 | END +2 | END +3 | END +3 |
| Ring (Dexterity) | DEX +2 | DEX +3 | DEX +4 | DEX +5 | DEX +6 |
| Weapon (2-hand, no shield) | DMG 6-10, STR +3 | DMG 7-14, STR +3 | DMG 9-17, STR +4 | DMG 11-21, STR +5 | DMG 14-27, STR +7 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 15 items (level_req = 15)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 5-9, STR +3 | DMG 6-12, STR +4 | DMG 8-15, STR +5 | DMG 10-18, STR +7 | DMG 12-23, STR +8 |
| Shield | ARM +2, DEF +1, HP +6 | ARM +3, DEF +2, HP +8 | ARM +4, DEF +2, HP +11 | ARM +5, DEF +3, HP +13 | ARM +6, DEF +3, HP +17 |
| Helmet | ARM +2, HP +13 | ARM +2, HP +17 | ARM +3, HP +21 | ARM +4, HP +26 | ARM +5, HP +33 |
| Chest | ARM +4, HP +16 | ARM +5, HP +23 | ARM +7, HP +30 | ARM +8, HP +37 | ARM +10, HP +46 |
| Gloves | ATK +2, CRIT% +1 | ATK +2, CRIT% +2 | ATK +3, CRIT% +2 | ATK +3, CRIT% +3 | ATK +4, CRIT% +3 |
| Boots | ARM +1, EVA% +1 | ARM +2, EVA% +2 | ARM +2, EVA% +2 | ARM +3, EVA% +3 | ARM +4, EVA% +3 |
| Belt | END +1, HP +6 | END +2, HP +8 | END +2, HP +11 | END +3, HP +13 | END +3, HP +17 |
| Legs | ARM +2, HP +13 | ARM +2, HP +17 | ARM +3, HP +21 | ARM +4, HP +26 | ARM +5, HP +33 |
| Bracers | DEF +1, STR +1 | DEF +1, STR +2 | DEF +2, STR +2 | DEF +2, STR +3 | DEF +3, STR +4 |
| Necklace | CRIT% +1, ANTICRIT% +1 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 | CRIT% +3, ANTICRIT% +3 |
| Ring (Strength) | STR +2 | STR +3 | STR +4 | STR +4 | STR +6 |
| Ring (Endurance) | END +2 | END +2 | END +3 | END +3 | END +4 |
| Ring (Dexterity) | DEX +2 | DEX +3 | DEX +4 | DEX +5 | DEX +6 |
| Weapon (2-hand, no shield) | DMG 7-14, STR +4 | DMG 10-18, STR +5 | DMG 12-23, STR +6 | DMG 15-28, STR +8 | DMG 19-35, STR +10 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 18 items (level_req = 18)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 7-13, STR +4 | DMG 9-16, STR +5 | DMG 11-21, STR +6 | DMG 14-26, STR +7 | DMG 17-32, STR +9 |
| Shield | ARM +3, DEF +2, HP +9 | ARM +4, DEF +2, HP +12 | ARM +5, DEF +3, HP +15 | ARM +7, DEF +4, HP +19 | ARM +8, DEF +5, HP +23 |
| Helmet | ARM +3, HP +17 | ARM +3, HP +24 | ARM +4, HP +30 | ARM +5, HP +37 | ARM +7, HP +47 |
| Chest | ARM +5, HP +15 | ARM +7, HP +33 | ARM +9, HP +42 | ARM +11, HP +52 | ARM +14, HP +65 |
| Gloves | ATK +2, CRIT% +1 | ATK +3, CRIT% +1 | ATK +4, CRIT% +2 | ATK +4, CRIT% +2 | ATK +5, CRIT% +3 |
| Boots | ARM +2, EVA% +1 | ARM +2, EVA% +2 | ARM +3, EVA% +2 | ARM +4, EVA% +2 | ARM +5, EVA% +3 |
| Belt | END +2, HP +9 | END +2, HP +12 | END +3, HP +15 | END +3, HP +19 | END +4, HP +23 |
| Legs | ARM +3, HP +17 | ARM +3, HP +24 | ARM +4, HP +30 | ARM +5, HP +37 | ARM +7, HP +47 |
| Bracers | DEF +1, STR +2 | DEF +2, STR +2 | DEF +2, STR +3 | DEF +3, STR +3 | DEF +4, STR +4 |
| Necklace | CRIT% +1, ANTICRIT% +1 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 |
| Ring (Strength) | STR +2 | STR +3 | STR +4 | STR +5 | STR +6 |
| Ring (Endurance) | END +2 | END +3 | END +3 | END +4 | END +5 |
| Ring (Dexterity) | DEX +3 | DEX +3 | DEX +4 | DEX +5 | DEX +6 |
| Weapon (2-hand, no shield) | DMG 10-19, STR +4 ⚠️ over budget | DMG 14-25, STR +6 | DMG 17-32, STR +7 | DMG 21-40, STR +9 | DMG 27-50, STR +11 |
| Earrings (needs 14th slot) | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +1, ANTIEVA% +1 | EVA% +2, ANTIEVA% +2 |

### Level 20 items (level_req = 20)

| Slot | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Weapon (1-hand) | DMG 8-15, STR +4 | DMG 10-19, STR +5 | DMG 13-24, STR +7 | DMG 16-30, STR +8 | DMG 20-37, STR +11 |
| Shield | ARM +4, DEF +2, HP +11 | ARM +5, DEF +3, HP +14 | ARM +6, DEF +3, HP +18 | ARM +8, DEF +4, HP +22 | ARM +9, DEF +5, HP +28 |
| Helmet | ARM +3, HP +17 | ARM +4, HP +29 | ARM +5, HP +36 | ARM +6, HP +45 | ARM +8, HP +56 |
| Chest | ARM +6, HP +14 | ARM +8, HP +32 | ARM +10, HP +51 | ARM +13, HP +63 | ARM +16, HP +79 |
| Gloves | ATK +2, CRIT% +1 | ATK +3, CRIT% +1 | ATK +4, CRIT% +2 | ATK +5, CRIT% +2 | ATK +6, CRIT% +3 |
| Boots | ARM +2, EVA% +1 | ARM +3, EVA% +2 | ARM +4, EVA% +2 | ARM +5, EVA% +2 | ARM +6, EVA% +3 |
| Belt | END +2, HP +11 | END +2, HP +14 | END +3, HP +18 | END +3, HP +22 | END +4, HP +28 |
| Legs | ARM +3, HP +17 | ARM +4, HP +29 | ARM +5, HP +36 | ARM +6, HP +45 | ARM +8, HP +56 |
| Bracers | DEF +2, STR +2 | DEF +2, STR +2 | DEF +3, STR +3 | DEF +3, STR +4 | DEF +4, STR +5 |
| Necklace | CRIT% +1, ANTICRIT% +1 | CRIT% +1, ANTICRIT% +1 | CRIT% +2, ANTICRIT% +2 | CRIT% +2, ANTICRIT% +2 | CRIT% +3, ANTICRIT% +3 |
| Ring (Strength) | STR +3 | STR +4 | STR +5 | STR +6 | STR +7 |
| Ring (Endurance) | END +2 | END +3 | END +3 | END +4 | END +5 |
| Ring (Dexterity) | DEX +3 | DEX +3 | DEX +4 | DEX +5 | DEX +7 |
| Weapon (2-hand, no shield) | DMG 12-23, STR +5 ⚠️ over budget | DMG 16-29, STR +6 | DMG 20-37, STR +8 | DMG 25-46, STR +10 | DMG 31-58, STR +12 |
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
