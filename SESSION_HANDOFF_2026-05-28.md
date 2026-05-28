# Session Handoff — 2026-05-28 (EOD)

> **Single-page entry point for the next session.**
> Branch `feature/v5.1-contracts` @ `0ab7677` pushed to origin.
> `main` mainline UNTOUCHED at `08ff991` (v4-era) per standing rule.

---

## TL;DR

**v5.1 is LIVE on Sui testnet and the running servers point at it.**
Three publishes happened in sequence today; the FINAL package is
`0x308645f3d85ba6d7647f660610faba5dbdae2822819939bc917302a20cf33717`.
13-slot loadout, three new chain registries, mutual-KO `settle_tie`,
item `slot_type` enforcement, rarity stat budgets — all live. Mr_Boss
test wallet is geared up with a Tank loadout from 52 newly minted
NFTs (26 Lv1 Ponke + 26 Lv2 Scavenger) sitting in the TREASURY kiosk.

**Mainnet readiness:** v5.1 closes ~50% of the v5.0 audit's
contract-layer items. The audit's top-3 mainnet blockers — settlement
retry / journal, confirm-modal gate, `settle_wager_attested` — are
all deferred to v5.2 with reasoning.

---

## What SHIPPED this session

### Contract layer (Move) — 71 / 71 PASS (was 35/35)

- **`CharacterRegistry`** — one Character per wallet on chain. Closes layer 3 of duplicate-mint.
- **`OpenWagerRegistry`** — one open wager per wallet. Closes silent-accept-as-creator + server-down-mid-create orphan family.
- **`KioskRegistry`** + `create_or_get_player_kiosk` — closes 2026-05-20 phantom-empty-kiosk vector. Idempotent.
- **`settle_tie`** (TREASURY-only) — mutual-KO 100% refund both sides. Closes 2026-05-28 stranded-escrow bug.
- **`Character.draws: u32`** + `update_after_fight_draw` admin entry.
- **`Item.slot_type: u8`** + `mint_item_admin` shape validation + `equip_weapon` / `equip_offhand` enforcement.
- **Rarity stat budgets:** Common=20, Uncommon=40, Rare=70, Epic=110, Legendary=160.
- **13-slot loadout:** added `ring_3`, `pants`, `bracelets`. Pauldrons explicitly removed (slot decision changed mid-session).
- **`burn_character`** admin-gated cleanup entry.

### Server layer

- `sui-settle.ts` — `settleTieOnChain` + `updateCharacterDrawOnChain` helpers; `settleWagerOnChain` + `adminCancelWagerOnChain` thread registry.
- `fight-room.ts:728` `else if (draw)` branch fires both helpers on mutual-KO.
- `handler.ts` — `MAX_WAGER_SUI_MIST` cap + `waitForWagerTxFinality` (closes 2026-05-27/28 finality race).
- `config.ts` — registry IDs + cap config + rate-limit value.
- v5.1 env active on the running servers. v5.0 backup at `server/.env.v5.0-backup`.

### Frontend layer

- `lib/sui-contracts.ts` — PTB builders thread registries.
- `lib/loadout.ts` + `lib/combat.ts` — 13-slot.
- `lib/tx-result.ts` — SDK 2.16 `$kind` discriminator handling.
- `components/character/character-profile.tsx` — 13 slot tiles; PRIMARY ATTRIBUTES bars **reactive** to `state.pendingEquipment`.
- `components/social/mini-equipment-frame.tsx` — Tavern preview 13 slots.
- `config/dapp-kit.ts` + `app/client-app.tsx` — session-aware `autoConnect`. Fresh tab → picker; F5 → silent restore; explicit Disconnect → next refresh shows picker.

### Operational artefacts

- Display\<Character\> + Display\<Item\> live (shared, schemas mirror v5.0).
- TREASURY kiosk holds **52 active listings**.
- 26 Lv1 Common Ponke NFTs minted (Pinata CID `bafybeib36hi7qup…ln3ida`).
- 26 Lv2 Uncommon Scavenger NFTs minted (Pinata CID `bafybeidsjl6kih…zzv4oq`).
- Mr_Boss test wallet: full Tank loadout equipped across the new 13-slot system.

---

## What was VERIFIED in browser (Mr_Boss, this session)

