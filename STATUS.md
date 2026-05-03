# SUI Combats — Project Status

> Single canonical status. Updated 2026-05-03 after the v5 testnet
> hardening + repo cleanup pass (commit `dc28eff` + the cleanup commit
> immediately after).
>
> Branch `feature/v5-redeploy`. Sui testnet only. Mainnet deferred to v5.1
> republish (player-signed settlement attestation + Move
> CharacterRegistry).

---

## What is SUI Combats?

A browser-based PvP RPG combat game on the Sui blockchain. Players
connect a wallet, mint a Character NFT, gear up with Item NFTs, equip via
on-chain dynamic-object-fields, and fight other players in 5-zone
turn-based combat — including wager fights where real SUI is locked in
on-chain escrow and 95/5 split-settled to the winner. Character XP,
level, wins/losses, and ELO rating are persisted to the chain after
every fight.

Inspired by the legendary Russian browser MMORPG combats.ru / oldbk.ru.
First open-source RPG combat framework on Sui; Sui Foundation grant
application drafted (`GRANT_APPLICATION.md`).

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (Turbopack), React, TypeScript, `@mysten/dapp-kit-react`, `@mysten/sui` |
| Server | Node.js, Express, `ws` (WebSocket), port 3001 |
| Blockchain | Sui Testnet — Move contracts, BCS-decoded event subscription via gRPC `SubscribeCheckpoints` |
| Database | Supabase (optional — server runs in-memory if blank; required for orphan-wager sweep + character-pin persistence across restarts) |
| Wallet | Slush / Suiet via dapp-kit; `CurrentAccountSigner` for tx signing |
| Decentralized hosting | Walrus Sites (testnet, static export) |
| Repository | https://github.com/Mr-Boss-AI/sui-comabts (MIT, public) |

---

## v5 deployment — Sui testnet

| Object | Id |
|---|---|
| **Package** | `0xa7dc2dabea6acc2db1a9599a0c1e003ad6b2e6064a2847687bc93037a662e1c1` |
| AdminCap | `0x4329021b08235418990a4a0bf8d1edb1e8cb1fe06be5d093f7e2c0f76d8e2579` |
| UpgradeCap | `0x05b27c97ddac6ca0172726d5e91339fc2802a86bba61c837012d2d708d60c5c6` |
| Publisher | `0x1a8116ed261e2513e617a4692520d2f661d9d827ac32f733a1b2ea320031ee87` |
| TransferPolicy<Item> | `0xb0ca682ce826c15166577b5879efa76830befe4af5627f747f9cf0b7e9e8e871` |
| TransferPolicyCap<Item> | `0x71d9157f2cab218f410773e48f7fa3992171b40526ae36ad757b24ffc43c12a1` |
| Display<Character> | `0xca2104f3944e9c150a2f84ef9919ace41ef4c006c4a49f27c5e195f4f0363955` |
| Display<Item> | `0x1f7505f81100e32869944db5368cc95291221935d5d9d7af724b0343d895478b` |

Published 2026-04-27. v5 is a fresh `sui client publish`, not an upgrade
of any prior package. Original-id semantics in `Move.toml` /
`Published.toml` reflect this. NFT artwork on Pinata: CID
`bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy`.

The full v5 deployment artefact is `deployment.testnet-v5.json`
(starter-NFT catalog with 22 minted Item objects split across the two
test wallets).

---

## Wallet roles

| Role | Address | Notes |
|---|---|---|
| **Publisher / TREASURY** (hardcoded in `arena.move`) | `0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d` | Holds `AdminCap`. Required for `settle_wager`, `admin_cancel_wager`, `update_after_fight`, `set_fight_lock`. Receives 5 % wager fees + marketplace listing fees + 2.5 % royalties. Private key in `server/.env::SUI_TREASURY_PRIVATE_KEY`. |
| **Mr_Boss** (test, crit build) | `0x06d6cb677518cc70884df24541d91d7a1d2ca5db2d8628a69568172652239624` | Owns starter items 1–11. Currently 3 chain Characters (Mr_Boss_v5, Mr_Boss_v5.1, "mee"); canonical pinned by server is **`Mr_Boss_v5.1`** (`0x9b294d7d6af20d8de72755df834e385f10e211ed41026d17cdfd09dc10ea808a`). |
| **Sx** (test, evasion build) | `0xd05ae8e26e9c239b4888822c83046fe7adaac243f46888ea430d852dafb6e92b` | Owns starter items 12–22. Two chain Characters; canonical pinned is **`Sx_v5.1`** (`0xaca14d0f3b13333f5bbda44ff514d9f1fb0052e1838c8bc7da753e9715046a40`). |

