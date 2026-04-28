# SUI Combats — v5 Status

> Snapshot at end of the v5 redeploy session. Sui testnet only. Branch
> `feature/v5-redeploy` — every change committed locally; nothing pushed
> to GitHub yet (per standing user rule).

## Pinata / IPFS

- **CID** (all 22 PNGs): `bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy`
- Public gateway base: `https://gateway.pinata.cloud/ipfs/<CID>/<filename>`

## Deployment IDs

| Object | ID |
|---|---|
| Package | `0xa7dc2dabea6acc2db1a9599a0c1e003ad6b2e6064a2847687bc93037a662e1c1` |
| AdminCap | `0x4329021b08235418990a4a0bf8d1edb1e8cb1fe06be5d093f7e2c0f76d8e2579` |
| UpgradeCap | `0x05b27c97ddac6ca0172726d5e91339fc2802a86bba61c837012d2d708d60c5c6` |
| Publisher | `0x1a8116ed261e2513e617a4692520d2f661d9d827ac32f733a1b2ea320031ee87` |
| TransferPolicy<Item> | `0xb0ca682ce826c15166577b5879efa76830befe4af5627f747f9cf0b7e9e8e871` |
| TransferPolicyCap<Item> | `0x71d9157f2cab218f410773e48f7fa3992171b40526ae36ad757b24ffc43c12a1` |
| Display<Character> | `0xca2104f3944e9c150a2f84ef9919ace41ef4c006c4a49f27c5e195f4f0363955` |
| Display<Item> | `0x1f7505f81100e32869944db5368cc95291221935d5d9d7af724b0343d895478b` |

### Wallets

