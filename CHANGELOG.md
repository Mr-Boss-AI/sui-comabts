# Changelog

All notable changes to SUI Combats. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> Versioning scheme: the on-chain `packageId` defines the major.
> v5.0.0 was the 2026-04-27 testnet `sui client publish`. v5.1 will be
> a fresh publish (per `MAINNET_PREP.md §A` — Sui upgrades don't retire
> bytecode, so the v5 package's old code stays callable forever; a new
> publish is the only safe path). Subsequent v5.x entries are server +
> frontend changes against the same `packageId`.

---

## [Unreleased] — Bucket 2 wrap, end of 2026-05-04

> Branch `feature/v5-redeploy` end-of-day push. **Not a chain
> re-publish.** Server + frontend hardening + comprehensive doc pass.
> Mainnet still gated on the v5.1 republish (see `STATE_OF_PROJECT_2026-05-04.md`
> § v5.1 Contract Republish Bundle for the full Move work list).

### Added — Bucket 2 close-out (Wager / 2H / Multi-queue / WS / Level-up)

- Frontend `canAcceptWager` predicate + Accept-button gate +
  `handleAcceptWager` early-return — closes silent-accept where a
  player with their own open wager could still chain-succeed an
  `accept_wager` on someone else's wager (commit `6512e10`,
  Bucket 2 Fix A).
- Server `decideAcceptOutcome` predicate + auto-rollback path —
  if the chain accept slipped past Fix A, the server now admin-cancels
  both wagers (50/50 split for ACTIVE; refund-to-creator for WAITING)
  so neither side stays stuck (commit `20feb72`, Bucket 2 Fix B).
- Frontend `TWO_HANDED_NAMES` set + `evaluateTwoHandedConflict`
  predicate covering both directions (2H → mainhand requires offhand
  empty; 2H → offhand always blocked) + slot-picker locks + action-
  gate defense in depth (commits `3319628` + `09934a6`).
- Frontend `computeBusyState` + server `evaluateServerBusy` predicates
  — single source of truth for "player is in fight / has open wager
  / queued / pending-accept", gates every queue/wager entry point,
  with cross-cleanup in `handleWagerAccepted` proceed branch
  (commit `6e2f2d3`, Bucket 2 Fix 1).
- Frontend `useGameSocket.send()` queue-and-drain — outbound messages
  fired during reconnect windows queue (cap 200, stale > 30 s
  discarded) instead of erroring; drains in FIFO on reconnect
  (commit `f0358d5`, Bucket 2 Fix 2).
- Server `character_leveled_up` WS broadcast post `update_after_fight`
  + frontend `LevelUpModal` celebration with "Allocate Stat Points"
  CTA + `mergeLevelUpEvent` for multi-burst level-ups
  (commit `97369ff`, Bucket 2 Fix 3).
- Polish: hide irrelevant fight-mode cards when busy instead of
  greying them out — `decideMatchmakingRender` predicate drives
  slot-by-slot rendering decisions (commit `dc543c6`).

### Added — Lv6-Lv8 v5.1 NFT catalog (Bucket 1 close)

- 9 epic / legendary items minted to TREASURY's kiosk for cross-build
  buy testing (Bloodletter Gauntlets, Shadowstep Wraps, Skullsplitter
  Helm, Hunter's Hood, Pendant of Wrath, Whisperwind Amulet, Dancer's
  Aegis × 2 duplicate test, Skullcrusher Maul). TREASURY kiosk
  auto-created during the mint pass (`0x47a5072d…`). Pinata folder
  `bafybeihrlw3jdq6ws2m3bjrjoyisvyyvtsp6mb2wnd6lps5hjtgatbwh3i`
  (commits `c8b8ec2` script, `db58941` data).

### Added — test gauntlets

- `qa-mint-catalog.ts` — 236 assertions; static spec validation
  for the v5.1 Lv6-Lv8 catalog (enums, bonuses, prices, deployment
  alignment).
- `qa-wager-accept-gate.ts` — 39 PASS (extended this session with
  cross-mode `callerInMatchmakingQueue` cases).
- `qa-multi-queue-isolation.ts` — 60 PASS; frontend +
  server predicate symmetry across 6 canonical scenarios.
- `qa-ws-readystate.ts` — 37 PASS; `drainPendingMessages` +
  `capPendingQueue` + integration scenarios.
- `qa-level-up-modal.ts` — 44 PASS; gating decision tree, format
  helpers, defensive validator, multi-burst merge.
- `qa-busy-state-render.ts` — 23 PASS; `decideMatchmakingRender`
  slot-by-slot decision tree.
- `qa-equip-picker.ts` — extended 53 → 78 (added 25 two-handed
  enforcement assertions in section 12.5).

**Test totals: 731 → 1195 PASS across 14 → 20 static gauntlets,
plus 35/35 Move unit tests.**

### Recovered (this session)