| | Step | Status |
|---|---|---|
| 1 | Wallet picker on fresh tab (no silent auto-connect) | ✅ |
| 2 | Character mint with `CharacterRegistry` arg | ✅ |
| 3 | Duplicate-mint blocked (`EWalletAlreadyHasCharacter` = 6) | ✅ |
| 4 | Marketplace browse — 52 listings visible | ✅ |
| 5 | Buy + TransferPolicy royalty (2.5%) math correct on Suiscan | ✅ |
| 6 | Inventory populated, item tiles render correctly | ✅ |
| 7 | Equip → PRIMARY ATTRIBUTES bars move LIVE (no refresh) | ✅ |
| 8 | Unequip → bars drop LIVE (no refresh) | ✅ |
| 9 | COMBAT STATS grid updates LIVE | ✅ |
| 10 | All 13 slot tiles render + accept items + persist after save_loadout | ✅ |
| 11 | `save_loadout` multi-PTB commits cleanly (single signing prompt) | ✅ |
| 12 | Lv1 character blocked from Lv2 gear (`ELevelTooLow` = 3) | ✅ |
| 13 | F5 mid-session → same wallet still connected | ✅ |
| 14 | Explicit Disconnect → next refresh shows picker | ✅ |
| 15 | Fresh tab → picker, no silent Google re-auth | ✅ |

---

## What was NOT verified in browser (carry forward)

| | Reason |
|---|---|
| Mutual-KO `settle_tie` end-to-end on chain | Server wiring shipped + Move test pinned; needs a live tied wager fight |
| Two-handed weapon blocking offhand | Mr_Boss is Lv1; needs Lv2 weapon to exercise the slot_type abort path |
| `OpenWagerRegistry` guard | Move-tested; needs a live two-wallet wager walk |
| Sx wallet on v5.1 | Not yet minted a v5.1 character |
| Full 13-slot single-PTB `save_loadout` walk | Tested with a few slots; full 13-dirty single-PTB walk pending |

---

## What was DEFERRED (v5.2 backlog — unchanged from overnight)

| Item | Why | Priority |
|---|---|---|
| Settlement retry / journal | ~300-500 lines TypeScript with persistence + state machine + tests; overnight-rushed worse than absent | **#1 mainnet blocker** |
| Confirm-modal gate per `signAndExecuteTransaction` | 8-15 sites + shared modal + gauntlet pin; HARD blocker per `MAINNET_PREP §D` | **#2 mainnet blocker** |
| `settle_wager_attested` (dual-sig) | BCS encoding + Move-side sig verification + server hash construction; closes TREASURY-trust | **#3 mainnet blocker** |
| `sui::random` for loot rolls | Net-new chain state; trust improvement | v5.2 trust tier |
| `respec_character` (5 SUI sink + 24h cooldown DOF) | Real-money flow; careful test coverage | v5.2 content tier |
| WS message Zod validation | ~30 message types + tests | Mainnet blocker |
| WS rate-limiter middleware | Per-wallet buckets; config landed, middleware deferred | Mainnet blocker |
| Frontend Draw modal + W/L/D counter | Type widening + neutral badges across navbar + profile + history | UX completeness (server already records on chain) |
| Empty `catch {}` sweep | characters.ts, sui-settle.ts, handler.ts, fight-room.ts | Mainnet hygiene |
| StatBonuses shape unification | Server vs frontend field-name mismatch silently drops 4 stat fields | Mainnet hygiene |
| Display V2 migration | Hard deadline July 31 2026 | Sui-protocol upgrade |

---

## Current state — exact pointers

| Thing | Location |
|---|---|
| Branch | `feature/v5.1-contracts` @ `0ab7677` (origin) |
| Mainline | `main` @ `08ff991` (v4-era — UNTOUCHED) |
| v5.1 package | `0x308645f3d85ba6d7647f660610faba5dbdae2822819939bc917302a20cf33717` |
| Machine-readable deploy IDs | `deployment.testnet-v5.1.json` (lists supersedes chain) |
| Canonical state snapshot | `STATE_OF_PROJECT_2026-05-28.md` |
| Release notes | `docs/V5.1_RELEASE_NOTES_2026-05-28.md` |
| Per-phase journal | `docs/V5.1_OVERNIGHT_LOG_2026-05-28.md` |
| QA walkthrough | `docs/V5.1_13SLOT_QA_CHECKLIST_2026-05-28.md` |
| Primary spec | `docs/V5_QA_AUDIT_AND_V5.1_SCOPE_2026-05-28.md` |
| Deploy + threat protocol | `MAINNET_PREP.md` (v5.1 marked SHIPPED in change log) |
| Hand-maintained Claude pointers | `CLAUDE.md` (block below the gitnexus auto-managed section) |

---

## ⚠️ Slot naming clarification (will trip up future-you)

