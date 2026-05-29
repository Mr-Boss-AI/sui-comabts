# SUI Combats — State of the Project, 2026-05-28 (v5.1 testnet SHIPPED + verified)

> **v5.1 IS LIVE on testnet.** Branch `feature/v5.1-contracts` @ `0ab7677`.
> Package `0x308645f3d85ba6d7647f660610faba5dbdae2822819939bc917302a20cf33717`.
> 26 Lv1 + 26 Lv2 NFTs minted + listed in TREASURY's kiosk. Mr_Boss test
> character is geared up (Tank build). Both servers running on v5.1 env.
> **Mainline `main` stays at `08ff991` (v4-era) until v5.2 audit clears.**
>
> This doc supersedes [`docs/archive/STATE_OF_PROJECT_2026-05-17.md`](docs/archive/STATE_OF_PROJECT_2026-05-17.md)
> as the canonical state. All prior STATE_OF_PROJECT_* snapshots
> (2026-05-04, 05-13, 05-14, 05-16, 05-17) are archived in
> `docs/archive/`.

---

## TL;DR

| Field | Value |
|---|---|
| Phase | **v5.1 testnet shipped + live-verified.** Next phase: v5.2 trust + content (`sui::random`, `respec`, `settle_wager_attested`) + audit prep |
| Branch | `feature/v5.1-contracts` |
| HEAD | `0ab7677` (pushed to origin) |
| Mainline | `main` untouched at `08ff991` (v4-era — standing rule, no merge until v5.2 + audit) |
| v5.1 package id | `0x308645f3d85ba6d7647f660610faba5dbdae2822819939bc917302a20cf33717` |
| Move tests | **71 / 71 PASS** (was 35/35 in v5.0; +36 this branch) |
| Server `tsc --noEmit` | clean |
| Frontend `tsc --noEmit` | clean |
| Backend `:3001` `/health` | ok |
| Frontend `:3000` HTTP | 200 |
| Marketplace listings | **52 active** (26 Lv1 Ponke + 26 Lv2 Scavenger) in TREASURY kiosk |
| Test wallets | Mr_Boss `0xf669789c…0f33` (geared, Tank), Sx `0x03c33df0…985f` (not yet geared on v5.1) |
| TREASURY balance | ~2.29 SUI (post-publish + 2 catalog mints + 52 listings) |

---

## What's LIVE in v5.1 testnet (verified in browser)

### Contract layer

**Three chain-side registries (closes 3 classes of orphan-state bugs):**

- **`CharacterRegistry`** `0xad05d60e…9105f` — `Table<address, ID>`. `create_character` aborts `EWalletAlreadyHasCharacter (6)` on duplicate. `burn_character(admin, character, registry)` retires + clears entry.
- **`OpenWagerRegistry`** `0xa3be188a…908e20` — `Table<address, ID>`. `create_wager` + `accept_wager` abort `EAlreadyHasOpenWager (11)` if caller already has one. All wager-completion paths (`cancel_wager` / `settle_wager` / `settle_tie` / `admin_cancel_wager` / `cancel_expired_wager`) remove the entry.
- **`KioskRegistry`** `0x05d355fd…d4860` — `Table<address, ID>`. `create_or_get_player_kiosk(registry, ctx) → ID` returns existing kiosk_id if registered, otherwise creates + registers. Idempotent.

**`settle_tie` (mutual-KO close):**
- New TREASURY-only `arena::settle_tie(wager, registry, clock, ctx)` — 100% refund to each side, no platform fee on draws. Emits new `WagerTied { match_id, player_a, player_b, refund_each }` event.
- Server's `fight-room.ts:728` `else if (draw)` branch now calls `settleTieOnChain` for wager draws + `updateCharacterDrawOnChain` for both characters. Closes the 2026-05-28 stranded-escrow bug.

**`Character.draws: u32`:**
- New field on `Character` struct, initialized 0 for new mints.
- New entry `character::update_after_fight_draw(admin, character, xp, clock)` increments draws + applies XP + no rating change. Emits `DrawRecorded`.

**13-slot loadout — final layout:**
- Equipment DOFs: weapon, offhand, helmet, chest, gloves, boots, belt, ring_1, ring_2, **ring_3** (new), necklace, **pants** (new), **bracelets** (new).
- ⚠️ **Note on slot naming:** earlier iteration had pauldrons; user changed plan mid-session. **Live build has RING_3, NOT pauldrons.** Pauldrons removed completely from `item.move` (no PAULDRONS=12 constant), `equipment.move` (no equip_pauldrons), tests, types, UI. ring_3 reuses RING=8 item type.
- New equip/unequip primitives: `equip_ring_3` / `unequip_ring_3`, `equip_pants` / `unequip_pants`, `equip_bracelets` / `unequip_bracelets`. Same shape as helmet/chest/gloves/boots/belt (owner + fight-lock + type + level-req + slot-empty checks).

