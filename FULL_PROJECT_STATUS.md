# SUI Combats — Full Project Status

> Comprehensive reference for current project state. Updated April 17, 2026.

---

## What Is SUI Combats?

SUI Combats is a browser-based medieval RPG combat game built on the Sui blockchain. Players create character NFTs, collect tradeable item NFTs, equip gear, and fight other players in zone-based PvP combat — including wager fights where real SUI is locked on-chain as escrow. Characters are "living" on-chain objects: XP, level, wins/losses, and ELO rating are persisted to the blockchain after every fight.

The project is positioned as the first open-source RPG combat framework for Sui, with a grant application submitted to the Sui Foundation.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16, React, TypeScript, @mysten/dapp-kit-react |
| **Backend** | Express, `ws` (WebSocket), Node.js, port 3001 |
| **Database** | Supabase (persistence for gold, fight history, leaderboards) |
| **Blockchain** | Sui Testnet (Move smart contracts) |
| **Wallet Integration** | @mysten/dapp-kit-react, `CurrentAccountSigner` for tx signing |
| **Decentralized Hosting** | Walrus Sites (testnet, static export) |
| **AI Bot** | "Big Bad Claude" — auto-queues ranked, random strategy, trash-talks in chat |
| **Repository** | [github.com/Mr-Boss-AI/sui-comabts](https://github.com/Mr-Boss-AI/sui-comabts) (public, MIT license) |

---

## Deployment & Contract Addresses

| Item | Value |
|------|-------|
| **Network** | Sui Testnet |
| **Package ID (v4, original)** | `0x07fd856dc8db9dc2950f7cc2ef39408bd20414cea86a37477361f5717e188c1d` |
| **Upgraded Package (v4+testing)** | `0xd8f27ff0996b98f8de1bce9a28cdebda30a128e5ed196d489a132815a3dfad11` |
| **AdminCap** | `0xff993e6ded3683762b3ed04d1e7dbe2e7a1373f3de9ddc52ed762b3c18ca9505` |
| **UpgradeCap** | `0x82c84dce1de7373677617b2941b0c10320f060d6a94157c6194772b6011239d7` |
| **Previous Packages** | v3: `0x543d...b098`, v2: `0x50a5...84fd`, v1: `0x7fd5...2303` |
| **Walrus Site Object** | `0xb8a80a92296751dc45aa3401b2042c18b050a039f2add33e5fd9387e2135b7e3` |
| **Deploy Date** | 2026-04-16 (v4), upgraded 2026-04-17 (testing thresholds) |

**Important:** The original package ID (`0x07fd...`) is used for all calls — Sui automatically routes to the latest upgraded version. The upgraded package (`0xd8f2...`) has temporarily lowered XP thresholds for testing. **Revert before mainnet.**

**Note:** Items and characters from previous packages (v1-v3) are incompatible with v4. Players must use "Reset Character" to migrate to v4.

---

## Wallet Addresses

| Role | Address | CLI Alias |
|------|---------|-----------|
| **Publisher / Player 1** | `0x3606cd88b355a0b45a859646d093ffb4a821fe2c955a99bd1936ebaa2c04e501` | gracious-coral |
| **Dev / Treasury / Admin** | `0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60` | priceless-turquois |
| **Player 2 (test)** | `0xa5ad6e718cfbc50aaaf79f49c9d70b7d3c0f420c3010853872237126bb572498` | — |

The TREASURY wallet is the active CLI address. It holds the `AdminCap` and is required for:
- `settle_wager` / `admin_cancel_wager` (arena admin calls)
- `update_after_fight` (character progression admin calls)

---

## Move Contract Modules

| Module | Purpose | Status |
|--------|---------|--------|
| `character` | Living character NFTs (shared, with AdminCap + owner access control) | **v4 — on-chain progression** |
| `item` | Tradeable item NFTs (key + store) with `image_url` field | Deployed |
| `equipment` | Equip/unequip via dynamic object fields (10 slots) | Deployed |
| `arena` | Wager escrow with lobby, admin controls, expiry, timestamps | Deployed |
| `marketplace` | Kiosk creation, item listing, TransferPolicy | Deployed |

### Character Module (v4) — Living NFTs

Characters are **shared objects** so the server can update them after fights. Access control:
- **AdminCap** required for `update_after_fight` (only server can call)
- **`owner` field check** for `allocate_points` (only the player can spend stat points)

| Function | Access | Description |
|----------|--------|-------------|
| `create_character(name, str, dex, int, end, clock, ctx)` | Anyone | Creates shared Character with `owner = sender`, 20 stat points |
| `update_after_fight(admin, character, won, xp_gained, new_rating, clock)` | **AdminCap only** | Updates wins/losses, XP, rating, auto level-up, emits events |
| `allocate_points(character, str, dex, int, end, ctx)` | **Owner only** | Spend unallocated stat points, requires wallet signature |

**Level-up system:**
- 20 levels with XP thresholds (**currently lowered for testing**: 2, 5, 10, 20, 35, 55, 80, 110, 150... — **revert before mainnet**)
- Production thresholds: 100, 300, 700, 1500, 3000, 6000, 12000, 25000, 50000, ... 1,000,000
- +3 unallocated stat points per level
- Auto level-up loop: if XP exceeds multiple thresholds, grants all levels at once
- `LevelUp` event emitted for each level gained
- `FightResultUpdated` event emitted after every fight

**Character struct fields:** `owner`, `name`, `level`, `xp`, `strength`, `dexterity`, `intuition`, `endurance`, `unallocated_points`, `wins`, `losses`, `rating`, `last_updated`, + 10 equipment slots

**Discovery:** Characters are found via `CharacterCreated` events query (not `listOwnedObjects`, since they're shared)

### Arena Module — Functions

| Function | Access | Description |
|----------|--------|-------------|
| `create_wager(stake, clock, ctx)` | Anyone | Lock SUI in escrow, stores `created_at` timestamp |
| `accept_wager(wager, stake, clock, ctx)` | Anyone (not creator) | Match stake, stores `accepted_at` timestamp |
| `settle_wager(wager, winner, ctx)` | **TREASURY only** | Winner gets 95%, treasury gets 5% |
| `cancel_wager(wager, ctx)` | Player A only | Refund creator (WAITING state only) |
| `admin_cancel_wager(wager, ctx)` | **TREASURY only** | Cancel any non-settled wager |
| `cancel_expired_wager(wager, clock, ctx)` | Anyone | Safety net: cancel after 10min expiry |

---

## Architecture

```
Browser (Next.js 16) ──WebSocket──> Game Server (Express + ws, port 3001)
  |                                      |
  | @mysten/dapp-kit-react               | Supabase persistence
  | Wallet signing for wagers + stats    | Fight resolution, matchmaking, chat
  |                                      | update_after_fight via sui CLI (AdminCap)
  |                                      | settle_wager / admin_cancel via sui CLI
  +-- Sui Testnet (gRPC) ──────────────> On-chain: Characters, Items, Wager escrow
  |
  +-- Walrus Sites (testnet) ──────────> Decentralized frontend hosting
```

### What's On-Chain vs Server-Side

| On-Chain (persists on Sui) | Server-Side (Supabase + in-memory) |
|----------------------------|--------------------------------------|
| Character NFTs (shared, living) | Gold (not yet on-chain) |
| Level, XP, stats, wins/losses, ELO | Equipment assignment (off-chain for speed) |
| Item NFTs (tradeable) | Fight resolution + turn logic |
| Wager escrow (real SUI) | Chat, matchmaking, presence |
| Kiosk marketplace | Wager lobby (in-memory, synced with on-chain) |
| AdminCap (server authority) | Leaderboards, fight history |
| Unallocated stat points | Server also tracks unallocatedPoints (retroactive) |

---

## Working Features

### Character System (On-Chain Progression)
- Character creation mints a shared NFT on Sui (wallet popup), then creates on server
- **After every fight, server calls `update_after_fight` on-chain** — XP, wins/losses, rating persist to blockchain
- **Auto level-up** when XP thresholds are met, +3 unallocated stat points per level
- **Server-side `unallocatedPoints` tracking** — retroactive computation for characters restored from DB
- **`allocate_points`** — player signs wallet tx to spend stat points on-chain (if on-chain character exists), falls back to server-only
- **`character_updated_onchain`** — server notifies frontend after on-chain update completes → frontend re-fetches on-chain data
- **Reset Character button** — deletes server + DB character, triggers re-creation under current package
- Login discovers characters via `CharacterCreated` events query
- Characters survive server restarts by loading from Supabase
- Clock timestamps on all character updates

### UI Layout (April 17 restructure)
- **Character tab** (default landing) — portrait with equipment doll, primary attributes with allocate button, combat statistics, inventory, fight history
- **Arena tab** — Find a Fight (friendly/ranked/wager) + wager lobby only
- **Marketplace tab** — marketplace browser + NPC shop + inventory
- **Tavern tab** — chat + player list
- **Hall of Fame tab** — leaderboard

### Inventory & Equipment
- Inventory merges server items + on-chain Item NFTs from wallet (deduped by ID, on-chain preferred)
- **Kiosk items visible in inventory** with "Listed" badge (not equippable while in kiosk)
- Equip/unequip works with both on-chain and server items, stats update correctly
- Equip/unequip is off-chain (no wallet popup) — wallet approval reserved for ownership/money changes only

### Combat (PvP)
- Zone-based PvP combat with ranked matchmaking (blind queue for friendly/ranked)
- Fight resolution on server with turn timer (20s per turn, auto-action on timeout)
- Loot drops on wins (server-side)
- **Leaderboard / Hall of Fame working**
- **Tavern chat working** with global messages, whispers, player list

### Wager Lobby System (Real SUI)
- Player A creates wager → SUI locked on-chain → appears in public lobby
- Lobby shows: player name, level, ELO, stat build, wager amount, time since creation
- Player B browses lobby, clicks "Accept" → wallet popup → fight starts
- Creator can cancel from lobby (on-chain refund)
- Server auto-cancels on disconnect or 10-min expiry
- **Race condition fix**: can't accept wager if in fight or have open wager
- **Auto-cancel**: lingering lobby wagers for both players cancelled on fight start
- `settle_wager` requires `sender == TREASURY` — admin-only
- **All wager math verified on Suiscan across 3 wallets**

### Chat & Social
- Tavern chat with global and whisper messages
- Player list with status indicators
- AI bot "Big Bad Claude" trash-talks in chat

### Walrus Sites
- Deployed to Walrus testnet (5 epochs)
- Site object: `0xb8a80a92296751dc45aa3401b2042c18b050a039f2add33e5fd9387e2135b7e3`

---

## All Bugs Fixed

| Bug | Fix | Date |
|-----|-----|------|
| Leaderboard not loading | Fixed, rankings display correctly | Apr 14 |
| Equip fails with on-chain items | Fixed, was only checking server inventory | Apr 14 |
| Stats not updating on equip | Fixed, merges onChainEquipped into equipment | Apr 14 |
| Item images not showing in slots | Fixed, EquipSlot renders imageUrl | Apr 14 |
| Character lost on server restart | Fixed, restores from on-chain data | Apr 14 |
| Infinite render loop | Fixed, memoized useGameSocket return | Apr 14 |
| Chat join spam | Fixed, handleDisconnect skips replaced sessions | Apr 14 |
| Chat messages not sending | Fixed, delayed close handler issue | Apr 14 |
| Duplicate item keys | Fixed, dedup by ID preferring on-chain | Apr 15 |
| Ghost items after transfer | Fixed, server verifies on-chain ownership | Apr 15 |
| WagerMatch object parsing | Fixed, SDK v2 discriminated union unwrap | Apr 16 |
| Kiosk items not showing | Fixed, fetchKioskItems via dynamic fields | Apr 16 |
| Wager SUI stuck on timeout | Fixed, admin_cancel_wager on all cancel paths | Apr 16 |
| settle_wager no auth | Fixed, requires sender == TREASURY | Apr 16 |
| Blind wager matchmaking broken | Fixed, replaced with explicit lobby system | Apr 16 |
| Wager race condition | Fixed, reject accept if in-fight or have open wager, auto-cancel on fight start | Apr 17 |
| unallocatedPoints hardcoded 0 | Fixed, server-side tracking + retroactive computation on restore | Apr 17 |
| Stat allocate button not showing | Fixed, button uses server data (not dependent on on-chain character) | Apr 17 |
| On-chain character not found | Root cause: characters from old package; fixed with Reset Character migration | Apr 17 |
| Turn timer 60s (spec is 10s) | Lowered to 20s after live testing (server `TURN_TIMER_MS` + frontend `TURN_SECONDS`) | Apr 20 |
| Shield owners rejected with "Expected 2 block zones" | On-chain items don't carry `offhand_type` label; `getOffhandType` now falls back to `itemType` (2=SHIELD, 1=WEAPON-in-offhand=dual-wield) | Apr 20 |
| Damage log showed "Your HP: ?" | Server `turn_result` payload now includes `hpAfter` per player | Apr 20 |
| No diagnostic when fight ends without HP zero | `finishFight` takes a `reason: 'hp_zero' \| 'draw' \| 'disconnect'` and logs it with turn + both HPs | Apr 20 |
| Zone-pick mismatch reports (hard to diagnose) | Added `[fight_action send]` (frontend console) + `[Fight] action …` (server log) on every submit — pins client vs server truth | Apr 20 |
| `[WS] DROPPED outbound get_fight_history` on first mount | FightHistory `useEffect` now gates send on `state.socket.authenticated` | Apr 20 |
| Unequip click silently sent legacy `unequip_item` WS for on-chain items | `stageUnequip` now consults both `pendingEquipment` and `committedEquipment`; if either holds an on-chain NFT, dispatches `STAGE_UNEQUIP` instead of falling through to the WS path | Apr 21 |
| Pending loadout stayed empty after first `SET_CHARACTER` hydration | Reducer now rebases `pendingEquipment` on first hydration (pending all-null + incoming committed populated), not just on committed change | Apr 21 |

---

## Known Bugs & Limitations

- **XP thresholds temporarily lowered** — on-chain contract upgraded with test values (2, 5, 10, 20...). **MUST revert before any launch.**
- **Old characters on previous package** (`0x7fd54c4d...`) — `update_after_fight` and `allocate_points` fail silently for unmigrated characters. Use "Reset Character" to migrate.
- **No Sui Object Display registered** — NFTs don't show metadata in Sui wallets (only visible on Explorer/in-game)
- **Marketplace UI not wired** — Kiosk contracts deployed but game UI doesn't connect to them
- **Badge NFTs not yet implemented** — no achievement/badge system
- **Opponent items not visible in fight arena** — fight UI doesn't show opponent's equipped items
- **Items from old packages incompatible** — items minted under v1-v3 don't work with v4 (expected)
- **Walrus portal requires self-hosting** — no public testnet portal
- **No settlement retry** — if on-chain settlement fails, no automatic retry
- **Gold not yet on-chain** — gold still server-side only

---

## Progress Timeline

### April 13-14
- Redeployed contracts with `image_url` field on Item struct
- On-chain items, equip/unequip, character persistence, equipment UI
- Fixed render loop, chat spam, chat messages

### April 15
- Wager escrow integration — real SUI locked on-chain
- Walrus Sites deployment, GitHub public release, security hardening
- Grant application drafted, AI bot operational

### April 16
- **Recovered 0.3 SUI** from stuck WagerMatch objects
- **Contract v3**: wager hardening (timestamps, admin settle, admin cancel, expiry safety net)
- **Wager lobby system** replaced blind matchmaking
- **Kiosk items in inventory** with "Listed" badge
- **WagerMatch parsing fix** for SDK v2
- **Contract v4**: living character NFTs
  - AdminCap pattern (minted to TREASURY on deploy)
  - Character as shared object with owner field
  - `update_after_fight` — server persists XP/wins/losses/rating to blockchain after every fight
  - `allocate_points` — player-signed stat allocation with owner check
  - Auto level-up with XP thresholds (1-20), +3 points per level
  - Clock timestamps, events for indexing
  - Characters discovered via events query (shared, not owned)
- All wager math verified on Suiscan across 3 wallets

### April 17
- **Wager race condition fix** — can't accept wager while in fight or with open wager; auto-cancel lingering wagers on fight start
- **Server-side `unallocatedPoints` tracking** — added to Character model, incremented on level-up in `applyXp`, retroactive computation for DB-restored characters
- **Stat allocation flow** — wallet tx (via `buildAllocateStatsTx` + `CurrentAccountSigner`) when on-chain character exists, server-only fallback otherwise; server validates and decrements points
- **`character_updated_onchain` notification** — server notifies frontend after `update_after_fight` completes, frontend re-fetches on-chain character data
- **Frontend re-fetches character after fight** — `get_character` sent on `fight_end` for immediate stats refresh
- **Dedicated Character tab** — new default landing with portrait, stats, allocate button, combat statistics, inventory, fight history
- **Arena tab simplified** — only Find a Fight + wager lobby (character management moved to Character tab)
- **Reset Character button** — deletes server/DB character, triggers re-creation under current package for v4 migration
- **Contract upgrade** — XP thresholds lowered for testing (2, 5, 10, 20... instead of 100, 300, 700, 1500...)

### April 21 — Loadout-Save flow
- **Shipped the `save_loadout` UX** (`feature/loadout-save` → commit `b7b8eac`). Players manipulate equipment locally, then one wallet popup commits all slot changes in a single atomic PTB.
- **New hook API** `useEquipmentActions()` returns `{ stageEquip, stageUnequip, stageDiscard, saveLoadout, signing, isDirty, dirtySlots }`. Per-click wallet popups are gone; `saveLoadout` builds one PTB that unequips + equips every dirty slot via `equipment::*_v2` primitives (D1 = PTB-of-primitives, D2 = no version counter).
- **New PTB builder** `frontend/src/lib/loadout-tx.ts::buildSaveLoadoutTx(characterId, committed, pending)` — diffs slots, emits `unequip_<slot>_v2` + `equip_<slot>_v2` pairs per dirty slot, gas budget 150M MIST.
- **State split** — `committedEquipment` (chain truth) and `pendingEquipment` (local staging) now live in `GameState`. Dirty detection via `computeDirtySlots(committed, pending)`.
- **UI** — Save Loadout + Discard buttons in character-profile header (count badge with N dirty slots). Every `EquipSlot` on the doll gets an amber ring + corner dot when dirty. Save disabled during active fights (with tooltip), auto-fires a fight-start toast if pending was dirty.
- **D3-strict server side** (already landed in Step 2) — `fetchEquippedFromDOFs` + `applyDOFEquipment` hydrate server equipment from chain at auth and again at fight start. Server ignores any client-sent `onChainEquipment` payload; matchmaking queue cleanup removed the obsolete field.
- **D4** — combat reads `committedEquipment`; fight-arena renders chain truth, not pending. Pending is inactive during fights.
- **Cleanup** — removed `onChainEquipped` slice + `EQUIP_ONCHAIN_ITEM` / `UNEQUIP_ONCHAIN_ITEM` action types. UI surfaces migrated to read pending.
- **Verified live** — three back-to-back real-SUI wager fights (0.51 SUI, 0.1 SUI, 0.1 SUI) completed with zero regressions. Settlement, fight-lock set/clear, character NFT updates all on-chain, no errors.
- **New doc** `ARCHITECTURE_MAP.md` — complete reference (on-chain modules / addresses / objects / DOFs, off-chain WS+REST+Supabase+memory+external calls, full data-flow traces, trust boundaries) for building a visual wiring diagram.

---

## What's Next

1. **Merge `feature/loadout-save` to main** once onboarding modal + final browser regression pass are done
2. **Migrate characters to v4** — both test players use Reset Character, re-create, verify on-chain allocation via Suiscan
3. **Revert XP thresholds** — restore production values in character.move before any public testing
4. **Register Sui Object Display** — so NFTs show metadata in Sui wallets
5. **Wire marketplace UI** — connect Kiosk contracts to game frontend
6. **Mint new items under v4** — replace incompatible old items
7. **Badge NFTs** — achievement system
8. **Settlement retry** — automatic retry if on-chain calls fail
9. **Show opponent equipment in fight UI**
10. **Gold on-chain** — move gold to on-chain balance
11. **Medieval theme redesign**
12. **Production server deployment**

---

## How to Run the Project

### Prerequisites
- Node.js, Sui CLI, a Sui wallet with testnet SUI

### Smart Contracts
```bash
cd contracts
sui move build
sui client publish --gas-budget 500000000
# Note: init() creates AdminCap — deploy from TREASURY wallet to receive it
# To upgrade: sui client upgrade --gas-budget 500000000
```

### Server
```bash
cd server
cp .env.example .env
# Fill in: SUI_PACKAGE_ID, PLATFORM_TREASURY, ADMIN_CAP_ID, PORT, Supabase creds
# IMPORTANT: Active sui CLI address must be TREASURY for admin calls
npm install
npm run dev
# Runs on port 3001
```

### Frontend
```bash
cd frontend
cp .env.local.example .env.local
# Fill in: NEXT_PUBLIC_SUI_PACKAGE_ID, NEXT_PUBLIC_WS_URL
npm install
npm run dev
# Runs on default Next.js port (3000)
```

---

## Config Files

| File | Purpose |
|------|---------|
| `frontend/.env.local` | `NEXT_PUBLIC_SUI_PACKAGE_ID`, `NEXT_PUBLIC_WS_URL` |
| `server/.env` | `SUI_PACKAGE_ID`, `PLATFORM_TREASURY`, `ADMIN_CAP_ID`, `PORT`, Supabase creds |
| `server/.env.example` | Template (no secrets) |
| `deployment.json` | Contract addresses, AdminCap, previous packages, upgrade info |
| `contracts/Published.toml` | Move package publish metadata (auto-updated by `sui client upgrade`) |

---

## MCP Servers Configured

| MCP Server | Purpose |
|------------|---------|
| **GitHub** (`mcp__github__*`) | Repo management, issues, PRs, code search |
| **Sui GraphQL** (`mcp__sui-graphql__*`) | On-chain queries via Sui's GraphQL API |
| **Sui** (`mcp__sui__*`) | Wallet operations — faucet, balance, transfer, account generation |
| **Gmail** (`mcp__claude_ai_Gmail__*`) | Email drafts and search (for grant communication) |

---

## Grant Application

| Item | Detail |
|------|--------|
| **File** | `GRANT_APPLICATION.md` |
| **Target** | Sui Foundation — Hydropower Accelerator / Direct Strategic Investment |
| **Ask** | $50,000 across 4 phases (16 weeks) |
| **Phase 1** | Production hardening + mainnet deploy |
| **Phase 2** | SDK extraction + npm packages |
| **Phase 3** | Open-source community launch |
| **Phase 4** | Cross-game interop + tournaments |
| **Status** | Draft complete, ready to submit |