| Role | Address |
|---|---|
| Publisher / TREASURY (hardcoded in `arena.move`) | `0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d` |
| Mr_Boss (crit build, items #1–11) | `0x06d6cb677518cc70884df24541d91d7a1d2ca5db2d8628a69568172652239624` |
| Sx (evasion build, items #12–22) | `0xd05ae8e26e9c239b4888822c83046fe7adaac243f46888ea430d852dafb6e92b` |

## 22-Item Starter Catalog

Full object IDs grouped by recipient live in `deployment.testnet-v5.json`
under `starterItemIds`. Quick verification on chain:

```bash
curl -s -X POST https://fullnode.testnet.sui.io:443 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"suix_getOwnedObjects","params":["<wallet>",{"filter":{"StructType":"0xa7dc2dabea6acc2db1a9599a0c1e003ad6b2e6064a2847687bc93037a662e1c1::item::Item"}},null,50]}' \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)['result']['data']),'NFTs')"
```

Both wallets confirmed owning **11 NFTs** each at session end.

## Decisions Locked This Session

- ✅ **Drop slot pointers** from `Character` — DOFs are the single source of truth.
- ✅ **`loadout_version: u64`** added to Character, bumped by `equipment::save_loadout`.
- ✅ **No `MAX_WAGER` cap** — players can stake anything they own.
- ✅ **`MAX_XP_PER_FIGHT = 1000`** in `update_after_fight`.
- ✅ **`MAX_LOCK_MS = 1 hour`** in `set_fight_lock`.
- ✅ **2.5% royalty rule** wired into the TransferPolicy at publish time.
- ✅ **Signed-challenge auth, 24h JWT session** — server verifies via
  `verifyPersonalMessageSignature`; token persisted client-side at
  `localStorage[sui-combats-jwt-<wallet>]`.
- ✅ **Wallet balance display** in navbar + wager UI insufficient-funds gate.
- ✅ **Marketplace UI ships in v5.0** (functional list/buy/cancel/kiosk).
  Currently the browser shows a v5.1 banner — **wiring is the next-session
  priority** before anything else.
- ✅ **No git push** until QA gauntlet fully passes.

## Autonomous QA — PASSED

- 35/35 Move unit tests (`sui move test`) — happy + error coverage on every
  entry function across all 5 modules.
- Chain gauntlet (`scripts/qa-chain-gauntlet.ts`):
  - `update_after_fight` rejects `xp_gained=1001` → abort `EXpTooHigh` (1).
  - `set_fight_lock` rejects 24h expiry → abort `ELockTooLong` (4).
  - Positive controls (xp=500 update, 30-min lock, clear via 0) all land.
- Display objects render on-chain with the correct Pinata URLs (verified
  via `sui_getObject` on Cursed Greatsword and Parrying Dirk).
- Servers start cleanly (`/health` 200, frontend HTTP 200 after env reload).

## Browser QA — PASSED

- Wallet connection both sides (Mr_Boss_v5, Sx_v5).
- Live SUI balance in navbar (~2.0 SUI both wallets).
- Auth handshake: sign once → 24h JWT issued → reload → no popup.
- Character creation form: 20 stat points are redistributable via the
  `+`/`-` controls.

## Browser QA — Issues Found

### 1. Character creation UX confusion *(non-blocking, polish)*

Form opens with 5/5/5/5 pre-allocated. User initially missed the redistribute
controls. Once discovered, custom builds (e.g. 4/4/7/5) work fine. Possible
fix: start at 0/0/0/0 with a "20 points to allocate" prompt, OR add inline
help text explaining the `+`/`-` action.

### 2. "Name already taken" when both wallets had already minted ⭐

User saw "Name already taken" on a second create attempt. **Investigation
during wrap-up confirmed both test wallets already own multiple Characters
on chain:**

| Wallet | Characters minted (via `CharacterCreated` event scan) |
|---|---|
| Mr_Boss `0x06d6cb…` | `Mr_Boss_v5.1` (`0x9b294d7d…`) and `Mr_Boss_v5` (`0x6161af02…`) |
| Sx `0xd05ae8…` | `Sx_v5.1` (`0xaca14d0f…`) and `Sx_v5` (`0x625db216…`) |
| Publisher `0x975f1b…` | `QA-Bot` (`0x8e1968e2…`) — gauntlet bootstrap |

So **on-chain mints succeeded**. The error originated server-side in
`server/src/data/characters.ts` `createCharacter`, which dedupes by
**name** across the in-memory store:

```ts
for (const [, char] of characters) {
  if (char.name.toLowerCase() === name.toLowerCase()) {
    return { character: null, error: 'Name already taken' };
  }
}
```

This dedupe is wrong for v5 — wallet address is the unique key, not name.
The user signs `create_character` on chain first (mint succeeds), then the
frontend sends a `create_character` WS message; the server's name check
rejects the second attempt while the on-chain Character NFT is still there
unbinding from any server record.

**Fix candidates for next session:**
- Drop the name-uniqueness check entirely (wallet address is the real key).
- OR allow same-name across different wallets but reject the same wallet
  trying to create twice (which `walletToCharacter` already covers at the
  start of `createCharacter`).
- AND the frontend should detect existing on-chain Character before showing
  the creation form — `fetchCharacterNFT` already returns the existing
  Character when present, but the auth/hydration race may be racing the
  WS character_data response.

### 3. Frontend does not surface chain-rejection errors during create

The user signed a transaction whose outcome wasn't visible — the frontend
neither showed "Mint succeeded but server rejected your name" nor surfaced
the on-chain abort. Investigation hint: the `signAndExecuteTransaction`
result is awaited but errors in the post-sign WS round-trip aren't toasted.
Next session: add a sticky toast for any chain-side abort during
`buildMintCharacterTx` and a separate "server rejected" path that points
to chain truth (NFT exists, server out of sync).

## Browser QA — NOT YET TESTED

These remain from the agreed gauntlet — must be validated in the next
session before declaring v5 ready for any merge.

- [ ] **#5 stat allocation post-level-up** ⭐ regression check (the v4
      critical bug — must verify fixed in v5).
- [ ] #6 all 10 equipment slots render in fight-arena (added accessory
      row for belt + ring1 + ring2 + necklace; needs a live confirm).
