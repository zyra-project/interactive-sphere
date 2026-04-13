# Design System Figma Sync — Implementation Plan

Establish a two-way sync pipeline between the CSS design system and
Figma across two layers:

1. **Global tokens** — colors, radii, glass effects, touch targets
2. **Component tokens** — per-component dimensions, typography, spacing
   with responsive/platform overrides

## Architecture

```
tokens/
  ├── global.json         ← global design tokens (colors, radii, glass)
  ├── components/
  │   ├── browse.json     ← browse panel component tokens
  │   ├── chat.json       ← chat panel component tokens
  │   ├── playback.json   ← playback controls component tokens
  │   └── tools-menu.json ← tools menu component tokens
  ├── style-dictionary.config.mjs
  ├── $metadata.json      ← Tokens Studio metadata
  └── $themes.json        ← Tokens Studio theme definitions

          │                                    ▲
          ▼                                    │
  Style Dictionary build                Tokens Studio
  (npm run tokens)                    (Figma plugin, Git sync)
          │                                    │
          ▼                                    │
  src/styles/tokens.css  ◄─── generated ───►  Figma Variables
  (gitignored build artifact;                & Components
   global + component custom properties)
```

**Round-trip flow:**

- **Designer edits in Figma** → Tokens Studio pushes a commit updating
  token JSON files → CI (or local `npm run tokens`) regenerates
  `tokens.css`
- **Developer edits token JSON** → runs `npm run tokens` to regenerate
  CSS → Tokens Studio pulls changes into Figma on next sync

**Gitignore strategy:** `tokens.css` is a generated build artifact and
is gitignored. A `postinstall` hook runs `npm run tokens` automatically
after `npm install`, so contributors never encounter a missing file:

```json
"postinstall": "npm run tokens"
```

## Scope

### Layer 1: Global tokens (sync'd via global.json)

| Category | Examples | Token type |
|---|---|---|
| Accent colors | `--color-accent`, `--color-accent-hover` | `color` |
| Surface colors | `--color-surface`, `--glass-bg` | `color` |
| Text colors | `--color-text`, `--color-text-muted` | `color` |
| Semantic colors | `--color-success`, `--color-error`, `--color-warning` | `color` |
| Opacity scales | `--accent-o05`…`--accent-o70`, `--white-o05`…`--white-o70` | `color` |
| Glass effect | `--glass-bg`, `--glass-bg-light`, `--glass-blur` | `color` / `dimension` |
| Border radii | `--radius-xs` through `--radius-pill` | `dimension` |
| Touch targets | `--touch-min` | `dimension` |
| Safe area insets | `--safe-top`, `--safe-bottom`, etc. | `dimension` |
| Spacing scale | `--space-xs` through `--space-3xl` | `dimension` |
| Platform overrides | `.mobile-native` token values | Modes |

### Layer 2: Component tokens (sync'd via components/*.json)

Design values that are specific to a component and vary across
responsive breakpoints or platform modes. Components are tiered by
how likely they are to benefit from design iteration:

**Tier 1 — tokenize now** (active design surface, responsive overrides):

| Component | Key synced values | Modes |
|---|---|---|
| **Browse panel** | width (420px / 100%), card thumbnail size (64px / 96px), grid column min (260px), card padding, chip sizes | desktop, phone-portrait |
| **Chat panel** | width (380px / 100vw / 100%), max-height (calc / 60vh / 75vh), trigger height (44px / 48px), message font-size, input min-height | desktop, tablet, phone-portrait |
| **Playback** | transport-btn min-width (28px / 40px), font-size (0.7rem / 1rem), home-btn min size (36px / 44px) | desktop, tablet |
| **Tools menu** | btn min-height (34px / 38px), popover min-width (240px / 260px), item padding/font-size | desktop, tablet |

**Tier 2 — tokenize later** (moderate complexity, some overrides):

| Component | Key synced values | Modes |
|---|---|---|
| **Info panel** | max-width (340px / 100vw-1.5rem), expanded max-height (60vh / 40vh), body padding | desktop, tablet |
| **Help panel** | width (640px / 100vw-1.5rem / 100vw), max-height (80vh / 70vh / 100dvh), trigger size (36px / 48px / 40px) | desktop, tablet, phone-portrait |