**`Item.slot_type: u8`:**
- New field on `Item`: 0=mainhand, 1=offhand, 2=both_hands.
- `mint_item_admin` shape validator enforces: WEAPON must be 0 or 2; SHIELD must be 1; everything else must be 0. Wrong values abort `EWeaponSlotTypeInvalid (7)` / `EInvalidSlotType (6)`.
- `equip_weapon` enforces two-handed reserves offhand: if `item.slot_type == 2` and offhand DOF non-empty → `EOffhandOccupied (6)`. If `slot_type == 1` → `EItemNotMainhand (8)`.
- `equip_offhand` blocks both-handed items (`EItemNotOffhand (9)`) and blocks offhand when current weapon is two-handed (`EWeaponIsTwoHanded (7)`).
- Closes the v5.0 two-handed-weapon hardcoded-allowlist gap.

**Item rarity stat budgets:**
- `mint_item_admin` aborts `ERarityBudgetExceeded (5)` if sum of all `*_bonus` + `max_damage` exceeds:
  Common=20, Uncommon=40, Rare=70, Epic=110, Legendary=160.
- Prevents admin minting a Legendary with stat-stack beyond its tier.

**Other:**
- `create_or_get_player_kiosk` replaces v5.0 unconditional `create_player_kiosk` (closes phantom-empty-kiosk vector from 2026-05-20).
- All hardening caps from v5.0 preserved (`MAX_XP_PER_FIGHT=1000`, `MAX_LOCK_MS=1h`, `MAX_BONUS=1000`, `MAX_LEVEL_REQ=20`).

### Server wiring (active on v5.1)

- `sui-settle.ts` — `settleTieOnChain` (calls `settle_tie` with registry; falls back to `admin_cancel_wager` on v5.0 env), `updateCharacterDrawOnChain` (calls `update_after_fight_draw`; falls back to `update_after_fight(won=false)` on v5.0).
- `sui-settle.ts` — `settleWagerOnChain` + `adminCancelWagerOnChain` thread the registry arg when env var present.
- `fight-room.ts` `else if (draw)` branch now fires both helpers on mutual-KO. Pre-fix: stranded escrow + no chain record. Closes 2026-05-28 incident wager `0xf2f3982266…`.
- `handler.ts` `handleQueueFight` — `MAX_WAGER_SUI_MIST` cap enforced (100 SUI default).
- `handler.ts` `handleWagerAccepted` — `waitForWagerTxFinality` runs before the chain probe (closes the 2026-05-27/28 finality race).

### Frontend

- `lib/sui-contracts.ts` — `buildMintCharacterTx`, `buildCreateWagerTx`, `buildAcceptWagerTx`, `buildCancelWagerTx`, `buildCancelExpiredWagerTx` all thread their registry args. `buildCreateKioskTx` calls `create_or_get_player_kiosk` (idempotent).
- `lib/loadout.ts` — `EQUIPMENT_SLOT_KEYS` is now 13 entries; `toChainSlot` maps `"ring3"` → `"ring_3"`.
- `lib/combat.ts` — `getEquipmentBonuses` iterates 13 slots (auto via `Object.values`).
- `lib/tx-result.ts` — `assertTxSucceeded` hardened for SDK 2.16 shape (`$kind` discriminator first; legacy paths as safety net).
- `components/character/character-profile.tsx` — doll-panel renders all 13 slot tiles; PRIMARY ATTRIBUTES bars compute bonuses from `state.pendingEquipment` (reactive to equip/unequip), no refresh required.
- `components/social/mini-equipment-frame.tsx` — Tavern profile preview also renders 13 slots.
- `config/dapp-kit.ts` + `app/client-app.tsx` — session-aware `autoConnect`. Fresh tab/window → picker. F5 mid-session → silent restore. Explicit Disconnect → next refresh shows picker.

### Operational artefacts on chain

- `deployment.testnet-v5.1.json` — all IDs (package / AdminCap / UpgradeCap / Publisher / TransferPolicy / TransferPolicyCap / 3 registries / 2 Display objects).
- Display<Character> `0x94a85532…fc0885`, Display<Item> `0x32bdda84…aa658` — both shared, both with v5.1 schema (name / description / image_url / link).
- TREASURY kiosk `0x9a492e52…dfdb36` holds 52 active listings.
- Lv1 Ponke catalog (26 NFTs) from Pinata CID `bafybeib36hi7qupllhjymo2qnte2nghbiowkwxj2hb2fgbs5jly2ln3ida`.
- Lv2 Scavenger catalog (26 NFTs) from Pinata CID `bafybeidsjl6kihow5vzgssvoyjo2nvworbwhmk53f5vfe3wp56tqzzv4oq`.