- [ ] #7 inventory shows zero duplicates (NFT-only).
- [ ] #8 item-detail tooltip shows non-zero stat bonuses for v5 items.
- [ ] #9 Sx equips Twin Stilettos → fight UI shows 2 attack zones.
- [ ] #10 Mr_Boss equips Wooden Buckler → fight UI shows 3 block zones.
- [ ] #11 Sx tries to equip Steel Greatsword (lvl 5) at lvl 1 → chain
      rejects (`ELevelTooLow`).
- [ ] #12 live wager: Mr_Boss creates 0.1 SUI → Sx accepts → fight →
      settle 95/5 on chain.
- [ ] #13 counter triangle: Sx evasion vs Mr_Boss crit (~5 fights, expect
      Sx majority wins).
- [ ] #14 marketplace UI — list / buy / cancel / kiosk creation.
      **Currently a v5.1 placeholder banner — must be wired before continuing.**
- [ ] #15 Slush wallet shows NFT art + name + description (Display
      registered; needs a live confirm in the wallet UI).

## Known Issues to Investigate Next Session

1. **Server-side name-dedupe in `createCharacter`** — see issue 2 above.
   The fix is small (~10 lines).
2. **Frontend post-sign error path** — see issue 3 above.
3. **Marketplace UI is a placeholder** — full kiosk discovery + on-chain
   `ItemListed` event subscription wiring is the priority.
4. **Multiple stale Character NFTs per wallet** — as a side-effect of #2,
   each test wallet has 2 Character objects. Decide whether to add an
   admin "burn stale character" path or just ignore for testnet QA. The
   game logic only sees one of them at a time (the one server hydrates
   first).
5. **`ts-node` vs ESM-only `@mysten/sui` v2** — `tsconfig.json` is on
   `module: CommonJS, moduleResolution: bundler` which works at runtime
   but emits an `ignoreDeprecations: 6.0` cruft warning. Consider moving
   to full ESM in v5.1 once we don't need ts-node compatibility.

## Next Session Priorities (in order)

1. **Investigate Character creation flow** — server name-dedupe drop +
   frontend post-sign error path. Confirm the existing on-chain
   characters can be surfaced cleanly, or wipe the QA-Bot + extras and
   restart the wallets fresh.
2. **Wire marketplace UI** — list / buy / delist / kiosk-create flows.
3. **#5 stat allocation regression check** — single most important
   gauntlet item (the v4 bug we shipped v5 to fix).
4. **Run gauntlet items 6 → 15** in order.
5. **Counter triangle balance test** (~5 fights).
6. **Extended bug hunt** — multi-fight sessions, wager cancellation,
   opponent disconnect mid-fight, edge cases.

## File Map (v5 work)

- `contracts/sources/{character,item,equipment,arena,marketplace,royalty_rule}.move`
- `contracts/tests/{character,item,equipment,arena}_tests.move`
- `server/src/{config,utils/sui-settle,utils/sui-read,utils/sui-verify,ws/handler,ws/fight-room,data/items}.ts`
- `frontend/src/{lib/sui-contracts,lib/loadout-tx,hooks/useGameSocket,hooks/useWalletBalance,app/game-provider}.{ts,tsx}`
- `frontend/src/components/{layout/navbar,fight/matchmaking-queue,fight/fight-arena,marketplace/marketplace-browser}.tsx`
- `scripts/{setup-display,mint-v5-catalog,mint-one,qa-chain-gauntlet}.ts`
- `deployment.testnet-v5.json`
- `nft/*.png` (11 Sx assets — Mr_Boss art lives at prior Pinata CID)

## Recent Local Commits (feature/v5-redeploy)

```
dcca786 feat(deploy): v5 testnet redeploy artefacts + 22-NFT catalog mint
487502f feat(frontend): v5 wiring — JWT auth, balance UI, 10 slots, env throws
26cd8a9 feat(server): v5 SDK migration + JWT auth + retry pattern + DOF reads
96546e7 build(contracts): untrack auto-generated build/ artifacts
6db670c docs: update for loadout-save shipped + architecture map  ← prior session
```
