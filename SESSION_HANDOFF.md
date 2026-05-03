# Session Handoff — 2026-05-03 (evening)

> Single-page summary of today's three sessions (afternoon code,
> evening browser QA, evening doc sync). Branch `feature/v5-redeploy`,
> latest commit `9d7dd19` on origin. Upstream `main` stays at the
> v4-era `08ff991`; **do not merge until v5.1 republish lands**.

---

## What shipped today

### Five code commits + this docs commit

| Commit | Bug | One-liner |
|---|---|---|
| `fd56b4a` | Slot picker hides locked items | `equipment-picker.ts` (NEW) keeps locked items in the picker, dimmed with a red `Lv N` badge. 53-test gauntlet. |
| `fe9c883` | Character page HP/ATK + stat bars | Frontend `LEVEL_HP` / `LEVEL_WEAPON_DAMAGE` synced element-by-element with server's rebalanced tables. STR/DEX/INT bars compile (Tailwind v4 JIT). GDD §3.3 rewritten. 79-test parity gauntlet. |
| `a26535e` | Wager stake input clearable (Bug 2) | New `wager-input.ts` parses string-state input; clearable, validates on submit. 47-test gauntlet. |
| `20f3750` | Outcome modal on rejoin (Bug 3) | Server caches per-wallet outcome; replays via `recent_fight_settled` on reconnect. localStorage dedupes. 31-test gauntlet. |
| `9d7dd19` | Grace timer cumulative budget (Bug 1) | 60 s window is now per-fight cumulative, not per-cycle. Abuser ping-pong now forfeits. 46-test gauntlet. |

### Browser QA pass (evening)

All three polish bugs verified live with two-wallet testing on Sui
testnet:

- **Bug 1 cumulative grace** — 3 disconnect/reconnect cycles in a
  single fight. Banner countdowns: 60 s → 14 s → 9 s, then forfeit.
  Initial confusion was a stale ts-node build serving old code; hard
  server restart + browser refresh fixed it. Working as designed.
- **Bug 2 stake input** — fully clearable, validation on submit,
  "Minimum stake is 0.1 SUI" inline.
- **Bug 3 rejoin modal** — Mr_Boss closed tab → forfeited offline →
  reopened tab → full Defeat modal (XP / rating / wager). Sx (still
  online) saw mirrored Victory in real time.

### Lv5 progression verified

- **Tap-to-equip auto-swap** — auto-unequips old + equips new in a
  single click. HP 113→116, ATK 26→29.5, Crit 2.5→7.5, Evasion
  6.5→13.5 on Mr_Boss's Cursed Greatsword (Epic Lv5) swap.
- **`allocate_points` regression stays fixed** — verified on
  Mr_Boss Lv4→Lv5 (day) and Sx Lv5 (evening). Slush approved both,
  no MoveAbort code 2. Three approvals total across two characters
  + two level-ups since the b39202d clamp.
- **Lv5 vs Lv5 wager (0.4 SUI)** — Sx evasion build (Twin Stilettos
  + Wooden Buckler + Magic Ring) beat Mr_Boss crit build (Cursed
  Greatsword Epic + Ornate Mithril Breastplate Rare + Copper Band)
  in 2 turns. 95/5 settle clean, XP +43/+100, ELO ±17. Dual-wield
  + shield combo did not crash the contract.

---

## Tests

14 gauntlets, **731 / 731 PASS**. New today:

- `qa-equip-picker.ts` — 53 (slot picker rules + sort order)
- `qa-combat-stats.ts` — 79 (HP/ATK table parity + sample stats)
- `qa-wager-form.ts` — 47 (parseWagerInput edge cases)
- `qa-reconnect-modal.ts` — 31 (recent-outcomes cache + dedupe)
- `qa-grace-budget.ts` — 46 (cumulative grace semantics)

Existing gauntlets unchanged. Frontend + server `tsc --noEmit`
clean. 35/35 Move unit tests still passing.

---

## New polish backlog (this session)