---

## Live-verified in browser (Mr_Boss wallet, this session)

| | Step | Status |
|---|---|---|
| 1 | Wallet connect via picker (no silent auto-connect on fresh start) | ✅ |
| 2 | Character mint with `CharacterRegistry` arg | ✅ |
| 3 | Duplicate-mint blocked by `EWalletAlreadyHasCharacter (6)` | ✅ |
| 4 | Marketplace browse — 52 listings visible | ✅ |
| 5 | Buy + royalty math (confirmed on Suiscan) | ✅ |
| 6 | Inventory populated, item tiles render correctly | ✅ |
| 7 | Equip item → PRIMARY ATTRIBUTES bar moves live (no refresh) | ✅ |
| 8 | Unequip item → bar drops live (no refresh) | ✅ |
| 9 | COMBAT STATS grid (HP/ATK/CRIT/CRIT×/EVADE/ARMOR/DEF/LV) updates live | ✅ |
| 10 | All 13 slot tiles render + accept items + persist after save_loadout | ✅ |
| 11 | `save_loadout` multi-PTB commits cleanly (single signing prompt) | ✅ |
| 12 | Lv1 character blocked from equipping Lv2 gear (`ELevelTooLow (3)`) | ✅ |
| 13 | F5 mid-session → same wallet still connected | ✅ |
| 14 | Explicit Disconnect → next refresh shows picker | ✅ |
| 15 | Fresh tab → picker, no silent Google re-auth | ✅ |

Mr_Boss has a working Tank-build loadout equipped from the Ponke + Scavenger sets.

---

## What's NOT yet verified in browser

| | Reason |
|---|---|
| Two-handed weapon blocking (Plank/Shovel) | Mr_Boss is Lv1; needs Lv2 to test. Move-test pinned (`test_equip_two_handed_with_offhand_occupied_aborts` etc.) |
| Mutual-KO `settle_tie` end-to-end live | Server wiring shipped + Move test pinned; needs a live tied wager fight to verify on chain |
| Sx wallet on v5.1 | Hasn't yet minted a v5.1 character or bought v5.1 gear |
| Wager creation + acceptance with registry-guard | Move test pinned; live two-wallet walk pending |
| 13-slot save_loadout PTB with all 13 dirty | Tested with a few slots; full-13-dirty single-PTB walk pending |

---

## Test suite state

| | v5.0 baseline | v5.1 current | Δ |
|---|---|---|---|
| Move unit tests | 35 | **71** PASS | +36 |
| Frontend gauntlets | 2,307+ (last STATE 05-17 number) | unchanged | 0 |

Move test additions cover:
- CharacterRegistry tracks owner, duplicate-mint aborts, burn clears
- update_after_fight_draw increments draws, can level up
- OpenWagerRegistry: tracks creator, duplicate-create aborts, acceptor-with-open-wager aborts, removes on all completion paths
- settle_tie: 100% refund both sides, TREASURY-only, ACTIVE-only
- cancel_expired_wager: too-early aborts, after-timeout happy
- admin_cancel_wager ACTIVE 50/50 verified
- Item slot_type validation: weapon/shield/non-weapon shape; weapon-with-offhand-slot-type rejected
- Rarity budget: Common-over-budget rejected; Legendary-high-budget happy; budget table accessor
- equipment slot_type enforcement: two-handed equip happy + offhand-blocked + after-two-handed-offhand-blocked + dual-wield happy + mainhand-with-shield happy
- 3 new slots: ring_3 + pants + bracelets equip/unequip happy + wrong-type + slot-occupied + level-too-low + fight-locked

JS gauntlet additions deferred — the frontend cut-over work is operational; the gauntlets that pinned v5.0 behaviour still validate the type system + helper logic that wasn't materially changed.

---

## Mainnet readiness scorecard

