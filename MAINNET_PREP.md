# SUI Combats — Mainnet Deployment Prep Checklist

> **READ THIS BEFORE ANY MAINNET ACTION.** Testnet lessons encoded here.
> Last updated: 2026-05-03, after the v5 testnet hardening pass and
> repo cleanup. The Sui-protocol content (sections A–H) is unchanged
> from the original 2026-04-18 draft — those facts are baked into the
> chain semantics, not our code state.

---

## Current state — 2026-05-03

**v5 is the testnet codename.** Branch `feature/v5-redeploy`, commit
`dc28eff` (final code) + the cleanup commit immediately after. v5 is
a fresh `sui client publish` of the entire package — not an upgrade
of any prior package. Per section A below, that's the only valid
mainnet path too.

**v5.1 is the planned mainnet republish.** It bundles every Move-side
change still pending so we never re-publish for a single fix:

| Item | Move work | Why |
|---|---|---|
| Player-signed settlement attestation | new `settle_wager_attested(wager, winner, sig_a, sig_b)` entry | Closes the TREASURY-key-holder trust assumption (server can pick wrong winner) |
| `CharacterRegistry` | shared object mapping `address → ID`; aborts new mints when wallet already has one | Closes layer 3 of the duplicate-mint bug (UI bypass via direct Slush PTB) |
| `burn_character` | admin-gated entry to retire a Character object | Cleanup for legacy mr_boss + sx multi-Character residue |
| Admin-signed loot mint | reuse existing `item::mint_item` with rarity + stat-roll math from `server/src/game/loot.ts` | Replace the v5 disabled "fake loot" path with real on-chain Item NFTs |

**Mainnet readiness:** 5/8 original blockers + 5 hotfixes closed (see
`STATUS.md` → "Mainnet readiness"). The only ⚠️ items are (a) Block 2
end-to-end validation gated on Supabase provisioning, and (b) the
v5.1 republish above.

**Test gauntlet:** 9 suites, 475/475 PASS. Plus 35/35 Move unit tests
in `contracts/tests/`. See `STATUS.md` → "Test totals".

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

- [ ] **Delete dead code: `frontend/src/components/items/equipment-grid.tsx`** — exported `EquipmentGrid` component, never imported anywhere (grep confirms zero consumers as of 2026-04-18). The active equipment UI lives in `character-profile.tsx`. Parked for separate cleanup PR rather than deleted alongside refactors.
- [ ] **`frontend/src/lib/sui-contracts.ts:5-7`** — remove the hardcoded testnet fallback `"0x7fd54c4d..."` for `NEXT_PUBLIC_SUI_PACKAGE_ID`. Missing env should throw at build time.
- [ ] **All `moveCall` targets use the upgraded package ID** — on mainnet there's only one package, so this is moot, but the pattern should stay so future upgrades work cleanly
- [ ] **No testnet wallet addresses visible in source** — search the frontend tree for `0xdbd3`, `0x3606`, `0xa5ad`, `0x07fd`, `0xff99` and remove all hits
- [ ] **No dev-mode API endpoints** — all RPC URLs come from env, no hardcoded testnet fullnode
- [ ] **Frontend error handlers surface, not swallow** — sweep for `catch {}`

### Shared

- [ ] **Unify StatBonuses shape between `server/src/types.ts` and `frontend/src/types/game.ts`.** Currently server uses `{armor, hp, defense, damage, critBonus, strength, dexterity, intuition, endurance}` while frontend expects `{armorBonus, hpBonus, defenseBonus, attackBonus, critChanceBonus, strengthBonus, ...}`. Translation layer in `sanitizeItem` (server handler.ts) masks the divergence today but drops 4 stat fields (`critMultiplierBonus`, `evasionBonus`, `antiCritBonus`, `antiEvasionBonus`). Resolve before mainnet.
- [ ] **All `.env.example` files contain only placeholders**:
  - [ ] `server/.env.example` — `SUPABASE_URL=https://your-project.supabase.co`, `SUI_PACKAGE_ID=0x...`, etc.
  - [ ] `frontend/.env.local.example` (create if missing)
  - [ ] No real secrets, no real addresses
- [ ] **`scripts/mint-demo-items.sh`** — file is testnet-specific (hardcodes `0xa5ad...` as recipient). Either delete before mainnet or rewrite with env vars + safety check for `NETWORK=mainnet`.
- [ ] **`deployment.json`** — delete or move to `deployment.testnet.json`. Mainnet starts with a fresh `deployment.mainnet.json`.
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