**Tier 3 — skip** (stable, rarely redesigned, few/no overrides):

- Loading screen, download manager, tour overlay — values stay
  hardcoded. Can be promoted to tokens in future iterations if needed.

### Out of scope (stays in CSS / code only)

- Layout logic (grid templates, flex direction, position)
- Animation / transition definitions (`transform 0.3s ease`, keyframes)
- JS-driven state classes (`.collapsed`, `.is-primary`, `.out-of-range`)
- `@media` block structure (breakpoint *values* are tokens; the rules
  and any structural overrides stay in CSS)
- Structural CSS (display, overflow, z-index, pointer-events)
- `accessibility.css` (responsive overrides are structural, not design values)
- Spacing scale activation (`--space-*` tokens are commented out in the
  current `tokens.css` — activating them is a separate migration)

## Platform Modes

Token files use **modes** to represent platform variants. Style
Dictionary generates the appropriate CSS selectors for each mode.

### Global modes (global.json)

| Mode | CSS Output | Trigger |
|---|---|---|
| `default` | `:root { ... }` | Base — desktop browser |
| `mobile-native` | `.mobile-native { ... }` | Tauri mobile sets class on `<body>` |

### Component modes (components/*.json)

Component tokens can define up to four modes. Not every component
uses every mode — only declare modes where values actually differ.

| Mode | CSS Output | Trigger |
|---|---|---|
| `default` | `:root { ... }` | Desktop (>768px) |
| `tablet` | `@media (max-width: 768px) { :root { ... } }` | Tablet + mobile |
| `phone-portrait` | `@media (max-width: 600px) and (orientation: portrait) { :root { ... } }` | Phone portrait |
| `mobile-native` | `.mobile-native { ... }` | Tauri mobile native app |

Style Dictionary maps each mode to its CSS output. Component CSS
files then reference the custom properties — they adapt automatically
when the mode activates. This replaces scattered hardcoded overrides
inside `@media` blocks with token references.

## Implementation Phases

### Phase 1a: Global token extraction (global.json)

Convert the existing `tokens.css` custom properties into a W3C Design
Tokens JSON file.

**File:** `tokens/global.json`

**Structure:**

```jsonc
{
  "color": {
    "accent": {
      "$value": "#4da6ff",
      "$type": "color",
      "$description": "Primary accent — links, active states, focus rings"
    },
    "accent-hover": { "$value": "#6ab8ff", "$type": "color" },
    "accent-dark": { "$value": "#0066cc", "$type": "color" },
    "accent-darker": { "$value": "#0052a3", "$type": "color" },
    "bg": { "$value": "#0d0d12", "$type": "color" },
    "surface": { "$value": "rgba(255, 255, 255, 0.06)", "$type": "color" }
    // ... all color tokens
  },
  "radius": {
    "xs": { "$value": "3px", "$type": "dimension" },
    "sm": { "$value": "4px", "$type": "dimension" },
    "md": { "$value": "6px", "$type": "dimension" },
    "lg": {
      "$value": "8px",
      "$type": "dimension",
      "$extensions": {
        "com.tokens-studio.modes": {
          "default": "8px",
          "mobile-native": "10px"
        }
      }
    }
    // ...
  },
  "space": {
    "xs":  { "$value": "4px",  "$type": "dimension" },
    "sm":  { "$value": "8px",  "$type": "dimension" },
    "md":  { "$value": "12px", "$type": "dimension" },
    "lg":  { "$value": "16px", "$type": "dimension" },
    "xl":  { "$value": "20px", "$type": "dimension" },
    "2xl": { "$value": "24px", "$type": "dimension" },
    "3xl": { "$value": "32px", "$type": "dimension" }
  },
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
  },
  "glass": {
    "bg":       { "$value": "rgba(13, 13, 18, 0.92)", "$type": "color" },
    "bg-light": { "$value": "rgba(13, 13, 18, 0.88)", "$type": "color" },
    "blur":     { "$value": "12px", "$type": "dimension" }
  }
}
```