| Track | State |
|---|---|
| Phase 2 — design redesign | ✅ shipped earlier; polish on this branch |
| Phase A — Sui-latest integration | ✅ shipped (zkLogin, Slush, Bug A pre-flight, Bug B branching) |
| Phase 3 — v5.1 contracts | ✅ **SHIPPED on testnet 2026-05-28** |
| Two-wallet wager live | ⏳ Mr_Boss live-verified; Sx pending |
| Mutual-KO live verify | ⏳ wiring shipped; live test pending |
| **#1 mainnet blocker — settlement retry / journal** | ❌ NOT DONE — DEFERRED to v5.2 |
| **#2 mainnet blocker — confirm-modal gate per signAndExecuteTransaction** | ❌ NOT DONE — DEFERRED to v5.2 |
| **#3 mainnet blocker — `settle_wager_attested` (closes TREASURY-trust)** | ❌ DEFERRED to v5.2 |
| WS Zod validation + rate-limiter middleware | ❌ DEFERRED |
| `sui::random` for loot / fight RNG | ❌ DEFERRED to v5.2 |
| `respec_character` (5 SUI sink + 24h cooldown) | ❌ DEFERRED to v5.2 |
| Empty `catch {}` sweep | ❌ DEFERRED |
| StatBonuses shape unification | ❌ DEFERRED |
| External smart-contract audit | ⏳ engagement not started; needs ~2-4 weeks pre-mainnet |
| Production monitoring + alerting (Grafana/Datadog) | ❌ NOT DONE |
| RPC failover / multi-fullnode | ❌ NOT DONE |
| Bug bounty | ❌ NOT POSTED |

v5.1 closes ~50% of the audit's contract-layer items. The remaining mainnet blockers — especially the settlement-retry journal (audit's #1 risk) and the confirm-modal gate (audit's #2 risk) — are **server/frontend work** for v5.2, not Move work.

---

## Files touched on this branch (since `feature/phase-2-design`)

### Contracts
```
contracts/sources/character.move           — CharacterRegistry, burn_character, draws, update_after_fight_draw
contracts/sources/arena.move               — OpenWagerRegistry, settle_tie, WagerTied, registry threading
contracts/sources/item.move                — slot_type, rarity stat budgets, PANTS / BRACELETS types
contracts/sources/equipment.move           — equip/unequip for ring_3 / pants / bracelets, two-handed enforcement
contracts/sources/marketplace.move         — KioskRegistry, create_or_get_player_kiosk
contracts/tests/character_tests.move       — 9 new tests
contracts/tests/equipment_tests.move       — 8 new tests
contracts/tests/arena_tests.move           — 12 new tests
contracts/tests/item_tests.move            — 7 new tests
contracts/Published.toml                   — v5.1 final package
```

### Server
```
server/src/config.ts                       — CHARACTER_REGISTRY_ID, OPEN_WAGER_REGISTRY_ID, KIOSK_REGISTRY_ID,
                                             MAX_WAGER_SUI_MIST, WS_MSG_RATE_LIMIT_PER_MIN
server/src/types.ts                        — EquipmentSlots: +ring3, +pants, +bracelets
server/src/game/combat.ts                  — slots[] aggregation 10→13
server/src/utils/sui-read.ts               — CHAIN_TO_SERVER_SLOT + EMPTY DOFEquipment 10→13
server/src/utils/sui-settle.ts             — settleTieOnChain, updateCharacterDrawOnChain, waitForWagerTxFinality
server/src/ws/handler.ts                   — MAX_WAGER_SUI cap, finality wait, txDigest logging
server/src/ws/fight-room.ts                — draw branch fires settle_tie + update_after_fight_draw
server/.env                                — v5.1 IDs (v5.0 backup at .env.v5.0-backup)
```

### Frontend
```
frontend/.env.local                        — v5.1 IDs
frontend/src/types/game.ts                 — ITEM_TYPES + EquipmentSlots + labels updated
frontend/src/lib/loadout.ts                — EQUIPMENT_SLOT_KEYS 13 entries, ring3↔ring_3 map
frontend/src/lib/sui-contracts.ts          — PTB builders thread registries; EquipSlotKey widened
frontend/src/lib/tx-result.ts              — SDK 2.16 shape hardening
frontend/src/lib/wager-preflight.ts        — diagnostic raw-result dump
frontend/src/components/character/character-profile.tsx
                                           — 13 slot tiles, reactive PRIMARY ATTRIBUTES bonuses
frontend/src/components/character/character-creation.tsx
                                           — emptyEquipment shape (13 keys)
frontend/src/components/social/mini-equipment-frame.tsx
                                           — Tavern preview 13 slots
frontend/src/config/dapp-kit.ts            — session-aware autoConnect
frontend/src/app/client-app.tsx            — SessionAutoConnectMarker bridge
```

