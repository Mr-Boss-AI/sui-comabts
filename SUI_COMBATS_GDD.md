# SUI COMBATS — Game Design Document v1.0

> **One-liner:** A blockchain PvP social arena where players connect wallets, create NFT characters, gear up, trade, chat, and fight in strategic zone-based combat — all on Sui.

---

## 1. VISION

Inspired by the legendary Russian browser MMORPG "Бойцовский Клуб" (combats.ru), SUI Combats strips the game down to its purest form: **pick your zone, pick your block, let the stats decide**. No complex ability trees, no tactic point farming, no PvE grind. Just player vs player combat, NFT gear economy, and a social hub where fighters hang out, trade, and talk trash.

### Core Pillars
- **Simple combat, deep strategy** — Anyone can learn in 1 fight, mastery comes from gear building and reading opponents
- **True ownership** — Characters and items are NFTs on Sui, tradeable in Kiosk
- **Social first** — The game IS the town square. Chat, trade, challenge, spectate
- **No cheating possible** — No active abilities = no exploits. Pure math + zone prediction
- **Stake to fight** — Wager SUI or items on fights for real stakes

---

## 2. TECH STACK

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Next.js + TypeScript | SSR, fast, you know it from Banzai |
| Game Server | Node.js + TypeScript + WebSockets | Real-time fight turns, matchmaking |
| Database | Supabase (PostgreSQL) | Auth, chat, fight history, leaderboards |
| Blockchain | Sui Move smart contracts | NFTs, Kiosk, token economy, fight result commits |
| Real-time | WebSocket (ws or socket.io) | Live fights, chat, presence |
| Wallet | @mysten/dapp-kit | Sui wallet connection |

### Architecture Flow
```
Player Wallet (Sui) → Next.js Frontend → WebSocket → Game Server (Node.js)
                                                          ↓
                                                    Fight Resolution
                                                          ↓
                                              Supabase (fast storage)
                                                    +
                                              Sui Chain (permanent: NFT mints, fight results, rewards)
```

---

## 3. CHARACTER SYSTEM

### 3.1 Character NFT

Each character is a Sui NFT object created on wallet connection. One wallet = one character (can burn and recreate).

```
Character {
  id: UID
  name: String
  level: u8              // 1-20
  xp: u64

  // Base stats (allocated by player on creation + level ups)
  strength: u16          // Raw physical power
  dexterity: u16         // Agility, evasion
  intuition: u16         // Critical hit chance
  endurance: u16         // HP pool, damage resistance

  // Derived stats (calculated from base + equipment)
  max_hp: u16
  attack_power: u16
  crit_chance: u16       // % chance
  crit_multiplier: u16   // damage multiplier (in basis points, e.g., 200 = 2.0x)
  evasion: u16           // dodge chance %
  armor: u16             // flat damage reduction
  defense: u16           // % damage reduction after armor

  // Record
  wins: u32
  losses: u32
  rating: u16            // ELO-style

  // Equipment slots (Object IDs of equipped item NFTs)
  weapon: Option<ID>
  offhand: Option<ID>    // shield OR second weapon
  helmet: Option<ID>
  chest: Option<ID>
  gloves: Option<ID>
  boots: Option<ID>
  belt: Option<ID>
  ring_1: Option<ID>
  ring_2: Option<ID>
  necklace: Option<ID>
}
```

### 3.2 Stat Allocation

On creation: player gets **20 stat points** to distribute across STR/DEX/INT/END.
Per level up: **+3 stat points**.

The distribution defines your archetype:

| Build | Primary Stat | Secondary | Playstyle |
|-------|-------------|-----------|-----------|
| **Tank** | Endurance + Strength | — | High HP, high armor effectiveness, solid damage. Survives long fights. |
| **Crit** | Intuition + Strength | — | High crit chance + crit damage. Burst damage, glass cannon. |
| **Evasion** | Dexterity + Endurance | — | High dodge chance. Avoids hits, wins by attrition. |
| **Hybrid** | Any mix | — | Player's choice. Jack of all trades. |

