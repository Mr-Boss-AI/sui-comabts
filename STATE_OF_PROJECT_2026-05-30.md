# SUI Combats — State of the Project, 2026-05-30 (v5.2 wager-fairness cut-over COMPLETE, ready for live QA)

> **v5.2 contract is LIVE on testnet** (package `0x9c01ad55…7d38f`,
> published from `feature/v5.2-wager-fairness` HEAD `406c5c8`,
> Move tests 105/105). **App-code cut-over COMPLETE** —
> arena-aborts, frontend wager flow (request → approve / decline /
> withdraw / expire / reclaim), server WS handshake handlers, OrphanWager
> PENDING_APPROVAL branch, env wired, gauntlets green, frontend production
> build clean. Branch local only — **not pushed, not merged to main**
> per standing rule.
>
> **The next physical action is live two-wallet QA** following the
> step-by-step in [`docs/V5.2_QA_GAUNTLET.md`](docs/V5.2_QA_GAUNTLET.md).
>
> This doc supersedes [`STATE_OF_PROJECT_2026-05-29.md`](STATE_OF_PROJECT_2026-05-29.md).

---

## TL;DR

| Field | Value |
|---|---|
| Phase | **v5.2 wager-fairness app cut-over COMPLETE on testnet — pending live QA** |
| Branch | `feature/v5.2-wager-fairness` |
| HEAD (local) | new commit incoming (PHASE 8 of STEP 5) |
| Mainline | `main` at `6fdb18d` (v5.1 baseline, tagged `v5.1`) — untouched |
| v5.2 package | `0x9c01ad55dd3aecafe671758fe4c9837b9fdfef1739793eb6bc094cc476f7d38f` |
| Move tests | **105 / 105 PASS** |
| Frontend gauntlets | all green — see § Test totals below |
| Frontend tsc | clean |
| Server tsc | clean |
| Frontend production build | clean |
| `accept_wager` call sites in frontend | **0** (every site replaced with v5.2 handshake) |
| Env wired | server/.env + frontend/.env.local point at v5.2 ids (backups preserved) |
| TREASURY balance | ~2.15 SUI (post-publish + post-setup; ample) |

---

## What shipped this session (STEPs 0 → 5)

### STEP 0 — v5.1 → main merge + tag (DONE)
- Merge commit `6fdb18d` on `main`, annotated tag `v5.1`.
- v5.1 became the saved rollback point before v5.2 contract work.

