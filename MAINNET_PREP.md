# SUI Combats — Mainnet Deployment Prep Checklist

> **READ THIS BEFORE ANY MAINNET ACTION.** Testnet lessons encoded here.
> Last updated: 2026-05-28, after the wager-accept finality-race fix
> shipped and the mutual-KO / draw bundle was added to the v5.1
> backlog (§C Contract layer). Earlier-dated content from 2026-05-03
> (v5 testnet hardening + repo cleanup) and 2026-05-20 (KioskRegistry
> bundling) remains canonical. The Sui-protocol content (sections
> A–H) is unchanged from the original 2026-04-18 draft — those facts
> are baked into the chain semantics, not our code state.

---

## Current state — 2026-05-03 (evening)

**v5 is the testnet codename.** Branch `feature/v5-redeploy`, latest
commit `9d7dd19`. v5 is a fresh `sui client publish` of the entire
package — not an upgrade of any prior package. Per section A below,
that's the only valid mainnet path too.

**v5.1 is the planned mainnet republish.** It bundles every Move-side
change still pending so we never re-publish for a single fix:

| Item | Move work | Why |
|---|---|---|
| Player-signed settlement attestation | new `settle_wager_attested(wager, winner, sig_a, sig_b)` entry | Closes the TREASURY-key-holder trust assumption (server can pick wrong winner) |
| `CharacterRegistry` | shared object mapping `address → ID`; aborts new mints when wallet already has one | Closes layer 3 of the duplicate-mint bug (UI bypass via direct Slush PTB) |
| `burn_character` | admin-gated entry to retire a Character object | Cleanup for legacy mr_boss + sx multi-Character residue |
| Admin-signed loot mint | reuse existing `item::mint_item` with rarity + stat-roll math from `server/src/game/loot.ts` | Replace the v5 disabled "fake loot" path with real on-chain Item NFTs |
| `settle_tie` for mutual-KO | new `settle_tie(wager, clock, ctx)` entry — full refund both sides (no platform fee on draws) | Today a true tie (both 0 HP same turn) silently strands the escrow in ACTIVE; no native Move path exists. Testnet manual-refund safety net works but is unacceptable for mainnet. See §C Contract layer for full bundle (server router + frontend Draw modal + `draws: u32`). |
| `draws: u32` on `Character` | add `draws: u32` field to the `Character` struct + increment in `update_after_fight` when `draw=true` | W/L/D record across the on-chain NFT; needed for leaderboard, character-profile badge, history-row tinting. Move-side struct change — pure v5.1 republish item. |

**Mainnet readiness:** 5/8 original blockers + 8 hotfixes closed (see
`STATUS.md` → "Mainnet readiness"). The only ⚠️ items are (a) Block 2
end-to-end validation gated on Supabase provisioning, and (b) the
v5.1 republish above. Three additional polish bugs from the
2026-05-03 arena gauntlet (cumulative grace budget, clearable stake
input, outcome-modal-on-rejoin) closed and live-verified the same
day.

**`allocate_points` regression watch.** The v4-era / 2026-05-02
MoveAbort code 2 (`ENotEnoughPoints`) was the canonical mainnet
blocker for stat allocation. Post-fix verification:

- Mr_Boss Lv3 → Lv4 (2026-05-02) — clean
- Mr_Boss Lv4 → Lv5 (2026-05-03 day) — clean
- Sx Lv5 (2026-05-03 evening) — clean

Three Slush approvals across two characters and two level-ups, no
abort, no MoveCall failure on dry-run. Treats the bug as
**confirmed fixed**; Bucket 1 mainnet-readiness item stays closed.

**Test gauntlet:** 14 suites, 731/731 PASS. Plus 35/35 Move unit
tests in `contracts/tests/`. See `STATUS.md` → "Test totals".

**Bucket 1 (live testnet QA) progress.**

- ✅ Character room — equip/unequip, slot picker, save loadout,
  stat allocate, fight history.
- ✅ Arena room — friendly, ranked, wager (12-test gauntlet pass);
  Lv5 vs Lv5 wager + dual-wield + shield + epic loadout verified.
- ⏳ Market room — code covered by gauntlets, live UX walkthrough
  pending.
- ⏳ Tavern — chat / presence / whispers / profile clicks not yet
  live-walked.
- ⏳ Hall of Fame — minimal; deeper sort/filter test pending.
- ⏳ Multi-day stability — no overnight uptime test yet.
- ⏳ Fresh user onboarding — wipe localStorage + full create-flow
  not yet verified.

---

---

## A. Why mainnet is a fresh deploy, not an upgrade

### The Sui upgrade semantic that forces this decision

Sui package upgrades do **not** retire old bytecode. Every upgrade publishes a new package at a new address (new `packageId`). The **original** package's bytecode remains on-chain, immutable, and callable forever.