**Tasks:**
- [ ] Create `tokens/` directory at project root
- [ ] Write `tokens/global.json` covering all custom properties from `tokens.css`
- [ ] Include mode extensions for `.mobile-native` overrides
- [ ] Validate JSON against W3C Design Tokens Community Group spec
- [ ] Create `tokens/README.md` — contributor guide explaining the
      workflow (`npm run tokens`, how to add/edit tokens, Tokens Studio
      setup link)

### Phase 1b: Component token extraction (components/*.json)

Extract hardcoded design values from the Tier 1 component CSS files
into per-component token files. Only values that a designer would
reasonably adjust belong here — not structural CSS.

**Criteria for inclusion:** A value is a component token if it:
- Defines a visual dimension a designer iterates on (width, padding,
  font-size, border-radius, thumbnail size)
- Has a responsive or platform override (different at 768px, 600px
  portrait, or `.mobile-native`)
- Is referenced in STYLE_GUIDE.md as a documented design decision
- Is a **single-value** property (`dimension`, `color`, `fontWeight`).
  Shorthand values like `padding: 0.12rem 0.35rem` should be split
  into separate x/y tokens or omitted — the W3C `dimension` type
  expects a single number+unit.

**File:** `tokens/components/browse.json` (example)

```jsonc
{
  "component": {
    "browse": {
      "panel-width": {
        "$value": "420px",
        "$type": "dimension",
        "$extensions": {
          "com.tokens-studio.modes": {
            "default": "420px",
            "phone-portrait": "100%"
          }
        }
      },
      "card-padding":   { "$value": "0.875rem", "$type": "dimension" },
      "card-radius":    { "$value": "{radius.lg}", "$type": "dimension" },
      "card-gap":       { "$value": "0.75rem", "$type": "dimension" },
      "thumb-size": {
        "$value": "64px",
        "$type": "dimension",
        "$description": "Collapsed thumbnail; expanded is thumb-size-expanded"
      },
      "thumb-size-expanded": { "$value": "96px", "$type": "dimension" },
      "thumb-radius":   { "$value": "{radius.sm}", "$type": "dimension" },
      "grid-col-min":   { "$value": "260px", "$type": "dimension" },
      "grid-gap":       { "$value": "0.75rem", "$type": "dimension" },
      "title-size":     { "$value": "0.8rem", "$type": "dimension" },
      "title-weight":   { "$value": "600", "$type": "fontWeight" },
      "desc-size":      { "$value": "0.7rem", "$type": "dimension" },
      "keyword-size":   { "$value": "0.58rem", "$type": "dimension" },
      "keyword-radius": { "$value": "{radius.xs}", "$type": "dimension" },
      "chip-size":      { "$value": "0.7rem", "$type": "dimension" },
      "chip-radius":    { "$value": "{radius.pill}", "$type": "dimension" },
      "search-size":    { "$value": "0.875rem", "$type": "dimension" },
      "search-radius":  { "$value": "{radius.md}", "$type": "dimension" }
    }
  }
}
```

**Tier 1 component token files:**

| File | Key values (with responsive modes where applicable) |
|---|---|
| `browse.json` | panel width (420px→100%), card thumb (64→96px), grid-col-min, title/desc/keyword/chip sizes, card padding/radius |
| `chat.json` | panel width (380px→100vw→100%), max-height (calc→60vh→75vh), trigger height (44→48px), msg font-size, input sizes, send-btn min-size (34→44px) |
| `playback.json` | transport-btn min-width (28→40px), font-size (0.7→1rem), home-btn min-size (36→44px), time-label font-size |
| `tools-menu.json` | btn min-height (34→38px), popover min-width (240→260px), item font-size (0.75→0.82rem), layout-btn min-height (30→36px) |

Tier 2 (info-panel, help) can be added in a follow-up once the
pipeline is proven. Tier 3 (loading, download, tour) stays hardcoded.

**Tasks:**
- [ ] Create `tokens/components/` directory
- [ ] Write each Tier 1 component JSON file with values extracted from
      the corresponding CSS file
- [ ] Use `{token.reference}` syntax where component values should
      reference global tokens (e.g., `{radius.lg}` instead of `8px`)
- [ ] Add mode extensions for every value that has a responsive or
      platform override