The legacy multi-Character state on these wallets (Mr_Boss_v5, "mee",
Sx_v5) is residue from earlier auth-flicker testing. Both layers of
the Block A duplicate-mint fix prevent any future wallet from getting
into this state. The `BUG E` fix (commit `dc28eff`) makes the existing
multi-char wallets work correctly by surfacing the server-pinned
canonical id to the frontend.

---

## What works (live-tested 2026-05-02)

- ✅ **Wager fights end-to-end** — create on-chain → lobby visible to
  opponent → accept → fight → 95/5 settle with `settleWagerOnChain` →
  WagerMatch SETTLED, escrow=0, on-chain balance changes match.
- ✅ **Marketplace** — kiosk create / list / buy / delist / withdraw,
  2.5 % royalty, atomic delist (delist + take + transfer in one PTB so
  NFTs never get stuck unlisted in a kiosk).
- ✅ **Equipment via DOFs** — load-out save flow (D1 PTB-of-primitives
  + D3 strict + D4 pending-inactive-during-fight). Server reads
  equipment from chain DOFs at fight start; client never lies about
  gear.
- ✅ **Auth handshake** — signed-personal-message challenge or 24 h
  JWT resume. JWT persisted client-side at
  `localStorage[sui-combats-jwt-<wallet>]`.
- ✅ **Character lifecycle** — mint, restore-from-chain, delete,
  duplicate-mint guard (Block A layers 1+2 close the auth-flicker
  bug at frontend state-machine + server pre-mint check).
- ✅ **Stat allocation** — modal clamps to `min(server, chain)` so the
  user can never stage a doomed transaction during the post-fight
  treasury-queue drain. After successful tx, frontend dispatches
  `LOCAL_ALLOCATE` immediately so stats render correctly even if the
  WS sync arrives during a reconnect window.
- ✅ **Reconnect grace** — 60 s window from socket drop; turn timer
  pauses; opponent sees a persistent banner with countdown; on
  reconnect the rejoining client receives `fight_resumed` with full
  state and can lock choices on the next turn (closes BUG C1.c).
- ✅ **Treasury sequencing** — single-flight FIFO queue serializes
  every admin tx so two settlements never compete for the same gas
  coin. Concurrency knob via `TREASURY_QUEUE_CONCURRENCY` env.
- ✅ **Fight-lock release order** — `set_fight_lock(0)` fires FIRST in
  the post-fight queue (ahead of `settle_wager` and
  `update_after_fight`), so save-loadout immediately after a fight
  works in ~5 s instead of ~25 s.
- ✅ **Marketplace resilience** — `coldSync` wrapped in
  `withChainRetry` (3 attempts), reconnect gap-fill wrapped in a 5-
  attempt loop with 1/3/9/27 s backoff. If gap-fill exhausts,
  `runSubscription` reschedules instead of opening the gRPC stream
  with a known-incomplete index.
- ✅ **Orphan-wager auto-recovery** — frontend sends `queue_fight`,
  awaits the `wager_lobby_added` ACK with a 7 s timeout. On timeout
  it falls back to `POST /api/admin/adopt-wager` (REST has TCP-level
  error reporting; no silent loss). Future WAITING-state orphans
  self-heal.
- ✅ **Server-pinned canonical NFT visible to frontend** — for legacy
  multi-Character wallets, the frontend reads chain truth from the
  same NFT the server uses (closes BUG E from the live retest).
- ✅ **Counter triangle** — Sx evasion vs Mr_Boss crit, ~60 % win-rate
  for evasion (matches GDD §6 spec).
- ✅ **Shield 3-block-zone** — `getOffhandType` falls back to
  `itemType` for chain items where `offhand_type` isn't carried;
  `validateTurnAction` accepts 3 zones forming an adjacent line.

---

## What's deferred to v5.1 (requires Move republish)

1. **Player-signed settlement attestation.** Today TREASURY can pick
   any winner from `{player_a, player_b}` in `settle_wager`. v5.1 adds
   `settle_wager_attested(wager, winner, sig_a, sig_b)` requiring both
   players' `signPersonalMessage` over the fight-outcome hash. Server
   still owns AdminCap and pays gas; chain refuses settlement without
   both signatures. ~12 h work + frontend signing UX.
