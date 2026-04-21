# SUI Combats — Architecture Map

> Reference material for building a visual wiring diagram. Snapshot as of commit `b7b8eac` on `feature/loadout-save`. 2026-04-21.
> Index source: GitNexus 934 nodes / 1999 edges / 75 flows.

---

## 1. ON-CHAIN — Move contracts

### Addresses (testnet, per `deployment.json`)

| Item | Value |
|---|---|
| Original package ID | `0x07fd856dc8db9dc2950f7cc2ef39408bd20414cea86a37477361f5717e188c1d` |
| Upgraded package ID (call target) | `0x5f9011c8eb31f321fbd5b2ad5c811f34011a96a4c8a2ddfc6262727dee55c76b` |
| Upgrade tx | `DyDUHVGYR8aHWQgtka1yAu8tgAWGxjgD5Ln7RaoaU3z5` |
| AdminCap object | `0xff993e6ded3683762b3ed04d1e7dbe2e7a1373f3de9ddc52ed762b3c18ca9505` (held by TREASURY) |
| UpgradeCap object | `0x82c84dce1de7373677617b2941b0c10320f060d6a94157c6194772b6011239d7` |
| Publisher object | created in `item::init`, transferred to deploy sender |
| TREASURY (hardcoded in `arena.move`) | `0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60` |
| Player 1 (publisher / gracious-coral) | `0x3606cd88b355a0b45a859646d093ffb4a821fe2c955a99bd1936ebaa2c04e501` |
| Player 2 (test) | `0xa5ad6e718cfbc50aaaf79f49c9d70b7d3c0f420c3010853872237126bb572498` |
| Previous packages | v1 `0x7fd5…2303`, v2 `0x50a5…84fd`, v3 `0x543d…b098`, v3.5 `0xd8f2…ad11` |

**Important**: All `moveCall` targets use the upgraded package ID. The original package ID is used for event type queries and struct type names.

### Module: `sui_combats::character`

**Location**: `contracts/sources/character.move`

**Structs**:
- `Character` — `has key` (shared object). Fields: `id: UID`, `owner: address`, `name: String`, `level: u8`, `xp: u64`, `strength/dexterity/intuition/endurance: u16`, `unallocated_points: u16`, `wins: u32`, `losses: u32`, `rating: u16`, `last_updated: u64`, and 10 `Option<ID>` equipment slot fields: `weapon`, `offhand`, `helmet`, `chest`, `gloves`, `boots`, `belt`, `ring_1`, `ring_2`, `necklace`.
- `AdminCap` — `has key, store` (owned capability). Gates server-only calls.
- `CharacterCreated`, `LevelUp`, `FightResultUpdated`, `PointsAllocated` — `has copy, drop` event types.

**Entry functions**:
- `create_character(name, str, dex, int, end, clock, ctx)` — anyone; mints shared Character (stat sum must be 20), emits `CharacterCreated`.
- `update_after_fight(&AdminCap, &mut Character, won, xp_gained, new_rating, clock)` — **AdminCap-gated**; updates wins/losses/XP/rating, auto-levels up, emits `LevelUp` per level + `FightResultUpdated`.
- `allocate_points(&mut Character, str, dex, int, end, ctx)` — **owner-only**; spends unallocated points, emits `PointsAllocated`.
- `set_fight_lock(&AdminCap, &mut Character, expires_at_ms)` — **AdminCap-gated**; writes/updates `b"fight_lock_expires_at"` dynamic field (u64).

**Public non-entry**:
- `is_fight_locked(&Character, &Clock) -> bool` — checks DF vs clock.
- `uid(&Character) -> &UID` (public), `uid_mut(&mut Character) -> &mut UID` (package-visible).
- Full field getters: `owner`, `level`, `strength`, `dexterity`, `intuition`, `endurance`, `rating`, `wins`, `losses`, `xp`, `name`, `unallocated_points`, `last_updated`, + 10 slot getters.
- Package-visible slot setters (one per slot): used by `equipment.move`.

**Error codes**: `0`=EInvalidStatTotal, `1`=EMaxLevelReached, `2`=ENotEnoughPoints, `3`=ENameTooLong, `4`=EStatTooHigh, `5`=ENotOwner.

**Dynamic field keys on Character**:
- `b"fight_lock_expires_at"` → `u64` (set/cleared by server to block equip during combat)

**`init()`**: creates one `AdminCap` and transfers to deploy sender. (On fresh mainnet deploy, deployer = TREASURY.)

**Constants**: `MAX_LEVEL=20`, `INITIAL_STAT_POINTS=20`, `POINTS_PER_LEVEL=3`, `MAX_NAME_LENGTH=32`, `DEFAULT_RATING=1000`. XP curve: L2=100, L5=1500, L10=50_000, L15=350_000, L20=1_000_000 (production values).

### Module: `sui_combats::item`

**Location**: `contracts/sources/item.move`

**Structs**:
- `Item` — `has key, store` (owned NFT, wrappable). 20+ fields: `id`, `name`, `image_url`, `item_type: u8`, `class_req`, `level_req`, `rarity`, 13 `*_bonus: u16` fields, `min_damage`, `max_damage`.
- `ITEM` — `has drop` (one-time witness for `package::claim`).
- `ItemMinted` event.

**Entry functions**:
- `mint_item_admin(&AdminCap, 21 args..., ctx)` — **AdminCap-gated**; creates `Item`, transfers to sender, emits `ItemMinted`.
- `mint_item(...)` — **DEPRECATED**, aborts `EDeprecated (2)`. Kept in upgraded bytecode for compatibility; original package still runs the v1 path (mainnet must be fresh deploy per `MAINNET_PREP.md`).

**Public non-entry**: 21 field getters + 9 item-type constants (`weapon_type()` → 1, `shield_type()` → 2, ... `necklace_type()` → 9).

**Error codes**: `0`=EInvalidItemType, `1`=EInvalidRarity, `2`=EDeprecated.

**`init(ITEM, ctx)`**: claims `Publisher` via one-time witness, transfers to deploy sender. `Publisher` is later required by `marketplace::setup_transfer_policy`.

**Constants**: WEAPON=1, SHIELD=2, HELMET=3, CHEST=4, GLOVES=5, BOOTS=6, BELT=7, RING=8, NECKLACE=9. COMMON=1..LEGENDARY=5.

### Module: `sui_combats::equipment`

