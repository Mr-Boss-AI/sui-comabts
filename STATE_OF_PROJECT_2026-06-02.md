# SUI Combats — State of the Project, 2026-06-02 (v5.2.2 — public testnet preview live, marketplace + bot-fight)

> **Public testnet preview is live and stable.** v5.2 contract +
> v5.2.1 atomic-draw-settlement + v5.2.2 Test Bot Fight all shipped
> and deployed to Railway from `main`. Wager loop, draw loop, marketplace
> browse + 88 listings, and the new instant-bot-practice mode all
> verified end-to-end against testnet. Hall of Fame ladder is
> uncorrupted by bot fights (zero on-chain or DB side effects).
>
> **The next physical action is landing-page testnet disclaimer +
> visual/UI polish** ahead of inviting external testers.
>
> This doc supersedes
> [`docs/archive/STATE_OF_PROJECT_2026-05-30.md`](docs/archive/STATE_OF_PROJECT_2026-05-30.md).

---

## TL;DR

| Field | Value |
|---|---|
| Phase | **v5.2.2 public testnet preview — LIVE on Railway / Vercel** |
| Branch | `main` |
| HEAD on origin | `1b20d50` (v5.2.2 Test Bot Fight) |
| Mainline lineage | `f84931f` (v5.2 wager-fairness baseline merge) → `1aaad80` (v5.2.1 atomic draw) → `1b20d50` (v5.2.2 bot fight) |
| v5.2 package on chain | `0x9c01ad55dd3aecafe671758fe4c9837b9fdfef1739793eb6bc094cc476f7d38f` |
| Move tests | **105 / 105 PASS** (no Move source change since v5.2 publish) |
| Server tsc | clean |
| Frontend tsc | clean |
| Railway deploy | Active on `main` HEAD `1b20d50` — health checks pass (verified post-push) |
| TREASURY balance | **~1.37 SUI** (post-marketplace mint: 2.16 → 1.37; net ~0.79 SUI spent on gas across the 88-NFT mint/list run, listing fees recycle since seller = recipient) |
| TREASURY v5.2 kiosk | `0x91f97327ed40e210b615fa8551677458e2a0aeb6434c843dc1d6dee51d12a359` — **87 active listings** (chain `item_count`) covering Lv1 → Lv8, Common → Legendary |

---

## What shipped this session (2026-06-01 → 2026-06-02)

### 1. Railway env vars repaired (live restore)
First v5.2 live wager surfaced `Object 0x041475565a... does not exist` on every fight. Root cause: 4 truncated object IDs in Railway's env paste (ADMIN_CAP_ID, PUBLISHER_OBJECT_ID, TRANSFER_POLICY_CAP_ID, PLATFORM_TREASURY all missing trailing chars; the SDK silently zero-padded to 64 hex which pointed at non-existent objects). Verified all 9 IDs on chain via GraphQL against the v5.2 deploy record + reissued a paste-ready JSON env block. **Env vars are manual on Railway — not in git.**

### 2. Supabase migration 005 — `characters.draws` column
- `server/src/data/migrations/005_v52_draws_column.sql` —
  `ALTER TABLE characters ADD COLUMN IF NOT EXISTS draws INTEGER NOT
  NULL DEFAULT 0` + `NOTIFY pgrst, 'reload schema'`.
- Root cause: migrations 001 + 002 shipped `wins` + `losses` only.
  Server has written `draws` since v5.1 (mutual-KO ship). PostgREST
  rejected every upsert ⇒ `characters` table stayed empty ⇒
  `fight_history.winner_wallet` FK violation cascaded on every fight
  insert.
- `server/setup-db.mjs` extended with a column-level probe so
  operators see `└ draws column (v5.2): ✓ EXISTS` (or the explicit
  `✗ MISSING — apply migration 005`).
- **Applied manually against live Supabase `twkuqeinleqiilkeixse`.**
  Confirmed live by the user; no DDL replay needed on Railway.

