# Gemini Project Log

## Summary of Tasks
- Evaluated the Sui Combats codebase and architecture.
- Discussed long-term vision (Planets, Farming, Pets).
- Discussed combat mechanics (RNG vs Strategy) and economy balancing.
- Discussed marketing strategy (Meme coin NFT collaborations).

## Changes Made
- Initialized Gemini.md to track project architecture and discussions.

## Next Steps / Suggestions
- Ensure combat remains engaging despite RNG by relying heavily on build-crafting (Tank vs Crit).
- Implement "Set Bonuses" to drive marketplace demand for specific item sets.
- Be cautious of reputational risks when associating with volatile meme coin communities.

## Tech Stack
- Frontend: Next.js 16 (Turbopack), React, TypeScript, @mysten/dapp-kit-react
- Server: Node.js, Express, ws (WebSocket)
- Blockchain: Sui Testnet (Move smart contracts)
- Database: Supabase
- Hosting: Walrus Sites (testnet)

## Architecture Decisions
- Combat is Server-Authoritative with WebSocket reconnect grace periods to prevent cheating while ensuring network drops don't lose real SUI.
- Equipment is handled via Sui dynamic-object-fields.
- Wager fights use full on-chain escrow.

## Known Limitations
- Heavy reliance on centralized server for combat resolution (trust-the-server).
- Game loop could become repetitive if build diversity is not deep enough.
- Meme coin collaborations carry external reputation risks.
