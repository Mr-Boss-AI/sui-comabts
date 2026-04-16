# Progress — April 15, 2026

## What Was Done

### Wager Escrow Integration (MAJOR)
- Integrated `arena.move` contract into the actual wager fight flow — real SUI is now locked on-chain
- Updated TREASURY address from placeholder `@0xCAFE` to dev wallet `0xdbd3...bcd60`
- Upgraded contract on testnet → new package: `0x50a536845980969dfa54c274f437f9da426e58b1ea5f1f38fe79ff29e8a684fd`
- 5% platform fee (500 BPS) to dev wallet, 95% to winner
- Full on-chain flow: `create_wager` → `accept_wager` → fight → `settle_wager`
- 30-second timeout for opponent to accept, `cancel_wager` for refunds
- Minimum wager: 0.1 SUI (100,000,000 MIST)
- Frontend: wallet popup for both players (create + accept) via `CurrentAccountSigner`
- Server: calls `settle_wager` via `sui client call` CLI after fight ends
- New server utility: `sui-settle.ts` (settlement + on-chain status verification)
- New frontend tx builders: `buildCreateWagerTx()`, `buildAcceptWagerTx()`, `buildCancelWagerTx()`
- New WebSocket messages: `wager_accept_required`, `wager_accepted`, `wager_accept_timeout`, `wager_settled`
- Matchmaking updated: wager matches go through acceptance flow before fight starts

### Walrus Sites Deployment
- Installed `walrus` CLI, `suiup`, and `site-builder` for testnet
- Configured Next.js for static export (`output: 'export'`, `images: { unoptimized: true }`)
- Fixed 4 TypeScript type mismatches blocking build (`TurnResult.hpAfter`, `FighterState.equipment`, `queue_fight.onChainEquipment`, SpectateView DamageLog props)
- Built static export and deployed to Walrus testnet (5 epochs)
- Site object: `0xb8a80a92296751dc45aa3401b2042c18b050a039f2add33e5fd9387e2135b7e3`
- Tested local Walrus portal with Bun (patched port to 8080)

### GitHub & Public Release
- Created private repo `Mr-Boss-AI/sui-comabts` via GitHub MCP
- Fixed frontend submodule issue (was tracked as gitlink, re-added as regular files)
- README.md with architecture diagram, setup guide, contract addresses, tech stack
- MIT License added
- Made repo public for grant application visibility

### Security Hardening
- Removed hardcoded Supabase anon key from `setup-db.mjs` (now reads from .env via dotenv)
- Removed `supabase/.temp/` from git (pooler URL, project ref, org metadata)
- Added `supabase/.temp/` to `.gitignore`
- Removed `adminWallet`, `publisherId`, `upgradeCap` from `deployment.json`
- Removed keystore alias name from knowledge base documentation
- Full repo scan for secrets — no private keys, mnemonics, or service keys found

### Bug Fixes
- **Duplicate item keys** — Fixed deduplication in `character-profile.tsx` and `equipment-grid.tsx` (Map by ID, prefer on-chain version)
- **On-chain ownership verification** — Server now verifies wallet owns equipped NFT items on every login via Sui JSON-RPC (`sui-verify.ts`), removes ghost items
- **Minimum wager** — Updated from gold-based to 0.1 SUI minimum (frontend + server validation)

### Grant Application
- Drafted `GRANT_APPLICATION.md` targeting Sui Foundation
- Programs: Hydropower Accelerator / Direct Strategic Investment
- $50,000 ask across 4 phases (16 weeks)
- Phase 1: Production hardening + mainnet deploy
- Phase 2: SDK extraction + npm packages
- Phase 3: Open-source community launch
- Phase 4: Cross-game interop + tournaments
- Positioned as first open-source RPG combat framework for Sui

### AI Bot
- "Big Bad Claude" bot operational — auto-queues ranked, fights with random strategy, trash-talks in chat
- Won a fight against player "Sx" (28 HP remaining, 6 turns)
- Got a Chainmail Coif (Uncommon) loot drop

## Files Changed

### New Files
- `server/src/utils/sui-settle.ts` — On-chain wager settlement + status verification
- `GRANT_APPLICATION.md` — Sui Foundation grant application
- `PROGRESS_APRIL_15.md` — This file
- `README.md` — Public repo documentation
- `LICENSE` — MIT license

### Modified Files
- `contracts/sources/arena.move` — TREASURY address fix → contract upgrade
- `server/src/config.ts` — Added `SUI_PACKAGE_ID`, `WAGER_ACCEPT_TIMEOUT_MS`
- `server/src/types.ts` — Added `wagerMatchId` to `FightState`, `QueueEntry`
- `server/src/ws/handler.ts` — Wager queue requires `wagerMatchId`, new `wager_accepted` handler, `initiateWagerAcceptance()` flow
- `server/src/ws/fight-room.ts` — `finishFight()` calls `settleWagerOnChain()` for on-chain wagers
- `server/src/index.ts` — `onMatchFound()` routes wager matches through acceptance flow
- `server/src/utils/sui-verify.ts` — On-chain item ownership verification
- `server/setup-db.mjs` — Removed hardcoded Supabase key
- `server/.env.example` — Added `SUI_PACKAGE_ID`
- `frontend/src/lib/sui-contracts.ts` — Added wager tx builders
- `frontend/src/components/fight/matchmaking-queue.tsx` — Full rewrite with wallet signing
- `frontend/src/components/character/character-profile.tsx` — Item dedup fix
- `frontend/src/components/items/equipment-grid.tsx` — Item dedup fix
- `frontend/src/components/fight/spectate-view.tsx` — DamageLog props fix
- `frontend/src/hooks/useGameStore.ts` — Added `pendingWagerAccept` state
- `frontend/src/app/game-provider.tsx` — Handles wager messages
- `frontend/src/types/game.ts` — Added `hpAfter`, `equipment` to fight types
- `frontend/src/types/ws-messages.ts` — Added wager message types
- `frontend/next.config.ts` — Static export config
- `deployment.json` — Updated to new package ID
- `.gitignore` — Added `supabase/.temp/`
- `SUI_COMBATS_KNOWLEDGE_BASE.md` — Full update

## Known Issues Still Open
- Wager fights untested end-to-end with real wallets (need two browser tabs with different wallets)
- Fight arena doesn't show opponent's equipped items visually
- Display object not registered (NFTs don't show metadata in Sui wallets)
- Walrus testnet portal requires self-hosting
- `settle_wager` doesn't verify caller — needs `_server_sig` check for production
- No retry mechanism if on-chain settlement fails

## Updated Config
- **Package ID:** `0x50a536845980969dfa54c274f437f9da426e58b1ea5f1f38fe79ff29e8a684fd`
- **Treasury:** `0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60`
- All env files and deployment.json updated