**Location**: `contracts/sources/equipment.move`

**Structs**: none new. Mutates `Character`, consumes/returns `Item`.

**Entry functions** (v2 — active):
- `equip_<slot>_v2(&mut Character, Item, &Clock, ctx)` — 10 variants. Owner-check + fight-lock check + type-match + level-check + slot-must-be-empty. Attaches item as **Dynamic Object Field** (dof::add) keyed by slot name bytes, writes `Some(item_id)` into the matching `Character.<slot>` field, emits `ItemEquipped`.
- `unequip_<slot>_v2(&mut Character, &Clock, ctx)` — 10 variants. Owner-check + fight-lock + slot-must-be-filled. Pulls DOF back via `dof::remove`, clears `Character.<slot>` to `None`, transfers item to owner, emits `ItemUnequipped`.

**Entry functions** (v1 — all **DEPRECATED**, abort `EDeprecated (6)`): 10 `equip_*` + 10 `unequip_*` kept in upgraded bytecode for compatibility.

**Events**: `ItemEquipped { character_id: ID, item_id: ID, slot: String }`, `ItemUnequipped` (same shape).

**Error codes**: `0`=EWrongItemType, `1`=ESlotOccupied, `2`=ESlotEmpty, `3`=ELevelTooLow, `4`=ENotOwner, `5`=EFightLocked, `6`=EDeprecated.

**DOF keys on Character** (all `string::utf8(b"<slot>")` → `Item`):
- `"weapon"`, `"offhand"`, `"helmet"`, `"chest"`, `"gloves"`, `"boots"`, `"belt"`, `"ring_1"`, `"ring_2"`, `"necklace"`.

### Module: `sui_combats::arena`

**Location**: `contracts/sources/arena.move`

**Structs**:
- `WagerMatch` — `has key` (shared). Fields: `id: UID`, `player_a: address`, `player_b: Option<address>`, `stake_amount: u64`, `escrow: Balance<SUI>`, `status: u8` (0=WAITING, 1=ACTIVE, 2=SETTLED), `created_at: u64`, `accepted_at: u64`.
- Events: `WagerCreated`, `WagerAccepted`, `WagerSettled`, `WagerCancelled`, `WagerRefunded` — all `has copy, drop`.

**Entry functions**:
- `create_wager(Coin<SUI>, &Clock, ctx)` — anyone. Shares WagerMatch in WAITING, emits `WagerCreated`.
- `accept_wager(&mut WagerMatch, Coin<SUI>, &Clock, ctx)` — anyone ≠ player_a. Moves state WAITING → ACTIVE, joins stake to escrow. Emits `WagerAccepted`.
- `settle_wager(&mut WagerMatch, winner: address, ctx)` — **TREASURY-only** via hardcoded `tx_context::sender(ctx) == TREASURY` check. Splits escrow 95/5 (winner/platform), transitions ACTIVE → SETTLED. Emits `WagerSettled`.
- `cancel_wager(&mut WagerMatch, ctx)` — **player_a only**, **WAITING state only**. Refunds full escrow. Emits `WagerCancelled`.
- `admin_cancel_wager(&mut WagerMatch, ctx)` — **TREASURY-only**. WAITING → refund A. ACTIVE → 50/50 split both. Emits `WagerCancelled` or `WagerRefunded`.
- `cancel_expired_wager(&mut WagerMatch, &Clock, ctx)` — public safety net after 10-min expiry on either phase.

**Error codes**: `0`=EInvalidStake, `1`=EMatchNotWaiting, `2`=EMatchNotActive, `3`=EStakeMismatch, `4`=ENotPlayerA, `5`=EInvalidWinner, `6`=EMatchAlreadySettled, `7`=ECannotJoinOwnMatch, `8`=EUnauthorized (not TREASURY), `9`=ENotExpired.

**Constants**: `STATUS_WAITING=0`, `STATUS_ACTIVE=1`, `STATUS_SETTLED=2`, `PLATFORM_FEE_BPS=500` (5%), `BPS_BASE=10_000`, `MATCH_EXPIRY_MS=600_000` (10 min), `SETTLEMENT_TIMEOUT_MS=600_000` (10 min), `TREASURY=0xdbd3…` (hardcoded).

### Module: `sui_combats::marketplace`

**Location**: `contracts/sources/marketplace.move`

**Structs**: none new. Uses Sui framework's `Kiosk`, `KioskOwnerCap`, `TransferPolicy<Item>`, `TransferPolicyCap<Item>`, `Publisher`.

**Entry functions**:
- `create_player_kiosk(ctx)` — creates shared `Kiosk` + `KioskOwnerCap` (transferred to sender). Emits `KioskCreated`.
- `list_item_with_fee(&mut Kiosk, &KioskOwnerCap, Item, price: u64, mut fee: Coin<SUI>, treasury: address, ctx)` — requires `fee >= LISTING_FEE_MIST (0.01 SUI)`; splits fee to `treasury` arg, refunds excess. Places item + sets listing price. Emits `ItemListed`.
- `list_item(...)` — **DEPRECATED**, aborts `EDeprecated (2)`.
- `delist_item(&mut Kiosk, &KioskOwnerCap, item_id, ctx)` — emits `ItemDelisted`. Fee not refunded.
- `buy_item(&mut Kiosk, item_id, Coin<SUI>, &mut TransferPolicy<Item>, ctx)` — executes `kiosk::purchase`, confirms against policy (royalty applies via policy rules), emits `ItemPurchased`.
- `setup_transfer_policy(&Publisher, ctx)` — creates `TransferPolicy<Item>` + `TransferPolicyCap<Item>`, shares policy, transfers cap. Emits `PolicyCreated`.

**Events**: `KioskCreated`, `ItemListed`, `ItemDelisted`, `ItemPurchased`, `PolicyCreated`.

**Error codes**: `0`=EInvalidPrice, `1`=EInsufficientFee, `2`=EDeprecated.

**Constants**: `ROYALTY_BPS=250` (2.5%), `LISTING_FEE_MIST=10_000_000` (0.01 SUI).

### Cross-module dependency graph

```
character      (AdminCap, Character, events)
  ▲                ▲
  │ uses          │ imports AdminCap
  │                │
item  (one-time witness → Publisher)
  ▲                ▲
  │ imports        │ reads item_type
  │                │
equipment (DOF orchestrator — mutates Character, consumes/returns Item)

arena     (self-contained — only Sui framework)
marketplace (uses Item + Publisher from item.move + Kiosk/TransferPolicy from framework)
```

