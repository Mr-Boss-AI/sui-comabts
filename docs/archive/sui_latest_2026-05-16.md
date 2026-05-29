# Sui Ecosystem Survey & SUI Combats Integration Plan (May 2025 – May 2026)

## TL;DR
- **The mainnet-hardening path is now obvious:** drop server-side RNG for `sui::random` + move fight resolution into a Nautilus TEE with on-chain attestation, migrate Display V1 → Display V2 before the **July 31 2026** deprecation, upgrade to `@mysten/sui` v2.x with gRPC, and adopt Enoki for zkLogin + sponsored transactions and Slush as the default wallet. These five moves solve roughly 80% of the listed pain points.
- **Roadmap features have native primitives waiting:** Clans & Tournaments map directly to shared objects + DeepBook/USDsui prize pools; Pets/Herbs/Potions map to dynamic NFTs + on-chain randomness for breeding/loot; private fight state and "fog of war" map to Seal threshold encryption; Walrus Mainnet + Walrus Sites with SuiNS gives you decentralized asset + frontend hosting today.
- **The biggest hidden risk and the biggest grant opportunity are the same thing**: the May 22 2025 Cetus exploit ($223M from a math-library overflow) means Sui Foundation is actively funding security + tooling work and Beamable has already taken a Sui Foundation grant to build the gaming abstraction layer. A polished `@suicombats/*` SDK published on MVR that wraps PvP wagering + settlement attestation cleanly is a credible Developer Grant ($10K–$100K) ask in the same lane.

## Key Findings

A compressed scorecard. Detailed evaluations follow in the **Details** sections.

| Area | Top items for SUI Combats | Fit | Effort | When |
|---|---|---|---|---|
| Identity/Auth | Enoki SDK (zkLogin + sponsored tx), Passkey (SIP-9), Slush wallet | High | S–M | Pre-mainnet |
| Storage/Infra | Walrus Mainnet, Walrus Sites + SuiNS, Seal (private state), Nautilus (TEE fight resolution) | High | M–L | Mixed |
| NFT/Gaming | Display V2 (mandatory), on-chain randomness, Kiosk extensions, MVR | High | S–M | Pre-mainnet |
| SDKs/Tooling | `@mysten/sui` v2.x + gRPC, new dApp Kit (`@mysten/dapp-kit-react`), MVR named deps | High | M | Pre-mainnet |
| DeFi/Economy | USDsui native stablecoin, DeepBook for prize liquidity, suiUSDe | Medium | M | Post-mainnet |
| Core protocol | Mysticeti v2 (auto), SIP-45 priority gas, Move 2024 features (macros/enums/method syntax) | High | S | Auto/Pre-mainnet |
| Grants/Partners | Sui Foundation grants $10K–$100K; Beamable Sui SDK exists; SuiPlay0X1 distribution | Medium | M | Apply now |
| Security | Cetus post-mortem lessons; OtterSec/Zellic audit ($30–$130K, 3–6 wk) | Critical | M | Before mainnet |

---

## Details — Category by Category

### 1. Sui Core Protocol Updates (May 2025–May 2026)

**Mysticeti v2 + Transaction Driver — shipped Nov 6, 2025 (Sui node v1.60).** Mysten Labs replaced the Quorum Driver with a Transaction Driver and merged transaction validation into consensus itself, eliminating the pre-consensus validation step. Mysten Labs' blog (blog.sui.io/mysticeti-v2-sui-consensus/, Nov 6 2025) reports: *"We observed a 35% latency reduction on Asia-based full nodes (from ~1.00s to ~0.65s) and a 25% reduction on Europe-based full nodes (from ~0.55s to ~0.40s)."* This is automatic — no action required from SUI Combats — but the takeaway is that **non-fastpath (shared-object) transactions are now meaningfully faster**, which matters because your 5-zone simultaneous combat loop almost certainly touches a shared `Match` object. *Fit: implicit, applies; Pain point: latency; Effort: none.*

**SIP-45 — Consensus Amplification & raised max gas price (Finalised).** SIP-45 raised the max gas price ceiling from 99,999 MIST to 1,000,000,000,000 MIST and added a priority-fee model: a tx with gas price `n × RGP` is amplified `n` times in consensus submission, with k=5 as the activation threshold (`amplification_factor = max(0, gas_price/RGP − K)`). For SUI Combats this means **you can bid up gas to win settlement races during tournament finals** without bumping into the cap. *Fit: yes for tournaments; Pain point: contention; Effort: small.*

