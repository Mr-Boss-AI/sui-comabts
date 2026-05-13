# Fonts

This system uses three Google Fonts loaded via `@import` in
`colors_and_type.css`. No font files are bundled.

| Family | Role | Weights | License |
|---|---|---|---|
| **Slackey** | Display / wordmark / `FIGHT!` splash text | 400 | OFL |
| **Poppins** | All UI text — nav, body, headings, buttons, stamps | 400, 500, 600, 700, 800, 900 | OFL |
| **JetBrains Mono** | Tabular numerics — prices, stats, timers | 500, 700 | OFL |

## Self-host plan

For offline / Walrus-Sites decentralized builds, replace the Google
Fonts `@import` in `colors_and_type.css` with `@font-face` declarations:

```css
@font-face {
  font-family: "Slackey";
  src: url("./fonts/slackey-v17-latin-regular.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
}
/* Repeat for Poppins (6 weights × 1 style) and JetBrains Mono (2 weights). */
```

Drop the `.woff2` files into this folder and they'll be picked up.

Download bundles:
- <https://fonts.google.com/specimen/Slackey>
- <https://fonts.google.com/specimen/Poppins>
- <https://fonts.google.com/specimen/JetBrains+Mono>