### Tests

- `contracts/tests/character_tests.move` — only test file.

---

## 2. ON-CHAIN — data that lives there

### Character NFT

- **Shape**: shared object.
- **Soulbound?**: YES — no `store` ability on `Character` struct, so cannot be wrapped or transferred. `owner: address` field records who controls it.
- **Mutability**: freely modified via `&mut Character` references inside the allowed entry functions. Shared object → any tx can read; mutations gated by owner check or AdminCap.
- **Discovery**: via `CharacterCreated` event query (`suix_queryEvents` with `MoveEventType = <pkg>::character::CharacterCreated`).
- **Dynamic fields attached**: `b"fight_lock_expires_at" → u64`, and up to 10 **Dynamic Object Fields** (one per equipment slot).

### Item NFT

- **Shape**: owned (`has key, store`).
- **Tradeable?**: YES. Freely transferable by owner wallet. Listable in Kiosk. Wrappable.
- **Where it lives at any moment** (mutually exclusive):
  - In a wallet (owner = address) — inventory, available to equip or list.
  - As a **Dynamic Object Field** on a Character (owner = Character UID) — equipped. Cannot be passed as a tx input until unequipped.
  - In a **Kiosk** (owner = Kiosk UID) — listed for sale or placed but delisted.
- **Mutability**: no entry function mutates existing Items after mint — fields are effectively immutable post-`mint_item_admin`.

### Dynamic Object Fields on Character (equipment slots)

One DOF per occupied slot, all keyed by UTF-8 bytes of the slot name:

| DOF key | Value type | Notes |
|---|---|---|
| `"weapon"` | `Item` | itemType must be 1 (WEAPON) — validated in `equip_weapon_v2` |
| `"offhand"` | `Item` | itemType 1 (dual-wield weapon) or 2 (SHIELD) |
| `"helmet"` | `Item` | itemType 3 |
| `"chest"` | `Item` | itemType 4 |
| `"gloves"` | `Item` | itemType 5 |
| `"boots"` | `Item` | itemType 6 |
| `"belt"` | `Item` | itemType 7 |
| `"ring_1"` | `Item` | itemType 8 |
| `"ring_2"` | `Item` | itemType 8 |
| `"necklace"` | `Item` | itemType 9 |

These DOFs also drive the `Character.<slot>: Option<ID>` redundant pointer fields — both are maintained in lock-step by `equip_*_v2` / `unequip_*_v2`.

### WagerMatch (shared)

- **Shape**: shared object with owned `Balance<SUI>` inside.
- **Lifecycle state machine** (`status: u8`):
  ```
  created (WAITING=0)
     │ accept_wager
     ▼
  (ACTIVE=1) ── settle_wager ──► (SETTLED=2)
     │                              ▲
     │ admin_cancel_wager            │
     │ cancel_expired_wager          │
     │ cancel_wager (A only, WAITING│ only)
     └──────────────────────────────┘
  ```
- **Timeouts**: 10 min in WAITING (expired refund to A), 10 min in ACTIVE (expired 50/50 split).
- **Payout math**: total escrow on settle = 2× stake. Winner gets 95%, TREASURY gets 5%.

### Kiosk + TransferPolicy

- **Kiosk**: shared object owned by `KioskOwnerCap` holder. One per player (typical).
- **TransferPolicy<Item>**: shared object, one per package. Created once via `setup_transfer_policy(Publisher, ctx)`.
- **TransferPolicyCap<Item>**: owned by publisher wallet; controls policy rules.
- **Royalty enforcement**: via rules attached to TransferPolicy (e.g., `transfer_policy::add_rule`). Current contract sets `ROYALTY_BPS = 250` (2.5%) as a constant but policy rule wiring is scripted at setup time, not in the contract.
- **Listing fee**: 0.01 SUI per `list_item_with_fee` call, routed to `treasury` arg (currently the TREASURY wallet). **Non-refundable** on delist.

---

## 3. OFF-CHAIN — server (port 3001)

### Inbound WebSocket messages (client → server)

Dispatched in `server/src/ws/handler.ts:162-238`. Type declared as `ClientMessage = { type: string } & Record<string, any>` in `server/src/types.ts:207` (untagged).

| Type | Purpose |
|---|---|
| `auth` | Authenticate wallet, hydrate character + DOFs, emit `auth_ok`. |
| `create_character` | Create new character (or restore from on-chain NFT). |
| `delete_character` | Delete character (blocks during active fight). |
| `get_character` | Fetch character data. |
| `allocate_points` | Spend unallocated stat points (server-only path; on-chain equivalent goes via wallet). |
| `queue_fight` | Enter matchmaking (friendly/ranked) or post wager to lobby. |
| `cancel_queue` | Leave matchmaking queue. |
| `fight_action` | Submit attack+block zone selections for current turn. |
| `wager_accepted` | Player B signed on-chain `accept_wager` — register fight. |
| `get_wager_lobby` | Fetch all open wagers. |
| `cancel_wager_lobby` | Creator cancels own wager (server invokes `admin_cancel_wager` on-chain). |
| `equip_item` | Server-only equip (legacy NPC items); on-chain items rejected. |
| `unequip_item` | Server-only unequip (legacy NPC items); on-chain items rejected. |
| `buy_shop_item` | Purchase NPC-shop item with in-memory gold balance. |
| `get_shop` | Fetch NPC shop catalog. |
| `get_inventory` | Fetch server-side inventory. |
| `get_leaderboard` | Top 100 by rating. |
| `get_fight_history` | Character's fight history. |
| `get_online_players` | Presence list. |
| `chat_message` | Send global/whisper message (1s rate limit). |
| `spectate_fight` | Join spectator list on an active fight (or list all). |

### Outbound WebSocket messages (server → client)

Type declared in `frontend/src/types/ws-messages.ts`. Triggered across `handler.ts`, `fight-room.ts`, `chat.ts`, `index.ts`.