**Move 2024 / Move 2024.beta language features.** Available in the Sui CLI today via `edition = "2024.beta"` in `Move.toml`. The high-impact features for your contracts:
- **Method/dot syntax**: `match.start_round()` instead of `combat::start_round(&mut match)`. Drastically improves readability of fight resolution.
- **Macros (`macro fun`)**: lambda-style helpers with `break`/`continue`/`return` — perfect for zone-iteration, attack-resolution pipelines, item-effect chains.
- **Enums + pattern matching**: model `AttackResult::{Hit, Miss, Critical, Blocked}`, `Path::{Warrior, Mage, Ranger, ...}` (Inclination), `ItemKind::{Weapon, Armor, Consumable}`. Replaces u8/tag hacks.
- **`public(package)`** replaces `public(friend)` — *"friend declarations and the associated public(friend) visibility modifiers are deprecated. In their place is the public(package) visibility modifier."*
- **Positional struct fields, postfix abilities, `mut` required on locals**.

Run `sui move migrate` to convert v5.0 contracts on the way to v5.1. *Fit: yes; Pain point: contract maintainability + v5.1 redesign opportunity; Effort: medium; Pre-mainnet: yes.*

**SIP-39 — lower validator stake threshold (Finalised, phased rollout)**: drops the entry stake from 30M SUI in phased thresholds (12/8/4 → 6/4/2 → 3/2/1 voting power), per the SIP. **SIP-58 — Accumulator (parallel fungible balances)** (open) — means treasury inflows for clans/tournaments won't bottleneck on a single shared coin object once it lands. **SIP-19 — Soft Bundle API** is finalised: *"a way to bundle transactions with different signers and sequence them (and allow partial revert) in a single bundle with a high probability."* Relevant if you ever do clan-multisig moves.

**Native bridge / NBridge** continues to operate; not directly relevant since SUI Combats is Sui-native. Bridge risk caveat: the Cetus attacker bridged ~$60M USDC out via Wormhole/CCTP, which is the usual cross-chain laundering path — relevant only if you ever add bridged assets.

---

### 2. Identity, Auth & Onboarding

**Slush wallet (Sui Wallet + Stashed merger) — April 24, 2025.** Mysten Labs merged Sui Wallet and Stashed into Slush (web + mobile + browser extension). The migration is the package rename `@mysten/zksend` → **`@mysten/slush-wallet`**, and dApp Kit users switch the `stashedWallet` prop to `slushWallet` in `WalletProvider`. Slush includes built-in zkLogin (Google, Twitch, Facebook), Slush Links (claimable token/NFT links), and built-in NFT management. **Action for SUI Combats:** update wallet registration to `registerSlushWallet`. *Fit: yes; Effort: small; Pre-mainnet.*

**Enoki SDK (`@mysten/enoki` 1.0.x).** Enoki is Mysten's productized account-abstraction layer combining zkLogin + sponsored transactions + SuiNS subnames + Enoki Connect (cross-app wallet portability). Subscription pricing starts with 500M CPU/month. For SUI Combats this directly solves three pain points:
- Onboarding friction → Google/Twitch/Apple sign-in via zkLogin, no seed phrase.
- Wallet popups for every fight → sponsor combat actions, end-users never pay gas.
- Server-trust → the `client.createSponsoredTransaction → executeSponsoredTransaction` pattern keeps user signatures, just sponsors gas.

You can also issue your players SuiNS subnames like `alice@suicombats.sui`. *Fit: very high; Pain point: onboarding + UX; Effort: medium; Pre-mainnet.*

**Sponsored Transactions** are also offered by Shinami; per Shinami's docs, *"gas fees for Sui are very small — averaging around or below 0.003 SUI per transaction in the last 12 months."* Either Enoki or Shinami is fine; Enoki gives you the tighter native stack.

**Passkey (SIP-9, Finalised) — live on Mainnet Aug 7, 2025.** Sui supports WebAuthn passkeys natively (signature flag 0x06), with `PasskeyKeypair` in `@mysten/sui/keypairs/passkey`. Users sign with Face ID, Touch ID, or hardware key — no seed phrase, phishing-resistant by domain binding. Can be combined with zkLogin or hardware key in multisig for recovery. The first wallet to integrate was Nimora. **For SUI Combats this is the cleanest cross-device sign-in path** if you don't want OAuth provider dependency. *Fit: yes (alternative to Enoki); Effort: small; Pre-mainnet.*

---

### 3. Storage and Decentralized Infrastructure