### STEP 1 (revised) — v5.2 Move contract implemented + test-covered
- `contracts/sources/arena.move` rewritten per spec §5/§6/§7.
- `contracts/tests/arena_tests.move` rewritten per spec §10 — 51 arena tests, every abort code 12–20 + 21/22/23 has a direct triggering test.
- HEAD `406c5c8` (judgment-call #5 tie-off — `EWrongExpiryEntrypoint = 23`).

### STEP 2 — v5.2 published to testnet
- Tx `DydwCsLiaAU8j5JoPJwbQLNiK5cwnHThSMN4ULJxrM14`, gas ~0.186 SUI.
- Package + 3 shared registries + AdminCap + UpgradeCap + Publisher created. Full IDs in `deployment.testnet-v5.2.json`.

### STEP 3 — Post-publish TransferPolicy + Display setup
- `marketplace::setup_transfer_policy` → TransferPolicy<Item> shared + cap to TREASURY + royalty rule (250 BPS / 1000 MIST floor, matching v5.1 parity).
- Display<Character> + Display<Item> created with byte-for-byte v5.1 field templates.
- Setup script `scripts/setup-v5.2.ts` committed for re-runs.

### STEP 4 — Env wired to v5.2
- 7 listed vars + `TRANSFER_POLICY_CAP_ID` swapped in `server/.env`.
- 5 `NEXT_PUBLIC_*` mirrors swapped in `frontend/.env.local`.
- Backups: `server/.env.v5.1-backup`, `frontend/.env.local.v5.1-backup` (one-line `cp` to roll back).
- Final grep: **zero v5.1 package/object/cap IDs** in either env file.

### STEP 5 — App-code cut-over (this session)
- **Frontend abort copy:** every code 0–23 in `arena-aborts.ts` with friendly user-facing strings.
- **Frontend wager flow:** `buildRequestAcceptWagerTx`, `buildApproveChallengerTx`, `buildDeclineChallengerTx`, `buildWithdrawChallengeTx`, `buildCancelExpiredChallengeTx`, `buildReclaimStalledWagerTx` added to `sui-contracts.ts`. `buildCreateWagerTx` now takes a `&Character`. v5.1's `buildAcceptWagerTx` removed.
- **State machine UI:** `WagerLobbyCard` dispatches on `(status, viewerRole)`:
    - WAITING + stranger in-bracket → Accept (signs `request_accept_wager`)
    - WAITING + stranger out-of-bracket → Accept disabled with bracket-blocked tooltip
    - WAITING + creator → Cancel
    - PENDING_APPROVAL + creator → Approve / Decline (with challenger details + countdown)
    - PENDING_APPROVAL + pending_challenger → Withdraw
    - PENDING_APPROVAL + stranger after 5 min → Clear expired
- **Constants single-source-of-truth:** new `frontend/src/lib/wager-constants.ts` mirrors chain `CHALLENGE_TIMEOUT_MS`, `WAGER_RESOLUTION_TIMEOUT_MS`, `LEVEL_BRACKET`, plus `WAGER_STATUS` enum and helpers (`inLevelBracket`, `isReclaimable`, `formatTimeoutMin`).
- **Reclaim escape hatch UI:** new `ReclaimStalledWagerBanner` mounted in `game-screen.tsx` above the FightArena. Visible only when `fight.wagerMatchId && fight.wagerAcceptedAtMs && elapsed >= 30 min && viewer is participant`. Below threshold or non-participant: hidden. Signs `reclaim_stalled_wager` on click.
- **Server WS handlers:** new `handleWagerHandshake` dispatcher for 5 message types (`wager_request_accepted`, `wager_declined`, `wager_withdrawn`, `wager_challenge_expired`, `wager_reclaimed`). Each waits for finality, probes chain status (expected status per message type), updates the in-memory lobby entry, broadcasts `wager_lobby_updated` or `wager_lobby_removed`.
- **Server gate update:** `decideAcceptOutcome` self-check relaxed to allow caller=creator when status=ACTIVE (v5.2 approve_challenger flow); v5.1 backward-compat preserved by gating on `targetChainStatus !== STATUS_ACTIVE`.
- **OrphanWager reconciler:** new PENDING_APPROVAL (status=3) branch routes to existing `adminCancelWagerOnChain` (v5.2 contract handles the PENDING_APPROVAL split: each side refunded their own stake).
- **WS types:** new client→server messages (`wager_request_accepted` etc.) and `wager_lobby_updated` server→client. `WagerLobbyEntry` extended with optional `status`, `playerALevelSnapshot`, `pendingChallenger`. `FightState` extended with optional `wagerMatchId` + `wagerAcceptedAtMs` (for the reclaim banner; populated by server in `fight_start` payload — that wiring is a v5.2.1 follow-up if not present yet).
- **All `accept_wager` user-facing copy** (Tavern modal, fight-request toast) updated to "request_accept_wager" / "request_accept_wager + approve" v5.2 handshake language.

---

## Architecture decisions (judgment calls made in STEP 5)

1. **Server is WS-mediated, not event-driven.** Pre-STEP-5 there was no chain-event subscriber. The new v5.2 handshake handlers follow the same pattern: clients sign tx → send WS message with digest → server waits for finality + probes chain → updates lobby + broadcasts. A dedicated chain-event indexer is a larger architectural step (deferred to v5.3 if needed).

2. **Creator signs `wager_accepted` after approve.** v5.1 had the challenger send `wager_accepted` after signing accept_wager. v5.2 has the creator send `wager_accepted` after signing approve_challenger. The gate's self-check was relaxed to handle this — only rejects self-accept when `targetChainStatus !== STATUS_ACTIVE`. This keeps the fight-start machinery as a single code path across both versions.

3. **No periodic server-side janitor for `cancel_expired_challenge`.** The 5-min PENDING_APPROVAL timeout is permissionless — any participant (or the frontend "Clear expired" button) can fire it. We don't add a server-side cron for this (matches existing v5.1 behaviour for `cancel_expired_wager`). If real-world data shows stale pending wagers piling up, a janitor is a future enhancement.

4. ~~`fight.wagerAcceptedAtMs` left server-side TODO.~~ **RESOLVED 2026-05-30 (STEP 5 addendum).** New `getWagerAcceptedAt(wagerMatchId)` in `server/src/utils/sui-settle.ts` reads chain `WagerMatch.accepted_at` directly. `createFight` extended with `wagerMatchId?` and `wagerAcceptedAtMs?` parameters (no longer set post-create). `buildFightStatePayload` surfaces both. Frontend banner activates on real fight state with deterministic 30-min countdown anchored to chain timestamp. Eligibility logic extracted to pure `computeReclaimEligibility(fight, viewerWallet, nowMs)` in `wager-constants.ts`; new `qa-reclaim-eligibility.ts` gauntlet (14 assertions) drives every boundary deterministically with injected clock.

5. **Test scaffolding additions:** `qa-wager-constants.ts` (NEW, 19 assertions) pins the chain-mirror + no-magic-numbers contract; `qa-reclaim-eligibility.ts` (NEW, 14 assertions) pins the banner visibility gate. Other gauntlets touched (`qa-arena-aborts`, `qa-wager-accept-gate`, `qa-wager-accept-race`, `qa-create-wager-orphan-guard`) updated for the new flow shape.

---

## Test totals (after this session)

### Move
| | |
|---|---|
| `sui_combats::arena_tests` | **51 / 51** |
| `sui_combats::character_tests` | 20 / 20 |
| `sui_combats::equipment_tests` | 20 / 20 |
| `sui_combats::item_tests` | 14 / 14 |
| **TOTAL** | **105 / 105 PASS** |

### Frontend gauntlets (all green this session)

| Gauntlet | Pass / Fail |
|---|---|
| `qa-slot-type` | 11 / 0 |
| `qa-equipment-aborts` | 19 / 0 |
| `qa-two-handed-loadout` | 19 / 0 |
| `qa-two-handed-stage-classifier` | 10 / 0 |
| `qa-equip-picker` | 87 / 0 |
| `qa-hall-of-fame` | 198 / 0 |
| `qa-arena-aborts` | **67 / 0** *(was 41/13 pre-cut-over)* |
| `qa-wager-accept-gate` | **71 / 0** *(was 67/1)* |
| `qa-wager-accept-race` | **16 / 0** *(was 10/6; rewritten for v5.2 wire)* |
| `qa-wager-form` | 47 / 0 |
| `qa-orphan-sweep` | 30 / 0 |
| `qa-create-wager-orphan-guard` | **15 / 0** *(was 9/6; updated for 7 sign sites)* |
| `qa-wager-register` | 25 / 0 |
| `qa-wager-constants` *(NEW)* | **19 / 0** — pins single-source-of-truth |
| `qa-reclaim-eligibility` *(NEW)* | **14 / 0** — pins banner visibility gate (deterministic clock injection) |

### Build hygiene
- `cd server && npx tsc --noEmit` — clean
- `cd frontend && npx tsc --noEmit` — clean
- `cd frontend && npx next build` — clean (static export, 5 routes generated)

---

## Files touched in STEP 5 (frontend)

| File | Change |
|---|---|
| `frontend/src/lib/arena-aborts.ts` | Codes 12–23 added with friendly copy |
| `frontend/src/lib/wager-constants.ts` | **NEW** — chain-mirror constants + helpers |
| `frontend/src/lib/sui-contracts.ts` | 6 new wager builders; `buildCreateWagerTx` takes `&Character`; `buildAcceptWagerTx` removed |
| `frontend/src/types/ws-messages.ts` | 5 new client→server messages + `wager_lobby_updated` server→client |
| `frontend/src/types/game.ts` | `WagerLobbyEntry` extended (status, playerALevelSnapshot, pendingChallenger); `FightState` extended (wagerMatchId, wagerAcceptedAtMs); `PendingChallenger` interface |
| `frontend/src/hooks/useGameStore.ts` | New `UPDATE_WAGER_LOBBY_ENTRY` action + reducer branch |
| `frontend/src/app/game-provider.tsx` | New `wager_lobby_updated` WS handler case |
| `frontend/src/components/fight/matchmaking-queue.tsx` | `WagerLobbyCard` rewritten for v5.2 state machine; `handleAcceptWager` → `handleRequestAccept`; 4 new handlers (approve / decline / withdraw / cancel-expired-challenge); level-bracket pre-check |
| `frontend/src/components/fight/reclaim-stalled-wager-banner.tsx` | **NEW** — referee-liveness escape hatch UI |
| `frontend/src/components/layout/game-screen.tsx` | Mounts ReclaimStalledWagerBanner above FightArena |
| `frontend/src/components/social/player-profile-modal.tsx` | User copy updated for v5.2 handshake |
| `frontend/src/components/social/fight-request-toasts.tsx` | User copy updated for v5.2 handshake |

## Files touched in STEP 5 (server)

| File | Change |
|---|---|
| `server/src/types.ts` | `WagerLobbyEntry` v5.2 fields + `PendingChallenger` interface |
| `server/src/ws/wager-accept-gate.ts` | New `STATUS_PENDING_APPROVAL = 3`; self-check relaxed for v5.2 creator-as-caller |
| `server/src/data/orphan-wager-recovery.ts` | New PENDING_APPROVAL (status=3) branch |
| `server/src/ws/handler.ts` | New `handleWagerHandshake` dispatcher for 5 message types; dispatcher cases added; `dbDeleteWagerInFlight` import added |

## Test/script files added or updated

| File | Change |
|---|---|
| `scripts/qa-wager-constants.ts` | **NEW** — chain-mirror + no-magic-numbers gauntlet (19 pass) |
| `scripts/qa-arena-aborts.ts` | Allowed-codes set extended to 0–23 |
| `scripts/qa-wager-accept-gate.ts` | Updated to assert v5.2 handshake call sites |
| `scripts/qa-wager-accept-race.ts` | Rewritten for `handleRequestAccept` + `wager_request_accepted` wire |
| `scripts/qa-create-wager-orphan-guard.ts` | Updated for 7 signing sites (v5.2 wager-fairness) |

---

## What's NOT done — explicit follow-ups

1. ~~`fight.wagerAcceptedAtMs` server population.~~ **DONE 2026-05-30 (STEP 5 addendum).** Server now fetches chain `WagerMatch.accepted_at` via new `getWagerAcceptedAt` helper at fight-start, passes it through `createFight`, surfaces it in `buildFightStatePayload`. `wagerMatchId` also explicitly threaded through the same path (was being set post-create; now passed as a constructor arg). Banner activates off real fight state — no dev-tools needed.
2. **Catalog mint.** No items minted into v5.2 TREASURY kiosk yet. v5.1 kiosk + items are untouched (different package type). For QA, players use existing v5.1 character + can buy items from v5.1 kiosk — but those Items can't be re-listed under v5.2's TransferPolicy. Migration is its own step; see scripts/mint-v5.1-13slot-catalog.ts for the pattern when ready.
3. **Live two-wallet QA.** Everything is staged for the gauntlet in [`docs/V5.2_QA_GAUNTLET.md`](docs/V5.2_QA_GAUNTLET.md). When you return, that's the run-list — and reclaim is now live-testable (no dev-tools workaround needed).
4. **Branch not pushed, not merged.** Standing rules respected.

---

## Feature — 2026-06-02 (Test Bot Fight, off-chain solo practice)

The Arena's "Friendly" tile is now an instant bot match. Players arriving
at the testnet preview can practice without a human opponent.

**Trigger.** New WS message `start_bot_fight`. The Arena tile (now
labelled "Test Bot Fight", CTA "Fight a Bot") sends this instead of
`queue_fight` when the friendly slot is selected. Server creates the
fight + sends `fight_start` within the same tick — no matchmaking, no
queue, no `queue_joined` bounce.

**Bot character.** Synthetic Character built by `buildBotCharacter` in
fight-room.ts — mirrors the player's level + stats, reference-shares
equipment for visual fidelity, sentinel wallet `bot:<uuid>`,
`onChainObjectId: undefined` (the single signal `createFight`-class
code uses to decide whether to read chain). NEVER added to
`characters` / `walletToCharacter` registries → invisible to every
read path.

**Bot moves.** `combat.ts::generateRandomAction(offhand)` — the same
function the AFK-timeout fallback uses. Shape-correct by construction
so `validateTurnAction` always accepts. Bot's action is filled
inside `startNextTurn` the moment the turn opens.

**Chain-zero audit.**
- `createBotFight` skips the `findCharacterObjectId` +
  `fetchEquippedFromDOFs` + `setFightLockOnChain` block in `createFight`.
- `finishFight` short-circuits before any `settle*` / `update*` /
  `set_fight_lock` / `dbSave*` call when `fight.type === 'bot'`.
- Player `wins/losses/draws/xp/rating/unallocatedPoints` bit-identical
  before and after (verified by qa-bot-fight gauntlet).

**Tavern friendly is unchanged.** Human-vs-human friendly via
tavern challenges (handler.ts:133 `requestType === 'friendly'`
→ `createFight`) still works as before. Only the Arena tile entry
swapped.

**Tests.** `scripts/qa-bot-fight.ts` — 28 assertions, 7-turn live
fight, all ✔. Run via `cd server && NODE_PATH=node_modules npx tsx
../scripts/qa-bot-fight.ts`.

---

## Live-QA hotfix — 2026-06-01 (atomic draw-settlement + treasury finality)

Live mutual-KO test surfaced a treasury gas-coin version race AND the
missing fight-lock release in the v5.1 draw branch.

**Symptoms.**
- `[Character.setFightLock] attempt 1/3 failed: object 0x75914b66… is
  unavailable for consumption`, same for `updateAfterFightDraw` +
  `settleTie`. settle_tie retried through (digest
  `3KFkL7mfUwzzXBmVDbyG9YL7uPLpu1Vpu1pP5wX5jLgH`), draws ticked
  on chain (both characters `draws=1`), but lock release never even
  fired — the draw branch had no `setFightLockOnChain` call. Players
  saw `arena::create_wager:53` until the chain's 10-min auto-expire.

**Root causes (2, independent).**
1. *Treasury-queue inter-tx race.* `signAndExecuteTransaction` returned
   before the new gas-coin version was observable on the same
   load-balanced fullnode → next queued sign read stale.
2. *Missing lock-release in draw branch.* `finishFight` draw arm
   (fight-room.ts:766-854) cleared no fight-locks — v5.1 parity miss
   vs. the win/loss arm (lines 647-665).

**Fix (atomic-PTB + finality-wait, ships together).**
- `server/src/utils/sui-settle.ts::settleDrawBundleOnChain` — single
  PTB does `settle_tie` (if wager) + `update_after_fight_draw`(A) +
  `set_fight_lock`(A, 0) + same for B. Sui's locked-input-version
  semantics close the intra-bundle race structurally. Returns parsed
  `DrawRecorded` + `LevelUp` effects per character so the server
  cache mirrors chain truth (also fixes the stale Hall-of-Fame D=0
  cache).
- `execAsTreasury` now awaits `client.waitForTransaction(digest, 5s)`
  inside its queue slot — closes inter-tx race for every OTHER
  treasury path (fight-start lock acquire, win/loss settle, future
  admin ops).
- Draw branch rewritten to call the bundle once + mirror per-character
  effects + send fresh `character_data` / `character_updated_onchain`
  / `character_leveled_up` / `wager_settled` messages. Drops
  `wager_in_flight` row on the same digest.

**Admin triage tool.**
`scripts/admin-clear-fight-lock.ts` — `npx tsx scripts/...
<characterId> [...]`. Reads the on-chain DF, skips the tx if already
unlocked, otherwise treasury-signs `set_fight_lock(_, 0)` and
verifies. Used to clear the 2026-06-01 stuck pair (txs
`F594APiJ4MLnU9RtonfVreVvKF1TJiPZMNfyE1H999Nu` for Sx,
`6ikZAEdem3quUay7ddAPk7mppL4gdbrfYT3sdEF8cncr` for Mr_Boss).

**Move impact.** None — the bundle composes existing v5.2 entries.
Move tests stay 105/105.

---

## Live-QA hotfix — 2026-06-01 (Supabase schema drift)

Two Railway-log errors surfaced during the first v5.2 live wager (env-vars
patch confirmed setFightLock + updateAfterFight working on chain):

- `[DB] Failed to save character: Could not find the 'draws' column of
  'characters' in the schema cache`
- `[DB] Failed to save fight: insert or update on table "fight_history"
  violates foreign key constraint "fight_history_winner_wallet_fkey"`

**Diagnosis.** The server has carried `Character.draws` since v5.1
(mirrored from chain `Character.draws: u32`) and `dbSaveCharacter`
(server/src/data/db.ts:53) writes the field on every upsert. Migration
001 shipped `characters` with `wins`+`losses` but no `draws`; migration
002 backfilled `unallocated_points` + `onchain_character_id` and forgot
the column. PostgREST rejected every upsert ⇒ characters table stayed
empty on live ⇒ subsequent fight_history insert violated the
winner_wallet FK (parent row never persisted). The draw branch in
`finishFight` (fight-room.ts:766-854) does NOT call `dbSaveFight`, so
the "NULL winner on draw" hypothesis is ruled out — Bug 2 was a pure
downstream of Bug 1.

**Fix.** `server/src/data/migrations/005_v52_draws_column.sql`:
`ALTER TABLE characters ADD COLUMN IF NOT EXISTS draws INTEGER NOT
NULL DEFAULT 0` + `NOTIFY pgrst, 'reload schema'` (PostgREST cache
reload — without it the next REST call still hits the stale cache on
the hosted Supabase tier). No app-code change — writer already
matches the new column shape. `setup-db.mjs` extended with a
column-level probe so the operator gets `✓ draws column (v5.2)` (or
the explicit `✗ MISSING — apply migration 005`) on every run.

---

## v5.1 status — untouched

- v5.1 package `0x308645f3…3717` still live on testnet.
- v5.1 shared objects + caps unchanged.
- v5.1 wagers (if any pre-cutover) settle under v5.1 rules — frontend now points only at v5.2 so they'd need direct PTB calls to settle.
- Rollback: `cp server/.env.v5.1-backup server/.env && cp frontend/.env.local.v5.1-backup frontend/.env.local` and restart both processes; or `git checkout main` to reset code.

---

## Standing rules (unchanged)

1. **No commit, no push** without explicit user signal. (Local commits in STEP 5 are saved on the v5.2 branch; no remote push.)
2. **No merge to `main`** until v5.2 testnet QA fully done AND external smart-contract audit clears v5.2.
3. **Fix-as-we-go, no deferrals.** Honoured this session.

---

## Reference

| Doc | Role |
|---|---|
| **`STATE_OF_PROJECT_2026-05-30.md`** | **This doc — canonical state** |
| `STATE_OF_PROJECT_2026-05-29.md` | Yesterday's state (v5.1 QA complete, v5.2 spec drafted) |
| `docs/V5.2_QA_GAUNTLET.md` | **The live-testnet QA script — the most-useful artifact, run top-to-bottom** |
| `docs/V5.2_WAGER_FAIRNESS_SPEC.md` | v5.2 spec (with §14 implementation deviations) |
| `deployment.testnet-v5.2.json` | v5.2 deploy record — package id, registries, caps, policy, displays, gas |
| `deployment.testnet-v5.1.json` | v5.1 deploy record (kept for parity reference) |
| `MAINNET_PREP.md` | Updated v5.2 row reflects current status |
| `SESSION_HANDOFF_2026-05-29.md` | Yesterday's handoff |
| `CHANGELOG.md` | Day-by-day change history |
| `CLAUDE.md` / `AGENTS.md` | GitNexus AI tooling integration; runtime block bumped to v5.2 IDs |