The `abort EDeprecated` pattern we used in Phase 0.5 (testnet) only blocks calls to the *upgraded* package ID. An adversarial client crafting a PTB against the *original* package ID bypasses the abort entirely and invokes the vulnerable original bytecode.

### Empirical proof from testnet (2026-04-18)

After upgrading to `0x5f9011c8eb31f321fbd5b2ad5c811f34011a96a4c8a2ddfc6262727dee55c76b`, dry-runs confirmed:

```bash
# ORIGINAL package — old bytecode still runs
$ sui client call --package 0x07fd856d... --module item --function mint_item ... --dry-run
Dry run completed, execution status: success   # ← unrestricted mint still works

# UPGRADED package — abort fires
$ sui client call --package 0x5f9011c8... --module item --function mint_item ... --dry-run
Dry run completed, execution status: failure due to MoveAbort(..., 2)   # EDeprecated
```

Same applies to `equipment::unequip_weapon` (asset-theft bug) and `marketplace::list_item` (no-fee list) — the original bytecode is an attack surface that cannot be closed by upgrade.

### Consequence for mainnet

Mainnet deployment **must** be a `sui client publish` of a new package, not a `sui client upgrade` of the testnet package. This gives us:

- Brand-new package ID with no legacy vulnerable bytecode
- Freedom to *remove* deprecated functions entirely (no need to keep `abort` stubs)
- Clean break from testnet's experimental state

### No migration path from testnet

- [ ] No existing testnet Character NFT is transferable to mainnet
- [ ] No existing testnet Item NFT is transferable to mainnet
- [ ] No existing testnet wager escrow balances can be moved
- [ ] All testnet players must re-create characters on mainnet from scratch
- [ ] All item drops and equipment state begins empty on mainnet

Communicate this clearly in any launch announcement.

---

## B. Fresh wallets required

### Wallets that must be NEW for mainnet

- [ ] **New publisher wallet** — do not reuse `0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60` (testnet treasury also acts as publisher)
- [ ] **New TREASURY wallet** — receives wager platform fee (5%) and item listing fee (0.01 SUI per list). Do not reuse testnet address.
- [ ] **New AdminCap holder** — the publisher wallet receives `AdminCap` on `init()`. This will be a new address, different from testnet's `0xff993e6ded3683762b3ed04d1e7dbe2e7a1373f3de9ddc52ed762b3c18ca9505`.
- [ ] **New UpgradeCap holder** — optional: consider storing this with different custody than AdminCap for operational safety (e.g., AdminCap in hot wallet for server ops, UpgradeCap in cold multisig).

### Private-key storage — plan BEFORE the deploy, not after

Decide and document the answer to these BEFORE running `sui client publish`:

- [ ] Where does the TREASURY private key live? (HashiCorp Vault, AWS Secrets Manager, 1Password Secrets Automation, hardware wallet)
- [ ] Who has access to it? (individual engineers vs. a break-glass process)
- [ ] Rotation policy? (annual, or on key compromise)
- [ ] Backup? (Shamir-split recovery phrase in two geographic locations)
- [ ] How does the server retrieve it at runtime? (init-time fetch, Vault agent sidecar, environment variable from secret manager)
- [ ] What happens if the TREASURY key is compromised? (run `transfer_objects` to move AdminCap to a new wallet, publish a patch that the server rejects old admin calls)

Rules that must hold:

- [ ] **No wallet private key is in the git repo, ever** — not `.env`, not `.env.example`, not comments, not docs
- [ ] **`SUI_TREASURY_PRIVATE_KEY` is in a secure vault, not `server/.env`** (dev `.env` on localhost is the one exception, but never on production hosts)
- [ ] `.gitignore` includes `.env`, `*.pem`, `*.key`, `*.keystore` (verified as of 2026-04-18)
- [ ] Server startup validates key is present and corresponds to the expected TREASURY address before accepting traffic

### Testnet keys that must NOT leak onto mainnet

- [ ] Testnet `~/.sui/sui_config/sui.keystore` should not be copied to production hosts
- [ ] Testnet treasury address (`0xdbd3acbd...`) must not appear anywhere in mainnet configs

---

## C. Pre-deploy code hygiene checklist

Each item below must be verified before running `sui client publish` against mainnet.

### Contract layer

- [ ] **No test XP thresholds in `character.move`** — currently production values (L2=100, L5=1500, L10=50k, L15=350k, L20=1M). Double-check the `xp_for_level` function (`contracts/sources/character.move:114-136`) has no stray test values.
- [ ] **All deprecated v1 functions removed entirely** — on a fresh deploy there are no legacy callers, so the `abort EDeprecated` stubs should simply be deleted (not kept). Files to clean:
  - [ ] `contracts/sources/equipment.move` — remove 10 `equip_*` (v1) and 10 `unequip_*` (v1) stubs; rename all `_v2` variants back to the canonical name
  - [ ] `contracts/sources/item.move` — remove `mint_item` stub; rename `mint_item_admin` back to `mint_item` (or keep `_admin` suffix for clarity — either is fine, pick one)
  - [ ] `contracts/sources/marketplace.move` — remove `list_item` stub; rename `list_item_with_fee` to `list_item`
  - [ ] Remove the now-unused `EDeprecated` constants from all three modules