### 3. v5.2.1 — Atomic draw-settlement PTB + treasury finality wait
Live mutual-KO surfaced a treasury gas-coin version race + the missing fight-lock release in the draw branch.

- **`server/src/utils/sui-settle.ts::settleDrawBundleOnChain`** — single PTB does (if wager) `arena::settle_tie` + `character::update_after_fight_draw(A)` + `character::set_fight_lock(A, 0)` + `update_after_fight_draw(B)` + `set_fight_lock(B, 0)`. Sui's locked-input-version semantics make the intra-bundle race structurally impossible. Returns parsed `DrawRecorded` + `LevelUp` effects so the server cache mirrors chain truth (fixes the Hall-of-Fame stale D=0 too).
- **`execAsTreasury` finality wait** — `await client.waitForTransaction(digest, 5s)` inside the queue slot after every `signAndExecuteTransaction`. Closes the inter-tx race for every OTHER treasury-queue path (fight-start lock acquire, win/loss settle, future admin ops).
- **`fight-room.ts` draw branch rewritten** to call the bundle once + mirror chain effects + send unified `character_data` / `character_updated_onchain` / `character_leveled_up` / `wager_settled` messages on the same Tx digest.
- **`scripts/admin-clear-fight-lock.ts`** — triage tool to bulk-clear stuck fight-locks via treasury-signed `set_fight_lock(0)`. Used on the 2026-06-01 stuck pair (Sx + Mr_Boss) with verification digests `F594APiJ…999Nu` (Sx) + `6ikZAEdem…dEF8cncr` (Mr_Boss).

Commit `1aaad80`.

### 4. v5.2.2 — Test Bot Fight (off-chain solo practice)
The Arena's Friendly tile is now an instant solo match against a server-side synthetic opponent. No matchmaking, no chain reads, no chain writes, no Supabase writes, no Hall-of-Fame mutation.

- **`fight-room.ts::createBotFight`** — builds a synthetic Character that mirrors the player's level / stats / cloned equipment, gives it a `bot:<uuid>` sentinel wallet (deliberately NOT `0x…` so no future code can route a chain call through it), drops it into a FightState with `type: 'bot'`. NEVER added to the characters registry.
- **Bot auto-move splice in `startNextTurn`** — when `fight.type === 'bot'` the bot's action is filled from `combat.ts::generateRandomAction` the same tick the turn opens. Same generator the AFK-timeout fallback uses, always shape-correct.
- **Hard short-circuit at top of `finishFight`** — when `fight.type === 'bot'` we send `fight_end` with zero loot + ratingChange=0, move to `finishedFights`, clear `currentFightId` + presence, then return. Every later branch (`settle_wager`, `update_after_fight`, `set_fight_lock`, `dbSaveCharacter`, `dbSaveFight`, draw bundle) is unreachable.
- **New WS message `start_bot_fight`** routed by `handleStartBotFight` with the same cross-mode busy gate as ranked/wager.
- **Frontend** — Arena tile relabelled "Test Bot Fight" / "Practice against a bot — no stakes" / "Fight a Bot". Click handler dispatches `start_bot_fight` when the Friendly tile is selected. Internal `"friendly"` type literal kept so palette/icon/busy-state predicates don't widen. Tavern human-vs-human friendly (`handler.ts:133 requestType === 'friendly'`) UNCHANGED.
- **`scripts/qa-bot-fight.ts`** — 28-assertion gauntlet, 7-turn live fight, verified bit-identical player record before/after.

Commit `1b20d50`. Live-verified post-Railway deploy.

### 5. v5.2 marketplace preview — 88 NFTs minted + listed
TREASURY kiosk on v5.2 now holds 87 active listings (one prior-session count anomaly, see Marketplace section below) covering Lv1 → Lv8 across Common / Uncommon / Rare / Epic / Legendary.