### Scripts
```
scripts/setup-display-v5.1.ts              — Display<Character> + Display<Item> setup
scripts/mint-v5.1-13slot-catalog.ts        — updated for ring_3 (not pauldrons)
scripts/mint-ponke-starter-set.ts          — (untracked; see SESSION_HANDOFF for status)
scripts/mint-scavenger-lv2-set.ts          — (untracked; see SESSION_HANDOFF)
```

### Docs
```
deployment.testnet-v5.1.json               — final v5.1 IDs + slot manifest + mint instructions
docs/V5_QA_AUDIT_AND_V5.1_SCOPE_2026-05-28.md  — 1000-line audit (primary spec source)
docs/V5.1_OVERNIGHT_LOG_2026-05-28.md      — per-phase autonomous-run journal
docs/V5.1_RELEASE_NOTES_2026-05-28.md      — single-source release notes
docs/V5.1_13SLOT_QA_CHECKLIST_2026-05-28.md — step-by-step QA walkthrough
docs/archive/STATE_OF_PROJECT_2026-05-{04,13,14,16,17}.md  — 5 archived snapshots
MAINNET_PREP.md                            — v5.1 items marked SHIPPED, package id pinned
README.md                                  — status block refreshed (already-done from overnight)
SESSION_HANDOFF_2026-05-28.md              — end-of-session handoff (this commit)
STATE_OF_PROJECT_2026-05-28.md             — this doc
```

### Auto-managed (do not commit by hand)
```
AGENTS.md / CLAUDE.md                      — GitNexus index counters (post-commit hook updates)
```

---

## Commit ladder on `feature/v5.1-contracts` since branch start

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

10 commits on this branch (1 carried from `feature/phase-2-design`, 9 new this session).

---

## v5.2 backlog (per the audit, locked at start of overnight run)

| Item | Type | Priority |
|---|---|---|
| Settlement retry / journal | BUG FIX | **#1 mainnet blocker** |
| Confirm-modal gate for every `signAndExecuteTransaction` | NEW FEATURE | **#2 mainnet blocker** |
| `settle_wager_attested` (dual-sig settle) | NEW FEATURE | **#3 mainnet blocker** (closes TREASURY-trust assumption) |
| `sui::random` for loot rolls | NEW FEATURE | trust improvement |
| `respec_character` + 5 SUI sink + 24h cooldown | NEW FEATURE | content + SUI sink |
| WS message Zod validation | TECH DEBT | mainnet blocker |
| WS rate-limiter middleware | TECH DEBT | mainnet blocker |
| Draw modal + W/L/D counter UI | BUG FIX | UX completeness (server already records draws on chain via update_after_fight_draw) |
| Opponent inspector / scout system | NEW FEATURE | UX |
| Empty `catch {}` sweep | TECH DEBT | mainnet hygiene |
| StatBonuses shape unification (4 dropped fields) | TECH DEBT | mainnet hygiene |
| Display V2 migration (July 31 2026 deadline) | POLISH | hard deadline approaching |
| Mobile-responsive UI | POLISH | post-mainnet content tier |
| Tournament feature (per memory seed) | NEW FEATURE | post-mainnet |

Per the audit's §6.3 recommendation: think of v5.1 testnet → audit → v6.0 mainnet, not v5.1 mainnet directly. Mainnet is a fresh publish per `MAINNET_PREP §A` (Sui upgrade semantics).

---

## Reference

| Doc | Role |
|---|---|
| **`STATE_OF_PROJECT_2026-05-28.md`** | **This doc — new canonical state** |
| `docs/archive/STATE_OF_PROJECT_2026-05-{04,13,14,16,17}.md` | Historical snapshots (archived) |
| `SESSION_HANDOFF_2026-05-28.md` | Single-page session handoff (next-session opener at the bottom) |
| `MAINNET_PREP.md` | Deploy protocol, threat model, change log |
| `docs/V5_QA_AUDIT_AND_V5.1_SCOPE_2026-05-28.md` | Authoritative v5.0 audit + v5.1 scope (PRIMARY SPEC) |
| `docs/V5.1_OVERNIGHT_LOG_2026-05-28.md` | Per-phase autonomous-run journal |
| `docs/V5.1_RELEASE_NOTES_2026-05-28.md` | v5.1 release notes |
| `docs/V5.1_13SLOT_QA_CHECKLIST_2026-05-28.md` | 10-step browser-QA walkthrough |
| `deployment.testnet-v5.1.json` | Machine-readable v5.1 deploy IDs |
| `CHANGELOG.md` | Day-by-day change history |
| `SUI_COMBATS_GDD.md` | Game design canonical |
| `CLAUDE.md` / `AGENTS.md` | GitNexus AI tooling integration |