- [ ] **`mint_item_admin` is the only mint path** — verify no backdoor mint function snuck in
- [ ] **`list_item_with_fee` is the only list path** — verify `TransferPolicy` setup tx still works
- [ ] **Equip/unequip have owner check + fight-lock check** — the `_v2` functions in `equipment.move` already include both
- [ ] **`option::borrow` is always guarded by `option::is_some`** — check `contracts/sources/arena.move:163, 255, 313` (flagged in Phase 0.5 audit, address during mainnet prep)
- [ ] **`#[allow(lint(public_entry))]` suppressions or cleanups** — the `public entry` redundancy warnings throughout the codebase are harmless but noisy; clean up for mainnet professionalism
- [ ] **One-Kiosk-per-wallet invariant must be on-chain enforced** — `marketplace::create_player_kiosk` (`contracts/sources/marketplace.move:59`) is currently unconditional; a second call mints a second `KioskOwnerCap` and the wallet ends up owning two shared kiosks. On testnet (May 20 2026, ShakaLiX) this produced the phantom-empty-kiosk bug — the UI tracked the first cap returned by RPC while sale profits settled in the second kiosk. **On mainnet this is a real lost-funds vector**, not testnet annoyance. The JS-side guard in `useMarketplaceActions.createKiosk` (queries `KioskOwnerCap` ownership before signing) is the deployed testnet fix, but it can be bypassed by anyone hand-crafting a PTB or racing two tabs through tx-indexing lag. Bundle into the v5.1 republish: add a shared `KioskRegistry { table: Table<address, ID> }` and a `create_or_get_player_kiosk(registry, ctx)` entry function that returns the existing kiosk_id if `tx_context::sender` is already registered, otherwise creates one and registers it. Frontend can then drop the JS guard.

- [ ] **Mutual-KO / draw bundle (added 2026-05-28).** A tied fight (both players reach 0 HP on the same turn — happens via combat resolver `server/src/game/combat.ts:422` `if (aDead && bDead) return { finished: true, draw: true }`) currently has NO on-chain settlement path: `arena::settle_wager` requires a single `winner` address, and the server's post-fight code (`server/src/ws/fight-room.ts:467` + `:482`) gates settlement behind `!draw`. Result: the wager stays `STATUS_ACTIVE` with full escrow stranded; both clients show "Defeat / You Lose" (`frontend/src/app/game-provider.tsx:267-271` has no draw branch — `msg.fight.winner === null` is falsy for both wallets). Live incident 2026-05-28: wager `0xf2f3982266cfa69d7061638b00c191dca30dcbe546eef217557622719cbee608`, fight `87ce91b9`, server log `[Fight] End id=87ce91b9 reason=draw winner=none draw=true turn=5 hpA=0/50 hpB=0/50` — 0.2 SUI orphaned in escrow; manually refunded via tx `9YPY7K9yNWeNbdvryhHyJAXVoyH3bTJtpsQ56sz5E37x` through `admin_cancel_wager`. **Bundle for v5.1:**
  - **Move** — add `public fun settle_tie(wager: &mut WagerMatch, clock: &Clock, ctx: &mut TxContext)` to `arena.move`, TREASURY-only, asserts `status == STATUS_ACTIVE && option::is_some(&player_b)`, refunds 100% to each (no 5% platform fee on draws — design decision option A2 over A1's `admin_cancel_wager` hack and over A3's 47.5/47.5/5 split). Emits new `WagerTied { match_id, player_a, player_b, refund_each }` event. Sets `status = STATUS_SETTLED, settled_at = clock`. Matches the existing `WagerRefunded` event shape so indexers can fold both into the same "no-winner" bucket if desired.
  - **Move** — add `draws: u32` to the `Character` struct alongside `wins: u32, losses: u32`. Bump `update_after_fight` signature to accept a `result: u8` discriminator (`0=loss, 1=win, 2=draw`) or split into `update_after_fight_draw(character, xp_gained, clock, ctx)`. Initial value 0 for new mints. Adds one `u32` per Character — negligible storage.
  - **Server** — in `fight-room.ts:728` `else if (draw)` branch, fire `settleTieOnChain(fight.wagerMatchId)` (new helper in `sui-settle.ts`, mirrors `adminCancelWagerOnChain` but calls `settle_tie`) for `fight.type === 'wager'`. Award draw XP (`calculateXpReward(fight.type, false, …)` currently used — fine to keep). Update `update_after_fight` call to pass `result: 'draw'` so the on-chain `draws` counter increments. Fall back to `admin_cancel_wager` if `settle_tie` fails — keeps the testnet safety net alive on mainnet too.
  - **Frontend** — `game-provider.tsx:258 case "fight_end"` add an explicit draw branch: detect `msg.fight.winner === null && fight.status === 'finished'`, dispatch `SET_DRAW_OUTCOME` (new), play a neutral "draw" sound (or no sound). New `<DrawOutcomeModal />` mirroring the post-fight modal layout, neutral copy ("Draw — both fighters down"), shows refund amount instead of "−0.1 SUI", shows XP gain (consolation). History rows: widen `result` type from `'win' | 'loss'` to `'win' | 'loss' | 'draw'`; add badge tint (neutral grey, not victory-green nor blood-red) at `character-profile.tsx:817-818`. Navbar W/L counter becomes W/L/D.
  - **Tests** — Move unit test for `settle_tie` (mirror `settle_wager` tests; assert refund_each == stake_amount, status flips to SETTLED, both balances credited). Frontend gauntlet pinning the draw branch dispatch + draw badge + W/L/D counter render.
  - **Until v5.1 ships:** testnet QA uses `admin_cancel_wager` as manual safety net — endpoint already exists; both this incident (2026-05-28 `0xf2f3982266…`) and earlier ones (2026-05-27 `0xf3aae8c5468e…` via disconnect cleanup, `0x0c24213f9f59…` via curl) prove the path works for 50/50 refunds. Acceptable for testnet; unacceptable for mainnet because (a) it requires admin intervention per draw, (b) the 50/50 split semantically reads as "cancelled" not "tied," and (c) no on-chain record of the draw outcome.