| Set | CID | Items × copies | Tier |
|---|---|---|---|
| Test batch (cross-tier validation) | mixed | 3 specs × 2/2/1 = 5 | Common / Uncommon / Epic |
| Ponke (broke-peasant) | `bafybeib36hi7qupllhjymo2qnte2nghbiowkwxj2hb2fgbs5jly2ln3ida` | 13 × 2 = 26 | Lv1 Common |
| Scavenger | `bafybeidsjl6kihow5vzgssvoyjo2nvworbwhmk53f5vfe3wp56tqzzv4oq` | 13 × 2 = 26 | Lv2 Uncommon |
| Lv6-8 catalog | `bafybeihrlw3jdq6ws2m3bjrjoyisvyyvtsp6mb2wnd6lps5hjtgatbwh3i` | 9 × 1 = 9 | Lv6-8 Epic / Legendary |
| Named-22 (loose PNGs) | `bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy` | 22 × 1 = 22 | Lv2-6 Uncommon / Rare / Epic |
| **TOTAL** | | **88 mints, 87 kiosk listings** | |

Scripts (committed locally, not all pushed — see § Deferred):
- `scripts/mint-v5.2-test-batch.ts`
- `scripts/mint-ponke-starter-set.ts` (pre-existing, re-ran against v5.2 env)
- `scripts/mint-scavenger-lv2-set.ts` (pre-existing, re-ran against v5.2 env)
- `scripts/mint-lv6-8-v5.2-set.ts` (new — legacy `mint-lv6-8-catalog.ts` predated `slot_type`)
- `scripts/mint-v5.2-named-22-set.ts` (new — uses MINT_FROM/MINT_TO env gates)

Spend: TREASURY 2.16 SUI → 1.37 SUI = ~0.79 SUI net (gas only; listing fees recycled since seller = TREASURY = fee recipient). One Pinata anomaly carried forward: `ornate_mithril_breastplate.png.png` literal double extension preserved in chain `image_url`.

### 6. Doc + script hygiene
- `setup-db.mjs` probes the `draws` column.
- `docs/V5.2_QA_GAUNTLET.md` §5.3 rewritten for the atomic-bundle draw flow + new §5.3a rescue path.
- `CHANGELOG.md` Unreleased section carries the v5.2.1 + v5.2.2 + Supabase-drift entries.

---

## Architecture decisions (session)

1. **Atomic PTB over sequential finality-wait for the draw path.** Both close the race; PTB additionally collapses 5 sequential txs into 1 (lower latency, single digest, all-or-nothing semantics, easier client UX). Sequential finality-wait was added too as defense-in-depth for every OTHER admin path (fight-start lock acquire, win/loss settle).
2. **Bot fight uses a `bot:<uuid>` sentinel wallet (NOT `0x…`).** Any future code that gates on `walletAddress.startsWith('0x')` can never accidentally route a chain call through the bot — belt-and-braces beyond the explicit `fight.type === 'bot'` short-circuits.
3. **Bot Character is reference-shared, not registered.** Equipment slots are shallow-copied (combat reads are pure), but the bot is NEVER added to `characters` / `walletToCharacter` maps. `getCharacterByWallet('bot:…')` returns undefined by design.
4. **Tavern friendly path unchanged.** Human-vs-human friendly via `requestType === 'friendly'` tavern challenges still hits `createFight` directly. Only the Arena tile entry was swapped to the bot path.
5. **Lv6-8 catalog forked rather than edited.** The legacy `mint-lv6-8-catalog.ts` is kept as-is for posterity; the new `mint-lv6-8-v5.2-set.ts` carries the v5.2 `slot_type` parameter.

---

## Test totals (after this session)

### Move
| | |
|---|---|
| `sui_combats::arena_tests` | 51 / 51 |
| `sui_combats::character_tests` | 20 / 20 |
| `sui_combats::equipment_tests` | 20 / 20 |
| `sui_combats::item_tests` | 14 / 14 |
| **TOTAL** | **105 / 105 PASS** (unchanged — no Move source change since v5.2 publish) |

### Server-side gauntlets
- `qa-bot-fight.ts` — **28 / 28** (NEW this session) — covers `isBotWallet`, `createBotFight` shape + no-RPC timing, auto-move presence, multi-turn resolution, bit-identical player record diff, registry-leak check.