2. **Move `CharacterRegistry`.** Closes the layer-3 path of the
   duplicate-mint bug (someone bypasses Layer 1 + Layer 2 by signing
   `create_character` directly via Slush). A shared
   `CharacterRegistry` mapping `address → ID` aborts new mints with
   `EWalletAlreadyHasCharacter` if the wallet already has one.
3. **`burn_character`.** Admin endpoint to clean up legacy "mee" /
   `Mr_Boss_v5` / `Sx_v5` artifacts now that the multi-char regression
   is closed.
4. **Admin-signed loot-NFT mint.** v5 disabled the old server-side
   "fake loot" path (off-chain Items violated the NFT-only contract).
   v5.1 reuses the `rollLoot` rarity + stat-roll math and mints a real
   chain Item NFT to the winner.

All four items batched into one v5.1 fresh-publish (no upgrade — Sui
upgrades don't retire bytecode, see `MAINNET_PREP.md`).

---

## Mainnet readiness — 5/8 original blockers + 5 hotfixes closed

The 8 mainnet blockers we entered the v5 hardening pass with:

| # | Blocker | State |
|---|---|---|
| 1 | Gas-coin contention in admin tx settlement | ✅ Closed — sequential treasury queue |
| 2 | Mid-fight crash leaves wagers stuck on chain | ⚠️ Code complete — orphan sweeper live + frontend ACK fallback. End-to-end live test gated on user provisioning Supabase |
| 3 | Multi-Character wallet picks wrong NFT on hot paths | ✅ Closed — server pin (`Character.onChainObjectId`) + frontend alignment via wire payload (BUG E fix) |
| 4 | Wager-lobby TOCTOU race on accept | ✅ Closed — `processingWagerAccepts` single-flight guard |
| 5 | Marketplace cursor stuck on empty pages | ✅ Closed — cursor advances unconditionally |
| 6 | Marketplace silent gap-fill loss on reconnect | ✅ Closed — 5-attempt retry loop, schedules full reconnect on exhaustion |
| 7 | Marketplace coldSync no boot retry | ✅ Closed — `withChainRetry` per page |
| 8 | Duplicate-Character mint during auth flicker | ✅ Closed for layers 1+2; layer 3 deferred to v5.1 republish |

Plus five hotfixes from live testing:

| Tag | Issue | State |
|---|---|---|
| C1 | Instant forfeit on WS drop costs real SUI | ✅ Closed — 60 s reconnect grace + timer pause + persistent banner |
| BUG B | "Not authenticated" toast after allocate | ✅ Closed — local stat update + WS error suppression |
| BUG C | Naked-stats gap on chain-restore | ✅ Closed — DOF hydration before `character_created` |
| BUG D | `auth_ok` character payload ignored | ✅ Closed — game-provider dispatches SET_CHARACTER on receipt |
| BUG E | Frontend reading wrong Character NFT | ✅ Closed — server pin in wire payload |

Net assessment: **everything we know about is fixed except (a) Block 2's
end-to-end live test (gated on Supabase provisioning), and (b) the v5.1
republish items (player-signed settlement + Move CharacterRegistry +
burn_character + on-chain loot mint).**

---

## Test totals — 12 gauntlets / 654 assertions

Run from `server/`: `npx tsx ../scripts/qa-<name>.ts`.

| Gauntlet | Coverage | Pass |
|---|---|---:|
| `qa-xp.ts` | XP table parity (chain ↔ server ↔ frontend), `applyXp` semantics, `calculateXpReward` ranked / wager × win / loss, frontend XP-bar helpers | 143 |
| `qa-marketplace.ts` | BCS decoders for the 4 `marketplace::*` events, royalty math, list / delist / buy lifecycle reconciliation, reconnect idempotency, atomic delist PTB structure, kiosk Listing-key BCS layout, Block C2 retry budget | 63 |
| `qa-treasury-queue.ts` | Single-flight FIFO, bounded concurrency, retry-then-succeed, exhaustion preserves last error, env-driven concurrency knob, custom backoff arrays | 25 |
| `qa-character-mint.ts` | Auth-phase state machine (Block A layer 1), duplicate-mint server-side guard predicate (layer 2) | 63 |
| `qa-orphan-sweep.ts` | `sweepOne` branches: ACTIVE → admin-cancel + drop, SETTLED → drop only, WAITING → defensive drop, RPC-fail → leave row, throw propagation | 30 |
| `qa-reconnect-grace.ts` | `markDisconnect` / `markReconnect` state machine — pending detection, idempotency, custom grace, multi-wallet independence, full disconnect → reconnect → disconnect → forfeit roundtrip | 35 |
| `qa-fight-pause.ts` | `pauseFightTimer` / `resumeFightTimer` math — captures exact remaining ms, idempotent, single onTimeout fire across roundtrip, locked-choice preservation | 46 |
| `qa-stat-points.ts` | `effectiveUnallocatedPoints(server, chain)` clamp, `isAwaitingChainCatchup`, NaN/negative sanitization, `applyLocalAllocate` reducer helper | 45 |
| `qa-wager-register.ts` | WS ACK happy path, silent-WS-loss → adopt-wager recovery, other-player's lobby_added doesn't false-ACK, both-paths-fail, throw handling, race resolution | 25 |
| `qa-equip-picker.ts` | `buildSlotPickerEntries` — locked items kept + annotated, sort order (unlocked alpha → locked asc level), kiosk + pending-equipped exclusion, slot-type matching across all 10 slots, dedup with on-chain wins, boundary `levelReq === level` is unlocked | 53 |
| `qa-combat-stats.ts` | Element-by-element parity of LEVEL_HP + LEVEL_WEAPON_DAMAGE between server config and frontend mirror, maxHp formula at every level, equipment hpBonus added flat, server `deriveCombatStats` agrees with frontend `computeDerivedStats` for the live-test Mr_Boss / Sx fixtures | 79 |
| `qa-wager-form.ts` | `parseWagerInput` — clearable input (empty/whitespace/lone-dot rejected without snap-back), below-min floor named in error, decimal-precision cap at SUI's 9 places, non-numeric / scientific / signed / hex / comma all rejected, whitespace trimmed, defensive null/undefined, full live-repro keystroke sequence | 47 |
| **Total** | | **654 / 654 PASS** |

Plus 35/35 Move unit tests under `contracts/tests/` (`sui move test`).

---

## How to run (testnet)

```bash
# One-time setup
cd ~/sui-comabts/server   && cp .env.example .env  # fill in v5 ids + treasury key
cd ~/sui-comabts/frontend && cp .env.local.example .env.local  # fill in v5 ids
cd ~/sui-comabts/server   && npm install
cd ~/sui-comabts/frontend && npm install

# Standard kill + start (run from any cwd)
kill $(lsof -t -i:3001) 2>/dev/null
kill $(lsof -t -i:3000) 2>/dev/null

cd ~/sui-comabts/server   && npm run dev > /tmp/server.log   2>&1 &
cd ~/sui-comabts/frontend && npm run dev > /tmp/frontend.log 2>&1 &

# Verify
curl -s localhost:3001/health | python3 -m json.tool
curl -s -o /dev/null -w "frontend HTTP %{http_code}\n" localhost:3000
```

Server boots through: env validation → Supabase init (in-memory if
blank) → marketplace cold-sync → orphan-wager sweep → gRPC checkpoint
subscription → WS server. ~3-6 s on testnet RPC.

---

## Optional — Supabase

Empty `SUPABASE_URL` / `SUPABASE_KEY` is the current default. Server
runs entirely in memory; orphan-wager rows aren't persisted (the boot
sweeper has nothing to read); character pins drop on every restart.