### Server layer

- [ ] **`sui-settle.ts` uses the `@mysten/sui` SDK, not `execSync`** — shell-injection surface must be closed. Verify no `execSync` calls remain in `server/src/utils/`.
- [ ] **`server/src/config.ts`** has no testnet default addresses:
  - [ ] `SUI_PACKAGE_ID` default is empty string or `throw` on missing — not the testnet `0x50a5...` or `0x07fd...`
  - [ ] `PLATFORM_TREASURY` default is empty string or throws — not `0xdbd3acbd...`
  - [ ] `ADMIN_CAP_ID` default is empty string or throws — not `0xff993e6d...`
- [ ] **Settlement retry / journal exists** — Phase 1 work (pending). Mainnet cannot go live without this because a server crash mid-settle would strand escrowed SUI.
- [ ] **`update_after_fight` has retry** — same concern as settlement retry (Phase 1 work)
- [ ] **No `console.log` of sensitive data**:
  - [ ] Private keys never logged
  - [ ] Full WS payloads with wallet addresses are OK; don't log signed tx bytes before broadcast
  - [ ] No database credentials in logs
- [ ] **Empty `catch {}` blocks reviewed and fixed** — sweep for them in:
  - [ ] `server/src/data/characters.ts` (fire-and-forget DB writes flagged in audit)
  - [ ] `server/src/utils/sui-settle.ts`
  - [ ] `server/src/ws/handler.ts`
  - [ ] `server/src/ws/fight-room.ts`
- [ ] **Input validation on every WS message** — add Zod schemas (Phase 3 work). Mainnet cannot go live without this because untrusted payloads go to on-chain admin calls.
- [ ] **`SIGTERM` shutdown handlers** — clean server exit for deploy rotations

### Frontend layer

- [x] ~~**Delete dead code: `frontend/src/components/items/equipment-grid.tsx`**~~ — DONE (file no longer present, verified 2026-05-19).
- [x] ~~**`frontend/src/lib/sui-contracts.ts:5-7`** — remove the hardcoded testnet fallback~~ — DONE; `PACKAGE_ID` now resolves through a `required(name, value)` env helper at sui-contracts.ts:44 that throws when `NEXT_PUBLIC_SUI_PACKAGE_ID` is absent.
- [ ] **All `moveCall` targets use the upgraded package ID** — on mainnet there's only one package, so this is moot, but the pattern should stay so future upgrades work cleanly
- [ ] **No testnet wallet addresses visible in source** — search the frontend tree for `0xdbd3`, `0x3606`, `0xa5ad`, `0x07fd`, `0xff99` and remove all hits
- [ ] **No dev-mode API endpoints** — all RPC URLs come from env, no hardcoded testnet fullnode
- [ ] **Frontend error handlers surface, not swallow** — sweep for `catch {}`
- [ ] **Kiosk cap resolution is aggregate, not `caps[0]`** — `useKiosk` (`frontend/src/hooks/useKiosk.ts`) enumerates every `KioskOwnerCap` the wallet owns and surfaces aggregated profits / listing count / item count. The seller-panel `Withdraw` button must call `buildWithdrawAllKioskProfitsTx` (single PTB, every kiosk swept in one signature), and `Delist` / `Retrieve` must look up the matching cap via `kiosk.capForKiosk(listingOrItem.kioskId)` rather than the wallet's "primary" cap. **Regression guard:** the gauntlet `scripts/qa-kiosk-orphan.ts` pins `aggregateKiosks` primary-selection, `buildWithdrawAllKioskProfitsTx` PTB shape, and the `createKiosk` pre-flight contract. Re-run before any change to `useKiosk` / `useMarketplaceActions`.