| Type | Trigger |
|---|---|
| `auth_ok` | Successful auth. |
| `error` | Any rejection / validation failure. |
| `character_data` | `get_character`. |
| `character_created` | `create_character`. |
| `character_deleted` | `delete_character`. |
| `character_updated_onchain` | Server's `update_after_fight` tx landed → tells client to refetch NFT. |
| `queue_joined` / `queue_left` | Matchmaking state changes. |
| `fight_start` | Opponent matched or wager accepted. |
| `turn_start` | New turn, includes deadline (20s). |
| `fight_action_ack` | Server received zone pick. |
| `turn_result` | Turn resolved (damage, blocks, crits, HP after). |
| `fight_end` | Winner/loser/draw, loot result. |
| `wager_settled` | `settle_wager` tx landed (with digest). |
| `wager_accept_required` | Player B matched for a wager — must sign accept. |
| `wager_accept_timeout` | Player B missed the accept window. |
| `wager_lobby_list` / `wager_lobby_added` / `wager_lobby_removed` | Lobby feed. |
| `item_equipped` / `item_unequipped` | Legacy NPC item flows. |
| `item_purchased` | Shop purchase. |
| `shop_data` / `inventory` / `leaderboard` / `fight_history` | Data fetches. |
| `online_players` / `player_joined` / `player_left` / `player_status_changed` | Presence. |
| `chat` | Chat broadcast. |
| `spectate_update` | Live fight state updates to spectators. |
| `marketplace_data` / `item_listed` / `item_delisted` / `item_bought` | Marketplace feed (stubbed; server routes exist but not fully wired). |
| `challenge_received` / `challenge_accepted` / `challenge_declined` | Direct challenges (stubbed). |
| `points_allocated` | Stat allocation landed. |

### REST endpoints

All defined in `server/src/index.ts`.

| Method | Path | Purpose | Mainnet gate |
|---|---|---|---|
| GET | `/health` | Liveness, uptime, online count. | open |
| GET | `/api/leaderboard` | Top 100. | open |
| GET | `/api/shop` | NPC catalog. | open |
| GET | `/api/character/:walletAddress` | Character by wallet. | open |
| GET | `/api/fights/:fightId` | Completed fight details. | open |
| POST | `/api/admin/grant-xp` | Grant XP to a wallet (testnet dev tool). | **403 on mainnet** (gated by `CONFIG.SUI_NETWORK !== 'mainnet'`) |
| POST | `/api/admin/adopt-wager` | Recover orphaned on-chain WagerMatch into lobby. | **403 on mainnet** |

### Supabase tables

Accessed via `supabase.from('...')` in `server/src/data/*.ts`.

| Table | Key columns | Operations |
|---|---|---|
| `characters` | `wallet_address (PK)`, `name`, `strength/dexterity/intuition/endurance`, `level`, `xp`, `gold`, `rating`, `wins`, `losses`, `unallocated_points`, `created_at` | upsert, select, delete |
| `items_inventory` | `id (PK)`, `owner_wallet (FK)`, `item_name`, `item_type`, `rarity`, `level_req`, 13× stat bonus columns, `damage_min/max`, `image_url`, `equipped_slot`, `is_onchain`, `onchain_id`, `created_at` | delete-by-owner+is_onchain, insert bulk, select |
| `fight_history` | `id (PK = fight UUID)`, `winner_wallet`, `loser_wallet`, `turns`, `fight_type`, `winner_xp`, `loser_xp`, `winner_elo_change`, `loser_elo_change`, `created_at` | insert, select (OR filter by winner/loser) |

All writes are **fire-and-forget** (async, non-blocking) so the game loop never stalls on DB roundtrips.

### In-memory server state

| Map / set | Location | Purpose |
|---|---|---|
| `connectedClients: Map<string, ConnectedClient>` | `ws/handler.ts:51` | Live WS sessions keyed by client UUID; stores wallet, character ref, current fight ID. |
| `wagerLobby: Map<string, WagerLobbyEntry>` | `ws/handler.ts:882` | Open wagers awaiting Player B. Swept every 30s for 10-min expiry. |
| `activeFights: Map<string, FightState>` | `ws/fight-room.ts:38` | Currently resolving fights; includes turn state, fighter HP, spectator list. |
| `finishedFights: Map<string, FightState>` | `ws/fight-room.ts:39` | Archived fights for REST queries. |
| `clientsRef` | `ws/fight-room.ts:42` | Backref to `connectedClients` set at startup. |
| `characters: Map<string, Character>` | `data/characters.ts:9` | In-memory character store keyed by character UUID. |
| `walletToCharacter: Map<string, string>` | `data/characters.ts:11` | Wallet → character UUID index. |
| `fightHistories: Map<string, FightHistoryEntry[]>` | `data/characters.ts:13` | Per-character history cache. |
| `clients: Map<string, ConnectedClient>` | `ws/chat.ts:8` | Chat clients keyed by wallet address. |
| `queue: QueueEntry[]` (inside `MatchmakingQueue`) | `game/matchmaking.ts` | Pending queue; scanned every 2s; rating window expands 200 ± 50 every 10s. |

### External calls the server makes

#### Sui JSON-RPC

- Base URL: `https://fullnode.mainnet.sui.io:443` or `https://fullnode.testnet.sui.io:443` based on `CONFIG.SUI_NETWORK`.
- `suix_queryEvents` — find Character NFT id by owner via `CharacterCreated` events (`utils/sui-settle.ts:127-159`).
- `sui_getObject` — fetch WagerMatch to verify status (`utils/sui-settle.ts:165-189` and `index.ts:166-176` for `/api/admin/adopt-wager`).
- `sui_getObject` — fetch Character for DOF hydration (`utils/sui-read.ts`, called from `handleAuth` and `createFight`).
- `sui_multiGetObjects` — batch hydrate Items for populated DOF slots (`utils/sui-read.ts`).

#### Sui CLI (`execSync`)

All in `utils/sui-settle.ts`. Active CLI address must be TREASURY.

- `sui client call --package <CALL_PACKAGE> --function settle_wager ...` — wager payout. Fire-and-forget from `fight-room.ts`.
- `sui client call --package <CALL_PACKAGE> --function admin_cancel_wager ...` — on disconnect, timeout, creator cancel.
- `sui client call --package <CALL_PACKAGE> --function update_after_fight ...` — persist XP/rating to NFT. AdminCap required.
- `sui client call --package <CALL_PACKAGE> --function set_fight_lock ...` — set/clear DOF on Character at fight start/end. AdminCap required.

Shell environment: `PATH` extended with `~/.local/bin` inside server process.

#### Supabase

