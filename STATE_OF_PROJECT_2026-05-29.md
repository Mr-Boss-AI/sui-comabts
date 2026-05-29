# SUI Combats — State of the Project, 2026-05-29 (v5.1 testnet hammered — two-wallet QA pass complete)

> **v5.1 IS LIVE on testnet** and has now been hammered with a
> two-wallet, dual-signing-path QA session. Branch `feature/v5.1-contracts`
> @ `0ab7677` on origin (unchanged from 2026-05-28) **+ three
> uncommitted working-tree fixes** that were live-verified today.
> Package `0x308645f3…3717` unchanged. **Mainline `main` stays at
> `08ff991` (v4-era) until v5.2 + external audit clears.**
>
> This doc supersedes [`STATE_OF_PROJECT_2026-05-28.md`](STATE_OF_PROJECT_2026-05-28.md)
> as canonical state. The 2026-05-28 doc remains as history.

---

## 🚨 UNCOMMITTED working-tree fixes (commit next session, no merge)

| Fix | Files | Status |
|---|---|---|
| Scout-modal equipped stats + 13 slots | `server/src/utils/wire-sanitize.ts` (new) · `server/src/ws/handler.ts` · `server/src/data/player-profile.ts` | ✅ live-verified |
| Arena wager-card clickable scouting | `frontend/src/components/fight/matchmaking-queue.tsx` | ✅ live-verified |
| Mutual-KO DRAW modal + sound | `frontend/src/components/fight/fight-result-modal.tsx` · `frontend/src/app/game-provider.tsx` | ✅ live-verified |

Server `tsc --noEmit` clean. Frontend `tsc --noEmit` clean. Next-session
action: commit to `feature/v5.1-contracts`, no merge to `main`.

---

## TL;DR