### Shared

- [ ] **Unify StatBonuses shape between `server/src/types.ts` and `frontend/src/types/game.ts`.** Currently server uses `{armor, hp, defense, damage, critBonus, strength, dexterity, intuition, endurance}` while frontend expects `{armorBonus, hpBonus, defenseBonus, attackBonus, critChanceBonus, strengthBonus, ...}`. Translation layer in `sanitizeItem` (server handler.ts) masks the divergence today but drops 4 stat fields (`critMultiplierBonus`, `evasionBonus`, `antiCritBonus`, `antiEvasionBonus`). Resolve before mainnet.
- [ ] **All `.env.example` files contain only placeholders**:
  - [ ] `server/.env.example` — `SUPABASE_URL=https://your-project.supabase.co`, `SUI_PACKAGE_ID=0x...`, etc.
  - [ ] `frontend/.env.local.example` (create if missing)
  - [ ] No real secrets, no real addresses
- [x] ~~**`scripts/mint-demo-items.sh`**~~ — DONE (file no longer present, verified 2026-05-19).
- [x] ~~**`deployment.json`** — delete or move to `deployment.testnet.json`~~ — DONE (root now holds only `deployment.testnet-v5.json`).
- [ ] **`contracts/Published.toml`** — delete the testnet publish metadata. It will regenerate on mainnet publish.
- [ ] **`contracts/Move.toml`** — currently has `sui_combats = "0x0"`. Leave as is; `sui client publish` auto-updates.

---

## D. Security checklist

### Contract-level security

- [ ] **All `equip_*` and `unequip_*` have owner check + fight-lock check** — critical. The testnet `_v2` functions pattern is the baseline; fresh deploy should inline these as the only implementation.
- [ ] **`settle_wager` verifies caller** — current implementation trusts server's `winner` parameter. Consider: the WagerMatch struct should store `player_a` and `player_b` addresses, and `settle_wager` should assert `winner == player_a || winner == player_b`. (`contracts/sources/arena.move` — flagged in audit, fix before mainnet)
- [ ] **`update_after_fight` validates XP / rating deltas are bounded** — server could accidentally grant 2^32 XP due to a bug. Add `assert!(xp_gained <= MAX_XP_PER_FIGHT)` where `MAX_XP_PER_FIGHT = 1000` or similar.
- [ ] **`set_fight_lock` caps the expiry** — server could accidentally lock a character for 10 years. Add `assert!(expires_at_ms <= clock::timestamp_ms(clock) + MAX_LOCK_DURATION_MS)` where `MAX = 1 hour`.
- [ ] **`option::is_some` guards before every `option::borrow`** — `arena.move:163, 255, 313` flagged. Add per-line.
- [ ] **Item stat bonus caps** — `mint_item_admin` should cap each `*_bonus: u16` at some reasonable maximum (e.g. 10000) to prevent integer overflow in combat math on frontend/server.
- [ ] **`level_req` cap** — `mint_item_admin` should `assert!(level_req <= MAX_LEVEL)` (20) so items can't be permanently unusable.

### UX gates — zkLogin signing must require explicit confirmation

> **HARD MAINNET BLOCKER — added 2026-05-19.** On testnet, Enoki
> zkLogin signs every `signAndExecuteTransaction` silently for demo-
> smoothness reasons (the Phase A login pass deliberately accepted
> the no-popup UX to keep the demo headline simple). That is **not
> safe for mainnet**: a logged-in user who walks away from their
> screen could lose real SUI to anyone with physical access, and
> a malicious page-injection attack could fire arbitrary
> `accept_wager` / `list_item` / `buy_listing` PTBs without the
> user noticing. Confirm popups are the line of defence between
> a stolen browser session and a drained mainnet wallet.

- [ ] **Every wallet-popup site must gain an explicit confirm-popup gate.** All sites that today call `signer.signAndExecuteTransaction({ transaction })` go through this gate. Audit checklist:
  - [ ] `frontend/src/components/fight/matchmaking-queue.tsx` — `handleQueue` (create_wager), `handleAcceptWager`, `handleCancelWager`
  - [ ] `frontend/src/components/character/character-creation.tsx` — initial mint
  - [ ] `frontend/src/hooks/useEquipmentActions.ts` — `saveLoadout`
  - [ ] `frontend/src/components/character/stat-allocate-modal.tsx` — `allocate_points`
  - [ ] `frontend/src/components/marketplace/*` — `list_item`, `delist_item`, `buy_listing`, kiosk withdraw
  - [ ] Any future signer.signAndExecuteTransaction call site — grep before every release.