The session went through **three** slot configurations:

1. **Original v5.1 plan** (audit): 10 slots, no expansion.
2. **Mid-session expansion** (intermediate publish `0x95c23…2c69` — SUPERSEDED): 13 slots with `ring_2` already existing + `pants` + `bracelets` + **`pauldrons`** added. User initially mentioned "ring_2" thinking it was new; it wasn't, so pauldrons filled the third new-slot spot.
3. **Final v5.1** (publish `0x30864…3717` — LIVE): user revisited the decision. **Pauldrons OUT, `ring_3` IN.** Pauldrons removed from contracts (`item.move` no `PAULDRONS=12`, `equipment.move` no `equip_pauldrons`), tests, server `EquipmentSlots`, frontend types, doll panels, scripts.

**The live runtime has `ring_3`, NOT `pauldrons`.** If anything in the
repo still references pauldrons, it's a bug — flag and remove.

Final 13-slot layout:
```
weapon · offhand · helmet · chest · gloves · boots · belt
ring_1 · ring_2 · ring_3 · necklace · pants · bracelets
```

---

## Untracked files (intentional — see status)

These exist on disk but are NOT in the commit. They're operational
artefacts the user can choose to commit or keep local.

```
nft/nft-meme/                          — Lv1 Ponke source assets (pinned by CID)
nft/nft-meme_lvl2/                     — Lv2 Scavenger source assets (pinned by CID)
scripts/mint-ponke-starter-set.ts      — Lv1 mint script (working, 26 NFTs minted)
scripts/mint-scavenger-lv2-set.ts      — Lv2 mint script (working, 26 NFTs minted)
server/.env.v5.0-backup                — pre-cutover server env (kept for revert)
```

Decision deferred to next session: commit the mint scripts (good for
reproducing the catalog) but probably NOT the `nft/` asset trees
(large, already on Pinata). The `.env.v5.0-backup` is dev-only and
should NEVER be committed.

---

## Next-session opener

```
Welcome back to SUI Combats. v5.1 testnet is LIVE and live-verified.
Branch feature/v5.1-contracts @ 0ab7677 on origin. Read these in order:

1. STATE_OF_PROJECT_2026-05-28.md       (canonical state)
2. SESSION_HANDOFF_2026-05-28.md        (this doc)
3. docs/V5.1_RELEASE_NOTES_2026-05-28.md (cut-over protocol + EOD addendum)
4. deployment.testnet-v5.1.json         (machine-readable IDs)

Then check both servers are up (npm run dev in server/ and frontend/),
verify /health on :3001 returns ok, and pick ONE of:

(a) Browser-verify the remaining 5 items: mutual-KO settle_tie end-to-end,
    two-handed weapon blocking with offhand occupied (needs Lv2),
    OpenWagerRegistry one-wager-per-wallet guard live, Sx wallet on v5.1,
    full 13-slot single-PTB save_loadout walk.

(b) Start on v5.2 mainnet-blocker work. Audit ranks:
    #1 Settlement retry / journal (server, ~300-500 lines + persistence)
    #2 Confirm-modal gate for every signAndExecuteTransaction (frontend)
    #3 settle_wager_attested dual-sig (Move + server hash construction)
    See docs/V5_QA_AUDIT_AND_V5.1_SCOPE_2026-05-28.md §6 for plan.

(c) Commit the untracked mint scripts (scripts/mint-ponke-starter-set.ts
    and scripts/mint-scavenger-lv2-set.ts) if you want the catalog
    reproducible from the repo. The nft/ asset trees can stay untracked
    (already pinned on Pinata).

(d) Address the slot_type-aware picker swap (frontend/src/lib/two-handed-
    weapons.ts) — drops the v5.0 JS allowlist now that slot_type is on
    chain. Trivial but should be done while v5.1 is fresh in head.

Live runtime has RING_3, not pauldrons. Live wallet test_target is
Mr_Boss 0xf66978…0f33. TREASURY 0x975f1b…19d4d holds the kiosk and is
both publisher and admin signer for testnet.
```

---

## Closing notes

- 52 NFTs are loose in TREASURY's kiosk + buyable. Anyone with a v5.1 character on testnet can shop.
- All Sui Explorer / Suiscan reads against the v5.1 package render correctly thanks to the Display objects.
- The v5.0 package and intermediate v5.1 publishes are still on chain (Sui upgrade semantics) — they're just not what the running servers point at.
- TREASURY balance ~2.29 SUI post-everything. Plenty of runway for testnet ops; refill before v5.2 work if minting more catalogs.

End of handoff.