To enable:

1. Provision a free-tier Supabase project at
   <https://supabase.com/dashboard/new/p>.
2. Project Settings → API → copy `Project URL` (→ `SUPABASE_URL`) and
   `service_role` key (→ `SUPABASE_KEY`). The `service_role` key
   bypasses RLS by design; it's server-only and never exposed to the
   browser.
3. `cd server && node setup-db.mjs` — prints the combined migration
   SQL (`migrations/001_initial.sql` + `002_wager_in_flight.sql`).
   Paste into the Supabase SQL Editor → Run. Re-run `setup-db.mjs`;
   both probes should show `✓ EXISTS`.
4. Restart the server. Boot log should say `[Supabase] Client
   initialized` instead of `[Supabase] No credentials configured —
   running in-memory only`.

End-to-end orphan-recovery validation (after Supabase is live): start
a wager fight, wait for `[Wager] dbInsertWagerInFlight` log, run
`kill -9 $(lsof -ti:3001)` mid-fight, restart. Boot log should show
`[OrphanWager] Found 1 stale wager_in_flight row(s) → admin_cancel
50/50 refund tx=…`.

---

## Recent session log (most recent first)

### 2026-05-03 — Repo cleanup + push to GitHub

Walked the repo top-to-bottom. Deleted 53 files (44 Gemini code-dump
chunks, 1 split-script, 1 audit notes file, 3 legacy test scripts, 2
stale architecture/function references, 1 boilerplate frontend README,
1 empty `test-wallets/` dir, the entire `supabase/.temp` scratch dir).
Renamed `STATUS_v5.md → STATUS.md`. Consolidated
`FULL_PROJECT_STATUS.md` content into the new STATUS.md and README.md,
then deleted it. Refreshed `README.md`, `MAINNET_PREP.md`,
`frontend/README.md`. Wrote fresh `SESSION_HANDOFF.md`. Force-pushed
`feature/v5-redeploy` to GitHub origin (local state is canonical;
upstream main is at the v4-era `08ff991` Phase 0.5 commit).