- [ ] **Implementation shape:** the confirm modal SHOULD show: (a) target Move function (`arena::accept_wager`), (b) human-readable amount + asset (`0.1 SUI`), (c) recipient if applicable (`creator's address …4ed3`), (d) gas estimate. A single shared `<ConfirmTxModal />` component renders before the signer call; the user must click "Sign" before the Enoki popup fires.
- [ ] **Pinning:** add a gauntlet that fails if a new `signAndExecuteTransaction` is added without an immediately-preceding `await confirmTransaction(...)` call. Mirror the pattern in `qa-wager-accept-race.ts` (source-grep count of signing sites with paired pre-flight).
- [ ] **Settings toggle (optional, not safe-by-default):** a "Trust this session for 30 minutes" setting that bypasses the popup for the same Move function. Default OFF. Surface clearly in the UI so the user knows they've reduced their own defence depth.

### Operational security

- [ ] **Empty `catch {}` blocks reviewed and fixed** (also listed in section C; this section for emphasis — they hide security-relevant failures)
- [ ] **Settlement retry/journal exists** — prevents stranded escrows (Phase 1)
- [ ] **`update_after_fight` retry exists** — prevents drift between server and chain (Phase 1)
- [ ] **Rate limits on WS messages** — per-wallet caps on `chat_message`, `queue_fight`, `create_wager` to prevent DoS
- [ ] **Match-making guardrails** — can the AI bot `Big Bad Claude` or any admin match a fight where one side controls both wallets? Verify the race-condition fix from April 17 generalizes.
- [ ] **Wager amount upper bound** — add server-side `MAX_WAGER_SUI` (e.g., 100 SUI) to limit blast radius of any single-match bug
- [ ] **Test the fight-lock race** — what happens if two server processes both try to create a fight with the same pair of characters? The on-chain lock prevents double-fight but server-side matchmaking must agree.
- [ ] **Post-tx chain-sync: replace 1-second delay with poll-until-converged.** Current testnet code uses `setTimeout(() => BUMP_ONCHAIN_REFRESH, 1000)` after successful equip/unequip (see `frontend/src/hooks/useEquipmentActions.ts`). On mainnet, fullnode indexing latency is variable; switch to a polling helper that re-queries `fetchOwnedItems` up to ~10 seconds, 500 ms intervals, until the expected item set has converged. Deterministic; no magic delay. Reference design:
  ```ts
  async function waitForChainSync(client, wallet, expectedGone: Set<string>, maxMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const owned = await fetchOwnedItems(client, wallet);
      const ownedIds = new Set(owned.map((i) => i.id));
      if ([...expectedGone].every((id) => !ownedIds.has(id))) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  ```

### Audit-level