### 3.3 Stat → Combat Formulas

```
max_hp = 100 + (endurance * 10) + equipment_hp_bonus

attack_power = (strength * 0.6) + (dexterity * 0.3) + (intuition * 0.1) + weapon_damage

crit_chance = min(75%, (intuition * 0.8) - opponent_anti_crit)
  // Anti-crit comes from opponent's endurance: anti_crit = endurance * 0.4

crit_multiplier = 2.0 + (intuition * 0.005) + equipment_crit_bonus
  // Default 2x, max ~3.5x at high intuition + gear

evasion_chance = min(60%, (dexterity * 0.7) - opponent_anti_evasion)
  // Anti-evasion comes from opponent's strength: anti_evasion = strength * 0.5

armor = equipment_armor_total
  // Flat subtraction from raw damage

defense = endurance * 0.3 + equipment_defense
  // Each 250 defense absorbs 50% of post-armor damage (exponential diminishing returns)
  // Formula: final_dmg = post_armor_dmg * 2^(-defense / 250)
```

### 3.4 Counter Triangle

The formulas naturally create this balance:

```
        TANK
       /    \
  beats      loses to
     /          \
 EVASION ------- CRIT
     beats →
```

- **Tank > Evasion**: Strength gives anti-evasion. Tank hits through dodges.
- **Evasion > Crit**: Crit builds are glass cannon with low endurance. Evasion dodges their burst and outlasts them.
- **Crit > Tank**: Crit ignores armor on critical hits (partial armor penetration on crits). Burst exceeds tank sustain.

This isn't hard-coded — it emerges from the stat formulas. A well-geared evasion build CAN beat a tank. The triangle is a tendency, not a rule.

---

## 4. COMBAT SYSTEM

### 4.1 Overview

Fights are **1v1 turn-based**. Each turn, both players simultaneously choose:
- **1 Attack Zone** (where to strike)
- **2 Block Zones** (where to defend) — 3 if using a shield

Zones: **Head, Chest, Stomach, Belt, Legs** (5 total)

Turns resolve on a **20-second timer** (design spec was 10s; widened after live testing for ergonomics). If you don't pick, random zones are chosen.

### 4.2 Turn Resolution (executed on server)

```
For each player (both resolve simultaneously):

1. ZONE CHECK
   - If attacker's attack_zone is in defender's block_zones → BLOCKED (0 damage)
   - If attacker's attack_zone is NOT blocked → proceed to step 2

2. EVASION CHECK (only if not blocked)
   - Roll random(0, 100)
   - If roll < defender.evasion_chance → DODGED (0 damage)
   - If dodged → no further checks

3. CRITICAL CHECK (only if hit lands)
   - Roll random(0, 100)
   - If roll < attacker.crit_chance → CRITICAL HIT
   - Critical hits get: crit_multiplier applied + 30% armor penetration

4. DAMAGE CALCULATION
   Normal hit:
     raw_dmg = random(attacker.attack_power * 0.85, attacker.attack_power * 1.0)
     post_armor = max(1, raw_dmg - defender.armor)
     final_dmg = post_armor * 2^(-defender.defense / 250)

   Critical hit:
     raw_dmg = random(attacker.attack_power * 0.85, attacker.attack_power * 1.0) * crit_multiplier
     effective_armor = defender.armor * 0.7  // 30% armor penetration on crits
     post_armor = max(1, raw_dmg - effective_armor)
     final_dmg = post_armor * 2^(-defender.defense / 250)

5. APPLY DAMAGE
   - Subtract final_dmg from defender HP
   - If HP <= 0 → fight over
```

### 4.3 Fight Flow

```
1. Both players enter arena (stake SUI/items or free fight)
2. 10-second countdown per turn
3. Both pick attack zone + block zones simultaneously
4. Server resolves both attacks
5. Both players see: hit/miss/crit, damage numbers, HP bars
6. Repeat until one player reaches 0 HP
7. Winner gets: XP, rating change, stakes (if wagered)
8. Fight log committed to Supabase + result hash to Sui chain
```

