# SUI Combats

A browser-based PvP RPG combat game on the [Sui blockchain](https://sui.io).
Connect a wallet, mint a Character NFT, gear up with Item NFTs, fight
other players in 5-zone turn-based combat — including **wager fights**
where real SUI is locked in on-chain escrow and 95/5 split-settled to
the winner.

Inspired by the Russian browser MMORPG *combats.ru / oldbk.ru*
(Бойцовский Клуб). First open-source RPG combat framework for Sui.

> **Status:** v5 testnet hardened. Branch `feature/v5-redeploy`.
> Mainnet deploy gated on the v5.1 republish (player-signed settlement
> + Move `CharacterRegistry`). Full state in [`STATUS.md`](STATUS.md);
> deploy protocol in [`MAINNET_PREP.md`](MAINNET_PREP.md).

---

## What it does

- **Living Character NFTs.** Stats, level, XP, ELO rating, win/loss
  record live on the Character object. Server (with `AdminCap`)
  persists fight outcomes via `update_after_fight` after every match.
  Players spend stat points via owner-only `allocate_points`.
- **NFT-only items.** Every Item is a chain object. Equipment binds
  to the Character via Sui dynamic-object-fields (10 slots: weapon,
  offhand, helmet, chest, gloves, boots, belt, ring × 2, necklace).
  Save-loadout is one atomic PTB across all dirty slots.
- **Real-SUI wager fights.** `arena::create_wager` locks player A's
  stake on chain; `accept_wager` matches it; `settle_wager` splits
  95 % to winner / 5 % to treasury. 10-minute auto-expiry safety net
  (`cancel_expired_wager` is anyone-callable). Boot-time orphan
  sweeper auto-recovers wagers stuck across server crashes.
- **Kiosk marketplace.** List, browse, buy, delist, withdraw — all
  PTB-driven from the player's wallet. 2.5 % `royalty_rule` enforced
  on every buy via the v5 `TransferPolicy<Item>`. Atomic delist
  (delist + take + transfer in one PTB) so NFTs never get stuck
  unlisted in a kiosk.
- **5-zone turn combat.** 20 s turn timer, server-authoritative
  resolution, deterministic roll math, anti-cheat fight-lock DOF
  prevents equipment swaps mid-fight. Reconnect-grace window pauses
  the fight on disconnect so a wifi blip doesn't cost real SUI.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (Turbopack), React, TypeScript, `@mysten/dapp-kit-react`, `@mysten/sui` |
| Server | Node.js, Express, `ws` (WebSocket), port 3001 |
| Blockchain | Sui Testnet — Move contracts, BCS-decoded event subscription via gRPC `SubscribeCheckpoints` |
| Database | Supabase (optional — server runs in-memory if blank) |
| Wallet | Slush / Suiet via dapp-kit; `CurrentAccountSigner` for tx signing |
| Decentralized hosting | Walrus Sites (testnet, static export) |

---

## Repository layout

```
sui-comabts/
├── contracts/               # Move package (sui_combats v5)
│   ├── sources/             #   character / item / equipment / arena
│   │                        #   marketplace / royalty_rule
│   └── tests/               #   35 Move unit tests (sui move test)
├── server/                  # Express + WebSocket game server
│   ├── src/
│   │   ├── data/            #   characters, marketplace, db, orphan recovery
│   │   ├── game/            #   combat, matchmaking, ELO, loot
│   │   ├── utils/           #   sui-settle, sui-read, sui-verify
│   │   └── ws/              #   handler, fight-room, fight-pause,
│   │                        #     reconnect-grace, chat
│   ├── setup-db.mjs         # Print Supabase migration SQL for paste
│   └── .env.example         # Required env vars (see below)
├── frontend/                # Next.js 16 client (port 3000)
│   └── src/
│       ├── app/             #   App Router + GameProvider
│       ├── components/      #   character / fight / items / marketplace / social / layout
│       ├── hooks/           #   useGameSocket, useGameStore, useEquipmentActions
│       ├── lib/             #   sui-contracts, loadout, auth-phase, stat-points,
│       │                    #     wager-register, sounds, combat
│       └── types/           #   game, ws-messages
├── scripts/                 # QA gauntlets (qa-*.ts) + setup-display + mint-*
├── nft/                     # 22 starter-NFT PNGs (also pinned to IPFS)
├── deployment.testnet-v5.json   # v5 deploy artefact (package id + catalog)
├── STATUS.md                # Canonical project state
├── MAINNET_PREP.md          # Mainnet deploy protocol
├── LOADOUT_DESIGN.md        # D1-D5 loadout-save design
├── SUI_COMBATS_GDD.md       # Game design — combat math, XP curve, economy
├── DESIGN_BRIEF.md          # Visual aesthetic brief (for redesign)
├── GRANT_APPLICATION.md     # Sui Foundation grant draft
├── SESSION_HANDOFF.md       # Latest session's-work handoff
└── CLAUDE.md / AGENTS.md    # GitNexus integration for AI tooling
```

---

## Quick start (testnet)

### One-time setup

```bash
git clone https://github.com/Mr-Boss-AI/sui-comabts.git
cd sui-comabts

# Server
cd server && cp .env.example .env
# Fill in: SUI_PACKAGE_ID, ADMIN_CAP_ID, PLATFORM_TREASURY,
#         SUI_TREASURY_PRIVATE_KEY (suiprivkey1...), TRANSFER_POLICY_ID,
#         TRANSFER_POLICY_CAP_ID. Optional: SUPABASE_URL/KEY (see below).
npm install

# Frontend
cd ../frontend && cp .env.local.example .env.local
# Fill in: NEXT_PUBLIC_SUI_PACKAGE_ID, NEXT_PUBLIC_TREASURY_ADDRESS,
#         NEXT_PUBLIC_TRANSFER_POLICY_ID. Defaults: WS_URL=ws://localhost:3001,
#         SUI_NETWORK=testnet.
npm install
```

### Run

```bash
# Standard kill + start (run from any cwd)
kill $(lsof -t -i:3001) 2>/dev/null
kill $(lsof -t -i:3000) 2>/dev/null

cd ~/sui-comabts/server   && npm run dev > /tmp/server.log   2>&1 &
cd ~/sui-comabts/frontend && npm run dev > /tmp/frontend.log 2>&1 &

# Verify
curl -s localhost:3001/health | python3 -m json.tool
curl -s -o /dev/null -w "frontend HTTP %{http_code}\n" localhost:3000
```

Open <http://localhost:3000>.

### Smart contracts

```bash
cd contracts
sui move build           # compile
sui move test            # 35 unit tests across all 5 modules
# To redeploy (creates a NEW package — see MAINNET_PREP.md for why
# upgrade is wrong for adversarial-bytecode reasons):
sui client publish --gas-budget 500000000
```

---

## Test gauntlets

Pure unit tests; no chain or DB calls. Run from `server/`:

```bash
cd server
for f in qa-xp qa-marketplace qa-treasury-queue qa-character-mint \
         qa-orphan-sweep qa-reconnect-grace qa-fight-pause \
         qa-stat-points qa-wager-register qa-equip-picker \
         qa-combat-stats qa-wager-form; do
  echo "=== $f ==="
  npx tsx ../scripts/$f.ts | tail -3
done
```

Total: **654 / 654 PASS** across 12 gauntlets. See [`STATUS.md`](STATUS.md)
for what each one covers.

Plus on-chain smoke tests: `npx tsx ../scripts/qa-chain-gauntlet.ts`
(requires `server/.env` populated; uses real chain RPC).

---

## v5 deployment IDs (testnet)

```
Package          0xa7dc2dabea6acc2db1a9599a0c1e003ad6b2e6064a2847687bc93037a662e1c1
AdminCap         0x4329021b08235418990a4a0bf8d1edb1e8cb1fe06be5d093f7e2c0f76d8e2579
UpgradeCap       0x05b27c97ddac6ca0172726d5e91339fc2802a86bba61c837012d2d708d60c5c6
Publisher        0x1a8116ed261e2513e617a4692520d2f661d9d827ac32f733a1b2ea320031ee87
TransferPolicy   0xb0ca682ce826c15166577b5879efa76830befe4af5627f747f9cf0b7e9e8e871
Display<Character>  0xca2104f3944e9c150a2f84ef9919ace41ef4c006c4a49f27c5e195f4f0363955
Display<Item>       0x1f7505f81100e32869944db5368cc95291221935d5d9d7af724b0343d895478b
TREASURY (publisher)
                 0x975f1b348625cdb4f277efaefda1d644b17a4ffd97223892d93e93277fe19d4d
```

The full deploy artefact (with the 22-NFT starter catalog) is in
[`deployment.testnet-v5.json`](deployment.testnet-v5.json). NFT artwork
on Pinata: CID `bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy`.

---

## Optional — Supabase persistence

Server runs entirely in memory if `SUPABASE_URL` / `SUPABASE_KEY` are
blank — useful for local dev. With Supabase configured, the boot-time
orphan-wager sweeper (`server/src/data/orphan-wager-recovery.ts`)
becomes active and character pins survive restarts.

```bash
# Free-tier project at https://supabase.com/dashboard/new/p
# Project Settings → API → copy:
#   Project URL → SUPABASE_URL
#   service_role key → SUPABASE_KEY  (server-only, bypasses RLS by design)

cd server && node setup-db.mjs
# Prints the combined migration SQL. Paste into Supabase SQL Editor → Run.
# Re-run setup-db.mjs to verify both tables exist.
```

---

## Walrus Sites (decentralized frontend hosting)

The static export of `frontend/` deploys to Walrus testnet. Site
object: see [`STATUS.md`](STATUS.md) for the current address. Walrus
testnet does not have a public portal yet — self-host or use the Sui
wallet's Walrus browser.

---

## Standing rules for contributors

- **NEVER push to `main`** without the user's explicit approval. The
  `feature/v5-redeploy` branch is canonical for v5 work; `main` on
  origin is at the v4-era `08ff991` (pre-Phase-0.5).
- **Test before shipping.** Every gauntlet must be green
  (`475/475 PASS`).
- **Search before building.** GitNexus index in `.gitnexus/` —
  see [`CLAUDE.md`](CLAUDE.md) for the AI tooling integration.
- **Treat testnet as production.** Real SUI is locked in wager
  escrows; correctness > velocity.

---

## License

MIT — see [`LICENSE`](LICENSE).

---

## Links

- Repo: <https://github.com/Mr-Boss-AI/sui-comabts>
- Sui docs: <https://docs.sui.io>
- Sui Move book: <https://move-book.com>
- Walrus: <https://docs.wal.app>
- Mysten Labs SDK: <https://sdk.mystenlabs.com>
