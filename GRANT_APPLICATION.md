# Sui Foundation Grant Application — SUI Combats

> **Submitted:** April 15, 2026
> **Program:** Hydropower Accelerator / Direct Strategic Investment

---

## 1. Project Overview

**Project Name:** SUI Combats

**One-liner:** A fully on-chain PvP RPG combat framework for Sui — soulbound characters, tradeable NFT items with IPFS art, zone-based tactical combat, and SUI-escrowed wager fights.

**Website:** Deployed on Walrus Sites (testnet)
**GitHub:** [github.com/Mr-Boss-AI/sui-comabts](https://github.com/Mr-Boss-AI/sui-comabts) (private — access available on request)

---

## 2. What We've Built

SUI Combats is a working, testnet-deployed RPG combat system where players create soulbound characters, collect tradeable NFT items, and fight other players in real-time PvP with SUI staked on the outcome.

### Smart Contracts (Move)

Five modules deployed to Sui Testnet — **13/13 end-to-end tests passing:**

| Module | Purpose | Key Features |
|--------|---------|--------------|
| `character` | Soulbound character NFTs | `key` only (no `store`), tied to wallet identity |
| `item` | Tradeable item NFTs | `key + store`, `image_url` field for IPFS art |
| `equipment` | Equip/unequip system | Dynamic object fields, 10 equipment slots |
| `arena` | Wager escrow | `create_wager` → `accept_wager` → `settle_wager`, 5% platform fee, full SUI escrow |
| `marketplace` | Kiosk integration | Kiosk creation, item listing, TransferPolicy enforcement |

**Package ID:** `0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303`
**Deploy Transaction:** `91dYe241tXexqzvKMQr4tUbtkVXaHUVazo3hqBcjxgBr`

### Architecture

```
Browser (Next.js 16) ──WebSocket──→ Game Server (Express + ws)
  │                                      │
  │ @mysten/dapp-kit-react               │ Supabase persistence
  │ Wallet signing for NFT operations    │ Fight resolution, matchmaking, chat
  │                                      │
  └── Sui Testnet (RPC) ───────────────→ On-chain NFTs, wager escrow
  │
  └── Walrus Sites (testnet) ──────────→ Decentralized frontend hosting
```

### What's Working Today

- **Character creation** mints a soulbound NFT on Sui (wallet signs the transaction)
- **Character persistence** across server restarts — frontend detects existing Character NFT in wallet and auto-restores
- **On-chain item NFTs** with IPFS-hosted artwork display in inventory, equipment slots, and fight arena
- **Zone-based PvP combat** — 5 body zones (head, chest, stomach, belt, legs), attack/block selection, critical hits, evasion, dual-wield and shield mechanics
- **Real-time matchmaking** with ELO rating, ranked and wager fight modes
- **Equipment system** — 10 slots (weapon, offhand, helmet, chest, gloves, boots, belt, 2 rings, necklace), stat bonuses affect combat
- **On-chain ownership verification** — server validates wallet still owns equipped NFT items on every login, preventing ghost items
- **NPC shop** with gold economy, loot drops from victories
- **Chat system** with rate limiting, system messages, direct messages
- **Leaderboard** and fight history tracking
- **AI bot** ("Big Bad Claude") for testing — auto-queues, fights with random strategy, trash-talks in chat
- **Supabase persistence** — characters and fight results survive server restarts
- **Walrus Sites deployment** — frontend hosted on decentralized storage (testnet)

### On-Chain Assets

| Asset | Object ID | Details |
|-------|-----------|---------|
| Iron Sword (Common) | `0x9349e5...17ec6a` | IPFS image, tradeable |
| Cursed Greatsword (Epic) | `0x7304...cba2adee` | IPFS image, transferred to player wallet |

### Test Results

All 13 contract tests pass on Sui Testnet:
- Character: create, read, verify soulbound (no transfer)
- Item: mint, transfer, verify `image_url` field
- Equipment: equip, unequip, verify dynamic fields
- Arena: create wager, accept wager, settle (winner payout + platform fee), cancel (refund)
- Marketplace: create kiosk, list item, verify TransferPolicy

---

## 3. How This Benefits the Sui Ecosystem

### The Gap

Sui has strong DeFi and NFT infrastructure, but **no open-source RPG combat framework**. Every game team building on Sui starts from zero — designing their own character systems, item standards, combat mechanics, and wager escrow. This duplicated effort slows ecosystem growth.

### What SUI Combats Provides

**For game developers:**
- Battle-tested Move modules for characters, items, equipment, and wager escrow — fork and customize
- A reference architecture for hybrid on-chain/off-chain game state (what belongs on-chain vs. server-side)
- WebSocket-based real-time game server pattern with Sui wallet integration

**For the Sui ecosystem:**
- **First RPG framework on Sui** — establishes a standard that other games can build on
- **Soulbound character NFTs** — demonstrates `key`-only objects for non-transferable identity
- **Wager escrow primitive** — reusable pattern for any competitive game wanting SUI-staked matches
- **Kiosk marketplace integration** — shows how game items can plug into Sui's native trading infrastructure
- **Walrus Sites hosting** — demonstrates decentralized frontend deployment for games
- **dapp-kit-react integration** — reference implementation for Next.js 16 + Sui wallet

**For players:**
- True ownership of characters and items as NFTs
- Provable scarcity — item stats and rarity are on-chain
- SUI-escrowed competitive fights — not trust-the-server, trust-the-contract
- IPFS-hosted item art that persists independently of any server

### SDK Potential

The Move modules are designed to be composable. The long-term vision is an **open-source Sui RPG SDK** that any developer can use:

```
sui-rpg-sdk/
  ├── contracts/       # character, item, equipment, arena, marketplace
  ├── server/          # matchmaking, combat resolution, WebSocket framework
  ├── frontend/        # React components, wallet integration, game UI
  └── docs/            # integration guides, customization cookbook
```

This is similar to what Anchor did for Solana or what OpenZeppelin did for Ethereum — but for games on Sui.

---

## 4. Team

We are a small, focused team with deep experience in full-stack development and blockchain systems. We move fast — SUI Combats went from concept to 13/13 passing testnet contracts, working PvP, and Walrus deployment in under two weeks.

We are actively looking for:
- A Move developer with Sui framework experience to help optimize contracts
- A game designer to refine combat balance and progression
- Community contributors once the SDK is open-sourced

---

## 5. Budget and Milestones

### Requested: $50,000

| Phase | Timeline | Deliverable | Budget |
|-------|----------|-------------|--------|
| **Phase 1 — Production Hardening** | Weeks 1–4 | Real SUI wager escrow integration, Display object for wallet NFT visibility, mainnet contract deployment, security audit prep | $15,000 |
| **Phase 2 — SDK Extraction** | Weeks 5–8 | Extract reusable SDK from monorepo, npm packages for contracts + server + frontend components, documentation site, integration guides | $15,000 |
| **Phase 3 — Community Launch** | Weeks 9–12 | Open-source release, example games built on the SDK, developer onboarding workshop, hackathon participation, bug bounty program | $10,000 |
| **Phase 4 — Ecosystem Growth** | Weeks 13–16 | Marketplace integration with existing Sui NFT platforms, cross-game item standard proposal, tournament system with prize pools, mobile-responsive UI | $10,000 |

### Key Milestones

1. **Week 4:** Mainnet deployment with real SUI wager escrow, 3 active playtesters
2. **Week 8:** SDK published to npm, documentation site live, first external team using the SDK
3. **Week 12:** Open-source release, 10+ GitHub stars, at least 2 community-built games using the framework
4. **Week 16:** Cross-game item interoperability demo, tournament with SUI prize pool

---

## 6. Links

| Resource | Link |
|----------|------|
| **GitHub** | [github.com/Mr-Boss-AI/sui-comabts](https://github.com/Mr-Boss-AI/sui-comabts) |
| **Package on Sui Explorer** | [suiscan.xyz/testnet/object/0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303](https://suiscan.xyz/testnet/object/0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303) |
| **Deploy Transaction** | [suiscan.xyz/testnet/tx/91dYe241tXexqzvKMQr4tUbtkVXaHUVazo3hqBcjxgBr](https://suiscan.xyz/testnet/tx/91dYe241tXexqzvKMQr4tUbtkVXaHUVazo3hqBcjxgBr) |
| **Iron Sword NFT** | [suiscan.xyz/testnet/object/0x9349e5989adf594cd61bb90a02bf96c91f68f3849822c3e39123c762e317ec6a](https://suiscan.xyz/testnet/object/0x9349e5989adf594cd61bb90a02bf96c91f68f3849822c3e39123c762e317ec6a) |
| **Cursed Greatsword NFT** | [suiscan.xyz/testnet/object/0x7304487409441df6e0596ee40e5f28fa725d0aa9ba8565e89f726901cba2adee](https://suiscan.xyz/testnet/object/0x7304487409441df6e0596ee40e5f28fa725d0aa9ba8565e89f726901cba2adee) |
| **Walrus Site (testnet)** | Object ID: `0xb8a80a92296751dc45aa3401b2042c18b050a039f2add33e5fd9387e2135b7e3` |
| **Item Art (IPFS)** | [gateway.pinata.cloud/ipfs/bafybeie4pcqfdj7c7j33bt3ko42dv7yarjzvqwij2tyd7sjndoqrm2sdjq](https://gateway.pinata.cloud/ipfs/bafybeie4pcqfdj7c7j33bt3ko42dv7yarjzvqwij2tyd7sjndoqrm2sdjq) |

---

## 7. Why Now

Sui's object model is uniquely suited for games — owned objects as characters, dynamic fields as equipment slots, shared objects as wager escrow. No other L1 makes this as natural. But without a reference framework, every game team reinvents the wheel.

SUI Combats is already working. The contracts are deployed and tested. The PvP is playable. The NFTs are minted. We're not pitching an idea — we're showing a product and asking for support to turn it into infrastructure the whole ecosystem can use.

---

*Built on Sui. Stored on Walrus. Fought on-chain.*