Via `@supabase/supabase-js` SDK singleton (`data/supabase.ts`). See tables above.

#### Other HTTP

None.

### Env vars consumed

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP+WS listen port. |
| `SUPABASE_URL` | `''` | Optional; falls back to in-memory if absent. |
| `SUPABASE_KEY` | `''` | Same. |
| `SUI_NETWORK` | `testnet` | Picks RPC URL + gates testnet-only endpoints. |
| `SUI_PACKAGE_ID` | `0x07fd…1d` | Type anchor (events, struct refs). |
| `SUI_UPGRADED_PACKAGE_ID` | `0x5f90…6b` | `moveCall` target. |
| `PLATFORM_TREASURY` | `0xdbd3…d60` | Fee recipient (matches on-chain hardcoded TREASURY). |
| `ADMIN_CAP_ID` | `0xff99…505` | Object ID passed as first arg to admin calls. |
| `DEBUG_WS` | unset | If `'1'` or unset (not `'0'`), logs every inbound WS message. |
| `HOME` | (system) | Used to locate `sui` binary. |

### File map (server/src/)

| File | Purpose |
|---|---|
| `index.ts` | HTTP+WS startup, REST endpoint definitions, graceful shutdown. |
| `types.ts` | Shared TypeScript interfaces (Character, FightState, messages). |
| `config.ts` | Env vars + game constants. |
| `ws/handler.ts` | Inbound WS dispatch; client registry; auth+DOF hydration; equip legacy path; wager lobby. |
| `ws/fight-room.ts` | Fight lifecycle (`createFight`, turn loop, resolve, settle). |
| `ws/chat.ts` | Rate-limited chat. |
| `data/characters.ts` | In-memory character store + CRUD. |
| `data/db.ts` | Supabase save/load (fire-and-forget). |
| `data/supabase.ts` | SDK client singleton. |
| `data/items.ts` | Static NPC shop catalog. |
| `data/leaderboard.ts` | On-demand ranking. |
| `game/matchmaking.ts` | Queue + auto-match tick. |
| `game/combat.ts` | Turn resolution math (damage, armor, crit, dodge, shield). |
| `game/loot.ts` | Loot RNG. |
| `utils/sui-settle.ts` | On-chain calls (settle/cancel wager, update character, set fight lock). |
| `utils/sui-read.ts` | DOF reader (`fetchEquippedFromDOFs`, `applyDOFEquipment`). |
| `utils/elo.ts` | ELO delta + XP reward math. |

---

## 4. OFF-CHAIN — frontend (port 3000)

### App entry + routing

- `src/app/page.tsx` — server component, dynamically imports `ClientApp` with `ssr: false`.
- `src/app/layout.tsx` — root layout (fonts, metadata, dark theme).
- `src/app/client-app.tsx` — wires `DAppKitProvider` → `GameProvider` → `GameScreen`.
- `src/app/game-provider.tsx` — owns `useReducer(gameReducer)`, handles every `ServerMessage` type, runs three on-chain fetch effects (character NFT, owned items, kiosk items), and fires the "fight-with-dirty" toast.
- **Routing**: no Next.js subroutes wired. Area selection is client-side via `TownNav` + `state.currentArea` (`character|arena|marketplace|tavern|hall_of_fame`). Directories `src/app/arena/`, `/character/`, etc. are empty placeholders.

### Main UI components

#### Character
- `character-profile.tsx` — doll + stats + combat statistics + Save Loadout header buttons. **Reads `state.pendingEquipment`**. Dirty slot indicators from `dirtySlots` set (amber ring + corner dot). Save button gated by `inFight`.
- `stat-allocate-modal.tsx` — allocate unallocated points. Signs `buildAllocateStatsTx`.
- `character-creation.tsx` — initial stat allocation UI. Signs `buildMintCharacterTx`.

#### Fight
- `fight-arena.tsx` — main combat UI. **Reads `state.committedEquipment`** (not pending) so stats reflect what the chain is actually fighting with (D4).
- `matchmaking-queue.tsx` — queue dropdown + wager lobby browser. Signs `buildCreateWagerTx` / `buildAcceptWagerTx` / `buildCancelWagerTx`.
- `zone-selector.tsx`, `turn-timer.tsx`, `hp-bar.tsx`, `damage-log.tsx`, `hit-animation.tsx`, `fight-result-modal.tsx`, `spectate-view.tsx` — sub-surfaces.

#### Items
- `inventory.tsx` — unified list of server items + on-chain items. **Hides items that appear in pending OR committed** (union guard against "owned by object" PTB errors).
- `equipment-grid.tsx` — alternative grid view (dead code per MAINNET_PREP; still reads `pendingEquipment`).
- `item-card.tsx`, `item-detail-modal.tsx`, `npc-shop.tsx`.

#### Marketplace / Social / UI
- `marketplace/marketplace-browser.tsx` — Kiosk browser (wiring incomplete).
- `social/leaderboard.tsx`, `fight-history.tsx`, `player-list.tsx`, `challenge-popup.tsx`, `chat-panel.tsx`.
- `layout/game-screen.tsx`, `navbar.tsx`, `town-hub.tsx` — shell.
- `ui/*` — button, card, badge, modal, error-toast, stat-bar, progress-bar.

### Global state (`useGameStore.ts`)

`GameState` fields:

- **Connection**: `socket`.
- **Character**: `character`, `inventory`, `onChainItems`, `onChainCharacter`.
- **Loadout**: `committedEquipment: EquipmentSlots`, `pendingEquipment: EquipmentSlots`.
- **Fight**: `fight`, `fightQueue`, `lootResult`.
- **Social**: `chatMessages` (capped 200), `onlinePlayers`.
- **Data**: `shopItems`, `leaderboard`, `fightHistory`, `marketplaceListings`.
- **Spectating**: `spectatingFight`.
- **Challenges**: `pendingChallenge`, `wagerLobby`, `pendingWagerAccept`.
- **UI**: `currentArea`, `errorMessage`, `errorTimestamp`, `errorSticky`, `onChainRefreshTrigger`.

`GameAction` union (notable cases):

