# SUI Combats

A browser-based PvP RPG combat game on the [Sui blockchain](https://sui.io).
Connect a wallet, mint a Character NFT, gear up with Item NFTs, fight
other players in 5-zone turn-based combat — including **wager fights**
where real SUI is locked in on-chain escrow and 95/5 split-settled to
the winner.

Inspired by the Russian browser MMORPG *combats.ru / oldbk.ru*
(Бойцовский Клуб). First open-source RPG combat framework for Sui.

> **Status (2026-05-04):** v5 testnet hardened — Bucket 2 closed.
> Branch `feature/v5-redeploy`. Mainnet deploy gated on the v5.1
> republish bundle (player-signed settlement, `CharacterRegistry`,
> `OpenWagerRegistry`, `slot_type` Item field, `burn_character`,
> draws counter, on-chain loot mint). Latest comprehensive snapshot
> (bug ledger, parking lot, what's-NOT-in-the-codebase, full commit
> log) lives in [`STATE_OF_PROJECT_2026-05-04.md`](STATE_OF_PROJECT_2026-05-04.md);
> high-level state in [`STATUS.md`](STATUS.md); deploy protocol in
> [`MAINNET_PREP.md`](MAINNET_PREP.md); session-by-session
> [`CHANGELOG.md`](CHANGELOG.md).

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
  Two-handed weapons (Cursed Greatsword, Skullcrusher Maul, Steel
  Greatsword) take both weapon + offhand slots; the picker greys
  out invalid combinations both directions and the action gate
  refuses any keyboard / dev-tools bypass.
- **Real-SUI wager fights.** `arena::create_wager` locks player A's
  stake on chain; `accept_wager` matches it; `settle_wager` splits
  95 % to winner / 5 % to treasury. 10-minute auto-expiry safety net
  (`cancel_expired_wager` is anyone-callable). Boot-time orphan
  sweeper auto-recovers wagers stuck across server crashes. Multi-
  queue isolation gate prevents a player from being in a wager AND
  the matchmaking queue simultaneously (which could strand SUI
  if ranked matched first); silent-accept gate at both client and
  server layers refuses an Accept click when the caller has their
  own open wager.
- **Kiosk marketplace.** List, browse, buy, delist, withdraw — all
  PTB-driven from the player's wallet. 2.5 % `royalty_rule` enforced
  on every buy via the v5 `TransferPolicy<Item>`. Atomic delist
  (delist + take + transfer in one PTB) so NFTs never get stuck
  unlisted in a kiosk. v5 starter catalog (22 items) plus a v5.1
  Lv6–Lv8 epic / legendary catalog (9 items) minted to TREASURY's
  kiosk for cross-build buy testing.
- **5-zone turn combat.** 20 s turn timer, server-authoritative
  resolution, deterministic roll math, anti-cheat fight-lock DOF
  prevents equipment swaps mid-fight. Reconnect-grace window pauses
  the fight on disconnect (cumulative per-fight budget — abusers
  who ping-pong run out, honest wifi blips get the full window) so
  a wifi blip doesn't cost real SUI. Outcome modal replays on
  rejoin if the player was offline at settle time.
- **Hardened WebSocket transport.** Outbound messages fired during
  reconnect windows queue and drain on reconnect (stale > 30 s
  discarded; queue capped at 200) instead of erroring. JWT
  auth-resume across reconnects; dapp-kit signed-personal-message
  challenge on first connect.
- **Level-up celebration modal.** Server emits `character_leveled_up`
  after `update_after_fight` confirms a level threshold crossing;
  frontend pops a one-shot modal with an "Allocate Stat Points"
  CTA. Multi-level gains merge into a single "Level Up xN!"
  celebration; modal queues during active fights and surfaces
  post-settle.

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
├── deployment.testnet-v5.json   # v5 deploy artefact (package id +
│                                #   22-item starter + 9-item v5.1 catalog)
├── STATUS.md                # High-level state (points to STATE_OF_PROJECT)
├── STATE_OF_PROJECT_2026-05-04.md   # Comprehensive end-of-Bucket-2 snapshot
│                                #   (bug ledger, v5.1 bundle, parking lot,
│                                #    full commit log, what's-NOT-built)
├── CHANGELOG.md             # Session-by-session change log
├── MAINNET_PREP.md          # Mainnet deploy protocol
├── LOADOUT_DESIGN.md        # D1-D5 loadout-save design
├── SUI_COMBATS_GDD.md       # Game design — combat math, XP curve, economy
├── DESIGN_BRIEF.md          # Visual aesthetic brief (for redesign)
├── GRANT_APPLICATION.md     # Sui Foundation grant draft
├── SESSION_HANDOFF.md       # Latest session's-work handoff (point-in-time)
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

Pure unit tests; no chain or DB calls. Run from repo root with
`NODE_PATH=server/node_modules` (or `cd server` and use relative
paths — most gauntlets work either way; `qa-mint-catalog` and
`qa-chain-gauntlet` need NODE_PATH for the `dotenv` resolve):

```bash
cd ~/sui-comabts
for f in scripts/qa-*.ts; do
  echo "=== $(basename $f) ==="
  NODE_PATH=server/node_modules ./server/node_modules/.bin/tsx "$f" | tail -3
done
```

**Total: 1195 / 1195 PASS across 20 gauntlets.** Coverage by area:

| Area | Gauntlets |
|---|---|
| Combat / XP / stats | qa-xp, qa-combat-stats, qa-stat-points, qa-character-mint |
| Arena / wagers | qa-treasury-queue, qa-orphan-sweep, qa-wager-register, qa-wager-form, qa-wager-accept-gate |
| Reconnect / grace / outcome | qa-reconnect-grace, qa-fight-pause, qa-reconnect-modal, qa-grace-budget |
| Equipment | qa-equip-picker (78 — covers level-locked + 2H both directions) |
| Marketplace | qa-marketplace, qa-mint-catalog (236 — Lv6-Lv8 catalog spec) |
| Cross-mode busy state | qa-multi-queue-isolation, qa-busy-state-render |
| WebSocket transport | qa-ws-readystate |
| Level-up celebration | qa-level-up-modal |

Plus the on-chain smoke gauntlet `qa-chain-gauntlet.ts` (real RPC)
and **35 / 35 Move unit tests** (`cd contracts && sui move test`).
See [`STATE_OF_PROJECT_2026-05-04.md`](STATE_OF_PROJECT_2026-05-04.md)
§ Test Suite State for the full list with assertion counts.

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

The full deploy artefact lives in
[`deployment.testnet-v5.json`](deployment.testnet-v5.json):
- **22-item starter catalog** (split across mr_boss + sx) — minted
  2026-04-27 from Pinata CID
  `bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy`.
- **9-item v5.1 Lv6-Lv8 catalog** (Bloodletter Gauntlets,
  Shadowstep Wraps, Skullsplitter Helm, Hunter's Hood, Pendant
  of Wrath, Whisperwind Amulet, Dancer's Aegis ×2 duplicate,
  Skullcrusher Maul) minted to TREASURY's kiosk 2026-05-04 from
  Pinata CID
  `bafybeihrlw3jdq6ws2m3bjrjoyisvyyvtsp6mb2wnd6lps5hjtgatbwh3i`.
  Cross-build buy testing exercised the marketplace flow during
  Bucket 1 / 2 close-out.

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
  (`1195/1195 PASS` across 20 static gauntlets, plus `35/35 PASS`
  on Move unit tests).
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
