# Web Game UI Kit — SUI Combats

Click-through prototype of the in-game surfaces, in the Ponke-skinned
visual language defined by `colors_and_type.css`. Drop the URL into
the address bar (or open `index.html`) and click around — every nav
link works, the Arena → Fight transition is live, and the marketplace
filters operate locally.

## What's here

| File | Role |
|---|---|
| `index.html` | Host page. Loads React + Babel + every JSX module. |
| `styles.css` | Layout glue, sticker-shadow recipe, keyframes, button + zone styling. Reads tokens from `../../colors_and_type.css`. |
| `Icons.jsx` | Monoline 24×24 SVG icon components — `<ISword>`, `<IShield>`, `<IBolt>`, etc. |
| `Primitives.jsx` | `<Button>`, `<Stamp>`, `<Card>`, `<Pill>`, `<Bar>`, `<Avatar>`, `<StatRow>`, `<Section>`. |
| `Data.jsx` | Fake game state — player, items, opponent, leaderboard, chat log. Field names mirror the real codebase types in `frontend/src/types/game.ts`. |
| `Navbar.jsx` | Top nav with wordmark, identity pill, nav links (bold-on-hover), SUI balance, Connect / Quick Fight buttons. |
| `Landing.jsx` | Pre-connect hero. Wordmark, three-step explainer, NFT-card stack. |
| `TownNav.jsx` | Sub-banner under the main nav showing where you are. |
| `CharacterScreen.jsx` | Equipment frame (combats.ru-style border around a central NFT portrait), stats, XP bar, combat derived, inventory, fight history. |
| `PortraitPicker.jsx` | Modal — pick a cosmetic NFT to display in the portrait frame. Cosmetic only; persists in localStorage. |
| `ArenaScreen.jsx` | Three fight-type cards (Friendly / Ranked / Wager) + active wager lobby. |
| `MarketplaceScreen.jsx` | Filter sidebar, item grid, your-kiosk panel. Real NFT PNGs from `assets/items/`. |
| `TavernScreen.jsx` | Three-column chat — DMs left, global tavern center, online players right. |
| `HallOfFameScreen.jsx` | Top 3 podium + ELO ladder table with player highlight. |
| `FightScreen.jsx` | Full-bleed arena — round banner, fighter portraits, zone selector, fight log, Lock-In button. |
| `App.jsx` | Router (connected? fighting? area). |

## Composition pattern

Every screen file:
1. Defines its components in module scope.
2. Reads tokens from `colors_and_type.css` via CSS vars.
3. Pulls fake data from `window.PLAYER / window.ITEMS / etc.`
4. Exposes its main component on `window.<Name>` at the bottom.
5. `App.jsx` consumes those globals.

This keeps each file ≤ ~250 lines and lets you replace any one screen
without touching the others.

## What it does NOT do

- No real WebSocket connection or wallet integration. Buttons are
  cosmetic — they trigger local React state transitions.
- No real wallet pop-up or signing dialog. The "Connect Wallet" CTA
  just flips a boolean.
- No keyboard shortcuts hooked up in the FightScreen yet — the legend
  is shown but the handlers are placeholders.
- Character portraits are emoji placeholders (🐸 🐕 🦍 etc.). Real
  chibi-meme fighter art needs to be commissioned per the brief.

## Replacing or extending

- **New screen** → drop `MyScreen.jsx` next to the others, add a `<script>` tag
  to `index.html` after `Primitives.jsx`, add a case to `App.jsx`.
- **New token** → edit `../../colors_and_type.css`; every component
  reads via `var(--…)`.
- **Different layout densities** → most container widths are set as
  inline grid templates. Change them on the specific screen, not the
  shared styles.