### 2026-05-02 (very late) — BUG E: server pin not shared with frontend

Mr_Boss leveled L3 → L4 after a wager fight; chain emitted
`LevelUp{ unallocated_points: 6 }` correctly; server log showed
`unalloc=6, leveledUp=true` and broadcast 6 over WS — but the UI
showed nothing allocatable across disconnect / hard refresh / new tab.

Root cause: Mr_Boss has 3 `CharacterCreated` events on chain
(`Mr_Boss_v5`, `Mr_Boss_v5.1`, "mee"). Server has `Mr_Boss_v5.1`
pinned. Frontend's `fetchCharacterNFT` does `descending` event scan,
returns first match → "mee" (newest, 0 unallocated).
`effectiveUnallocatedPoints(server=6, chain=0) = min(6, 0) = 0`. The
b39202d clamp logic was correct, but the chain input was wrong.

Fix (commit `dc28eff`): `sanitizeCharacter` includes `onChainObjectId`
in the wire payload. Frontend's `Character` type adds the field.
`fetchCharacterNFT(client, owner, pinnedObjectId?)` accepts a hint —
when provided, queries that object directly instead of the descending
event scan. Game-provider passes `state.character?.onChainObjectId`
to every post-auth chain refresh.

### 2026-05-02 (late) — Bug 1 retest cleanup (BUG B + C + D)

User retested allocate_points after the b39202d clamp landed. Chain
accepted cleanly (no MoveAbort code 2) but three secondary failure
modes surfaced.

- **BUG B** — Modal showed "Not authenticated. Send auth_request
  first." after a successful chain tx because the WS `allocate_points`
  message arrived during a reconnect window. Fix: new
  `applyLocalAllocate` helper + `LOCAL_ALLOCATE` reducer action
  (frontend reflects truth immediately, regardless of WS state) +
  game-provider suppresses the auth-pending error toast specifically
  (logs only — useGameSocket auto-retries the handshake).
- **BUG C** — Hard refresh showed naked-stats gap because
  `handleRestoreCharacter` responded with `character_created` carrying
  empty equipment. Fix: extracted `hydrateDOFsForCharacter` helper,
  called from both auth and chain-restore paths. Equipment lands in
  the same payload as the character.
- **BUG D** — `auth_ok` carries the fully-hydrated character payload
  but game-provider didn't have a case "auth_ok" handler.
  `SET_CHARACTER` only fired on the redundant `get_character` reply,
  exposing a frame-level window where game-screen rendered with
  `character=null` after auth completed. Fix: added the handler;
  auth gate releases with full equipment in one step.

Commit `413593e`. Tests: `qa-stat-points` 32 → 45 with 13 new
`applyLocalAllocate` assertions.

### 2026-05-02 (later) — Orphan wager 0xbdd3c596 recovered + WS-loss orphan class closed

User caught a 0.8 SUI orphan WagerMatch: on-chain `create_wager`
succeeded (status WAITING, escrow 0.8 SUI), but the `queue_fight` WS
message that registers the wager in the in-memory lobby never reached
the server. Refunded via `/api/admin/cancel-wager` (tx
`f1okCdAi5R7p8hpVXVnaKHEKAoPNbN8vLUisigF1WLv`, +0.800 SUI exact).