### 4.4 Fight Types

| Type | Description | Stakes |
|------|------------|--------|
| **Friendly** | No stakes, just practice | None |
| **Ranked** | ELO rating on the line | Rating points |
| **Wager** | Both players stake equal SUI | Winner takes pot (minus 5% platform fee) |
| **Item Stake** | Each player puts up an NFT item | Winner takes both items |

### 4.5 Anti-Cheat

There's nothing to cheat because:
- No active abilities to script/macro
- Zone selection is simultaneous (commit-reveal if needed)
- All math runs server-side
- Fight results are deterministic from inputs
- Optional: commit zone picks as hashes, reveal after both commit (on-chain fairness)

---

## 5. EQUIPMENT (NFT ITEMS)

### 5.1 Item Structure

Every item is a Sui NFT with stats that modify the character when equipped.

```
Item {
  id: UID
  name: String
  item_type: u8         // weapon, shield, helmet, chest, etc.
  class_req: u8         // 0=any, 1=STR-focused, 2=DEX-focused, 3=INT-focused
  level_req: u8         // minimum character level
  rarity: u8            // 1=Common, 2=Uncommon, 3=Rare, 4=Epic, 5=Legendary

  // Stat bonuses (all optional, 0 = no bonus)
  strength_bonus: u16
  dexterity_bonus: u16
  intuition_bonus: u16
  endurance_bonus: u16
  hp_bonus: u16
  armor_bonus: u16
  defense_bonus: u16
  attack_bonus: u16
  crit_chance_bonus: u16
  crit_multiplier_bonus: u16  // basis points
  evasion_bonus: u16
  anti_crit_bonus: u16
  anti_evasion_bonus: u16

  // Weapon-specific
  min_damage: u16       // only for weapons
  max_damage: u16       // only for weapons
}
```

### 5.2 Equipment Slots

| Slot | Item Type | Primary Stats |
|------|----------|---------------|
| Weapon (main hand) | Sword, Dagger, Mace, Axe | Damage, attack power, crit or anti-evasion |
| Offhand | Shield OR second weapon | Shield: +armor, +1 block zone. Dual wield: +1 attack zone |
| Helmet | Head armor | HP, defense, anti-crit |
| Chest | Body armor | Armor, HP, defense |
| Gloves | Hand armor | Attack, crit chance, anti-evasion |
| Boots | Foot armor | Evasion, dexterity, defense |
| Belt | Waist | Endurance, HP |
| Ring 1 | Jewelry | Any stat small bonus |
| Ring 2 | Jewelry | Any stat small bonus |
| Necklace | Jewelry | Any stat small bonus |

### 5.3 Dual Wield vs Shield

| Choice | Benefit | Tradeoff |
|--------|---------|----------|
| **Shield** | 3 block zones instead of 2 | Only 1 attack zone |
| **Dual Wield** | 2 attack zones (hit 2 zones per turn) | Only 2 block zones |
| **Two-handed** | Higher base damage weapon | Only 2 block zones, 1 attack zone |

This is a huge strategic choice — more defense or more offense.

### 5.4 Rarity Scaling

| Rarity | Stat Budget | Drop/Mint Rate | Color |
|--------|------------|-----------------|-------|
| Common | 1x | Abundant | White |
| Uncommon | 1.5x | Regular | Green |
| Rare | 2.2x | Scarce | Blue |
| Epic | 3x | Very scarce | Purple |
| Legendary | 4x | Extremely rare | Orange |

Stat budget means a Legendary item has ~4x the total stat points of a Common item of the same level.

### 5.5 Item Acquisition

- **Shop (NPC)**: Buy Common/Uncommon items for SUI (baseline gear)
- **Fight Rewards**: Win fights to earn loot boxes with chance of Rare+
- **Crafting** (future): Combine lower items into higher rarity
- **Trading**: Buy from other players via Kiosk
- **Seasonal Drops**: Limited-edition Legendary items during events

---