- [ ] Split or omit shorthand values — use single-value tokens only
- [ ] Cross-reference against STYLE_GUIDE.md to ensure all documented
      Tier 1 component specs are captured

### Phase 2: Style Dictionary build pipeline

Install Style Dictionary and configure it to generate `src/styles/tokens.css`
from both `tokens/global.json` and `tokens/components/*.json`.

**Files:**
- `tokens/style-dictionary.config.mjs` — build configuration
- `tokens/formats/` — custom format for multi-mode CSS output

**Config outline:**

```js
// tokens/style-dictionary.config.mjs
export default {
  source: [
    'tokens/global.json',
    'tokens/components/*.json'
  ],
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'src/styles/',
      files: [
        {
          destination: 'tokens.css',
          format: 'custom/multi-mode-css',
          options: {
            outputReferences: true,
            modes: {
              'default':         ':root',
              'mobile-native':   '.mobile-native',
              'tablet':          '@media (max-width: 768px) { :root',
              'phone-portrait':  '@media (max-width: 600px) and (orientation: portrait) { :root'
            }
          }
        }
      ]
    }
  }
}
```

The custom `multi-mode-css` format outputs:
1. `:root { }` — all default-mode tokens (global + component)
2. `.mobile-native { }` — only tokens with mobile-native overrides
3. `@media (max-width: 768px) { :root { } }` — tablet overrides
4. `@media (max-width: 600px) and (orientation: portrait) { :root { } }` — phone overrides

Component CSS files then replace hardcoded values with
`var(--component-browse-panel-width)` etc. and can remove their
`@media` overrides for values now handled by the token modes.