- Stuck 0.1 SUI wager `0xeade9baafda8ccb61aaf26d98c55c8bc4528f682b622476628e68f7970b16432`
  (created during a server-down window; never registered in lobby).
  Recovered via `POST /api/admin/cancel-wager` —
  tx `EQVSgRaymDz3Xj71RenMxFZDKsbH5AhqWhaJhUPPYLYE`. Permanent fix
  for the family is `OpenWagerRegistry` in the v5.1 republish bundle.

### Changed

- Reconnect grace timer is now a per-fight cumulative budget, not
  per-cycle — abusers who ping-pong run out, honest wifi blips still
  get the full window (commit `9d7dd19`).
- Wager stake input bound to a string and validated on submit —
  clearable, partial keystrokes don't snap back (commit `a26535e`).
- Outcome modal replays on rejoin if the player was offline at
  settle time (commit `20f3750`).
- Slot picker keeps locked items, dimmed with a red `Lv N` badge
  instead of silently filtering them out (commit `fd56b4a`).
- Character page HP/ATK tables synced element-by-element with
  server's rebalanced `LEVEL_HP` / `LEVEL_WEAPON_DAMAGE` (commit
  `fe9c883`).

### Documentation

- `STATE_OF_PROJECT_2026-05-04.md` (NEW) — comprehensive end-of-
  Bucket-2 snapshot consolidating STATUS.md + SESSION_HANDOFF +
  MAINNET_PREP + memory seeds + commit history + GDD scope.
- `STATUS.md` reorganised — high-level shape only, points at
  STATE_OF_PROJECT for the deep dive.
- `README.md` brought current — test counts (1195/20), Bucket 2
  close-out features, pointer to STATE_OF_PROJECT + CHANGELOG.
- `SESSION_HANDOFF.md` (2026-05-03 evening) marked SUPERSEDED.

---

## [v5.x] — 2026-05-03 (evening QA pass)

### Fixed

- Cumulative grace timer abuse — verified live across 3 cycles
  (60s → 14s → 9s → forfeit) (commit `9d7dd19`).
- Wager stake input snap-back — fully clearable, validates on
  submit (commit `a26535e`).
- Outcome modal silent for player who reconnects after settle —
  server caches per-wallet outcome, replays via `recent_fight_settled`
  with localStorage dedupe (commit `20f3750`).
- Character page HP/ATK consistency with combat math — server
  `LEVEL_HP` / `LEVEL_WEAPON_DAMAGE` mirrored to frontend element-
  by-element. STR/DEX/INT/END stat bars compile correctly under
  Tailwind v4 JIT (commit `fe9c883`).
- Slot picker hides locked items cliff — picker now keeps every
  slot-compatible item the player owns; locked items render dimmed
  with `Lv N` badge (commit `fd56b4a`).

### Added

- 5 new test gauntlets (qa-equip-picker, qa-combat-stats, qa-wager-
  form, qa-reconnect-modal, qa-grace-budget) — 252 new assertions.

---

## [v5.x] — 2026-05-02 (live-test bug sweep)

### Fixed

- BUG E — multi-Character wallet picks wrong NFT for hot paths.
  Server pin (`Character.onChainObjectId`) surfaced to frontend via
  the wire payload; `fetchCharacterNFT` accepts a pinned-id hint
  (commit `dc28eff`).
- BUG B — "Not authenticated" toast after allocate. New
  `applyLocalAllocate` helper + `LOCAL_ALLOCATE` reducer; game-
  provider suppresses the auth-pending error toast specifically
  (commit `413593e`).
- BUG C — Naked-stats gap on chain-restore. Extracted
  `hydrateDOFsForCharacter`, called from both auth and chain-restore
  paths (commit `413593e`).
- BUG D — `auth_ok` character payload ignored. Game-provider
  dispatches SET_CHARACTER on receipt, closing the frame-level
  window where game-screen rendered with `character=null` after
  auth (commit `413593e`).
- Silent-WS-loss orphan-wager class — new `wager-register.ts`:
  WS-send-then-ACK with REST fallback to `/api/admin/adopt-wager`
  (commit `6871df0`). 25-test gauntlet.
- BUG 1 — `allocate_points` MoveAbort code 2 (`ENotEnoughPoints`)
  due to server XP ahead of chain. New `effectiveUnallocatedPoints`
  clamp returns `min(server, chain)` when chain hydrated. Plus
  amber "Chain state is catching up" hint (commit `b39202d`).
- BUG 2 — Save-loadout fight-lock race. Reordered post-fight
  treasury queue: `set_fight_lock(0)` fires first, releases lock in
  ~2-5s instead of ~10-25s (commit `b39202d`).
- BUG 3 — Off-chain "fake loot" violated NFT-only contract. Removed
  `rollLoot` call from `finishFight`; the function survives in
  `game/loot.ts` for v5.1 to reuse for on-chain admin-signed Item
  NFT minting (commit `b39202d`).