## 6. SUI BLOCKCHAIN INTEGRATION

### 6.1 On-Chain vs Off-Chain

| On-Chain (Sui) | Off-Chain (Supabase + Server) |
|---------------|-------------------------------|
| Character NFT (creation, stats, level) | Fight resolution (turn-by-turn) |
| Item NFTs (mint, transfer, equip) | Chat messages |
| Kiosk marketplace | Matchmaking |
| SUI wager escrow | Real-time WebSocket |
| Fight result hash (proof) | Leaderboards |
| Rating updates | Presence / social |

### 6.2 Sui Move Modules

```
sui_combats/
├── character.move      // Character NFT, stat allocation, leveling
├── item.move           // Item NFT, rarity, stats
├── equipment.move      // Equip/unequip logic
├── marketplace.move    // Kiosk setup, TransferPolicy, royalties
├── arena.move          // Wager escrow, fight result settlement
├── token.move          // Optional: game token (COMBAT coin)
```

### 6.3 Kiosk Marketplace

- All items use Sui Kiosk for trading
- TransferPolicy enforces 2.5% royalty on all trades
- Items can be listed with fixed price or auction
- Character NFTs are soulbound (non-transferable) — only items trade

### 6.4 Wager System

```
1. Player A creates wager: locks X SUI in escrow smart contract
2. Player B accepts: locks matching X SUI
3. Fight happens off-chain on game server
4. Server submits fight result to Sui contract with signed proof
5. Contract releases escrow: 95% to winner, 5% platform fee
```

The server signs results with its keypair. The contract validates the signature before releasing funds.

---

## 7. SOCIAL SYSTEM

### 7.1 The Town Square

The game opens to a **social hub** — a visual town where player avatars are visible. Think of it as a chat room with character sprites.

Features:
- **Global chat** — everyone in the hub can talk
- **Whisper** — private DMs
- **Trade requests** — click a player → offer trade
- **Challenge** — click a player → challenge to fight
- **Spectate** — watch ongoing fights live
- **Profiles** — click to see stats, gear, win/loss record

### 7.2 Areas in Town

| Area | Function |
|------|----------|
| **Arena** | Where fights happen. Spectators can watch. |
| **Marketplace** | Browse Kiosk listings, buy/sell items |
| **Tavern** | Social chat, no fighting |
| **Training Ground** | Free fights, no stakes, no rating change |
| **Hall of Fame** | Leaderboards, top players, seasonal rankings |

### 7.3 Presence System

WebSocket-powered:
- See who's online
- See who's in a fight
- See who's browsing marketplace
- Real-time chat
- Fight spectating with live zone picks + damage

---

## 8. ECONOMY

### 8.1 Currency

- **SUI** — Primary currency for everything (no custom token needed at launch)
- **Future: COMBAT token** — Optional governance/reward token later

### 8.2 SUI Sinks (how SUI leaves circulation)

- Buy items from NPC shop
- Platform fee on wagers (5%)
- Marketplace royalties (2.5%)
- Character respecs (re-allocate stats)
- Cosmetic purchases

### 8.3 SUI Sources (how players earn)

- Win wager fights
- Sell items on marketplace
- Seasonal tournament prizes
- Referral bonuses

### 8.4 Item Economy

Items are the real economy. Rare+ items are scarce and valuable because:
- They significantly improve combat effectiveness
- They're tradeable NFTs with real value
- Better gear = higher win rate = more SUI from wagers
- Legendary items are status symbols in the social hub

---

## 9. LEVELING & PROGRESSION

### 9.1 XP Table (Simplified, no billion-XP grind)

| Level | Total XP | Stat Points | Unlocks |
|-------|---------|-------------|---------|
| 1 | 0 | 20 (starting) | Training Ground, Common items |
| 2 | 100 | +3 | — |
| 3 | 300 | +3 | Friendly fights |
| 4 | 700 | +3 | Trading unlocked |
| 5 | 1,500 | +3 | Ranked fights, Uncommon items |
| 6 | 3,000 | +3 | — |
| 7 | 6,000 | +3 | Wager fights, Rare items |
| 8 | 12,000 | +3 | Dual wield / Shield choice |
| 9 | 25,000 | +3 | — |
| 10 | 50,000 | +3 | Epic items |
| 12 | 120,000 | +3 each | — |
| 15 | 350,000 | +3 each | Legendary items |
| 20 | 1,000,000 | +3 each | Max level, Hall of Fame eligible |