- `SET_CHARACTER` — rebases `committedEquipment` from chain-hydrated character; rebases `pendingEquipment` iff committed changed OR pending empty with incoming items (fix for 2026-04-21 ring2 fall-through bug).
- `STAGE_EQUIP` / `STAGE_UNEQUIP` / `STAGE_DISCARD` — mutate `pendingEquipment` only.
- `COMMIT_SAVED` — after save PTB lands, snaps `pendingEquipment := committedEquipment := action.committed` → `isDirty` goes false.
- `BUMP_ONCHAIN_REFRESH` — bumps counter to refresh owned items + on-chain character.
- `SET_ERROR` — optional `sticky` flag for financial events requiring user dismissal.

### Hooks

| Hook | Purpose | Returns |
|---|---|---|
| `useGame()` | Context accessor. | `{ state, dispatch }`. |
| `useGameSocket(walletAddress)` | WS lifecycle; auto-reconnect (3s, skipped on code 4001). | `{ send, addHandler, connected, authenticated }`. |
| `useEquipmentActions()` | Loadout staging + save PTB; humanizes Move abort codes. | `{ stageEquip, stageUnequip, stageDiscard, saveLoadout, signing, isDirty, dirtySlots }`. |

### Wallet integration points (`CurrentAccountSigner`)

| Site | Tx | Builder |
|---|---|---|
| `character-creation.tsx:98` | Create character | `buildMintCharacterTx` |
| `stat-allocate-modal.tsx:62` | Allocate stats | `buildAllocateStatsTx` |
| `matchmaking-queue.tsx:116` | Create wager escrow | `buildCreateWagerTx` |
| `matchmaking-queue.tsx:202` | Accept wager | `buildAcceptWagerTx` |
| `matchmaking-queue.tsx:226` | Cancel wager | `buildCancelWagerTx` |
| `useEquipmentActions.ts:206` | Save loadout (atomic multi-slot PTB) | `buildSaveLoadoutTx` |

### `lib/` files

| File | Exports |
|---|---|
| `sui-contracts.ts` | `CALL_PACKAGE`, `SUI_CLOCK`, `TREASURY_ADDRESS`, `LISTING_FEE_MIST`, tx builders (mint character, allocate stats, wager CRUD, equip/unequip/swap, create kiosk, list/delist/buy), `fetchCharacterNFT`, `fetchOwnedItems`, `fetchKioskItems`, `OnChainCharacter` type, `EquipSlotKey` type. |
| `loadout.ts` | `EQUIPMENT_SLOT_KEYS`, `EMPTY_EQUIPMENT`, `cloneEquipment`, `computeDirtySlots`, `isLoadoutDirty`, `isOnChainItem`, `toChainSlot`. |
| `loadout-tx.ts` | `buildSaveLoadoutTx(characterObjectId, committed, pending) → { tx, changedSlots, skippedNonChainSlots }`. Atomic PTB, 150M MIST gas budget. |
| `combat.ts` | `computeDerivedStats`, `getArchetype`, `getArchetypeColor`, `LEVEL_HP`, `LEVEL_WEAPON_DAMAGE` tables. |
| `sounds.ts` | Web Audio oscillator SFX: `playSound`, `playSoundIf`, `toggleSound`. |

### Env vars (frontend)

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_WS_URL` | WS server URL. |
| `NEXT_PUBLIC_SUI_PACKAGE_ID` | Original package (type anchor). |
| `NEXT_PUBLIC_SUI_UPGRADED_PACKAGE_ID` | Current package (`moveCall` targets). |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | Fee recipient for `list_item_with_fee`. |
| `NODE_ENV` | Dev-only burner wallet enable. |

---

## 5. DATA FLOW — traced wire paths per user action

### 5.1 Character creation

```
UI  character-creation.tsx:handleSubmit
  │ user picks name + 20 stat points
  │
  ├─ buildMintCharacterTx(name, str, dex, int, end)
  │    target = <CALL_PACKAGE>::character::create_character
  │
  ├─ CurrentAccountSigner.signAndExecuteTransaction(tx)
  │    └─► wallet popup ─► Sui RPC: sui_executeTransactionBlock
  │
  │  CHAIN: character.move::create_character
  │    - validates name length (≤32) + stat sum (==20)
  │    - creates shared Character { owner = tx_context::sender(ctx), ... }
  │    - emits CharacterCreated { character_id, name, owner, stats }
  │
  ├─ assertTxSucceeded(result)
  │
  └─ socket.send({ type: 'create_character', name, stats })
       │
       SERVER  handler.ts:handleCreateCharacter
         - characters.createCharacter(wallet, stats, name)
         - dbSaveCharacter(...) (fire-and-forget)
         - respond: { type: 'character_created', character }
       │
       CLIENT reducer: SET_CHARACTER
         - committedEquipment := character.equipment (all nulls on create)
         - pendingEquipment := clone of committed
```

### 5.2 Login (auth)

```
USER opens /
  │
  ├─ DAppKit detects current account → walletAddress
  │
  ├─ useGameSocket(walletAddress)
  │    - new WebSocket(NEXT_PUBLIC_WS_URL)
  │    - onopen → send { type: 'auth', walletAddress }
  │
  │  SERVER  handler.ts:handleAuth
  │    - authenticated = true
  │    - characters.getCharacterByWallet(wallet) → (memory or Supabase restore)
  │    - if character: characters.sync ...
  │    - dbLoadCharacter (async) → dbLoadItems (async) + dbLoadFightHistory (async)
  │    - IF on-chain character found (via findCharacterObjectId):
  │        dof = await fetchEquippedFromDOFs(charObjectId)
  │        applyDOFEquipment(character.equipment, dof) → log "chain has N equipped, M slot(s) synced"
  │    - respond: { type: 'auth_ok', ..., character: sanitizeCharacter(character) }
  │    - broadcast: { type: 'player_joined', player }
  │
  ├─ CLIENT reducer: SET_CHARACTER
  │    committedEquipment := character.equipment (chain truth)
  │    pendingEquipment := clone of committed  (if committed changed OR pending empty)
  │
  ├─ game-provider.tsx:useEffect(socket.authenticated)
  │    socket.send({ type: 'get_character' })
  │    socket.send({ type: 'get_online_players' })
  │    socket.send({ type: 'get_inventory' })
  │    socket.send({ type: 'get_wager_lobby' })
  │
  ├─ game-provider.tsx:useEffect(onChainRefreshTrigger)
  │    parallel:
  │      fetchOwnedItems(client, wallet)  — RPC listOwnedObjects
  │      fetchKioskItems(client, wallet)  — RPC (KioskOwnerCap → dynamic fields → Items)
  │    dispatch SET_ONCHAIN_ITEMS
  │
  └─ game-provider.tsx:useEffect(auth+!character)
       1.5s delay → fetchCharacterNFT(client, wallet) (suix_queryEvents)
       if found: socket.send({ type: 'create_character', ...nftStats })
       (server restore path — rebinds on-chain NFT to server session)