### Frontend gauntlets
Unchanged this session — last green totals carry over from 2026-05-30 (198/198 Hall-of-Fame, 87/87 equip-picker, 41/41 arena aborts, 19/19 equipment aborts, 19/19 two-handed, 11/11 slot-type, 10/10 stage classifier, 79/79 combat stats, 63/63 marketplace + the v5.2 additions). `tsc --noEmit` clean both sides.

---

## v5.2 deployment (testnet, live)

Unchanged from 2026-05-30. Full table preserved in [`CLAUDE.md`](CLAUDE.md).

| Artefact | ID |
|---|---|
| Package | `0x9c01ad55dd3aecafe671758fe4c9837b9fdfef1739793eb6bc094cc476f7d38f` |
| AdminCap (→ TREASURY) | `0x41475565a81cf769948ea1268d850fc144c7e995d91017d4115730dc5d617c44` |
| TREASURY wallet | `0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d` |
| TREASURY v5.2 kiosk | `0x91f97327ed40e210b615fa8551677458e2a0aeb6434c843dc1d6dee51d12a359` |
| TransferPolicy\<Item\> | `0x7d2aa5d31544d16b28998a7bfdce112c2bd02be79da7f9fbbd34e63d41de568d` |
| CharacterRegistry | `0x84c78a861f3ee2d2299fec507640605c71e313bfbea340bd490a19a04d8492ff` |
| OpenWagerRegistry | `0xabf10378c0b8a65f883098440cfcb68809f14f66fcdb1278106dbd88bf086e16` |
| KioskRegistry | `0xbc5f55674711b69ea830603d715853f50e40028702be9e837aaf8afd50bc3efe` |

---

## Marketplace state — 88 minted, 87 in kiosk

Chain `Kiosk.item_count = 87` post-bulk. The 88 vs 87 delta is one of the 66 pre-existing items from prior-session bulk runs — every one of the 22 named-22 mints from today verified `ObjectOwner = kiosk DOF` via spot checks. Not a placement failure in today's run.

`TransferPolicy<Item>` at `0x7d2a…e568d` covers every Item; royalty 250 BP / 1000 MIST min applies automatically to each listing. No per-item rule attachment needed.

---

## Standing rules (unchanged)

1. **No commit, no push without explicit user signal.** Two pushes authorized this session: `1aaad80` (atomic draw bundle), `1b20d50` (bot fight). Marketplace mint scripts authored but NOT pushed pending decision.
2. **No mainnet republish until v5.2 testnet QA fully passes + external smart-contract audit clears v5.2.**
3. **Fix-as-we-go, no deferrals on the live-incident path.** Honoured: Railway env, Supabase 005, draw race, missing lock-release all closed same-session.

---

## Reference

| Doc | Role |
|---|---|
| **`STATE_OF_PROJECT_2026-06-02.md`** | **This doc — canonical state** |
| `docs/archive/STATE_OF_PROJECT_2026-05-30.md` | Prior session's state (v5.2 cut-over complete) |
| `docs/archive/STATE_OF_PROJECT_2026-05-29.md` | v5.1 QA complete + v5.2 contract built |
| `SESSION_HANDOFF_2026-06-02.md` | **Single-page entry point for next session** |
| `docs/V5.2_QA_GAUNTLET.md` | Live-testnet QA script (top-to-bottom runlist) |
| `docs/V5.2_WAGER_FAIRNESS_SPEC.md` | v5.2 spec with §14 implementation deviations |
| `deployment.testnet-v5.2.json` | v5.2 deploy record (package, registries, caps, policy, displays, gas) |
| `deployment.testnet-v5.1.json` | v5.1 deploy record (parity reference) |
| `MAINNET_PREP.md` | Deploy protocol + threat model + change log |
| `CHANGELOG.md` | Day-by-day change history |
| `CLAUDE.md` / `AGENTS.md` | GitNexus integration; runtime block tracks v5.2.x |