### 9.2 XP Sources

| Source | XP |
|--------|-----|
| Win ranked fight | 50-200 (based on opponent rating) |
| Lose ranked fight | 10-30 |
| Win wager fight | 100-400 |
| Daily first fight | 50 bonus |

---

## 10. MVP ROADMAP

### Phase 1: Core Combat (Week 1-4)
- [ ] Wallet connection (Sui dapp-kit)
- [ ] Character NFT creation + stat allocation
- [ ] Basic fight system (zone pick, damage calc)
- [ ] Fight UI (zone selector, HP bars, damage log)
- [ ] WebSocket server for real-time turns

### Phase 2: Items & Gear (Week 5-8)
- [ ] Item NFT smart contracts
- [ ] NPC shop (buy Common/Uncommon)
- [ ] Equip/unequip system
- [ ] Stats recalculation with gear
- [ ] Basic item display UI

### Phase 3: Social & Trading (Week 9-12)
- [ ] Town hub UI with player presence
- [ ] Global chat + whisper
- [ ] Kiosk marketplace integration
- [ ] Player profiles with gear display
- [ ] Fight spectating

### Phase 4: Economy & Stakes (Week 13-16)
- [ ] SUI wager escrow contracts
- [ ] Ranked matchmaking + ELO
- [ ] Leaderboards
- [ ] Loot box rewards from fights
- [ ] Rarity drop rate tuning

### Phase 5: Polish & Launch (Week 17-20)
- [ ] Mobile responsive UI
- [ ] Sound effects + fight animations
- [ ] Seasonal ranking system
- [ ] Anti-bot measures
- [ ] Testnet → Mainnet deployment

---

## 11. KEY DESIGN DECISIONS

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| No abilities | Stats + gear only | Eliminates cheating, simplifies balance, makes gear more valuable |
| 5 body zones | Head, Chest, Stomach, Belt, Legs | Proven by 20+ years in combats.ru — enough variety without overwhelm |
| 20-second turns (spec: 10s) | Timed simultaneous | Fast enough to not bore, slow enough to think — widened from 10s after live testing |
| Items as NFTs | Sui Kiosk | Real ownership, tradeable, royalty-enforced |
| Characters soulbound | Non-transferable | Prevents account selling, keeps progression meaningful |
| SUI as currency | No custom token at launch | Lower barrier to entry, real value from day 1 |
| Off-chain fights | Server-side resolution | Speed (on-chain turns would be too slow), with result hash committed for proof |

---

## 12. REFERENCE: ORIGINAL COMBATS.RU MECHANICS KEPT

| Original Mechanic | Our Version |
|-------------------|-------------|
| 5 zone attack/block | ✅ Kept exactly |
| Stat-based builds (no fixed classes) | ✅ Kept — STR/DEX/INT/END |
| Counter triangle (crit > tank > evasion > crit) | ✅ Kept via formulas |
| Shield = +1 block, dual wield = +1 attack | ✅ Kept exactly |
| Piercing/Slashing damage types | ❌ Simplified to single damage type |
| Tactic point system | ❌ Removed entirely |
| Complex ability trees | ❌ Removed entirely |
| Mages (4 elements) | ❌ Removed for MVP |
| Archers/Crossbow | ❌ Removed for MVP |
| Dungeons/PvE | ❌ Removed — PvP only |
| Billion-XP progression | ❌ Flattened to level 20 cap |
| Equipment runes/enchanting | ⏳ Future feature |
| Clan wars | ⏳ Future feature |

---

*This document is the single source of truth for SUI Combats development. Any AI or developer building features should read this first.*
