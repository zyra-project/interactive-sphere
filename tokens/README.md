# Design Tokens

This directory contains the design token source files that generate
`src/styles/tokens.css`. The CSS file is a **build artifact** — do not
edit it directly.

## Quick Start

```bash
npm run tokens        # regenerate src/styles/tokens.css
```

This runs automatically on `npm install` (via `postinstall`), so you
rarely need to run it manually.

## How It Works

```
tokens/global.json          ← source of truth for all design values
tokens/components/*.json    ← per-component design values (future)
        │
        ▼
Style Dictionary build (npm run tokens)
        │
        ▼
src/styles/tokens.css       ← generated CSS custom properties (gitignored)
```

[Style Dictionary](https://styledictionary.com/) reads the token JSON
files and generates CSS custom properties. A custom format
(`multi-mode-css.mjs`) outputs a single CSS file with `:root` defaults
and `.mobile-native` overrides.

## Editing Tokens

1. Edit the value in `tokens/global.json` (or a component file)
2. Run `npm run tokens`
3. Verify the change in `src/styles/tokens.css`
4. Test visually in the dev server (`npm run dev`)

## Token Structure (W3C Design Tokens format)

```jsonc
{
  "color": {
    "accent": {
      "$value": "#4da6ff",       // the token value
      "$type": "color",          // W3C token type
      "$description": "Primary accent — links, active states"
    }
  }
}
```

### Platform modes

Tokens with platform-specific overrides use Tokens Studio extensions:

```jsonc
{
  "touch": {
    "min": {
      "$value": "44px",
      "$type": "dimension",
      "$extensions": {
        "com.tokens-studio.modes": {
          "default": "44px",
          "mobile-native": "48px"
        }
      }
    }
  }
}
```

The `mobile-native` mode generates a `.mobile-native { }` CSS block.

## Figma Sync (Tokens Studio)

The token JSON files can be synced with Figma via the
[Tokens Studio](https://www.figma.com/community/plugin/843461159747178978)
plugin. See `docs/FIGMA_SYNC_PLAN.md` for setup instructions.

## Files

| File | Purpose |
|---|---|
| `global.json` | All global design tokens (colors, radii, glass, touch) |
| `components/*.json` | Per-component tokens with responsive modes (future) |
| `style-dictionary.config.mjs` | Build configuration |
| `multi-mode-css.mjs` | Custom output format for single-file multi-mode CSS |
| `$metadata.json` | Tokens Studio metadata (future) |
| `$themes.json` | Tokens Studio theme definitions (future) |
