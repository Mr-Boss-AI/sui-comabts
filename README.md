# ⚔️ SUI Combats

**On-chain PvP RPG combat on Sui — soulbound characters, tradeable NFT items, zone-based tactical fights, and SUI-escrowed wagers.**

[![Sui Testnet](https://img.shields.io/badge/Sui-Testnet-4DA2FF?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiPjwvc3ZnPg==)](https://suiscan.xyz/testnet/object/0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303)
[![Move](https://img.shields.io/badge/Move-Smart%20Contracts-blue)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<!-- TODO: Add screenshot -->
<!-- ![SUI Combats Screenshot](docs/screenshot.png) -->

---

## Features

- **Soulbound Characters** — Character NFTs minted on Sui with `key` only (no `store`), permanently tied to your wallet
- **Tradeable NFT Items** — Weapons, armor, and accessories as `key + store` objects with IPFS-hosted artwork
- **Zone-Based PvP Combat** — 5 body zones (head, chest, stomach, belt, legs), attack/block selection, critical hits, evasion, dual-wield and shield mechanics
- **Wager Escrow** — Stake real SUI on fights via on-chain escrow (`arena.move`), winner takes 95%, 5% platform fee
- **Kiosk Marketplace** — List and trade items using Sui's native Kiosk standard with TransferPolicy enforcement
- **Equipment System** — 10 gear slots with stat bonuses that affect combat calculations
- **ELO Matchmaking** — Ranked fights with rating-based pairing and progressive queue expansion
- **Character Persistence** — Characters survive server restarts by restoring from on-chain NFT data + Supabase
- **Walrus Sites** — Frontend deployed to decentralized storage on Walrus testnet
- **On-Chain Ownership Verification** — Server validates NFT ownership on every login, preventing ghost items

## Architecture

```
┌─────────────────┐         WebSocket          ┌──────────────────────┐
│                 │◄──────────────────────────►│                      │
│   Next.js 16    │                            │  Game Server         │
│   Frontend      │                            │  Express + ws        │
│                 │                            │                      │
│  dapp-kit-react │                            │  Matchmaking         │
│  Wallet signing │                            │  Combat resolution   │
│                 │                            │  Chat, Leaderboard   │
└────────┬────────┘                            └──────────┬───────────┘
         │                                                │
         │  Sui RPC                                       │  Supabase
         ▼                                                ▼
┌─────────────────┐                            ┌──────────────────────┐
│   Sui Testnet   │                            │  PostgreSQL          │
│                 │                            │                      │
│  character.move │                            │  Characters          │
│  item.move      │                            │  Fight history       │
│  equipment.move │                            │  Inventory           │
│  arena.move     │                            │                      │
│  marketplace    │                            │                      │
└─────────────────┘                            └──────────────────────┘
         │
         ▼
┌─────────────────┐
│  Walrus Sites   │
│  (testnet)      │
│  Static hosting │
└─────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Smart Contracts** | Move on Sui |
| **Frontend** | Next.js 16, React 19, Tailwind CSS, @mysten/dapp-kit-react |
| **Game Server** | Node.js, Express, WebSocket (ws) |
| **Database** | Supabase (PostgreSQL) |
| **Storage** | IPFS (Pinata) for NFT art, Walrus Sites for frontend |
| **Blockchain** | Sui Testnet |

## Quick Start

### Prerequisites

- Node.js 20+
- A Sui wallet (install [Sui Wallet](https://chromewebstore.google.com/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil) browser extension)
- [Supabase](https://supabase.com) project (free tier works)

### 1. Clone and install

```bash
git clone https://github.com/Mr-Boss-AI/sui-comabts.git
cd sui-comabts
```

### 2. Set up the server

```bash
cd server
npm install
cp .env.example .env
```

Edit `server/.env` with your Supabase credentials:

```env
PORT=3001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUI_NETWORK=testnet
SUI_PACKAGE_ID=0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303
PLATFORM_TREASURY=0x0000000000000000000000000000000000000000000000000000000000000000
```

Run the database migration — paste `server/src/data/migrations/001_initial.sql` into your Supabase SQL editor.

Start the server:

```bash
npm run dev
```

### 3. Set up the frontend

```bash
cd ../frontend
npm install
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_WS_URL=ws://localhost:3001
NEXT_PUBLIC_SUI_NETWORK=testnet
NEXT_PUBLIC_SUI_PACKAGE_ID=0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303
```

Start the frontend:

```bash
npm run dev
```

### 4. Play

Open [http://localhost:3000](http://localhost:3000), connect your Sui wallet, create a character, and fight.

### 5. (Optional) Run the AI bot

```bash
cd ..
node ai-bot.mjs
```

Big Bad Claude will join the ranked queue and auto-fight with trash talk.

## Smart Contracts

All contracts are deployed to **Sui Testnet** — 13/13 end-to-end tests passing.

| Module | Address | Purpose |
|--------|---------|---------|
| `character` | [`0x7fd5...2303::character`](https://suiscan.xyz/testnet/object/0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303) | Soulbound character NFTs |
| `item` | `0x7fd5...2303::item` | Tradeable item NFTs with IPFS art |
| `equipment` | `0x7fd5...2303::equipment` | Equip/unequip via dynamic object fields |
| `arena` | `0x7fd5...2303::arena` | Wager escrow (create, accept, settle, cancel) |
| `marketplace` | `0x7fd5...2303::marketplace` | Kiosk creation, listing, TransferPolicy |

**Package ID:** `0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303`

### Build contracts locally

```bash
cd contracts
sui move build
sui move test
```

## Project Structure

```
sui-comabts/
├── contracts/           # Move smart contracts
│   └── sources/         # character, item, equipment, arena, marketplace
├── frontend/            # Next.js 16 game client
│   └── src/
│       ├── app/         # App router, providers
│       ├── components/  # Fight arena, inventory, chat, etc.
│       ├── hooks/       # Game state, WebSocket
│       ├── lib/         # Combat math, Sui contract calls
│       └── types/       # TypeScript interfaces
├── server/              # Game server
│   └── src/
│       ├── data/        # Character storage, migrations
│       ├── game/        # Combat, loot, matchmaking
│       ├── utils/       # ELO, Sui verification
│       └── ws/          # WebSocket handlers, fight room, chat
├── nft/                 # NFT artwork assets
├── ai-bot.mjs           # AI opponent for testing
├── deployment.json       # Testnet contract addresses
└── test-e2e.mjs         # End-to-end contract tests
```

## Contributing

Contributions are welcome! Here's how to help:

1. **Fork** the repo
2. **Create a branch** (`git checkout -b feature/your-feature`)
3. **Make your changes** and test locally
4. **Commit** (`git commit -m "Add your feature"`)
5. **Push** (`git push origin feature/your-feature`)
6. **Open a Pull Request**

### Areas we'd love help with

- Move contract optimizations and security hardening
- Game balance tuning (combat formulas, loot tables)
- UI/UX improvements and medieval theme design
- Mobile-responsive layout
- Integration tests
- Documentation

## License

[MIT](LICENSE)

---

*Built on [Sui](https://sui.io). Stored on [Walrus](https://walrus.site). Fought on-chain.*