```

### 5.3 Equip item (new loadout-save flow)

```
UI click equip slot → pick item
  │
  ├─ useEquipmentActions.stageEquip(item, slot, currentSlotItem?)
  │    - if !isOnChainItem(item): socket.send({type:'equip_item', itemId, slot})
  │    - else: dispatch STAGE_EQUIP { item, slot }
  │        → pendingEquipment[slot] = item
  │        → computeDirtySlots(committed, pending) now has slot
  │        → CharacterProfile re-renders:
  │            EquipSlot gets isDirty=true (amber ring + dot)
  │            Save Loadout button appears with "(N)" count
  │
...user continues staging changes...

UI click Save Loadout button
  │
  ├─ useEquipmentActions.saveLoadout()
  │    1. buildSaveLoadoutTx(characterObjectId, committed, pending)
  │         for each dirty slot (committed[slot]?.id !== pending[slot]?.id):
  │           if committed[slot]: tx.moveCall(unequip_<slot>_v2)
  │           if pending[slot]:   tx.moveCall(equip_<slot>_v2, item)
  │         tx.setGasBudget(150_000_000)
  │
  │    2. CurrentAccountSigner.signAndExecuteTransaction(tx)
  │         └─► wallet popup
  │         └─► Sui RPC: executes PTB atomically
  │
  │       CHAIN: equipment.move (per call)
  │         owner check: character.owner == sender
  │         fight-lock check: is_fight_locked(character, clock) == false
  │         unequip_<slot>_v2:
  │           item = dof::remove(character_id, "<slot>")
  │           character.set_<slot>(None)
  │           transfer::public_transfer(item, sender)
  │           emit ItemUnequipped
  │         equip_<slot>_v2:
  │           validate itemType, level_req
  │           slot must be None
  │           character.set_<slot>(Some(item.id))
  │           dof::add(character_id, "<slot>", item)
  │           emit ItemEquipped
  │
  │    3. assertTxSucceeded(result)
  │
  │    4. dispatch COMMIT_SAVED { committed: pending }
  │         → committedEquipment := pending
  │         → pendingEquipment   := clone(pending)
  │         → dirtySlots becomes empty, Save/Discard hide
  │
  │    5. setTimeout 1s → dispatch BUMP_ONCHAIN_REFRESH
  │         → game-provider useEffect fires:
  │           fetchOwnedItems + fetchKioskItems re-query
  │           equipped items (now DOFs) drop out of the wallet-owned list
```

### 5.4 Create wager

```
UI matchmaking-queue:handleQueue (selectedType=wager)
  │
  ├─ buildCreateWagerTx(stakeAmountMist)
  │    splits stake coin from gas
  │    moveCall arena::create_wager(stakeCoin, SUI_CLOCK)
  │
  ├─ CurrentAccountSigner.signAndExecuteTransaction(tx)
  │    └─► wallet popup
  │
  │  CHAIN: arena.move::create_wager
  │    - creates shared WagerMatch { player_a=sender, stake_amount, escrow, status=WAITING }
  │    - emits WagerCreated
  │
  ├─ Extract wagerMatchId from tx result:
  │    result.Transaction.effects.changedObjects
  │    filter idOperation == "Created" AND outputOwner.$kind == "Shared"
  │
  ├─ (if extraction fails) dispatch SET_ERROR with STICKY flag
  │    "0.X SUI locked on-chain (tx Z) but app couldn't read wager ID…"
  │    → user must not retry (double-stake risk)
  │
  ├─ socket.send({ type: 'queue_fight', fightType: 'wager', wagerAmount, wagerMatchId })
  │    (note: no onChainEquipment payload post-D3-strict)
  │
  │  SERVER  handler.ts:handleQueueFight
  │    - verifies no double-wager (existing lobby entry, in-fight)
  │    - wagerLobby.set(wagerMatchId, { creatorWallet, creatorCharacterId, ... })
  │    - broadcastAll({ type: 'wager_lobby_added', entry })
  │
  └─ CLIENT reducer: ADD_WAGER_LOBBY_ENTRY
       → lobby list updates
```

### 5.5 Fight turn

```
UI fight-arena:handleSubmit (after picking zones)
  │
  ├─ socket.send({ type: 'fight_action', attackZones, blockZones })
  │
  │  SERVER  fight-room.ts:submitTurnAction
  │    - fight.currentTurnActions[side] = action
  │    - broadcast { type: 'fight_action_ack', side }
  │    - IF both sides submitted OR timer expired:
  │        combat.resolveTurn(fight)
  │          for each player:
  │            zone check → evasion roll → crit roll → damage math
  │          dual-wield handles 2 attack zones
  │          shield handles 3 block zones
  │          reduce HP
  │        broadcast { type: 'turn_result', fight, result: { playerA, playerB, hpAfter } }
  │        IF HP<=0 or turn>=max: finishFight(fight, reason)
  │        ELSE: startTurn(fight, turn+1) → broadcast turn_start with new deadline
  │
  ├─ CLIENT reducer: APPEND_TURN_RESULT
  │    → fight-arena re-renders damage log, HP bars
  │    → playSoundIf based on hit/block/dodge/crit