---

## [v5.x] — 2026-04-30 (Blocks A-D shipped)

### Added

- Block A — Duplicate-Character mint guard (Layers 1+2). New
  `auth-phase.ts` state machine; server pre-mint guard via
  `findAllCharacterIdsForWallet` + `shouldRejectDuplicateMint`
  predicate. Layer 3 (Move `CharacterRegistry`) deferred to v5.1
  (commit `a462fec`). 63-test gauntlet.
- Block B — Supabase wiring + orphan-sweep instrumentation. New
  migration `002_wager_in_flight.sql` + boot-time sweeper
  `data/orphan-wager-recovery.ts` (commit `999300e`). 30-test
  gauntlet. End-to-end live test gated on Supabase provisioning.
- Block C1 — Reconnect grace window. Server pauses fight timer on
  WS drop; persistent banner with countdown for the opponent;
  full state rehydrate on rejoin via `fight_resumed`. 60s default
  window (commit `bd631c9`). 35-test gauntlet.
- Block C2 — Marketplace gap-fill retry budget. 5 attempts with
  1/3/9/27 s backoff; on exhaustion, schedules full reconnect
  (commit `468a43e`).
- Block C3 — Marketplace coldSync `withChainRetry` per page —
  3 attempts with 1/3 s backoff (commit `468a43e`).

---

## [v5.0.0] — 2026-04-27 — Testnet publish

### Added

- Fresh `sui client publish` of all 5 modules
  (character / item / equipment / arena / marketplace + royalty_rule).
- New `packageId`
  `0xa7dc2dabea6acc2db1a9599a0c1e003ad6b2e6064a2847687bc93037a662e1c1`,
  new `AdminCap`, new `UpgradeCap`, new `Publisher`,
  new `TransferPolicy<Item>`, new `Display<Character>`,
  new `Display<Item>`.
- 22-NFT starter catalog minted via `scripts/mint-v5-catalog.ts`
  — 11 items to mr_boss, 11 items to sx (commit `dcca786`).
- Production XP thresholds restored (no more lowered-for-testing
  values).
- Frontend wired to v5: JWT auth, balance UI, 10 slots, env-throws
  on missing required ids (commit `487502f`).
- Server: SDK migration to `@mysten/sui` 1.x, JWT auth, retry
  pattern for treasury queue admin calls, DOF reads via gRPC
  (commit `26cd8a9`).
- 35/35 Move unit tests passing.

### Removed

- All legacy v1 `equip_*` / `unequip_*` stub functions (the
  `abort EDeprecated` pattern from Phase 0.5 is no longer needed
  on a fresh publish — see `MAINNET_PREP.md §A`).
- Build artefact `contracts/build/` no longer tracked
  (commit `96546e7`).

---

## [v4.x] — 2026-04-21 (loadout-save flow)

### Added

- Atomic save-loadout PTB: stage equip/unequip locally; one wallet
  popup commits all dirty slots in a single PTB (commit `b7b8eac`).
- LOADOUT_DESIGN.md — D1=PTB-of-primitives, D2=skip auto-save,
  D3=strict server validation, D4=pending-inactive-during-fight,
  D5=keep-pending-on-cancel (commit `6a33bc1`).

---

## [v4.x] — 2026-04-18 (Phase 0.5 — DTC equipment + fight-lock)

### Added

- On-chain dynamic-object-fields equipment binding (10 slots).
- Fight-lock DOF prevents equipment swaps mid-combat.
- Marketplace listing fee (0.01 SUI flat per list call).
- 2.5 % royalty rule on `TransferPolicy<Item>` (commit `08ff991`).

### Fixed

- WebSocket reconnect loop on session replacement
  (commit `9b3196e`).

---

## [v4.x] — 2026-04-15 (initial wager escrow)

### Added

- On-chain wager escrow integration (commit `e4283a4`).
- Living Character NFTs, wager lobby hardening, Character tab
  redesign (commit `c4c8a96`).

---

## [v0.x] — 2026-04-10 (initial commit)

### Added

- Initial SUI Combats project skeleton (commit `213557e`).
- README + MIT LICENSE (commit `d5aa294`).
- Sui Foundation grant application draft (commit `316cf81`).
- Walrus Sites deployment support (commit `91a83a7`).
- Root `package.json` with vercel-build script (commit `1d2ac7c`).
- Security hardening pre-public-release: secrets purged before
  the repo flipped public (commit `e95bc34`).

---

## Reference

- `STATE_OF_PROJECT_2026-05-04.md` — comprehensive snapshot;
  see § Commit Log for the full ordered list of every commit
  on `feature/v5-redeploy` since branch start.
- `STATUS.md` — high-level current state.
- `MAINNET_PREP.md` — mainnet deploy protocol + threat model.
- `git log --oneline` — chronological source of truth.