Root cause: WebSockets here have no application-level ACK.
`socket.send` returns `true` whenever `readyState === OPEN` at
check-time. TCP-level death between check and write (Mysten testnet
gRPC reconnect spam, half-closed socket) lets the OS silently drop the
bytes.

Fix (commit `6871df0`): new leaf `frontend/src/lib/wager-register.ts`
with `registerWagerWithServer(wagerMatchId, deps, timeoutMs=7000)`.
Subscribes to incoming WS messages, sends `queue_fight`, races the
server's `wager_lobby_added` ACK against a 7 s timeout. On timeout,
falls back to `POST /api/admin/adopt-wager` (existing endpoint —
server reads chain truth, inserts the lobby entry, broadcasts the same
`wager_lobby_added`). Sticky error only when both paths fail. Closes
the entire silent-WS-loss orphan class. Tests:
`qa-wager-register.ts` (NEW) — 25/25 PASS.

### 2026-05-02 — Live-test bug sweep (3 bugs from yesterday's session)

Three bugs from a fresh wager-fight gauntlet. Single commit, no Move
republish.

- **BUG 1** — `allocate_points` MoveAbort code 2 (`ENotEnoughPoints`).
  Server's `applyXp` bumps `unallocatedPoints` optimistically the
  instant a fight ends; chain's `update_after_fight` lands ~5–25 s
  later through the treasury queue. Modal showed "+3" while chain was
  still 0 → Slush dry-run aborted. Fix: new leaf
  `frontend/src/lib/stat-points.ts::effectiveUnallocatedPoints` returns
  `min(server, chain)` when chain is hydrated. Plus an amber "Chain
  state is catching up" hint when drift is detected.
- **BUG 2** — Save-loadout fight-lock race after a fight. Treasury
  queue serialized
  `settle_wager → update_after_fight × 2 → set_fight_lock(0) × 2`,
  delaying lock release ~10–25 s. Fix: reorder so
  `set_fight_lock(0)` fires first; locks clear in ~2–5 s.
- **BUG 3** — Off-chain "Wooden Club / Cloth Hood" loot drops
  violated v5's NFT-only contract. Removed the `rollLoot` call from
  `finishFight`; the function survives in `game/loot.ts` for v5.1 to
  reuse when on-chain admin-signed Item NFT minting lands.

Commit `b39202d`. Tests: `qa-stat-points.ts` (NEW) — 32/32 PASS.

### 2026-04-30 (later) — Blocks A through D shipped

Four-block follow-up to the prior-session Gemini audit + live test:

- **Block A** — Duplicate-Character mint fix (layers 1+2). New leaf
  `auth-phase.ts` with explicit state machine (`auth_pending` →
  `chain_check_pending` → `no_character` | `chain_check_failed`).
  Server pre-mint guard via new `findAllCharacterIdsForWallet` +
  `shouldRejectDuplicateMint` predicate. Layer 3 (Move
  `CharacterRegistry`) deferred to v5.1.
- **Block B** — Supabase wiring + orphan-sweep instrumentation. New
  migration `002_wager_in_flight.sql` (table + character columns).
  `sweepOne` refactored for testability. End-to-end live validation
  blocked on user provisioning a Supabase project.
- **Block C** — Three Gemini re-audit findings. C1 (CRITICAL) —
  `handlePlayerDisconnect` was instant-forfeiting on WS drop;
  introduced `reconnect-grace.ts` with 60 s window + timer pause +
  persistent banner. C2 — `runSubscription` swallowed gap-fill
  failures; now retries 5× with 1/3/9/27 s backoff, schedules full
  reconnect on exhaustion. C3 — `coldSync` had no internal retries;
  now wrapped in `withChainRetry`.
- **Block D** — Final wrap, STATUS update, mainnet readiness ranking.

Commits `a462fec` / `999300e` / `468a43e` / `3d2c6a4`.

### 2026-04-30 — Live-test critical-bug discovery (auth-flicker dupe)

mr_boss accidentally minted a SECOND Character NFT ("mee") during the
auth-flicker window — frontend rendered `<CharacterCreation />` as a
fallback while waiting for `fetchCharacterNFT` to resolve. Reproduced
end-to-end. Block A (next session) closed the auth-flicker bug at
both frontend and server layers; the legacy "mee" character remains
on chain until v5.1's `burn_character`.

### 2026-04-29 — XP rewrite, marketplace end-to-end