**Before writing custom code:** investigate the
[`@tokens-studio/sd-transforms`](https://github.com/tokens-studio/sd-transforms)
package for its token **transforms** (color conversion, dimension
handling, etc.). However, its multi-mode output generates **separate
CSS files per mode** (e.g., `desktop.css`, `tablet.css`) — it does
not output a single file with `:root`, `.mobile-native`, and `@media`
blocks. A custom Style Dictionary format (`custom/multi-mode-css`) is
required for our single-file architecture.

> **Note:** The latest `sd-transforms` requires Style Dictionary v5
> (not v4). Use `style-dictionary@^5.0.0`.

**Tasks:**
- [ ] Install `style-dictionary@^5.0.0` as a devDependency
- [ ] Install `@tokens-studio/sd-transforms` for token transforms
      (color, dimension, fontWeight handling)
- [ ] Write the `custom/multi-mode-css` format that reads
      `com.tokens-studio.modes` extensions and generates `:root`,
      `.mobile-native`, and `@media` blocks in a single CSS file
- [ ] Create `tokens/style-dictionary.config.mjs`
- [ ] Handle composite tokens: `--glass-border` is
      `1px solid var(--color-surface-border-subtle)` — needs a custom
      transform or manual override
- [ ] Handle `env()` safe-area tokens — these are runtime-only and
      can't come from the JSON; keep them as static entries appended
      to the generated file
- [ ] Add scripts to `package.json`:
      - `"tokens": "style-dictionary build --config tokens/style-dictionary.config.mjs"`
      - `"postinstall": "npm run tokens"` — ensures `tokens.css`
        exists immediately after `npm install`, before any other
        command. Eliminates all contributor friction from the gitignore.
- [ ] Verify generated `tokens.css` matches current file (diff should
      be zero meaningful changes for the global section; component
      tokens will be net-new custom properties)

### Phase 3: Tokens Studio configuration

Configure the Figma-side integration so the Tokens Studio plugin can
read/write the token JSON files in this repository.

**Tasks:**
- [ ] **Verify Tokens Studio free tier supports multi-file Git sync.**
      If it only supports single-file, collapse `global.json` +
      `components/*.json` into one `tokens.json` and adjust the Style
      Dictionary config accordingly.
- [ ] Add `tokens/$metadata.json` and `tokens/$themes.json` files
      (Tokens Studio uses these to store mode/theme mappings and
      multi-file token set references)
- [ ] Configure `$metadata.json` with token set order:
      `["global", "components/browse", "components/chat", ...]`
- [ ] Document Tokens Studio setup steps in this plan (below)
- [ ] Test round-trip: edit a color in Figma → push → verify JSON
      change → run `npm run tokens` → verify CSS output
- [ ] Test component round-trip: change browse panel width in Figma →
      push → verify component JSON → regenerate CSS → verify
      `--component-browse-panel-width` value

**Tokens Studio setup (manual, in Figma):**

1. Install the [Tokens Studio](https://www.figma.com/community/plugin/843461159747178978)
   plugin in Figma
2. Open plugin → Settings → Add new sync provider → **GitHub**
3. Configure:
   - Repository: `zyra-project/interactive-sphere`
   - Branch: `main` (or feature branch for testing)
   - File path: `tokens` (Tokens Studio reads `$metadata.json` to
     discover all token files in the directory)
   - Personal access token: (a GitHub PAT with `repo` scope)
4. Pull tokens → verify all global and component values appear
5. Create Figma variable collections:
   - **Global** collection → colors, radii, spacing, glass, touch
   - **Components** collection → per-component design values
6. Set up modes using **Tokens Studio's mode UI** (not native Figma
   variable modes — those require Figma Professional):
   - Global: "Default", "Mobile Native"
   - Components: "Default", "Tablet", "Phone Portrait", "Mobile Native"
     (only where modes are defined in the JSON)
   - Designers switch modes in the Tokens Studio plugin panel to
     preview platform variants

### Phase 4: CI and contributor setup

Since `tokens.css` is gitignored, CI must generate it before building.
The `postinstall` hook (added in Phase 2) handles this automatically
— `npm ci` triggers `postinstall` which runs `npm run tokens`.

**Tasks:**
- [ ] Verify CI passes end-to-end: `npm ci` (triggers postinstall →
      tokens) → `npm run build`
- [ ] Update `CLAUDE.md` key commands section to document `npm run tokens`
- [ ] Update `src/styles/README.md` to note that `tokens.css` is
      generated and should not be edited directly

### Phase 5: Component CSS migration

Migrate Tier 1 component CSS files to reference the new component
token custom properties, replacing hardcoded values. This is the step
where the sync pipeline actually takes effect in the running app.

**Approach:** Replace hardcoded values with `var(--component-{name}-{property})`
references **within the existing `@media` structure**. Do NOT try to
remove `@media` blocks — most blocks mix token-eligible values with
structural overrides (flex-direction changes, display toggling, etc.)
that must stay. Keeping the `@media` structure intact makes the
migration straightforward and avoids regressions.

**Example migration (browse.css):**

```css
/* Before */
#browse-overlay {
  width: 420px;
}
@media (max-width: 600px) and (orientation: portrait) {
  #browse-overlay {
    width: 100%;
    border-left: none;      /* structural — stays hardcoded */
    border-top: 1px solid;  /* structural — stays hardcoded */
  }
}

/* After */
#browse-overlay {
  width: var(--component-browse-panel-width);
}
@media (max-width: 600px) and (orientation: portrait) {
  #browse-overlay {
    width: var(--component-browse-panel-width);  /* token mode sets this to 100% */
    border-left: none;
    border-top: 1px solid;
  }
}
```

> The `@media` block for `width` is technically redundant (the token
> mode already changes the value) but keeping it is harmless and
> preserves the CSS structure. It can be cleaned up later once the
> pipeline is stable.

**Tasks:**
- [ ] Migrate `browse.css` — replace ~15 hardcoded values with token vars
- [ ] Migrate `chat.css` — replace ~20 hardcoded values
- [ ] Migrate `playback.css` — replace ~6 values (transport-btn sizes,
      home-btn, time-label)
- [ ] Migrate `tools-menu.css` — replace ~12 values
- [ ] After each file: run `npm run type-check` and `npm run test`
- [ ] Visual regression check: compare dev server rendering before
      and after migration (should be pixel-identical)

### Phase 6: STYLE_GUIDE.md auto-generated sections

Keep STYLE_GUIDE.md as the human-readable design reference, but inject
token-derived tables so it stays in sync with the source of truth
automatically.

**Approach:** A Node script reads the token JSON files and writes
markdown tables between marker comments in STYLE_GUIDE.md. Hand-written
prose outside the markers is preserved.

**Marker format:**

```markdown
## Color Palette

<!-- tokens:auto:colors -->
| Token | Value | Usage |
|---|---|---|
| `--color-accent` | `#4da6ff` | Active states, links, highlights |
...
<!-- /tokens:auto:colors -->
```

**Auto-generated sections:**

| Section | Source | Content |
|---|---|---|
| Color Palette | `global.json` → `color.*` | Table of token name, value, `$description` |
| Spacing Scale | `global.json` → `space.*` | Table of `--space-*` tokens |
| Border Radii | `global.json` → `radius.*` | Table with default + mobile-native values |
| Glass Surface | `global.json` → `glass.*` | Background, blur, border values |
| Component Catalog (each) | `components/*.json` | Table of key dimensions per mode |

**Hand-written sections (preserved as-is):**

- Design Principles
- Typography (prose + font stack — values can reference tokens)
- Interactive Buttons (prose describing states)
- Animations
- Accessibility (Section 508 / WCAG 2.1 AA)
- Mobile Adaptations (prose; dimension tables auto-generated)

**Script:** `tokens/scripts/update-style-guide.mjs`

```js
// Reads tokens/global.json + tokens/components/*.json
// Finds <!-- tokens:auto:{section} --> markers in STYLE_GUIDE.md
// Replaces content between markers with generated tables
// Preserves everything outside markers
```

**Tasks:**
- [ ] Add marker comments to STYLE_GUIDE.md for each auto-generated
      section
- [ ] Write `tokens/scripts/update-style-guide.mjs`
- [ ] Add `"docs:tokens": "node tokens/scripts/update-style-guide.mjs"`
      to `package.json`
- [ ] Run `npm run docs:tokens` after `npm run tokens` in CI so the
      style guide is always current in PRs
- [ ] Verify hand-written prose is untouched after running the script

## File Changes Summary

| Action | Path | Description |
|---|---|---|
| Create | `tokens/global.json` | W3C Design Tokens — all values from `tokens.css` |
| Create | `tokens/components/*.json` (4 files) | Tier 1 per-component design values with responsive modes |
| Create | `tokens/style-dictionary.config.mjs` | Style Dictionary build config |
| Create | `tokens/$metadata.json` | Tokens Studio metadata (token set order) |
| Create | `tokens/$themes.json` | Tokens Studio theme definitions |
| Create | `tokens/README.md` | Contributor guide for the token workflow |
| Create | `tokens/scripts/update-style-guide.mjs` | Script to inject token tables into STYLE_GUIDE.md |
| Delete | `src/styles/tokens.css` | Removed from git — now a **generated** build artifact (gitignored) |
| Modify | `.gitignore` | Add `src/styles/tokens.css` |
| Modify | `src/styles/browse.css` | Replace hardcoded values with `var()` token references |
| Modify | `src/styles/chat.css` | Replace hardcoded values with `var()` token references |
| Modify | `src/styles/playback.css` | Replace hardcoded values with `var()` token references |
| Modify | `src/styles/tools-menu.css` | Replace hardcoded values with `var()` token references |
| Modify | `STYLE_GUIDE.md` | Add marker comments for auto-generated sections |
| Modify | `package.json` | Add devDeps + `tokens` / `postinstall` / `docs:tokens` scripts |

## Dependencies

| Package | Version | Purpose | Cost |
|---|---|---|---|
| `style-dictionary` | `^5.0.0` | Token → CSS build | Free (Apache 2.0) |
| `@tokens-studio/sd-transforms` | latest | Token transforms (color, dimension, etc.) | Free (open source) |
| Tokens Studio plugin | latest | Figma ↔ Git sync | Free tier |
| Figma | Free plan | Design tool | $0 — modes managed via Tokens Studio UI |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Generated `tokens.css` drifts from hand-edited version | Broken styles | Phase 2 validation: diff generated vs. current before switching over |
| `rgba()` values don't round-trip perfectly through Figma | Slight color shifts | Pin exact values in JSON; Tokens Studio preserves raw values |
| Composite tokens (`--glass-border`) can't be expressed in W3C format | Manual maintenance | Keep composites as a hand-written appendix in the generated file, or use Style Dictionary references |
| `env()` safe-area tokens are runtime-only | Can't be in JSON | Append as static lines via a custom Style Dictionary format |
| Developer edits `tokens.css` directly instead of JSON | Changes lost on next build | File is gitignored so direct edits are never committed; contributors learn the workflow naturally |
| Component CSS migration introduces visual regressions | Broken UI | Migrate one file at a time with visual regression check; keep `@media` structure intact |
| Token naming collisions between components | Conflicting custom properties | Namespace all component tokens: `--component-{name}-{property}` |
| Tokens Studio free tier may not support multi-file Git sync | Architecture change | Verify in Phase 3; fall back to single `tokens.json` if needed |
| `postinstall` adds time to `npm install` | Slower install | Token build is fast (~1s); acceptable tradeoff for zero-friction contributor experience |

## Phasing & Sequencing

Phases can be executed incrementally. Each phase produces a working
state.

```
Phase 1a (global tokens)
    └──▶ Phase 2 (build pipeline + postinstall) ──▶ Phase 4 (CI)
Phase 1b (Tier 1 component tokens) ─────────────────┘
    └──▶ Phase 5 (CSS migration)
Phase 3 (Tokens Studio) — can start after Phase 1a
Phase 6 (STYLE_GUIDE auto-update) — after Phase 1a + 1b
```

**Recommended order:**
1. Phase 1a + Phase 2 — get global tokens building, `tokens.css`
   gitignored, `postinstall` hook working
2. Phase 4 — verify CI passes, update docs
3. Phase 3 — verify Figma round-trip works with global tokens
4. Phase 1b — add Tier 1 component tokens
5. Phase 5 — migrate Tier 1 component CSS to use token vars
6. Phase 6 — add auto-generated sections to STYLE_GUIDE.md

## Decisions

1. **`tokens.css` is gitignored.** A `postinstall` hook runs
   `npm run tokens` after every `npm install`, so `tokens.css` exists
   before any other command runs. Contributors never see a missing
   file. Drift is impossible because the file is never committed.

2. **Token naming convention:** `--component-{name}-{property}`. The
   `component-` prefix avoids collisions with global tokens.

3. **Figma free plan.** All modes are managed in Tokens Studio's own
   mode UI (free tier), not Figma's native variable modes. This keeps
   the entire pipeline at $0/mo — important for contributor adoption on
   an open-source project.

4. **Granularity threshold:** tokenize values documented in
   STYLE_GUIDE.md and values with responsive/platform overrides.
   One-off internal values stay hardcoded. Single-value tokens only —
   shorthand properties are split or omitted.

5. **STYLE_GUIDE.md stays as a human-readable document** with
   auto-generated token tables injected between marker comments.
   Prose sections stay hand-written. See Phase 6.

6. **Component tiers.** Tokenize Tier 1 (browse, chat, playback,
   tools-menu) first. Tier 2 (info-panel, help) follows once the
   pipeline is proven. Tier 3 (loading, download, tour) stays
   hardcoded.

7. **CSS migration preserves `@media` structure.** Replace hardcoded
   values with `var()` references within the existing `@media` blocks.
   Do not remove `@media` blocks — they contain a mix of token-eligible
   values and structural overrides.

8. **Spacing scale is a separate effort.** The commented-out
   `--space-*` tokens in `tokens.css` are not activated as part of this
   work. Activating them would require migrating raw `rem` values
   across all CSS files — a separate task.

## Future Work (not part of this plan)

These items depend on prerequisites that don't exist yet:

- **Figma Code Connect** — links Figma component frames to CSS source
  files. Requires a Figma component library to exist first. Add once
  the Figma file is created. Uses `@figma/code-connect` (free, open
  source).

- **Figma file creation** — a Figma MCP server could automate
  populating variable collections, modes, and token values (~100+
  variables). The visual component frames must be designed manually.
  Requires: blank Figma file (manual), Figma MCP server access.

- **Tier 2 component tokens** — info-panel, help panel. Add after
  Tier 1 pipeline is stable.

- **Spacing scale activation** — uncomment `--space-*` tokens, migrate
  raw `rem` values across all CSS files.

- **`@media` block cleanup** — once token modes are stable, redundant
  responsive overrides in `@media` blocks can be removed. Low priority.