```

### 5.6 Fight end (wager)

```
SERVER fight-room.ts:finishFight
  │
  ├─ combat.checkFightEnd(fight)  → determine winner
  │
  ├─ compute XP + ELO deltas (utils/elo.ts)
  │
  ├─ update in-memory characters (wins/losses/xp/rating)
  │
  ├─ dbSaveFight + dbSaveCharacter (fire-and-forget)
  │
  ├─ IF wager fight:
  │    await settleWagerOnChain(wagerMatchId, winnerAddress)
  │      child_process.execSync(
  │        sui client call --package <CALL_PACKAGE>
  │          --module arena --function settle_wager
  │          --args <wagerMatchId> <winnerAddress>
  │      )
  │      [CHAIN: arena.move::settle_wager
  │        assert sender == TREASURY
  │        split escrow 95%/5% (winner/TREASURY)
  │        transfer::public_transfer both coins
  │        status → SETTLED
  │        emit WagerSettled]
  │    broadcast { type: 'wager_settled', wagerMatchId, txDigest }
  │
  ├─ parallel for each player:
  │    updateCharacterOnChain(adminCapId, characterObjectId, won, xpGain, newRating)
  │      [CHAIN: character.move::update_after_fight
  │        AdminCap-gated
  │        update wins/losses/rating/xp
  │        auto-level-up loop (emits LevelUp per level)
  │        emit FightResultUpdated]
  │    broadcast { type: 'character_updated_onchain', walletAddress }
  │
  ├─ parallel for each player:
  │    setFightLockOnChain(adminCapId, characterObjectId, 0)  ← clears lock
  │
  ├─ broadcast { type: 'fight_end', fight, loot, outcomes }
  │
  ├─ activeFights.delete(fightId)
  │  finishedFights.set(fightId, fight)
  │
  CLIENT on fight_end:
    - SET_FIGHT { fight }
    - SET_LOOT_RESULT { loot }
    - socket.send('get_character')  ← refetch updated stats
    - BUMP_ONCHAIN_REFRESH is NOT fired here; game-provider's useEffect on
      character_updated_onchain fires fetchCharacterNFT refresh instead.
```

---

## 6. TRUST BOUNDARIES

### What the server trusts the client to send

| Accepted as-is | Reason |
|---|---|
| `fight_action` zone picks | Range-validated server-side but client is trusted to pick its own zones. |
| `chat_message` content | Rate-limited (1/sec); not sanitized beyond type. |
| `walletAddress` on `auth` | Not cryptographically verified — no signature check. Implicit trust that the socket originates from the address's browser. (Mainnet gap — see MAINNET_PREP.md.) |
| Self-reported `fightType`, wager amount | Validated against server rules (min 0.1 SUI) but accepted from client. |

### What the server re-reads from chain (does NOT trust client)

| Re-read | Where | Why |
|---|---|---|
| Character equipment (DOFs) at auth | `handleAuth` → `fetchEquippedFromDOFs` → `applyDOFEquipment` | Server's in-memory state can drift; chain is authoritative. |
| Character equipment (DOFs) at fight start | `fight-room.ts::createFight` parallel fetch for both players | D3-strict: combat stats MUST derive from chain state the moment the fight begins, not from anything the client claims. Observed catching drift in live testing (3 of 5 slots changed between auth and fight start). |
| Wager status (0/1/2) on `wager_accepted` | RPC `sui_getObject` | Verify Player B actually signed `accept_wager` before starting fight. |
| Character NFT existence | `findCharacterObjectId` via events | Required before server agrees to call `update_after_fight`. |

### What the chain enforces

| Invariant | Where |
|---|---|
| Only owner can equip/unequip (not even server) | `equipment.move` owner check via `character.owner == tx_context::sender(ctx)`. |
| Only owner can allocate stat points | `character.move::allocate_points`. |
| Only AdminCap holder can `update_after_fight` / `set_fight_lock` / `mint_item_admin` | `&AdminCap` param required. |
| Only TREASURY can `settle_wager` / `admin_cancel_wager` | Hardcoded `assert!(sender == TREASURY)` in `arena.move`. |
| Only Player A can `cancel_wager` (in WAITING) | `assert!(sender == wager.player_a)`. |
| Player B ≠ Player A on accept | `ECannotJoinOwnMatch`. |
| Equip slot must be empty / unequip slot must be filled | `ESlotOccupied`, `ESlotEmpty`. |
| Item type must match slot | `EWrongItemType`. |
| Character level ≥ item level_req | `ELevelTooLow`. |
| Cannot equip/unequip during active fight | Fight-lock DF on Character; `EFightLocked` if `is_fight_locked` returns true. |
| Listing fee exactly 0.01 SUI | `list_item_with_fee` aborts `EInsufficientFee`; excess refunded. |
| Stake amounts match on accept | `EStakeMismatch`. |
| Wager payout math 95/5 | `PLATFORM_FEE_BPS = 500` with `BPS_BASE = 10_000`. |

### What the chain does NOT enforce (convention / server responsibility)

| Behavior | Enforced by |
|---|---|
| XP reward per fight | Server (`utils/elo.ts::calculateXpReward`); server can pass any value to `update_after_fight`. `MAINNET_PREP.md` flags adding a `MAX_XP_PER_FIGHT` cap on-chain. |
| ELO rating delta | Server. |
| Winner = actual combat winner | Server — it's the only one who ran the fight math. `settle_wager` trusts the `winner: address` arg unconditionally (only TREASURY can call). `MAINNET_PREP.md` flags adding `assert!(winner == player_a || winner == player_b)`. |
| Loot drop | Server. |
| Matchmaking fairness | Server. |
| Fight-lock expiry set reasonably | Server passes `expires_at_ms`; no chain cap. `MAINNET_PREP.md` flags adding a 1-hour cap. |
| Royalty collection on trades | TransferPolicy rules configured at setup; enforcement depends on which rules were attached to the policy. |
| Item stat bonus caps | No bounds on `mint_item_admin` stat args. `MAINNET_PREP.md` flags bounding them. |

### Where admin signatures are required

| Operation | Signer |
|---|---|
| `settle_wager` | TREASURY (hardcoded). |
| `admin_cancel_wager` | TREASURY (hardcoded). |
| `update_after_fight` | AdminCap-holder (== TREASURY by convention). |
| `set_fight_lock` | AdminCap-holder. |
| `mint_item_admin` | AdminCap-holder. |
| `setup_transfer_policy` | Publisher-holder. |
| `delist_item`, `list_item_with_fee` | KioskOwnerCap holder (player). |
| All `equip_*_v2` / `unequip_*_v2` | Character owner (player). |
| `allocate_points` | Character owner (player). |
| `create_wager` / `accept_wager` / `cancel_wager` (A only) / `cancel_expired_wager` (anyone) | Any wallet with enough SUI. |

### Active bytecode exposure (testnet)

Per `MAINNET_PREP.md`: the original package ID `0x07fd…1d` still has the v1 vulnerable bytecode callable (e.g. the old `equip_*` without owner check, old `mint_item` without AdminCap). The upgrade only routes calls made against the upgraded package ID. **Mainnet must be a fresh `publish`, not an `upgrade` of the testnet package.**