Unified XP table across chain ↔ server ↔ frontend (matches GDD §9.1
production thresholds). Marketplace went from placeholder to full
list / browse / buy / delist / withdraw flow with gRPC
`SubscribeCheckpoints` event index, BCS decoders for the four
`marketplace::*` events, atomic delist PTB (delist + take +
transfer), and a `Retrieve` flow for items stuck in kiosks from
pre-fix delists. Commit `07732d2`. Tests at the time: 198/198 PASS.

### 2026-04-27 — v5 redeploy

Fresh `sui client publish` of all 5 modules
(`character / item / equipment / arena / marketplace +
royalty_rule`). New package id, new AdminCap. Display objects
registered for both `Character` and `Item` with proper Pinata image
URLs. 22 starter Items minted from the catalog
(`scripts/mint-v5-catalog.ts`); 11 to mr_boss, 11 to sx. Production
XP thresholds restored (no more lowered-for-testing values). 35/35
Move unit tests passing.

---

## Recent commits — `feature/v5-redeploy`

```
dc28eff fix(v5): publish server-pinned chain id to frontend (BUG E)
413593e fix(v5): post-allocate UX + naked-stats gap + auth_ok wiring
6871df0 fix(v5): close silent-WS-loss orphan-wager class
b39202d fix(v5): three live-test bugs — stat drift, fight-lock race, fake loot
bd631c9 fix(v5): C1 reconnect grace — banner, timer pause, choice acceptance
3d2c6a4 docs(v5): STATUS wrap — Blocks A–D shipped, mainnet readiness
468a43e fix(v5): three Gemini re-audit findings (C1 + C2 + C3)
999300e fix(v5): orphan-wager sweep — schema, setup, testability
a462fec fix(v5): close duplicate-Character-mint bug (layers 1+2)
3b54108 docs(v5): session-end wrap with tomorrow-morning checklist
a70832b admin(v5): cancel-wager + repin-character endpoints
ba41fe6 hardening(v5): treasury queue, crash recovery, multi-char fix, SDK hygiene
07732d2 feat(v5): XP rewrite, marketplace end-to-end, hardening from gauntlet
dcca786 feat(deploy): v5 testnet redeploy artefacts + 22-NFT catalog mint
```

Plus the cleanup commit immediately after this STATUS.md write.

---

## Next-session pickup

1. **Provision Supabase + run kill-mid-fight test** — closes Block B's
   live validation (the only mainnet-readiness item NOT marked ✅).
2. **Live regression of Bug 1 + BUG E together** — finish a fight,
   open Allocate within 5 s. Should see amber "catching up" hint, then
   correct chain-truth value once update_after_fight lands. For
   mr_boss: Slush popup must show `0x9b294d7d…` (Mr_Boss_v5.1) NOT
   `0xec6fbbcf…` (mee).
3. **Pre-v5.1 republish design** — finalise
   `settle_wager_attested` signature scheme, `CharacterRegistry`
   shape, `burn_character` admin path, and on-chain loot-mint flow.
   Spec out the Move-side test gauntlet for the new code.
4. **Polish bugs from prior sessions:**
   - HP decimal display quirk (combat math uses fractional HP; round
     up displayed HP when actual_hp > 0 so "0.25 HP" doesn't render
     as "0/90")
   - Equipped items not visible at fight start (refresh fixes — race
     between fight-room render and DOF hydration)
   - Stat-allocate modal preset to 0/0/0/0 (user has to manually
     redistribute; could pre-pop with current stats and let them
     adjust)

---

## Reference

| File | Use |
|---|---|
| `README.md` | Public-facing project overview + run instructions |
| `STATUS.md` | This file — canonical project state |
| `SESSION_HANDOFF.md` | Today's-work summary for the next session pickup |
| `MAINNET_PREP.md` | Mainnet deploy protocol, threat model, Move semantics |
| `LOADOUT_DESIGN.md` | D1–D5 loadout-save design + invariants |
| `SUI_COMBATS_GDD.md` | Game design — combat math, XP curve, item economy |
| `DESIGN_BRIEF.md` | Visual aesthetic brief (meme-coin energy, neon palette) |
| `GRANT_APPLICATION.md` | Sui Foundation grant draft |
| `CLAUDE.md` / `AGENTS.md` | GitNexus integration for AI tooling |
| `deployment.testnet-v5.json` | v5 deploy artefact + 22-NFT starter catalog |