**Walrus Mainnet — live March 27, 2025** (epoch 1 began March 25, 2025; 100+ storage nodes; mainnet epochs are 14 days). WAL token funded a $140M private sale led by Standard Crypto, *"with a16z crypto, Electric Capital, Franklin Templeton Digital Assets and RW3 Ventures"* participating (CoinDesk, Mar 20 2025). Key 2025 features: blob attributes, blob burn (reclaim storage fee), Reed-Solomon erasure codes (replacing RaptorQ), JWT auth for publishers, TLS, Quilt batching (small file optimization), Upload Relay, and the TypeScript SDK. For SUI Combats: **migrate Character/Item NFT images, equipment art, ability icons, and any large blobs off centralized hosting onto Walrus**. *Fit: yes; Effort: medium; Pre-mainnet for new art, post-mainnet acceptable for existing.*

**Walrus Sites + SuiNS — production-ready on Mainnet via wal.app portal.** A SuiNS name is required to make a site browsable through wal.app (Base36 subdomains only work locally). Use site-builder via `suiup install site-builder@mainnet` and `site-builder deploy ./dist`. Costs are paid in WAL; small static sites cost on the order of 0.1 WAL per epoch on testnet. **Direct fix for your "decentralized hosting (currently using Walrus Sites testnet)" pain point**: register `suicombats.sui`, buy WAL, and `site-builder deploy` your Next.js export. The Walrus 2025 year-in-review confirms Walrus Sites now supports deletable blobs to make updates capital-efficient. *Fit: yes; Effort: small–medium; This is the headline grant-story upgrade.*

**Seal — decentralized secrets management.** Launched on Sui Testnet in June 2025; mainnet in September 2025. Architecture: client-side identity-based encryption + t-of-n threshold key servers + on-chain access policies in Move. **High-value uses for SUI Combats:**
- Encrypt fight log replays so only participants (or paying spectators) can decrypt.
- Time-lock tournament bracket reveals.
- Encrypt mage scroll contents until the scroll is consumed.
- Encrypt clan-internal chat / strategy notes.
- Encrypt loot-table rolls so players see "loot dropped" but can't see what until reveal.

Vendetta (a Sui multiplayer game) is already using Seal for "encrypted, trustless gameplay mechanics," confirming the gaming-first fit. *Fit: very high for Tournaments + Clans + Mage Scrolls; Effort: medium; Post-mainnet.*

**Nautilus — verifiable off-chain compute (TEE) — live on Mainnet June 5, 2025.** Currently supports self-managed AWS Nitro Enclaves (with a roadmap to Marlin Oyster TEE marketplace). Pattern: Move smart contract stores expected PCRs (Platform Configuration Registers) of the enclave → register enclave attestation on-chain → enclave signs responses → Move contract verifies signature before consuming. The Sui blog explicitly describes the Seal+Nautilus pairing: *"Seal solves the 'who should access a key' question while TEE solves 'how can I compute on encrypted data.'"* **This is the textbook answer to your "move from server-trust to player-signed settlement attestation" pain point**: run your fight resolver in a Nitro enclave, have it sign the result, verify the attestation in Move, then mint loot. Combine with Seal for persisting long-lived keys between TEE restarts. *Fit: very high; Effort: large; Post-mainnet but ideal grant deliverable.*