| Field | Value |
|---|---|
| Phase | **v5.1 testnet hammered + flagship paths live-verified.** Next phase: v5.2 trust + content (`sui::random`, `respec`, `settle_wager_attested`) + audit prep |
| Branch | `feature/v5.1-contracts` |
| HEAD on origin | `0ab7677` (unchanged today; 3 fixes uncommitted in working tree) |
| Mainline | `main` untouched at `08ff991` (v4-era — standing rule, no merge until v5.2 + audit) |
| v5.1 package id | `0x308645f3d85ba6d7647f660610faba5dbdae2822819939bc917302a20cf33717` |
| Move tests | **71 / 71 PASS** (unchanged) |
| Server `tsc --noEmit` | clean (after today's fixes) |
| Frontend `tsc --noEmit` | clean (after today's fixes) |
| Backend `:3001` `/health` | ok |
| Frontend `:3000` HTTP | 200 |
| Test wallets | Mr_Boss (Slush) `0x06d6cb67…9624` Lv2, geared Tank · Sx (zkLogin) `0x03c33df0…985f` Lv2, full Lv1 Ponke loadout |
| TREASURY | `0x975f1b34…19d4d` — ~comfortable, paid ~0.000887 SUI gas on mutual-KO settle today |
| Marketplace | 26 Lv1 Ponke originally; ~13 sold to Sx today via zkLogin gasless buy |

---

## What changed vs 2026-05-28

**Chain state — unchanged.** Same v5.1 package, same registries, same
Display objects, same kiosk. No new contract publish, no migration.

**Server state — three changed files, all uncommitted.** The wire-shape
translator was extracted to a shared util so the Tavern scout-modal
path matches `character_state`'s translator. See *Today's fixes* below.

**Frontend state — three changed files, all uncommitted.** Draw modal
+ sound branch landed. Arena wager-card became a clickable scout entry
point.

**Live-verified set expanded significantly.** Everything the
2026-05-28 handoff listed as "NOT yet verified in browser" except
two-handed weapon blocking is now ✅. Plus a v4-era regression
(`allocate_points`) was confirmed fixed across both signing paths.

---

## What's LIVE in v5.1 testnet (verified in browser this session)

### Two-wallet, dual-signing-path QA — Mr_Boss (Slush) + Sx (zkLogin)

| Path | Wallet | Live state |
|---|---|---|
| Slush (native Sui wallet) | Mr_Boss `0x06d6cb67…9624` | v5.1 character, Tank build, Lv2 (allocated STR 9 / END 8) |
| zkLogin (Google) | Sx `0x03c33df0…985f` | v5.1 character, full Lv1 Ponke loadout, Lv2 (allocated INT 11) |

The zkLogin path has now carried mint + buy + equip + create_wager +
accept_wager + allocate_points end-to-end, gaslessly, without a wallet
popup. This is the first session where the two signing paths were
hammered side-by-side against the v5.1 chain.

### Flagship paths live-verified ✅

| Path | Status |
|---|---|
| zkLogin gasless buy + equip walk (13 Lv1 items, 2 PTBs) | ✅ |
| Real-time wager-lobby sync across tabs | ✅ |
| Full wager cycle (create → accept → fight → `settle_wager` payout) — Slush + zkLogin | ✅ |
| Gear actually changes combat outcomes (shield blocks, equipped stats propagate) | ✅ |
| `allocate_points` (v4-killer — `MoveAbort 2` regression) on Slush + zkLogin | ✅ |
| Mutual-KO `settle_tie` end-to-end chain (event + escrow + refund + draws counter) | ✅ |
| 13-slot scout modal (after today's fix) | ✅ |
| Arena wager-card scout (new) | ✅ |
| Draw modal + refund line (after today's fix) | ✅ |

### Mutual-KO end-to-end — the flagship trial

A live geared 0.1 SUI wager (Mr_Boss vs Sx) ended on a simultaneous KO
turn 13.

- `combat.ts::checkFightEnd` correctly returned `draw: true`.
- `settle_tie` dispatched via TREASURY AdminCap; first attempt hit a
  transient gas-coin version conflict (parallel
  `update_after_fight_draw`), retry attempt 2 succeeded.
- `arena::WagerTied { match_id, player_a, player_b, refund_each: 100000000 }` emitted.
- WagerMatch `0x19a4b6c4…4585d` chain-read: `escrow: 0`, `status: 2`.
- Balance changes: Mr_Boss +0.1 SUI, Sx +0.1 SUI, TREASURY −~0.000887 SUI gas.
- `draws: u32` ticked on both Characters.

| Tx | Digest |
|---|---|
| `settle_tie` | `3GcBVimynSDa35vnZmZifwmTeYyu5qhNPRWcaEMrbVzp` |
| `update_after_fight_draw` (A) | `6r8SvRB6M73ZKqFjH5Npu2Rd55cVdjHYXvAfLSBTdsoS` |
| `update_after_fight_draw` (B) | `4Mjoe3pD7Ya2VZb7VbDzcix2Tr1ZHHeb5oaQ49zeTDxD` |

---

## Today's fixes (uncommitted in working tree)

### (1) Scout-modal stats + 13 slots — `wire-sanitize.ts` extraction

`data/player-profile.ts::cloneEquipment` was a v5.0 10-slot map that
also shallow-cloned items, leaving server-shape `statBonuses` keys
(`strength / hp / damage / critBonus / armor`) on the wire. The
frontend's `computeDerivedStats` and the modal's `eqBonusSum` both
read frontend-shape keys (`strengthBonus / hpBonus / attackBonus /
critChanceBonus / armorBonus`) → all bonuses coerced to `0`. Plus
`ring3 / pants / bracelets` dropped from the wire entirely.

The correct wire-shape translator already existed in
`ws/handler.ts::sanitizeItem` (used for `character_state`). The
scout-modal path was a parallel-but-broken copy. Extract:

- New `server/src/utils/wire-sanitize.ts` — single source of truth.
  Explicit 13-slot v5.1 list so missing slots ship as `null` (empty
  placeholder render). Avoids the cycle
  `handler → tavern-handlers → player-profile → handler`.
- `server/src/data/player-profile.ts` — `cloneEquipment` deleted;
  `characterToProfileWire` now calls `sanitizeEquipment`.
- `server/src/ws/handler.ts` — inline definitions removed; imports
  from the new util.

This also closes the v5.2-backlog "StatBonuses shape unification"
**at the wire boundary** for the scout-modal path. The internal
server-shape data structure is still server-shape (combat resolver,
DB persistence) — only the wire crossing converts. Full server-side
unification remains v5.2 backlog.

### (2) Arena wager-card scouting (new feature)

`frontend/src/components/fight/matchmaking-queue.tsx::WagerLobbyCard`
is now `role="button"` + Enter/Space keyboard. Clicking the card
fires `OPEN_PROFILE` for `entry.creatorWallet` → the Tavern scout
modal opens. Accept/Cancel buttons `stopPropagation` so they still
fire only their own actions. Own card stays non-inspectable.

This is part of the "Opponent scout system" v5.2 backlog item —
shipped early because the bug fix already had the modal-opening
plumbing in place.

### (3) Mutual-KO DRAW modal + sound

`FightResultModal` had a binary `won = fight.winner === myAddress`
and no draw branch (`winner=null` fell into the loss branch + the
wager row rendered `−0.1 SUI`). Closed:

- `fight-result-modal.tsx` — three-state
  `outcome: 'win' | 'loss' | 'draw'`. `fight.winner == null` (covers
  null + undefined) ⇒ `'draw'`. Title "Draw", big "DRAW" in
  `var(--sc-parchment)` (no colored glow), wager row
  "Refunded · X SUI returned" in bronze (never a minus sign), rating
  row neutral on draw. **Win/loss paths byte-equivalent.**
- `game-provider.tsx` — `fight_end` short-circuits `winner == null`
  to skip both audio cues.

Closes the v5.2-backlog "Frontend Draw modal + W/L/D counter" item
for the modal layer. W/L/D counter rendering across
navbar/profile/history is still a separate backlog item.

---

## What's NOT yet verified in browser

| | Reason |
|---|---|
| Two-handed weapon blocking | The last untested v5.1 chain rule. Equip a slot_type=2 weapon (Nail Plank etc.) — chain MUST abort `EOffhandOccupied (6)` if offhand populated, and `EWeaponIsTwoHanded (7)` if offhand-equip is attempted while a 2H weapon is held |
| More weapon variety in combat | This session used only the Lv1 Ponke starter set; broader weapon-class behaviour (range, 2H, dual-wield) unverified end-to-end |
| Lv2 Scavenger Uncommon equip walk | Both wallets are now Lv2; level-gate flip + Uncommon rarity stat-budget rendering pending |
| Full 13-slot single-PTB `save_loadout` (all 13 dirty) | Tested with 2-PTB walks and a few slot edits; full-13-dirty single PTB still pending |
| W/L/D counter render in navbar / profile / history (`draws` value) | Modal-layer closed today; counter UI surfaces still v5.2 backlog |

---

## Test suite state

| | v5.0 baseline | v5.1 current | Δ |
|---|---|---|---|
| Move unit tests | 35 | **71** PASS | +36 (unchanged from 2026-05-28) |
| Frontend gauntlets | 2,307+ | unchanged | 0 |

No new tests today. The fixes shipped today were closed against live
browser QA + chain-read verification rather than new unit tests;
adding a draw-branch gauntlet and a `sanitizeEquipment` gauntlet
remains an open hygiene item.

---

## Mainnet readiness scorecard

| Track | State (vs 2026-05-28) |
|---|---|
| Phase 2 — design redesign | ✅ shipped earlier |
| Phase A — Sui-latest integration | ✅ shipped (zkLogin Lv1 buy + equip + wager + allocate live today) |
| Phase 3 — v5.1 contracts | ✅ **shipped on testnet 2026-05-28** |
| Two-wallet wager live | ✅ **closed today** (was ⏳ yesterday) |
| Mutual-KO `settle_tie` live | ✅ **closed today** (was ⏳ yesterday — chain-verified end-to-end) |
| Frontend draw modal | ✅ **closed today** (was v5.2 backlog) |
| Two-handed weapon block live | ⏳ remaining v5.1 chain rule — next-session step 1 |
| **#1 mainnet blocker — settlement retry / journal** | ❌ DEFERRED to v5.2 |
| **#2 mainnet blocker — confirm-modal gate** | ❌ DEFERRED to v5.2 |
| **#3 mainnet blocker — `settle_wager_attested`** | ❌ DEFERRED to v5.2 |
| WS Zod validation + rate-limiter middleware | ❌ DEFERRED |
| `sui::random` for loot / fight RNG | ❌ DEFERRED to v5.2 |
| `respec_character` (5 SUI sink + 24h cooldown) | ❌ DEFERRED to v5.2 |
| Empty `catch {}` sweep | ❌ DEFERRED |
| StatBonuses shape unification (full server-internal) | ❌ DEFERRED — closed at wire boundary today |
| W/L/D counter render across surfaces | ❌ DEFERRED — modal-only closed today |
| External smart-contract audit | ⏳ engagement not started; ~2-4 weeks pre-mainnet |
| Production monitoring + alerting | ❌ NOT DONE |
| RPC failover / multi-fullnode | ❌ NOT DONE |
| Bug bounty | ❌ NOT POSTED |

v5.1 has now visibly closed ~55% of the audit's contract-layer items
once the working-tree fixes commit. The mainnet blockers (settlement
retry, confirm-modal gate, attested settlement) are unchanged — all
v5.2 server/frontend work, not contract work.

---

## Files touched on this branch (since `feature/phase-2-design`)

Same as 2026-05-28 plus **three uncommitted today**:

### Server — uncommitted ⚠
```
server/src/utils/wire-sanitize.ts          — NEW (extract: sanitizeItem + sanitizeEquipment, 13-slot guaranteed)
server/src/ws/handler.ts                   — uses shared util (inline defs removed)
server/src/data/player-profile.ts          — broken cloneEquipment deleted; uses sanitizeEquipment
```

### Frontend — uncommitted ⚠
```
frontend/src/components/fight/matchmaking-queue.tsx
                                           — WagerLobbyCard clickable scout (role=button, kbd, stopPropagation)
frontend/src/components/fight/fight-result-modal.tsx
                                           — three-state outcome, DRAW branch, refund wager row
frontend/src/app/game-provider.tsx         — fight_end skips sound on winner == null
```

All committed-prior files from 2026-05-28 STATE remain in place — see
`STATE_OF_PROJECT_2026-05-28.md` for the full catalogue.

---

## Commit ladder on `feature/v5.1-contracts`

Unchanged from 2026-05-28 — no new commits today.

```
0ab7677  fix(v5.1): live-reactive loadout stats + session-aware autoConnect
fb5cd8b  feat(v5.1-final): drop pauldrons, add ring_3; fresh republish + UX
b881d6b  fix(v5.1-13slot): render pants / bracelets / pauldrons in doll panels
a82933e  chore(v5.1-13slot): mint script + QA checklist for fresh cut-over
55583cf  feat(v5.1-13slot): add pants + bracelets + pauldrons, fresh republish
6403712  docs(v5.1): release notes + journal final + README + MAINNET_PREP (Phase 7)
2e6bb41  feat(v5.1): server wiring + mainnet hardening pass (Phase 3)
5a71e4c  deploy(v5.1-contracts): fresh publish to testnet (Phase 2)
5594f38  feat(v5.1-contracts): registries + settle_tie + slot_type + draws (Phase 1)
fe8bfe9  chore(v5.0): wager-accept finality fix + diagnostic logging + v5.1 backlog
                                                   ← branch point on `feature/phase-2-design`
```

Six files modified in the working tree, zero commits. Next session
opens with a commit pass.

---

## v5.2 backlog status delta

| Item | Status change today |
|---|---|
| Frontend Draw modal | ✅ **modal-layer closed today** (counter render across surfaces still backlog) |
| Opponent inspector / scout system | ✅ **partial-shipped today** (Tavern modal + Arena wager-card entry point; pre-accept *preview* before signing still backlog) |
| StatBonuses shape unification | ✅ **closed at wire boundary** for the scout-modal path; full server-internal unification still backlog |
| Settlement retry / journal | ❌ unchanged — still #1 mainnet blocker |
| Confirm-modal gate | ❌ unchanged — still #2 mainnet blocker |
| `settle_wager_attested` | ❌ unchanged — still #3 mainnet blocker |
| `sui::random` for loot / fight RNG | ❌ unchanged |
| `respec_character` | ❌ unchanged |
| WS Zod validation + rate-limiter middleware | ❌ unchanged |
| Empty `catch {}` sweep | ❌ unchanged |
| Display V2 migration (July 31 2026) | ❌ unchanged |
| Tournament feature | ❌ unchanged — post-mainnet |
| Mobile-responsive UI | ❌ unchanged — post-mainnet |

---

## Standing rules (do not need re-confirming)

1. **No commit, no push** without explicit user signal.
2. **No merge to `main`** until v5.1 QA fully done AND external audit clears v5.2.
3. **Fix-as-we-go, no deferrals.** Today's session shipped three fixes inside the QA pass that surfaced them — that's the working pattern.

---

## Reference

| Doc | Role |
|---|---|
| **`STATE_OF_PROJECT_2026-05-29.md`** | **This doc — new canonical state** |
| `STATE_OF_PROJECT_2026-05-28.md` | Yesterday's snapshot (kept as history) |
| `docs/archive/STATE_OF_PROJECT_2026-05-{04,13,14,16,17}.md` | Older snapshots |
| `SESSION_HANDOFF_2026-05-29.md` | Today's session handoff (single-page next-session opener) |
| `SESSION_HANDOFF_2026-05-28.md` | Yesterday's handoff (history) |
| `MAINNET_PREP.md` | Deploy protocol, threat model, change log |
| `docs/V5_QA_AUDIT_AND_V5.1_SCOPE_2026-05-28.md` | v5.0 audit + v5.1 scope (PRIMARY SPEC) |
| `docs/V5.1_OVERNIGHT_LOG_2026-05-28.md` | v5.1 per-phase journal |
| `docs/V5.1_RELEASE_NOTES_2026-05-28.md` | v5.1 release notes |
| `docs/V5.1_13SLOT_QA_CHECKLIST_2026-05-28.md` | Browser-QA walkthrough |
| `deployment.testnet-v5.1.json` | Machine-readable v5.1 deploy IDs |
| `CHANGELOG.md` | Day-by-day change history |
| `SUI_COMBATS_GDD.md` | Game design canonical |
| `CLAUDE.md` / `AGENTS.md` | GitNexus AI tooling integration |
