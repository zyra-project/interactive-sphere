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

Tokens with platform-specific overrides use **mode extensions** in
the standard W3C Design Tokens Community Group `$extensions` slot.
The `com.tokens-studio.modes` namespace below is the de-facto
extension key supported by both [Penpot](https://penpot.app/)
(natively) and the Tokens Studio Figma plugin:

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

## Design Tool Sync (Penpot)

The token JSON files in this directory are imported directly into
[Penpot](https://penpot.app/), the open-source design tool we use
for the Interactive Sphere component library. Penpot natively reads
and writes the W3C Design Tokens JSON format — **no plugin, no
Personal Access Token, no GitHub integration required**:

1. Open the Penpot file → Tokens panel → **Import**
2. Select `tokens/global.json` and each `tokens/components/*.json`
3. Designers edit values in the Tokens panel; **Export** writes
   updated JSON files that drop straight back into this directory
4. Run `npm run tokens` to regenerate `src/styles/tokens.css` from
   the updated JSON

See [`docs/DESIGN_SYSTEM_PLAN.md`](../docs/DESIGN_SYSTEM_PLAN.md)
for the full architecture and
[`docs/DESIGN_TOOL_GETTING_STARTED.md`](../docs/DESIGN_TOOL_GETTING_STARTED.md)
for the designer-facing walkthrough.

## Files

| File | Purpose |
|---|---|
| `global.json` | All global design tokens (colors, radii, glass, touch) |
| `components/*.json` | Per-component tokens with responsive modes |
| `style-dictionary.config.mjs` | Build configuration |
| `multi-mode-css.mjs` | Custom output format for single-file multi-mode CSS |
