# SUI Combats — Frontend Function Reference

> Comprehensive breakdown of every page, component, WebSocket message, and on-chain transaction the frontend can produce. Source of truth for frontend redesign and documentation. Last updated 2026-04-18.

---

## Table of Contents

1. [Top-Level Screen Routing](#top-level-screen-routing)
2. [Navbar](#navbar)
3. [Character Tab](#character-tab-default-landing)
4. [Arena Tab](#arena-tab)
5. [Marketplace Tab](#marketplace-tab)
6. [Tavern Tab](#tavern-tab)
7. [Hall of Fame Tab](#hall-of-fame-tab)
8. [Fight Arena (Full-Screen)](#fight-arena-full-screen)
9. [Spectate View](#spectate-view)
10. [Global Modals & Popups](#global-modals--popups)
11. [Key End-to-End Flows](#key-end-to-end-flows)
12. [Full WebSocket Message Reference](#full-websocket-message-reference)
13. [Full On-Chain Transaction Reference](#full-on-chain-transaction-reference)

---

## Top-Level Screen Routing

File: `frontend/src/components/layout/game-screen.tsx`

The root game screen renders one of several states based on `useGame()` state + wallet:

| State | Condition | UI Rendered |
|---|---|---|
| **Disconnected** | `!account` | Landing hero: logo + "Connect your Sui wallet to begin" |
| **In fight** | `fight.status === "active"` | `<FightArena />` full-screen |
| **Fight finished** | `fight.status === "finished"` | `<FightArena />` + result modal |
| **Spectating** | `spectatingFight != null` | `<SpectateView />` |
| **No character** | connected but `character == null` | `<CharacterCreation />` |
| **Default (town)** | connected + character exists | `<Navbar />` + `<TownNav />` + tab content |

A testnet banner ("characters and items reset on server restart") sits above `<TownNav />`.

---

## Navbar

File: `frontend/src/components/layout/navbar.tsx`

Always rendered at the top. Contains:
- "SUI**Combats**" wordmark
- Sui wallet connect button (from `@mysten/dapp-kit-react`) — displays truncated address when connected
- Optional gold/SUI balance indicator (wallet-side)

No WebSocket messages. No on-chain transactions besides the wallet connect handshake.

---

## Character Tab (default landing)

File: `frontend/src/components/layout/game-screen.tsx` → `case "character"`
Layout: 3-column grid. Left 2/3 → profile + fight history. Right 1/3 → inventory + Reset.

### 1. CharacterProfile
File: `frontend/src/components/character/character-profile.tsx`

**Displays:**
- **Header row**: character name, level badge (`Lv.X`), archetype label (Tank/Crit/Evasion/Hybrid, color-coded), ELO rating badge
- **Equipment doll** (left panel): framed dark silhouette with 10 equipment slots positioned around it:
  - Helmet (top-center)
  - Weapon (left)
  - Offhand (right)
  - Chest (below silhouette)
  - Gloves (bottom-left)
  - Boots (bottom-right)
  - Accessory row below: Belt, Ring1, Ring2, Necklace
  - Each slot shows item's `imageUrl` or fallback icon, colored by rarity
- **Primary Attributes** (right panel): STR / DEX / INT / END bars with base + equipment bonuses (green `(+N)` suffix), width proportional to total/20
- **+N points to allocate** button (pulses amber) when `unallocatedPoints > 0`
- **Combat Statistics grid**: HP / ATK / Crit% / Crit× / Evasion / Armor / Defense (derived via `computeDerivedStats`)
- **XP bar**: current XP, threshold for next level, progress fill
- **Win / Loss / Win%** record

**Interactions:**
- **Click equipped slot** → opens `ItemDetailModal` with stats + `Unequip` button
- **Click empty slot** → opens `Modal` listing equippable items from `inventory` + `onChainItems` (filtered by `SLOT_TO_ITEM_TYPE[slot]` and `levelReq <= character.level`, excluding kiosk items)
- **Click `+N points to allocate`** → opens `StatAllocateModal`

**WebSocket messages sent:**
- `equip_item { itemId, slot }` — for server-side items
- `unequip_item { slot }` — for server-side items
- `allocate_points { strength, dexterity, intuition, endurance }` — always, after any on-chain tx

**WebSocket messages received:**
- `character_data`, `character_created`, `points_allocated`, `item_equipped`, `item_unequipped` → update `character` in store

**On-chain transactions:**
- Equip/unequip for **on-chain items** is purely client-side (no tx) — moves item between `onChainItems` array and `onChainEquipped` map. Stats apply in combat via `onChainEquipment` payload sent with `queue_fight`.
- `allocate_points` Move call (if `characterObjectId` known) — see [Stat Allocation Flow](#stat-allocation-flow)

### 2. FightHistory
File: `frontend/src/components/social/fight-history.tsx`

**Displays:** last N fights involving this player, each row showing opponent name, result (W/L), XP/rating change, wager amount if any, timestamp.

**WebSocket messages sent:**
- `get_fight_history` (on mount)

**WebSocket messages received:**
- `fight_history { fights: FightHistoryEntry[] }`

### 3. Inventory (right sidebar)
File: `frontend/src/components/items/inventory.tsx`

**Displays:** merged list of server items + on-chain Item NFTs (deduped by ID, on-chain wins). Kiosk items show a "Listed" badge and aren't equippable while listed.

**Interactions:**
- Click item → `ItemDetailModal` with stats + actions (Equip if compatible slot empty, List on Market if owned, etc.)

**WebSocket messages sent:** `get_inventory` (via `GameProvider` on auth)
**WebSocket messages received:** `inventory { items }`

### 4. ResetCharacterButton
Inline in `game-screen.tsx`. Confirmation flow:
1. Click "Reset Character (migrate to current package)"
2. Warning card appears with `Confirm Reset` + `Cancel`
3. On confirm → sends `delete_character`

**Server response:** `character_deleted` → clears `character` and `onChainCharacter` in store. User is redirected to `<CharacterCreation />`.

---

## Arena Tab

File: `frontend/src/components/layout/game-screen.tsx` → `case "arena"`
Contains: `<HowToPlayButton />` + `<MatchmakingQueue />`.

### HowToPlayButton
Opens a wide modal explaining:
- 5-zone system (Head / Chest / Stomach / Belt / Legs)
- Block coverage per weapon (2 / 3 / 1)
- Stat counter triangle (Tank > Evasion > Crit > Tank)

### MatchmakingQueue
File: `frontend/src/components/fight/matchmaking-queue.tsx`

**Three fight-type cards:**
| Type | Description | On-chain? |
|---|---|---|
| **Friendly** | No stakes, just practice | No |
| **Ranked** | ELO rating on the line | No |
| **Wager** | Stake real SUI on the outcome | Yes — lock escrow |

**Queue state (friendly / ranked):**
- Click a type → highlights
- Click "Enter Queue" → sends `queue_fight { fightType, onChainEquipment }`
- While queued: spinner "Finding opponent..." + `Cancel` button → sends `cancel_queue`

**Wager flow — Create:**
1. Select `Wager` card
2. Input stake in SUI (min 0.1)
3. Click "Create Wager & Lock SUI" → **wallet popup**: `create_wager(stake, clock)` Move call
4. Parse `WagerMatch` object ID from tx result (`changedObjects` → shared output)
5. Send `queue_fight { fightType: "wager", wagerAmount, wagerMatchId, onChainEquipment }`
6. Server adds entry to lobby; own entry pinned + amber-tinted

**Wager flow — Accept (from lobby):**
1. See list of open wagers (creator name, level, ELO, stat build `S#D#I#E#`, wager amount, time ago)
2. Click `Accept` on another player's wager → **wallet popup**: `accept_wager(wager, stake, clock)`
3. Send `wager_accepted { wagerMatchId, txDigest }`
4. Server matches and starts fight (`fight_start` message)

**Wager flow — Cancel own:**
1. On own lobby entry, `Cancel` button is shown
2. Click → **wallet popup**: `cancel_wager(wager)` Move call
3. Send `cancel_wager_lobby { wagerMatchId }`

**WebSocket messages sent:**
- `queue_fight { fightType, wagerAmount?, wagerMatchId?, onChainEquipment? }`
- `cancel_queue`
- `wager_accepted { wagerMatchId, txDigest }`
- `cancel_wager_lobby { wagerMatchId }`

**WebSocket messages received:**
- `queue_joined { fightType }`
- `queue_left`
- `wager_lobby_list { entries }` (initial)
- `wager_lobby_added { entry }`
- `wager_lobby_removed { wagerMatchId }`
- `wager_accept_required { wagerMatchId, stakeAmount, playerAName, playerAWallet }` (Player B prompt — currently auto-handled)
- `wager_accept_timeout { wagerMatchId }`
- `wager_settled { txDigest, wagerMatchId }` (post-fight info)
- `fight_start { fight }` → transitions to full-screen fight

**On-chain transactions:**
- `arena::create_wager(stake: Coin<SUI>, clock) → WagerMatch (shared)`
- `arena::accept_wager(wager, stake: Coin<SUI>, clock)`
- `arena::cancel_wager(wager)` (Player A only, waiting state only)
- `arena::cancel_expired_wager(wager, clock)` (safety net; anyone after 10min)

**Wager math:** winner gets 95%, treasury gets 5% (settled via `settle_wager` by admin/TREASURY after fight completes).

---

## Marketplace Tab

File: `frontend/src/components/layout/game-screen.tsx` → `case "marketplace"`
Layout: 3-column. Left 2/3 → `MarketplaceBrowser`. Right 1/3 → `NpcShop` + `Inventory`.

### MarketplaceBrowser
File: `frontend/src/components/marketplace/marketplace-browser.tsx`

**Displays:** all active Kiosk listings from other players. Each card shows item image, name, rarity, stats, seller, price in SUI.

**Interactions:**
- Click listing → `ItemDetailModal` with `Buy` button
- **Kiosk UI is currently partial** — kiosk contracts deployed but buy-flow not fully wired (see KNOWN LIMITATIONS).

**WebSocket messages sent:**
- `get_marketplace`
- `list_item { itemId, price }` (list one of your items)
- `delist_item { listingId }`
- `buy_listing { listingId }`

**WebSocket messages received:**
- `marketplace_data { listings }`
- `item_listed { listing }`
- `item_delisted { listingId }`
- `item_bought { listing }`

**On-chain transactions:** (planned — not fully wired in UI yet)
- Kiosk `place` / `list` / `purchase` via `@mysten/sui` Kiosk SDK
- `TransferPolicy` enforces 2.5% royalty

### NpcShop
File: `frontend/src/components/items/npc-shop.tsx`

**Displays:** grid of Common/Uncommon items for sale (server-managed). Price in gold.

**Interactions:**
- Click item → `ItemDetailModal` with `Buy` button → sends `buy_shop_item { itemId }`

**WebSocket messages sent:** `get_shop`, `buy_shop_item { itemId }`
**WebSocket messages received:** `shop_data { items }`, `item_purchased { item, character }`

### Inventory (right sidebar)
Same component as Character tab — your owned items.

---

## Tavern Tab

File: `frontend/src/components/layout/game-screen.tsx` → `case "tavern"`
Layout: 3-column. Left 2/3 → `ChatPanel`. Right 1/3 → `PlayerList`.

### ChatPanel
File: `frontend/src/components/social/chat-panel.tsx`

**Displays:**
- Scrollable message list (last 200)
- Message types: `global`, `whisper`, `system`
- Whisper messages color-coded differently
- AI bot "Big Bad Claude" posts trash-talk

**Interactions:**
- Text input with send button
- `/w <name> message` for whispers (parsed client-side → `target` param)

**WebSocket messages sent:** `chat_message { content, target? }`
**WebSocket messages received:** `chat { message: ChatMessage }`

### PlayerList
File: `frontend/src/components/social/player-list.tsx`

**Displays:** all online players with status indicators (`idle` / `queued` / `in_fight` / `spectating`).

**Interactions:**
- Click a player → context actions:
  - **Challenge** (opens `ChallengePopup` on target)
  - **Whisper** (pre-fills chat input)
  - **Spectate** (if status == `in_fight`)

**WebSocket messages sent:**
- `get_online_players`
- `challenge_player { targetAddress, fightType }`
- `spectate_fight { fightId }`

**WebSocket messages received:**
- `online_players { players }` (initial)
- `player_joined { player }`
- `player_left { walletAddress }`
- `player_status_changed { walletAddress, status }`

---

## Hall of Fame Tab

File: `frontend/src/components/layout/game-screen.tsx` → `case "hall_of_fame"`

### Leaderboard
File: `frontend/src/components/social/leaderboard.tsx`

**Displays:** top players ranked by ELO. Each row: rank, character name, level, wins/losses, ELO rating, win%.

**WebSocket messages sent:** `get_leaderboard` (on mount)
**WebSocket messages received:** `leaderboard { entries }`

No interactions besides scroll. No on-chain txs.

---

## Fight Arena (full-screen)

File: `frontend/src/components/fight/fight-arena.tsx`
Rendered when `fight.status === "active"` or `"finished"` (replaces town hub entirely).

**Displays:**
- **Top bar**: HP bars (both players), turn counter, turn timer (60s countdown), wager amount (if any)
- **Center**: fighter silhouettes (left = me, right = opponent) with equipment slots around them showing `imageUrl`s; battle log between them
- **Bottom**: `ZoneSelector` (5 zones: Head / Chest / Stomach / Belt / Legs) + `LOCK IN` button

**Attack / block constraints (derived from equipped offhand):**
| Gear | Max Attacks | Max Blocks |
|---|---|---|
| Shield equipped | 1 | 3 (adjacent, circular) |
| Dual wield (weapon in offhand) | 2 | 1 |
| Regular / two-handed | 1 | 2 (adjacent, circular) |

**Interactions:**
- Click zone in attack row → toggle attack (caps at `maxAttacks`)
- Click zone pair in block row → select adjacent block (caps at `maxBlocks`)
- `LOCK IN` (enabled only when selections match max counts) → sends `fight_action`
- After lock: "LOCKED IN / Waiting..." state; cleared on next `turn_start`

**WebSocket messages sent:**
- `fight_action { attackZones, blockZones }`
- `get_character` (auto-sent after `fight_end` to refresh stats)

**WebSocket messages received:**
- `fight_start { fight }`
- `turn_start { turn, deadline }`
- `turn_result { result: TurnResult, fight }` (plays hit / block / dodge / crit sounds)
- `fight_end { fight, loot }` (plays victory/defeat)
- `character_updated_onchain` (server confirms on-chain XP/rating update, frontend re-fetches `fetchCharacterNFT`)

**On-chain transactions:** None from frontend during fight. Server-side:
- Server calls `character::update_after_fight(admin, character, won, xp_gained, new_rating, clock)` for both players (AdminCap)
- For wager fights: server calls `arena::settle_wager(wager, winner)` (TREASURY signs) → 95% to winner, 5% treasury

### FightResultModal
File: `frontend/src/components/fight/fight-result-modal.tsx`

Appears on `fight_end`. Shows:
- Win/Lose banner
- XP gained
- ELO change (+/-)
- Loot box rewards (if won)
- Wager payout (if applicable)
- Close button → returns to town (Character tab)

---

## Spectate View

File: `frontend/src/components/fight/spectate-view.tsx`
Rendered when `spectatingFight != null`. Read-only view of another fight:
- HP bars, turn counter
- Battle log (as it streams in via `spectate_update`)
- No zone selector
- `Stop Spectating` button → sends `stop_spectating`

**WebSocket messages received:** `spectate_update { fight }`

---

## Global Modals & Popups

### StatAllocateModal
File: `frontend/src/components/character/stat-allocate-modal.tsx`

**Displays:** `+` / `-` buttons for each stat (STR/DEX/INT/END), remaining counter, base + allocation display (e.g. "(5 + 2)").

**Interactions:**
- Adjust allocations
- Click `Allocate Points`:
  - If `characterObjectId` known: **wallet popup** for `allocate_points(character, str, dex, int, end)` Move call → re-fetch on-chain character
  - Always: send `allocate_points` WebSocket message to server

### ItemDetailModal
File: `frontend/src/components/items/item-detail-modal.tsx`
Shows item: image, name, rarity, all stat bonuses, level req, class req, durability. Actions slot is contextual (`Equip`, `Unequip`, `Buy`, `List`, `Sell`).

### ChallengePopup
File: `frontend/src/components/social/challenge-popup.tsx`
Appears on `challenge_received`. Shows challenger name + fight type. Buttons: `Accept` / `Decline`.

**WebSocket messages sent:** `accept_challenge { challengeId }` or `decline_challenge { challengeId }`
**WebSocket messages received:** `challenge_accepted { fight }`, `challenge_declined`

### ErrorToast
File: `frontend/src/components/ui/error-toast.tsx`
Dismissable toast at top. Shown whenever `errorMessage` set in store. Auto-hides after a few seconds.

---

## Key End-to-End Flows

### Character Creation + Minting

1. User connects wallet → `GameProvider` auto-sends `auth { walletAddress }`
2. Server checks DB for existing character. If none, also checks on-chain:
   - Frontend queries `CharacterCreated` events for `owner == wallet` via JSON-RPC
   - If event found → fetches shared `Character` object, restores via `create_character` WebSocket call
3. If no character anywhere → renders `<CharacterCreation />`
4. User picks name + distributes 20 stat points (min 3 per stat, max 14 per stat)
5. Click `Create Fighter`:
   - **On-chain Step**: `buildMintCharacterTx(name, str, dex, int, end)` → `character::create_character(name, s, d, i, e, clock)` — wallet popup; creates shared `Character` object with `owner = sender`, 20 points distributed, XP=0, rating=1000
   - **Server Step**: `create_character { name, ...stats }` WebSocket → server persists in Supabase
6. Server responds `character_created { character }` → store updated, `GameScreen` renders main view → lands on Character tab

### Finding a Fight — Friendly / Ranked

1. Arena tab → select `Friendly` or `Ranked`
2. Click `Enter Queue` → `queue_fight { fightType, onChainEquipment }` (collects all `onChainEquipped` items so server applies their stats)
3. Server responds `queue_joined { fightType }` → spinner shown
4. Server matches against another queued player (or AI bot)
5. Server sends `fight_start { fight }` to both → full-screen `<FightArena />` mounts
6. [Combat loop](#combat-turn-flow)

### Finding a Fight — Wager (Create → Match → Fight → Settle)

**Phase 1 — Create:**
1. Arena tab → select `Wager`, input stake (0.1 SUI+)
2. Click `Create Wager & Lock SUI` → wallet popup signs `arena::create_wager(stake, clock)`
3. Parse shared `WagerMatch` object ID from tx `changedObjects`
4. Send `queue_fight { fightType: "wager", wagerAmount, wagerMatchId, onChainEquipment }`
5. Server adds to public lobby → broadcasts `wager_lobby_added { entry }` to all

**Phase 2 — Match:**
1. Other player sees entry in lobby
2. Click `Accept` → wallet popup signs `arena::accept_wager(wager, stake, clock)`
3. Send `wager_accepted { wagerMatchId, txDigest }`
4. Server verifies on-chain, removes entry (`wager_lobby_removed`), starts fight (`fight_start` to both)

**Phase 3 — Fight:** (same as combat flow)

**Phase 4 — Settle (server-side):**
1. On `fight_end`, server calls `arena::settle_wager(wager, winner)` with TREASURY's AdminCap
2. 95% SUI transferred to winner's wallet, 5% to treasury
3. Server broadcasts `wager_settled { txDigest, wagerMatchId }`

**Cancel paths:**
- Creator clicks own `Cancel` → `arena::cancel_wager(wager)` (waiting state only) + `cancel_wager_lobby`
- Disconnect / timeout (10min) → server calls `arena::admin_cancel_wager(wager)` or anyone can call `arena::cancel_expired_wager(wager, clock)` as safety net
- Race condition guard: can't accept wager if already in-fight or have open wager (server rejects)

### Combat Turn Flow

1. Both clients see `fight_start { fight }` with initial HP, equipment, etc. → `<FightArena />` mounts
2. Server sends `turn_start { turn: 1, deadline: timestamp }` → 60s countdown begins
3. Each player picks `attackZones` (1-2) and `blockZones` (1-3) from the 5 zones
4. Click `LOCK IN` → `fight_action { attackZones, blockZones }` sent to server
5. If player doesn't lock in before deadline → server auto-picks random zones
6. Once both locked (or timed out), server resolves turn:
   - For each hit: zone check (blocked?) → evasion roll → crit roll → damage calc
   - Deducts HP, updates fight state
7. Server sends `turn_result { result: TurnResult, fight }` → client appends to battle log, plays sound per hit (block / dodge / crit / normal hit)
8. If both HPs > 0 → loop back to `turn_start` with `turn: N+1`
9. If one HP ≤ 0 → `fight_end { fight, loot }`:
   - Server runs `update_after_fight` on both Character NFTs (persists XP, wins, losses, rating on-chain)
   - Server broadcasts `character_updated_onchain` → frontend re-fetches via `fetchCharacterNFT`
   - Client plays victory/defeat sound, shows `FightResultModal` with XP/rating/loot
   - Auto-sends `get_character` for fresh server-side stats

### Stat Allocation Flow

1. Character has `unallocatedPoints > 0` (either from level-up or server retro-compute)
2. Click `+N points to allocate` in Character tab → `<StatAllocateModal />` opens
3. User distributes points across STR/DEX/INT/END
4. Click `Allocate Points`:
   - **If `onChainCharacter.objectId` exists**: build `buildAllocateStatsTx(characterObjectId, s, d, i, e)` → wallet popup signs `character::allocate_points(character, s, d, i, e)` (owner-only, checked on-chain)
   - **Always**: send `allocate_points { strength, dexterity, intuition, endurance }` WebSocket
5. Server validates `used <= character.unallocatedPoints`, decrements, applies
6. Server responds `points_allocated { character }` → store update
7. If on-chain: also re-fetch `fetchCharacterNFT` to sync `unallocatedPoints`, `level`, `xp`

### Equipping Items

**Flow A — Server-side items:**
1. Character tab → click empty slot → modal opens with compatible items
2. Click an item → if `!onChainIds.has(item.id)` → send `equip_item { itemId, slot }`
3. Server validates ownership + slot compatibility + `levelReq`, applies, responds `item_equipped { character }` with updated equipment map
4. Unequip: click equipped slot → `Unequip` button → `unequip_item { slot }` → `item_unequipped { character, item }`

**Flow B — On-chain Item NFTs:**
1. Same click flow; if `onChainIds.has(item.id)` → dispatch local action `EQUIP_ONCHAIN_ITEM { item, slot }`
2. **No wallet popup, no server call** — item moves locally from `onChainItems` → `onChainEquipped[slot]`
3. When queueing a fight, `matchmaking-queue.tsx` bundles `onChainEquipped` into `queue_fight.onChainEquipment` so server applies bonuses during combat
4. Unequip: `UNEQUIP_ONCHAIN_ITEM { slot }` — returns to `onChainItems`

**Reason equip isn't on-chain:** Equipment state changes constantly during gear-testing; requiring a wallet popup per swap would be friction hell. On-chain equip reserved for permanent / ownership-changing moves.

**Kiosk items:** Fetched alongside owned items (`fetchKioskItems`). Shown with `Listed` badge. Cannot be equipped while `inKiosk == true`.

### Reset Character Migration

1. Old characters minted under previous packages (v1-v3) can't be updated by v4 `update_after_fight` / `allocate_points` — shared-object type mismatch
2. Character tab → `Reset Character (migrate to current package)` → confirmation card
3. Click `Confirm Reset` → `delete_character` WebSocket → server deletes from DB and memory
4. Server responds `character_deleted` → store clears `character` and `onChainCharacter`
5. `GameScreen` re-renders `<CharacterCreation />` (since `character == null`)
6. User creates a new character → freshly minted on v4 package
7. Old on-chain Character NFT is orphaned (owned but inert — won't be discovered since event query matches by current package ID; items from old packages similarly incompatible)

---

## Full WebSocket Message Reference

File: `frontend/src/types/ws-messages.ts`

### Client → Server

| Message | Payload | Sent From |
|---|---|---|
| `auth` | `{ walletAddress }` | `useGameSocket` on connect |
| `create_character` | `{ name, strength, dexterity, intuition, endurance }` | `CharacterCreation`, `GameProvider` (restore) |
| `get_character` | — | `GameProvider` auth, post-`fight_end` |
| `delete_character` | — | `ResetCharacterButton` |
| `allocate_points` | `{ strength, dexterity, intuition, endurance }` | `StatAllocateModal` |
| `queue_fight` | `{ fightType, wagerAmount?, wagerMatchId?, onChainEquipment? }` | `MatchmakingQueue` |
| `cancel_queue` | — | `MatchmakingQueue` |
| `wager_accepted` | `{ wagerMatchId, txDigest }` | `MatchmakingQueue` (accept flow) |
| `cancel_wager_lobby` | `{ wagerMatchId }` | `MatchmakingQueue` (own cancel) |
| `fight_action` | `{ attackZones, blockZones }` | `FightArena` |
| `chat_message` | `{ content, target? }` | `ChatPanel` |
| `get_online_players` | — | `GameProvider` auth |
| `equip_item` | `{ itemId, slot }` | `CharacterProfile` (server items) |
| `unequip_item` | `{ slot }` | `CharacterProfile` (server items) |
| `buy_shop_item` | `{ itemId }` | `NpcShop` |
| `get_shop` | — | `NpcShop` on mount |
| `get_inventory` | — | `GameProvider` auth |
| `get_leaderboard` | — | `Leaderboard` on mount |
| `get_fight_history` | — | `FightHistory` on mount |
| `spectate_fight` | `{ fightId }` | `PlayerList` |
| `stop_spectating` | — | `SpectateView` |
| `list_item` | `{ itemId, price }` | `MarketplaceBrowser` / `Inventory` |
| `delist_item` | `{ listingId }` | `MarketplaceBrowser` |
| `buy_listing` | `{ listingId }` | `MarketplaceBrowser` |
| `get_marketplace` | — | `MarketplaceBrowser` on mount |
| `challenge_player` | `{ targetAddress, fightType }` | `PlayerList` |
| `accept_challenge` | `{ challengeId }` | `ChallengePopup` |
| `decline_challenge` | `{ challengeId }` | `ChallengePopup` |
| `get_wager_lobby` | — | `GameProvider` auth |

### Server → Client

| Message | Payload | Handled By |
|---|---|---|
| `auth_ok` | `{ walletAddress }` | `useGameSocket` (sets authenticated) |
| `error` | `{ message }` | `ErrorToast` |
| `character_data` | `{ character }` | store (SET_CHARACTER) |
| `character_created` | `{ character }` | store + level-up sound |
| `character_deleted` | — | store (clear character + onChainCharacter) |
| `character_updated_onchain` | — | `GameProvider` re-fetches `fetchCharacterNFT` |
| `points_allocated` | `{ character }` | store |
| `queue_joined` | `{ fightType }` | store |
| `queue_left` | — | store |
| `fight_start` | `{ fight }` | store + challenge sound |
| `turn_start` | `{ turn, deadline }` | store + turn_start sound |
| `turn_result` | `{ result, fight }` | append log + hit sounds |
| `fight_end` | `{ fight, loot }` | store + victory/defeat sound |
| `chat` | `{ message }` | store + whisper sound |
| `online_players` | `{ players }` | store |
| `player_joined` | `{ player }` | store |
| `player_left` | `{ walletAddress }` | store |
| `player_status_changed` | `{ walletAddress, status }` | store |
| `inventory` | `{ items }` | store |
| `item_equipped` | `{ character }` | store |
| `item_unequipped` | `{ character, item }` | store |
| `shop_data` | `{ items }` | store |
| `item_purchased` | `{ item, character }` | store + purchase sound |
| `leaderboard` | `{ entries }` | store |
| `fight_history` | `{ fights }` | store |
| `spectate_update` | `{ fight }` | store |
| `marketplace_data` | `{ listings }` | store |
| `item_listed` | `{ listing }` | store |
| `item_delisted` | `{ listingId }` | store |
| `item_bought` | `{ listing }` | store |
| `challenge_received` | `{ challengeId, from, fromName, fightType }` | `ChallengePopup` + challenge sound |
| `challenge_accepted` | `{ challengeId, fight }` | store |
| `challenge_declined` | `{ challengeId }` | store |
| `wager_accept_required` | `{ wagerMatchId, stakeAmount, playerAName, playerAWallet }` | store (currently auto-handled) |
| `wager_accept_timeout` | `{ wagerMatchId }` | store |
| `wager_settled` | `{ txDigest, wagerMatchId }` | info log only |
| `wager_lobby_list` | `{ entries }` | store |
| `wager_lobby_added` | `{ entry }` | store |
| `wager_lobby_removed` | `{ wagerMatchId }` | store |

---

## Full On-Chain Transaction Reference

File: `frontend/src/lib/sui-contracts.ts` — all transactions built client-side, signed with `CurrentAccountSigner` from `@mysten/dapp-kit-core`.

| Builder Function | Move Target | Triggered By | Purpose |
|---|---|---|---|
| `buildMintCharacterTx` | `character::create_character(name, s, d, i, e, clock)` | `CharacterCreation` submit | Mint soulbound shared `Character` NFT |
| `buildAllocateStatsTx` | `character::allocate_points(character, s, d, i, e)` | `StatAllocateModal` allocate | Spend unallocated stat points (owner-only) |
| `buildCreateWagerTx` | `arena::create_wager(stake: Coin<SUI>, clock)` | `MatchmakingQueue` create wager | Lock SUI in shared `WagerMatch` object |
| `buildAcceptWagerTx` | `arena::accept_wager(wager, stake: Coin<SUI>, clock)` | `MatchmakingQueue` accept lobby entry | Match opponent's stake |
| `buildCancelWagerTx` | `arena::cancel_wager(wager)` | `MatchmakingQueue` own-cancel | Refund creator (waiting state only) |
| `buildCancelExpiredWagerTx` | `arena::cancel_expired_wager(wager, clock)` | Not currently wired to UI — safety net | Anyone can trigger after 10min expiry |

**Reads (JSON-RPC / gRPC, no signing):**
- `fetchCharacterNFT(client, owner)` — queries `CharacterCreated` events, fetches shared `Character` object by ID
- `fetchOwnedItems(client, owner)` — `listOwnedObjects` with `type = {PACKAGE}::item::Item`
- `fetchKioskItems(client, owner)` — finds `KioskOwnerCap`s → reads `DynamicObject` fields for items

**Server-side only (using TREASURY's AdminCap — not frontend):**
- `character::update_after_fight(admin, character, won, xp_gained, new_rating, clock)` — after every fight
- `arena::settle_wager(wager, winner)` — after wager fight ends
- `arena::admin_cancel_wager(wager)` — on disconnect/timeout

---

## Known Limitations Affecting Frontend

- **Marketplace UI partial** — Kiosk contracts deployed but buy/list/delist not fully wired to on-chain Kiosk SDK
- **No Sui Object Display registered** — Character and Item NFTs appear without metadata in Sui wallets (only visible in-game / on Explorer)
- **Opponent equipment invisible in fight arena** — `FighterDisplay` reads `opponent.equipment` but server currently omits on-chain opponent items from fight state
- **No settlement retry** — if `update_after_fight` or `settle_wager` fails on server, no automatic retry from frontend; manual CLI intervention required
- **Old-package characters silently fail** — characters minted on v1-v3 are detected but `update_after_fight` / `allocate_points` fail silently; solved by Reset Character migration
- **Gold still off-chain** — no on-chain gold balance; all NPC shop purchases and loot are server-side only