Tracked in `STATUS.md` → "Known polish backlog". Non-blocking:

1. **Level-up popup** — no celebratory toast on level-up. Stats
   update silently; player has to notice the new badge.
2. **Inventory auto-refresh after rapid swaps** — minor sync lag
   between doll panel and inventory list. Hard refresh fixes.

Carry-over polish from prior sessions still open: HP decimal
display, equipped items invisible at fight start, stat-allocate
modal preset.

---

## Game balance (content tuning, not code)

Lv5 vs Lv5 fights end in 2 turns at high rarity. Combat math
correctness is verified by `qa-xp.ts`, `qa-combat-stats.ts`, and
the live counter-triangle observation; this is content/data
tuning. Likely needs an armor/HP scaling pass for higher levels +
rarities. No action in contracts/frontend until we have a tuning
plan.

---

## Server status

Both servers running on commit `9d7dd19` post-restart:

- **3001:** clean boot — `[OrphanWager] No stale in-flight rows`,
  marketplace stream active, 2 wallets connected.
- **3000:** Next.js 16.2.3 ready, `HTTP 200`.

To rerun:

```bash
kill $(lsof -t -i:3001) 2>/dev/null
kill $(lsof -t -i:3000) 2>/dev/null
cd ~/sui-comabts/server   && npm run dev > /tmp/server.log   2>&1 &
cd ~/sui-comabts/frontend && npm run dev > /tmp/frontend.log 2>&1 &
sleep 6
curl -s localhost:3001/health | python3 -m json.tool
```

Supabase still OPTIONAL (running in-memory). To enable, see
`STATUS.md` → "Optional — Supabase".

---

## Next-session pickup — Bucket 1 remaining

In priority order:

1. **Market room** — Kiosk list / buy / cancel / royalty math /
   cross-wallet browse (live UX walk; `qa-marketplace.ts`'s 63
   assertions cover the math).
2. **Tavern** — chat, presence, whispers, profile clicks. Currently
   uncovered live; gauntlet has nothing on chat.
3. **Hall of Fame** — sort, filter, profile click-throughs.
4. **Multi-day stability** — overnight uptime test.
5. **Fresh user onboarding** — wipe localStorage, full
   create-character flow from a never-seen wallet.

After Bucket 1 is green, the v5.1 republish design (player-signed
settlement, `CharacterRegistry`, `burn_character`, on-chain loot
mint) can begin.

---

## Branch state

- Local `feature/v5-redeploy` and `origin/feature/v5-redeploy` in
  sync at `9d7dd19` (post-doc commit will advance both).
- `main` untouched (still at v4-era `08ff991`).
- **Standing rule:** no merge to main until v5.1 republish is
  confirmed working on testnet.

---

## Useful one-liners

```bash
# Inspect any chain object
curl -s -X POST https://fullnode.testnet.sui.io:443 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getObject",
       "params":["0x...",{"showContent":true}]}' | python3 -m json.tool

# Find a wallet's Character NFTs (descending — newest first)
curl -s -X POST https://fullnode.testnet.sui.io:443 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"suix_queryEvents",
       "params":[{"MoveEventType":"<PKG>::character::CharacterCreated"},
                 null,50,true]}' | python3 -m json.tool

# Refund an orphan wager
curl -s -X POST http://localhost:3001/api/admin/cancel-wager \
  -H 'Content-Type: application/json' \
  -d '{"wagerMatchId":"0x..."}'

# Force-clear a stuck fight-lock DOF
curl -s -X POST http://localhost:3001/api/admin/force-unlock \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"0x..."}'

# Repin a wallet to a specific Character NFT
curl -s -X POST http://localhost:3001/api/admin/repin-character \
  -H 'Content-Type: application/json' \
  -d '{"wallet":"0x...","characterId":"0x..."}'
```

All admin endpoints are testnet-only (`CONFIG.SUI_NETWORK !== 'mainnet'`
guard) and 403 on mainnet. Don't expose them externally even on testnet.