**SuiNS + MVR (Move Registry).** MVR ([moveregistry.com](https://www.moveregistry.com/)) is the on-chain Move package registry — npm/crates.io for Move. It builds on SuiNS for ownership and adds versioning, source-code linking, testnet↔mainnet ID resolution, and runtime usage analytics. Register `@suicombats/core`, `@suicombats/combat`, `@suicombats/kiosk-rules`, etc. and reference them in `Move.toml` via `core = { r.mvr = "@suicombats/core" }`. Per Mysten CTO Sam Blackshear: *"surfacing verified usage data alongside the code is unique to MVR/Sui."* **This is the single highest-leverage thing for your `@suicombats/*` SDK-extraction grant story.** *Fit: yes; Effort: small (register names); Pre-mainnet.*

---

### 4. DeFi / Token Primitives (for game economy)

**USDsui — native Sui stablecoin announced Nov 12, 2025, issued by Bridge (a Stripe company).** Designed as the GENIUS-Act-ready USD asset for Sui. Sui processed **$412B in stablecoin transfer volume Aug–Sep 2025** alone in third-party stables (per Sui Foundation), and USDsui captures the yield from that. Will integrate with DeepBook and is interoperable with Bridge-powered stables on Phantom, Hyperliquid, MetaMask. For SUI Combats: **denominate tournament prize pools in USDsui (or USDC) rather than SUI** to remove price-volatility risk. *Fit: yes for Tournaments; Effort: medium; Post-mainnet.*

**suiUSDe — Ethena-backed synthetic dollar.** Launched on Sui Mainnet Feb 5, 2026, with a $10M seed vault on Ember Protocol (Bluefin team), incubated by Bluefin. First synthetic dollar supported by DeepBook Margin. 90% of fees flow back to Sui Group / Sui Foundation for SUI buybacks. Yield-bearing — relevant if you want to park clan treasury or unredeemed tournament pools to earn yield.

**DeepBook v3.** Mainnet upgrade expected Q2 2026 introducing margin trading and a referral/commission model. **DeepBook is built into the Sui network rather than deployed as a dApp**, so you can route any in-game token swap (Herbs to SUI) through DeepBook with sub-second finality. *Fit: medium; Effort: medium.*

**Bluefin and BluefinX.** BluefinX (RFQ aggregator, live April 2025) routes spot trades across Cetus, DeepBook, Aftermath, and Bluefin's own CLMM pools in a single tx in under one second. Per BSC News (Dec 2025): *"As of December 2025, Bluefin Spot handles more than 30% of all decentralized spot volume on Sui and consistently ranks in the top three protocols by daily active users for spot trading."* For SUI Combats: if you ever issue a closed-loop in-game token, Bluefin/BluefinX is the natural exit/on-ramp.

**Closed-Loop Tokens.** Already in your "aware of" list; remain the standard Sui pattern for in-game currencies (Herbs, Potions, scroll components) where you want trade restrictions. No major spec changes in the last 12 months — pattern is stable.

---

### 5. NFT & Gaming-Specific Primitives

**Display V2 — live in Sui v1.68. The single biggest "now-obsolete-in-your-codebase" finding.** Per blog.sui.io/display-v2-mainnet/: *"After July 31, 2026, the sui::display::new APIs will no longer be callable."* Migration:
- Existing V1 displays were auto-migrated by a system snapshot — your registered Display objects for Character + Item still work today.
- For any **new** types or display **updates** after July 31 2026, you must use `sui::display_registry`. The blog notes: *"If you previously created a display using V1 APIs, there's a v1_to_v2 endpoint in sui::display_registry you can call directly."*
- V2 enforces exactly one display per type (deterministic ID, no event-scanning).
- Templates can now access **elements of vectors/sets/maps** and **dynamic fields and child objects** — meaning your Character display can pull equipped items from the 10-slot dynamic-object-field equipment system into the display template, and your Pet display can show evolution stage from a dynamic field directly.

**Action:** Claim `DisplayCap<Character>` and `DisplayCap<Item>` via your Publisher (the old V1 display gets consumed), then rewrite templates with `sui::display_registry`. *Fit: critical; Effort: small–medium; Pre-mainnet mandatory.*

**On-chain randomness (`sui::random`, address 0x8) — fully production.** Threshold-cryptography + DKG; sub-second after tx ordering, runs in parallel with consensus. The required pattern for SUI Combats:
- Mark the entry function as **private `entry fun`** (no `public`), not callable from other modules.
- Take `&Random` as an argument and call `random::new_generator(r, ctx)` inside.
- Beware **PTB composition attacks**: per Sui docs, *"Sui rejects PTBs that have commands that are not TransferObjects or MergeCoins following a MoveCall command that uses Random as an input."* So you cannot have `fight() → checkResult() → revertIfLost()` in one PTB.
- Beware **gas-budget attacks**: an attacker who controls the gas budget can cause your function to abort partway after seeing a roll. Always do all reads/work before consuming randomness.

**For SUI Combats:** replace server-side RNG for fight resolution with `sui::random`. This is the single biggest credibility win — your wager game becomes verifiably fair. Maps perfectly to Herbs/Potions gacha drops and Pet breeding genetics. *Fit: critical; Effort: medium; Pre-mainnet.*

**Kiosk extensions.** Mature, stable. You already use Kiosk + TransferPolicy with 2.5% royalty. The extension model (`kiosk_extension::add` with permission bitmap) is the right place for custom rules — for example, a "minimum-listing-price" rule for tournament-prize items, or an auction extension for clan-exclusive sales. Permissions are all-or-nothing; kiosk owner can disable extensions any time. *Fit: medium; Effort: medium; Post-mainnet.*

**SuiPlay0X1.** Mysten/Playtron's $599 handheld (AMD Ryzen 7 7840U, 7" 1920×1200, Playtron GameOS) shipping to pre-orderers in 2025. Wallet integration at the OS level via Enoki Connect + Playtron wallet + SuiLink. For SUI Combats, **shipping a Playtron build is a credible distribution channel and grant ask** — Mysten is actively promoting Sui games for the device (XOCIETY, DARKTIMES are early titles). *Fit: maybe; Effort: medium to port; Post-mainnet.*

---

### 6. Developer Tooling & SDKs

**`@mysten/sui` v2.x and the new dApp Kit are out.** Major changes:
- The legacy `@mysten/dapp-kit` package is **frozen** — JSON-RPC only, will not get gRPC/GraphQL updates.
- The new packages are `@mysten/dapp-kit-core` (framework-agnostic) and `@mysten/dapp-kit-react`.
- **`SuiJsonRpcClient` is deprecated.** Replace with `SuiGrpcClient` (recommended) or `SuiGraphQLClient` (for complex filters). The gRPC client is a near-drop-in replacement; same fullnode URLs.
- New transaction APIs use `client.core.simulateTransaction(...)` instead of `devInspectTransactionBlock`.
- `Transaction` from `@mysten/sui/transactions` (no more `TransactionBlock` from `@mysten/sui.js`).
- The MVR namedPackagesPlugin is now a global serialization plugin: `Transaction.registerGlobalSerializationPlugin('namedPackagesPlugin', namedPackagesPlugin({ url: 'https://mainnet.mvr.mystenlabs.com' }))` so your TypeScript PTBs can use `@suicombats/core::combat::fight` instead of raw package IDs.

**Action for SUI Combats:** upgrade to `@mysten/sui` 2.x, swap your JSON-RPC client for gRPC (latency win), and migrate from `@mysten/dapp-kit` to `@mysten/dapp-kit-react`. Target versions referenced by the community migration tool zktx-io/sui-grpc-migration: `@mysten/sui@^2.4.0, @mysten/dapp-kit-react@^1.0.2, @mysten/dapp-kit-core@^1.0.4`. *Fit: yes; Effort: medium; Pre-mainnet.*

**MVR (Move Registry).** Install via `suiup install mvr` (or `cargo install --locked --git https://github.com/mystenlabs/mvr --branch release mvr`) and add named deps: `app = { r.mvr = "@deepbook/core" }`. Eliminates manual address copying between testnet/mainnet.

**`suiup`** is the recommended installer for Sui CLI, MVR CLI, and site-builder. Replaces ad-hoc binary downloads.

**Move analyzer + Prover.** Move 2024 ships with improved analyzer and `sui move test` capabilities. For SUI Combats: write Move unit tests for combat math, equipment slot constraints, and wager-split arithmetic. Consider the Move Prover for the 95/5 split invariant.

**Indexers.** Suiscan, BlockBerry, Blockvision continue as the main indexers. With gRPC + GraphQL replacing JSON-RPC, **prefer GraphQL filters for your "list a player's items / fights" backend queries** rather than scrolling through events.

---

### 7. Ecosystem Partnerships & Grants

**Sui Foundation Grants.** Three tracks: Developer Grants ($10K–$100K), Ecosystem Funding, and RFPs. Open-source initiatives, gaming, and security tooling are explicitly in scope. The Foundation has distributed ~$4.7M across ~90 projects. **SUI Combats is well-positioned as a Developer Grant applicant** — open-source, gaming, and the SDK extraction story (`@suicombats/*` published to MVR) is a clean ecosystem-value contribution.

**Hydropower Accelerator.** Cohort 1 graduated 12 projects in January 2025 (7k, AdToken, CryptoMate, Gifted, InsiDeX, Lotus Finance, Nativerse, Nemo Protocol, Pomerene, Printr, Protocol Media Labs, one confidential). Cohort 2 was announced June 24, 2025 — also 12 projects, focused on AI, DeFi, and social engagement. Eight-week format: tech, product, marketing, fundraising, demo day. SUI Combats is a plausible cohort 3 application.

**Beamable Sui SDK — funded by a Sui Foundation grant.** Beamable received a Sui Foundation grant to expand its Unity + Unreal SDKs with Sui integration: Stashed/Slush wallets, zkLogin via Enoki, sponsored transactions, NFT mint/burn/update, closed-loop tokens, Sui Kiosk. The Beamable Venus release (Unity SDK 4.0, Unreal SDK 2.2) added Web SDK and combinable Microservices. Warped Games (Warped Universe, Unreal) is a launch partner. **For SUI Combats: even if you stay on Next.js, the Beamable patterns (federated wallet auth via 2FA-style sign-message-then-verify, sponsored mint flows) are the reference implementation to copy.** Their open-source `beamable/sui-example` repo is required reading. *Fit: pattern source; Effort: read + adapt.*

**Tournament infrastructure** specific to Sui: nothing has shipped as a standalone primitive — this is actually a gap, and your Tournaments roadmap item could be packaged as a public `@suicombats/tournaments` Move package with Display V2 brackets, on-chain randomness for seeding, USDsui prize escrow, and Nautilus-attested match results. **This is the cleanest grant pitch.**

---

### 8. Performance, Economics, Gas

- **Reference Gas Price (RGP)** is set per-epoch by validators via the Gas Price Survey (2/3 percentile by stake). Typical mainnet RGP cited in docs: **750–1,000 MIST**.
- **Storage price**: 76 MIST per storage unit; 1 KB ≈ 0.0076 SUI in storage.
- **Storage rebate**: 99% refund on object deletion (1% to storage fund). Per Sui docs: *"Initially, the rebateable amount equals 99% of the storage fees, while the non-rebateable amount equals the remaining 1%."*
- **Min gas budget** 2,000 MIST; **max** 50,000,000,000 MIST (50 SUI).
- **SIP-45 raised max gas price** to 1,000,000,000,000 MIST (1 trillion).
- Average actual transaction cost on Sui over the last 12 months: at or below **0.003 SUI per tx** (Shinami).

**SUI Combats gas-efficiency actions:**
1. **Burn deleted Item NFTs** (consumed Potions, used Mage Scrolls) to claim the 99% storage rebate. Materially cheaper consumables economy.
2. **Batch into PTBs**: a single PTB that does `start_match → equip → fight → settle → mint_loot` saves multiple consensus rounds vs. 5 separate txns. Watch the randomness composition restriction (no commands after a `Random`-consuming MoveCall except `TransferObjects`/`MergeCoins`).
3. **Use SIP-45 priority gas during tournament finals** (gas price = 5× RGP for 5× amplification).
4. **Don't use shared objects when an owned object will do.** Owned-object txns take the fastpath — even faster than Mysticeti v2's shared-object path.

---

### 9. Upcoming Features (SIPs in flight)

From the [sui-foundation/sips](https://github.com/sui-foundation/sips) PR queue:

- **SIP-46 — UNFT Standard** (Nov 2, 2025): Unified NFT Standard for Sui. Worth tracking if it standardizes attribute layouts you'd otherwise hand-roll.
- **SIP-54 — One-Click Trading**: relevant for tournament entry / item purchase UX.
- **SIP-55 — Infallible PTBs** (Mar 13, 2025): PTBs that succeed atomically or revert. Reduces partial-state failure cases in your settle-and-loot flow.
- **SIP-57 — Better observability into package upgrades** (May 13, 2025).
- **SIP-58 — Sui Address Balances / Accumulator**: parallel fungible deposits/withdrawals. Big once it lands for tournament prize pools (no contention).
- **PR #58 — `tx_context::get_transaction_signers`** (Jun 6, 2025): enables Move code to read the signer set — useful for multisig actions like clan treasury withdrawals.
- **PR #61 — String formatter module for Move stdlib** (Jul 22, 2025): cleaner Display V2 templates.
- **PR #68 — PTB Type Argument Interpolation** (Jan 5, 2026): generic PTBs without packing types client-side.
- **PR #70 — PTB Dynamic Dispatch via Command Context** (Feb 5, 2026): runtime dispatch in PTBs. Likely the future answer to "I want combat resolution to dispatch different item-effect modules without a giant match expression."

**Walrus MemWal SDK (beta March 2026)** for AI agent persistent memory and **Quilt batch storage optimization** (2025–2026) reduce small-file costs — already integrated automatically by Walrus Sites.

---

### 10. Security & Audits

**Cetus exploit — May 22, 2025, $223M loss.** The biggest event of the year. An overflow bug in the `checked_shlw` function of the open-source `integer-mate` math library let an attacker mint enormous LP credit for one token. Sui validators coordinated to freeze ~$162M on-chain; ~$60M was bridged out via Wormhole/CCTP before the freeze. Recovery (per Cointelegraph citing Sui's official governance page, May 29 2025): *"governance vote concluded May 29, 2025, with validators representing 90.9% of stake voting Yes, 1.5% abstaining, 7.2% not participating."* Frozen funds were transferred to a multisig (Cetus + OtterSec + Sui Foundation); Cetus + a Sui Foundation loan ($30M USDC) covered the off-chain portion. Vulnerable library was shared with Kriya, Momentum, and Bluefin, all patched. The Sui Foundation announced a **$10M security initiative fund** (audits, bug bounty, formal verification) in response.

**Implications for SUI Combats:**
1. **Audit your math** — the 95/5 wager split, 2.5% royalty rounding, and any future damage/stat/drop-table math. Move's overflow protection doesn't cover bit shifts and doesn't cover logic-level errors.
2. **Vendor + audit any external Move libraries** you depend on.
3. **Bug-bounty before mainnet.** Even $5K–$10K on Immunefi catches a lot.
4. **OtterSec is the natural audit choice** for SUI Combats — they are a Sui Foundation–partnered firm and per their site protect "$5B+ in TVL." Zellic and MoveBit are equally credible alternatives.

**Audit pricing (Q1 2025 → 2026 benchmarks from Sherlock and Zealynx):** Sherlock states *"Cairo (StarkNet) and Move (Sui, Aptos) sit at 30 to 45 percent above EVM equivalents… most DeFi protocol audits landing between $25,000 and $100,000"* — implying **$30K–$130K for Move** at mid complexity. Lead times 3–6 weeks standard; expedited rounds add 20–40%; re-audit rounds $5K–$20K. Plan to audit before mainnet.

**Volo liquid-staking exploit** (early 2026, $3.5M) is a separate, smaller incident. Sui TVL **peaked at $2.6 billion on October 10, 2025** per DeFiLlama (The Defiant, Oct 2025), then pulled back sharply to ~$568M by March 31, 2026 (largely market + token unlocks, not security per se). For SUI Combats this means **don't expect to ride DeFi-driven user growth in the short term — design for organic gaming acquisition.**

---

## Recommendations — Prioritized for SUI Combats (Highest Impact-to-Effort First)

1. **(Pre-mainnet, MUST)** Migrate to **Display V2** for Character + Item using `sui::display_registry`. Reach into dynamic fields to render equipped items live in wallets/explorers. Hard deadline: `sui::display::new` calls abort after July 31, 2026. Effort: 1–2 days. Impact: critical + grant story (V2 dynamic-field templates are rare and you'd be a reference).
2. **(Pre-mainnet, MUST)** Replace server-side RNG with **`sui::random`** in combat resolution. Mark resolve functions as private `entry`, take `&Random`, validate composition restrictions and gas-budget hardening per docs. Effort: 3–5 days. Impact: turns SUI Combats from "trust us" to "verifiably fair." This is your #1 grant pitch line.
3. **(Pre-mainnet, MUST)** Upgrade **`@mysten/sui` → 2.x** + new **`@mysten/dapp-kit-react`**; swap JSON-RPC for **`SuiGrpcClient`** with GraphQL fallback for filtered queries; replace `@mysten/zksend` → **`@mysten/slush-wallet`** with `registerSlushWallet`. Effort: 2–4 days. Impact: keeps you off the deprecation cliff and unlocks gRPC latency.
4. **(Pre-mainnet, SHOULD)** Integrate **Enoki** for zkLogin (Google/Twitch) + sponsored transactions for combat actions. Removes wallet popups and onboarding friction. Issue **SuiNS subnames** (`alice@suicombats.sui`) via Enoki. Effort: 1 week. Impact: massive UX win + onboarding metric for grants. Alternative or complement: enable **Passkey** sign-in for the wallet-friction case where players don't want OAuth.
5. **(Pre-mainnet, SHOULD)** Register `@suicombats/core`, `@suicombats/combat`, `@suicombats/kiosk-rules`, `@suicombats/tournaments` on **MVR**. Reference them from `Move.toml` and TypeScript PTBs via `namedPackagesPlugin`. Effort: 1–2 days. Impact: directly enables the SDK-extraction grant story.
6. **(Pre-mainnet, SHOULD)** Adopt **Move 2024.beta** in v5.1 redesign — method syntax, macros, enums for `AttackResult`/`Path`/`ItemKind`, `public(package)` where you currently use `friend`. Run `sui move migrate`. Effort: 1 week (paired with v5.1 design). Impact: cleaner codebase, audit-friendlier.
7. **(Pre-mainnet, MUST)** Get a **professional Move audit** (OtterSec or Zellic). Budget $30K–$130K, 3–6 week lead time. Pair with $5K Immunefi bounty post-audit. Impact: existential for a wager game holding real SUI.
8. **(Post-mainnet, SHOULD)** Move static frontend onto **Walrus Sites + SuiNS** (`suicombats.sui` → wal.app). Move Character/Item art onto **Walrus** with Quilt batching. Effort: 1 week. Impact: real decentralization story.
9. **(Post-mainnet, HIGH-VALUE GRANT DELIVERABLE)** Move fight resolution into **Nautilus** (AWS Nitro Enclave), have it sign results, verify attestation on-chain before minting loot. Use **Seal** to persist the enclave signing key across restarts. Effort: 3–6 weeks. Impact: completely retires server-trust — the grant pitch becomes "verifiable PvP combat on Sui."
10. **(Post-mainnet, ROADMAP)** **Seal** for time-locked tournament brackets, encrypted mage scrolls, and clan-internal data. **DeepBook + USDsui** for tournament prize pool denomination + on-chain settlement. **Closed-loop tokens** for Herbs (already in your aware list, stable spec).

---

## Currently-in-Codebase Items That Are Now Suboptimal

| Current | Replacement | Why | Effort |
|---|---|---|---|
| Server-side RNG for fight resolution | `sui::random` | Verifiable fairness; mandatory for grant credibility | M |
| Display V1 registered for Character + Item | Display V2 via `sui::display_registry` | V1 `display::new` aborts after July 31, 2026; V2 supports dynamic fields + collection iteration | S |
| `@mysten/sui` (v1.x) + legacy `@mysten/dapp-kit` | `@mysten/sui` ^2.4 + `@mysten/dapp-kit-react` ^1.0.2 + `SuiGrpcClient` | Legacy package is frozen; gRPC has lower latency | M |
| Direct package IDs in TS + Move | MVR named packages (`@suicombats/core`) | Testnet↔mainnet without code changes; grant/SDK story | S |
| `@mysten/zksend` `registerStashedWallet` | `@mysten/slush-wallet` `registerSlushWallet` | Stashed merged into Slush April 24, 2025 | S |
| Custodial-style server submission of player actions | Enoki sponsored transactions with player-signed tx kind bytes | Removes server-trust, removes wallet popups for gas | M |
| Walrus Sites testnet | Walrus Sites mainnet + SuiNS via wal.app portal | Production hosting, deletable blobs, public portal | S |
| `public(friend)` if used anywhere | `public(package)` | Move 2024 deprecation | S |

---

## Plan Coverage Table

| Plan item | Covered |
|---|---|
| 1. Core protocol (Mysticeti, Move VM, object model, NBridge, roadmap) | ✅ §1, §9 |
| 2. Identity/auth/onboarding (zkLogin, passkeys, Enoki, sponsored tx, Slush) | ✅ §2 |
| 3. Storage/infra (Walrus, Seal, Nautilus, SuiNS) | ✅ §3 |
| 4. DeFi/token primitives (closed-loop, DeepBook/Bluefin, stablecoins, LST) | ✅ §4 |
| 5. NFT/gaming primitives (Kiosk, Display, randomness, gaming SDKs) | ✅ §5 |
| 6. Developer tooling/SDKs (@mysten/sui, dApp Kit, MVR, suiup, GraphQL, indexers, Move 2024) | ✅ §6, §1 |
| 7. Ecosystem partnerships/grants (Hydropower, Beamable, etc.) | ✅ §7 |
| 8. Performance/economics/gas | ✅ §8 |
| 9. Upcoming features (SIPs, GitHub roadmap) | ✅ §9, §1 |
| 10. Security/audits (Cetus, audit firms, pricing) | ✅ §10 |
| Per-finding SUI Combats fit eval | ✅ inline in each §  |
| Prioritized top-10 recommendations | ✅ Recommendations section |
| Flag obsolete items in codebase | ✅ Suboptimal table |

---

## Caveats

- **Speculative items flagged explicitly:** DeepBook v3 is "expected Q2 2026" — not shipped. USDsui shipped Nov 2025 but on-chain integrations are still ramping. SuiPlay0X1 deliveries were "expected 2025" — verify current shipping status before committing engineering time.
- **TVL pullback context:** Sui TVL fell from $2.6B (Oct 10 2025 ATH per DeFiLlama / The Defiant) to ~$568M by March 31, 2026 (largely market + token-unlock pressure measured in USD, not security or product). Gaming projects on Sui should design for organic gaming acquisition, not DeFi spillover.
- **Cetus exploit reminder:** Move's "safe by default" reputation is real for reentrancy and most overflow but NOT for bit shifts, NOT for shared libraries, and NOT for logic errors. Audit accordingly.
- **Enoki and Shinami are not free at scale.** Both are SaaS-priced. Model gas-sponsorship costs into your unit economics before going all-in.
- **Nautilus on AWS Nitro Enclaves means you still depend on AWS.** Marlin Oyster integration is on the Nautilus roadmap and would make this fully decentralized; until then, the trust assumption is "AWS attestation + open-source enclave image." Disclose this to users.
- **The Sui Foundation freeze of Cetus attacker addresses** was validator coordination, not a protocol-level censorship feature. Critics (e.g., @DU09BTC on X) raised decentralization concerns. If your wager game holds real money, this cuts both ways: validators can help recover from an exploit, but the precedent exists.
- **Items I could not fully verify and you should re-check before quoting publicly:** exact `@mysten/sui` v2.0 release date (npm version history needed; current is 2.x); SIP-22 contents (could not retrieve directly); firm-specific audit pricing for OtterSec/Zellic is RFP-only and the $30K–$130K range comes from industry benchmarks (Sherlock, Zealynx), not the firms themselves.