- [ ] **External smart contract audit** — for real-money mainnet, budget 2-4 weeks of an auditor's time. Relevant firms for Sui Move: OtterSec, Zellic, Movebit. Start engagement ~6 weeks before target launch.
- [ ] **Penetration test of server + frontend** — WebSocket auth bypass, PTB crafting attacks against original package ID (irrelevant on mainnet since there's no original vulnerable package, but worth testing mental model)
- [ ] **Bug bounty posted before launch** — Immunefi or in-house

---

## E. Deploy sequence

Execute in order. Do NOT skip steps.

### Pre-flight (runs offline, before any on-chain action)

1. [ ] Complete all of sections B, C, D above
2. [ ] Create + fund publisher wallet with ~20 SUI for publish + setup transactions
3. [ ] Create + fund TREASURY wallet with ~10 SUI for admin ops gas reserve
4. [ ] Export TREASURY private key into production server's secret vault (NOT into git)
5. [ ] Run `sui move build` locally — verify no compiler warnings except known lint
6. [ ] Run `sui move test` — all tests green
7. [ ] Run `npm run build` on server and frontend — both green
8. [ ] Write production `server/.env` with mainnet values (no real file, just document the values in the vault)
9. [ ] Write production `frontend/.env.local` with mainnet values

### On-chain publish

10. [ ] Set active CLI address to publisher wallet
11. [ ] `sui client publish --gas-budget 500000000` — captures package ID
12. [ ] Record package ID in fresh `deployment.mainnet.json`
13. [ ] Record `AdminCap`, `UpgradeCap`, `Publisher` object IDs
14. [ ] Transfer `AdminCap` to TREASURY wallet: `sui client transfer --to <TREASURY> --object-id <ADMIN_CAP>`
15. [ ] Transfer `Publisher` to publisher-ops wallet (separate from AdminCap holder, for Kiosk TransferPolicy setup)
16. [ ] Consider locking `UpgradeCap` behind a multisig or making it non-upgradeable via `package::make_immutable` (one-way decision)

### TransferPolicy + initial item catalog

17. [ ] Call `marketplace::setup_transfer_policy(publisher, ctx)` — creates TransferPolicy<Item>, transfers TransferPolicyCap to sender. Record policy object ID.
18. [ ] Mint initial item catalog via `item::mint_item_admin(admin, ...)` — use a spec'd script (equivalent to `scripts/mint-demo-items.sh` but for production items with finalized stats)
19. [ ] Verify a sample item on mainnet Explorer

### Infrastructure

20. [ ] Deploy server to production host (Docker, Fly.io, Render, or similar)
21. [ ] Verify server startup: logs show `Supabase connected`, `AdminCap validated`, correct package ID
22. [ ] Deploy frontend to Vercel production (or Walrus Sites mainnet portal, once public)
23. [ ] Update DNS / `NEXT_PUBLIC_WS_URL` to production server WS endpoint

### Smoke test

24. [ ] Connect two fresh mainnet wallets to the frontend
25. [ ] Create character (wallet popup → on-chain Character NFT mint)
26. [ ] Mint an admin-held item, transfer to player, verify inventory sync
27. [ ] Equip item (wallet popup → DOF attached on Character)
28. [ ] Unequip item, verify DOF removed
29. [ ] List item for sale (wallet popup → 0.01 SUI fee routes to TREASURY, item in kiosk)
30. [ ] Second wallet buys listed item — verify TransferPolicy royalty (2.5%) taken
30a. [ ] Seller withdraws profits — verify aggregated `profitsSui` clears to 0 in one signature, balance lands in wallet
30b. [ ] Click "Create my Kiosk" a second time — confirm the JS guard short-circuits to "You already own a Kiosk — refreshing." (or, post-v5.1, that `create_or_get_player_kiosk` returns the existing id)
31. [ ] Queue a friendly fight between the two wallets — fight resolves, `update_after_fight` lands on both characters
32. [ ] Queue a wager fight (start with 0.1 SUI to minimize blast radius) — wager creation + acceptance + settlement all land on-chain
33. [ ] Verify TREASURY received 5% of the wager pot

### Only NOW announce to users

34. [ ] Public launch tweet / Discord / grant update
35. [ ] Monitor for 48 hours with elevated oncall before removing feature flags

---

## F. Post-deploy monitoring

- [ ] RPC poller for calls to the testnet package (sanity — should be zero). Reuse for any future "old package callable" alerts.
- [ ] Alert on `settle_wager` failures — each one is a stranded escrow needing manual intervention until retry queue exists
- [ ] Alert on `update_after_fight` failures — server and chain diverging
- [ ] Alert on admin calls (`update_after_fight`, `settle_wager`, `set_fight_lock`, `mint_item_admin`) signed by any address other than TREASURY — immediate credential-compromise signal
- [ ] Alert on `list_item_with_fee` where the `treasury` arg is anything other than the canonical TREASURY address — frontend bug or client-crafted PTB
- [ ] Daily summary: total characters, total items in circulation, total SUI in active wagers, largest active wager
- [ ] Grafana / Datadog dashboard: fight volume, settlement latency, RPC error rate, WebSocket connection count
- [ ] Settlement queue depth alert (once queue exists) — alert if `pending` older than 5 minutes

---

## G. What NOT to copy from testnet

Explicitly do not bring into mainnet:

- [ ] Testnet `packageId` (`0x07fd856dc8db9dc2950f7cc2ef39408bd20414cea86a37477361f5717e188c1d`) — don't reference it anywhere
- [ ] Testnet `upgradedPackageId` (`0x5f9011c8eb31f321fbd5b2ad5c811f34011a96a4c8a2ddfc6262727dee55c76b`)
- [ ] Testnet TREASURY address (`0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60`)
- [ ] Testnet publisher key (never on production host)
- [ ] Testnet `AdminCap` object ID (`0xff993e6ded3683762b3ed04d1e7dbe2e7a1373f3de9ddc52ed762b3c18ca9505`)
- [ ] Testnet `deployment.json` as-is — start fresh `deployment.mainnet.json`
- [ ] Testnet Supabase project — create a mainnet-separate Supabase with different credentials, schema migrated but data empty
- [ ] Testnet `Published.toml` — delete before mainnet publish
- [ ] Testnet-minted items from `scripts/mint_receipts.jsonl` — testnet-only object IDs

---

## H. Grant application alignment

- [ ] Phase 4 of `GRANT_APPLICATION.md` ("Cross-game interop + tournaments") must reference this file for the mainnet deploy sub-milestone
- [ ] Mainnet deploy is its own reported milestone with its own budget line — not a "just upgrade testnet" task
- [ ] Production monitoring stack (section F above) is part of Phase 4 deliverables, not a post-hoc add
- [ ] External audit cost (section D) should be budgeted explicitly in the grant — typically $10-30k for a 2-4 week Sui Move audit
- [ ] Bug bounty budget should be reserved — recommend $5-10k initial pool for Immunefi launch

---

## Testnet recovery endpoints

These endpoints are **testnet-only** — all guarded by `CONFIG.SUI_NETWORK !== 'mainnet'` and respond with 403 on mainnet. They exist to rescue state when normal flows fail during development. Do NOT build features that depend on them.

### `POST /api/admin/grant-xp`
Grants XP to a character server-side AND on-chain (via `update_after_fight` with `won=false`). Bumps on-chain level so level-gated items become equippable without grinding fights.

**Side effect:** increments the character's loss counter by 1 per call. Acceptable on testnet; document per-character if leaderboard is important.

```bash
curl -X POST http://localhost:3001/api/admin/grant-xp \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"0x...","xp":300}'
```

### `POST /api/admin/adopt-wager`
Recovers an on-chain WagerMatch that never made it into the in-memory lobby (e.g. WS reconnect race, frontend extraction failure, server restart mid-flow). Queries chain, validates status=WAITING, inserts lobby entry, broadcasts `wager_lobby_added`. Creator must be logged in at the time of adoption.

```bash
curl -X POST http://localhost:3001/api/admin/adopt-wager \
  -H 'Content-Type: application/json' \
  -d '{"wagerMatchId":"0x..."}'
```

Returns 409 if already in lobby, 409 if status != WAITING, 404 if not a WagerMatch object.

---

## Known races & reliability gaps

### WS reconnect vs outbound message
On unstable connections, the browser socket can reconnect silently during the gap between a successful on-chain tx landing and the frontend's follow-up WS message (`queue_fight`, `wager_accepted`, etc.). The outbound send either fires on the old (closing) socket and gets dropped, or fires before the new session has completed auth handshake. Result: chain state exists, server state doesn't, user sees nothing.

**Current mitigations:**
- Sticky (non-fading) error banner when wager-id extraction fails after create_wager sign — user cannot miss the state divergence. Banner tells them to contact admin rather than retry (retry would lock a second stake).
- Testnet `/api/admin/adopt-wager` endpoint for manual recovery.
- Server-side `DEBUG_WS=1` logs every inbound WS message with type + key fields — diagnoses "did the server receive it" in one log line.

**To resolve before mainnet:**
- [ ] Outbound message queue on the WS client — buffer sends while socket is disconnected, flush on reconnect+auth success.
- [ ] Make the post-tx WS message idempotent (server tolerates duplicate `queue_fight` for the same `wagerMatchId`) so a retry is safe.
- [ ] Automated orphan-wager scanner: server periodically queries chain for WagerMatch objects in WAITING state whose creator is connected but has no lobby entry, auto-adopt. Eliminates manual curl.

## Change log

| Date | Author | Change |
|---|---|---|
| 2026-04-18 | Initial draft | After Phase 0 + 0.5 testnet upgrade revealed Sui upgrade semantics (old bytecode stays callable). Documented to prevent future sessions from assuming upgrade-to-mainnet is viable. |
| 2026-05-20 | Session wrap | Bundled `KioskRegistry` + `create_or_get_player_kiosk` into v5.1 (§C Contract layer) after the 2026-05-20 phantom-empty-kiosk incident. |
| 2026-05-28 | Session wrap | Bundled mutual-KO / draw handling into v5.1 (§C Contract layer): `settle_tie` Move entry, `draws: u32` on `Character`, server router, frontend Draw modal + W/L/D counter. Triggered by the 2026-05-28 live tie (wager `0xf2f3982266…`, fight `87ce91b9`) — 0.2 SUI orphaned, refunded via `admin_cancel_wager` (`9YPY7K9yNWeNbdvryhHyJAXVoyH3bTJtpsQ56sz5E37x`). |
| 2026-05-28 (PM) | Autonomous overnight | **v5.1 contracts SHIPPED to testnet** — package `0x7853412fb905…`. CharacterRegistry + OpenWagerRegistry + KioskRegistry + settle_tie + slot_type + draws field + rarity budgets + burn_character + create_or_get_player_kiosk. Server wiring landed (settleTieOnChain + updateCharacterDrawOnChain helpers + fight-room.ts draw branch). MAX_WAGER_SUI_MIST cap + WS rate-limit config + admin-endpoint network gating audit. Frontend assertTxSucceeded hardened for SDK 2.16. Move tests 35 → 64 PASS. Branch `feature/v5.1-contracts` @ HEAD. Cut-over protocol in `docs/V5.1_RELEASE_NOTES_2026-05-28.md`. v5.2 deferral list locked: sui::random, respec_character, settle_wager_attested, three new slots. |
