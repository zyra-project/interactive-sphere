# Getting Started — Interactive Sphere Design System

This guide walks you through building the Interactive Sphere
component library from scratch in [Penpot](https://penpot.app/), the
recommended design tool for this project. Penpot is open source
(MPL 2.0), self-hostable, and natively imports and exports W3C
Design Tokens — no plugin, no Personal Access Token, and no GitHub
integration to set up.

> **Using Figma instead?** Figma + the Tokens Studio plugin is
> supported as an alternative — look for the "Figma alternative"
> notes in §5 (Apply Tokens) and §14 (Keeping Things in Sync). The
> Glossary at the bottom maps Penpot terms to their Figma
> equivalents (Board → Frame, Flex Layout → Auto Layout, Tokens
> panel → Tokens Studio plugin).

## Quickstart

1. Sign up at [design.penpot.app](https://design.penpot.app) (free)
   or self-host the open-source release
2. Create a new file named "Interactive Sphere — Design System"
3. Open the **Tokens** tab in the left sidebar
4. Click **Tools → Import** (in the Tokens panel) and select the
   token JSON files from this repo:
   - `tokens/global.json`
   - `tokens/components/browse.json`
   - `tokens/components/chat.json`
   - `tokens/components/playback.json`
   - `tokens/components/tools-menu.json`
5. All colors, dimensions, and font weights — including the
   responsive modes declared in `$extensions` — appear in Penpot's
   Tokens panel, ready to apply to your designs

## Table of Contents

1. [Create the Design File](#1-create-the-design-file)
2. [Understand the Penpot Interface](#2-understand-the-penpot-interface)
3. [Set Up Your First Page Structure](#3-set-up-your-first-page-structure)
4. [Build the Glass Surface Foundation](#4-build-the-glass-surface-foundation)
5. [Apply Tokens](#5-apply-tokens)
6. [Build Your First Component: Transport Button](#6-build-your-first-component-transport-button)
7. [Build the Browse Card Component](#7-build-the-browse-card-component)
8. [Build the Search Bar Component](#8-build-the-search-bar-component)
9. [Build Category Chip Components](#9-build-category-chip-components)
10. [Build the Chat Trigger Button](#10-build-the-chat-trigger-button)
11. [Build the Browse Button](#11-build-the-browse-button)
12. [Build the Gear Toggle Button](#12-build-the-gear-toggle-button)
13. [Assemble Full Panel Layouts](#13-assemble-full-panel-layouts)
14. [Keeping Things in Sync](#14-keeping-things-in-sync)

---

## 1. Create the Design File

1. Open Penpot (web at [design.penpot.app](https://design.penpot.app)
   or your self-hosted instance)
2. From the dashboard, click **+ New file** in your team or project
3. Click the file name at the top and rename it to
   **"Interactive Sphere — Design System"**
4. You'll see a blank workspace — this is where you'll build
   everything

> Save the file URL somewhere accessible (the address bar of the
> Penpot tab). Collaborators open the file from this URL — no
> per-seat license is required.

---

## 2. Understand the Penpot Interface

If you're new to Penpot, here are the key areas:

```
┌─────────────────────────────────────────────────────┐
│  Toolbar (top)                                      │
│  [Move] [Board (B)] [Rect (R)] [Ellipse (E)]        │
│  [Text (T)] [Path] [Comments]                       │
├──────────┬──────────────────────┬───────────────────┤
│  Left    │                      │  Design panel     │
│  sidebar │     Canvas           │  (right sidebar — │
│          │     (center)         │   properties of   │
│  Tabs:   │                      │   selected item)  │
│  Layers  │                      │                   │
│  Assets  │                      │  Fill, Stroke,    │
│  Tokens  │                      │  Layout, Effects  │
├──────────┴──────────────────────┴───────────────────┤
│  Pages (top, above the canvas)                      │
└─────────────────────────────────────────────────────┘
```

**Key concepts:**

- **Board** (shortcut `B`): A container, like a `<div>` in HTML.
  Use boards for everything — panels, cards, buttons, screens.
  *(Figma calls these Frames, shortcut `F`.)*
- **Rectangle** (shortcut `R`): A shape. Used for backgrounds,
  dividers, thumbnails.
- **Text** (shortcut `T`): A text element.
- **Flex Layout** (shortcut `Ctrl/Cmd+Shift+A`): Makes a board
  behave like CSS flexbox — children stack horizontally or
  vertically with gaps and padding. The most important Penpot
  feature for our work. *(Figma calls this Auto Layout, shortcut
  `Shift+A`.)*
- **Component** (shortcut `Ctrl/Cmd+K`): A reusable element. When
  you update the main component, all instances update too. *(Figma
  uses `Ctrl/Cmd+Alt+K`.)*
- **Variant**: Different states of a component (default, hover,
  active) stored in one component set.
- **Tokens panel** (left sidebar tab): Where all imported design
  tokens live. Right-click a token → **Apply Token** → choose the
  property to bind it to the selected layer. *(In Figma, the
  Tokens Studio plugin panel plays this role.)*

---

## 3. Set Up Your First Page Structure

Pages are like tabs in your file. Create these pages:

1. Right-click the default "Page 1" in the top-left → **Rename** →
   call it **"Foundation"**
2. Click the **+** next to pages → create **"Components"**
3. Create another page → **"Screens"**

| Page | What goes here |
|---|---|
| Foundation | Color swatches, text styles, glass surface, spacing reference |
| Components | Reusable components (buttons, cards, chips, inputs) |
| Screens | Full desktop/tablet/phone layouts assembling the components |

---

## 4. Build the Glass Surface Foundation

Go to the **Foundation** page. This is your design system reference.

### Create a color swatch grid

1. Press `B` to create a board. In the Design panel (right sidebar),
   set its size to `800 × 600`. Name it "Color Palette" in the
   Layers panel.
2. Press `R` to create a rectangle. Set it to `60 × 60`.
3. Open the **Tokens** tab in the left sidebar (next to Layers /
   Assets).
4. In the Tokens panel, find `color > accent`.
5. Select your rectangle on the canvas, then right-click the
   `color.accent` token → **Apply Token** → **Fill**. The rectangle
   turns `#4da6ff`.
6. Duplicate the rectangle (`Ctrl/Cmd+D`) and apply the next color
   (`color.accent-hover`). Repeat for all colors.

> **Tip:** Select multiple rectangles, then press
> `Ctrl/Cmd+Shift+A` to wrap them in a Flex Layout board. Set the
> gap to 8px. They'll stay neatly arranged.

### Create the glass surface sample

1. Press `B` to create a board, size `300 × 200`. Name it
   "Glass Surface".
2. **Fill:** In the Design panel under "Fill", apply the
   `glass.bg-light` token (right-click in the Tokens panel →
   **Apply Token** → **Fill**).
3. **Stroke:** Click "+" next to Stroke in the Design panel and
   apply the `color.surface-border-subtle` token. Width 1px.
4. **Corner radius:** Apply `radius.lg` to Border Radius.
5. **Background blur:** In the Design panel under "Effects", click
   "+" → choose **Blur** → set type to **Layer background blur** →
   apply `glass.blur` (12px).

This glass surface board is the foundation for every panel in the
app. You'll reuse it as a component.

### Turn it into a component

1. Select the glass surface board
2. Press `Ctrl/Cmd + K` (or right-click → **Create component**)
3. Name it `.glass-surface` in the Layers panel
4. Now whenever you need a glass background, create an **instance**
   of this component (drag from the Assets panel)

---

## 5. Apply Tokens

Here's the general workflow for applying any token. Both Penpot
and Figma + Tokens Studio bind the property to the token, so when
the token value changes the design updates automatically.

### In Penpot

1. Select the layer or board on the canvas
2. Open the **Tokens** tab in the left sidebar
3. Find the token (e.g., `color.accent` or
   `component.browse.card-radius`)
4. Right-click the token → **Apply Token** → choose the property
   (Fill, Stroke, Width, Height, Border Radius, Gap, Padding, Font
   Size, Font Weight, etc.)
5. The property in the Design panel now shows the token name
   instead of the raw value — confirming the binding

### Figma + Tokens Studio (alternative)

#### For colors (fills, strokes)
1. Select the layer
2. In Tokens Studio, find the color token (e.g., `color > accent`)
3. Right-click the token → choose **"Fill"** or **"Stroke"**
4. Or click the token and hit "Apply to selection"

#### For dimensions (width, height, padding, gap, radius)
1. Select the frame or layer
2. In Tokens Studio, find the dimension token
3. Right-click → choose the property: **"Width"**, **"Height"**,
   **"Border Radius"**, **"Gap"**, **"Padding"**, etc.

#### For font sizes and weights
1. Select a text layer
2. Find the token in Tokens Studio
3. Right-click → **"Font Size"** or **"Font Weight"**

> **Important:** Always apply tokens through the design tool's
> token binding, never by typing values manually. Binding is what
> keeps the design synced to the source-of-truth JSON.

> **Font weight caveat.** Numeric font weights (`400`, `500`,
> `600`, `700`) sometimes don't map cleanly through Tokens Studio's
> font weight property — Figma expects a named style ("Regular",
> "Medium", "Semi Bold", "Bold"). Penpot accepts numeric weights
> directly. If the weight doesn't take in Figma, set it manually
> in the text panel: `400` = Regular, `500` = Medium,
> `600` = Semi Bold, `700` = Bold.

---

## 6. Build Your First Component: Transport Button

Go to the **Components** page. We'll build a simple button first
to practice the workflow.

### Step 1: Create the board

1. Press `B` to create a board
2. In the Design panel, set width to 28 and height to 28
   (or apply `component.playback.transport-btn-min-width`)
3. Set corner radius to 6 (apply `radius.md`)

### Step 2: Apply the glass surface properties

1. Set fill to `color.surface` token
2. Add a stroke: `white-opacity.o10`, weight 1px

### Step 3: Add the icon/label

1. Press `T` to create a text element inside the board
2. Type a play symbol: `▶` (or any placeholder)
3. Set color to `#ccc`
4. Set font size to the
   `component.playback.transport-btn-font-size` token
   (0.7rem ≈ 11.2px at default browser size)

> **rem to px:** Both Penpot and Figma display dimensions in px,
> but our tokens use rem. At default browser font size (16px), the
> conversion is `rem × 16 = px`. So `0.7rem = 11.2px`,
> `0.8rem = 12.8px`, etc. Round to the nearest whole pixel.

### Step 4: Apply Flex Layout

1. Select the board
2. Press `Ctrl/Cmd+Shift+A` to apply Flex Layout (or use the
   Layout `+` button in the Design panel → choose **Flex layout**)
3. Set alignment to center (both axes)
4. Set padding to `5px 6px` (approximates `0.3rem 0.4rem`)

### Step 5: Turn it into a component

1. Select the board → `Ctrl/Cmd + K`
2. Name it `.transport-btn`

### Step 6: Add variants (optional but recommended)

1. In the Design panel, click **"+"** next to "Variants"
2. This creates a variant container. Rename the variants:
   - **Default** — the one you just built
   - **Hover** — duplicate, change border to `accent-opacity.o40`,
     text color to `color.text`
   - **Active** — duplicate, change border and text to
     `color.accent`

---

## 7. Build the Browse Card Component

This is a more complex component. Go to the **Components** page.

### Step 1: Create the outer board

1. Press `B` → set width to 300 (will be flexible in a grid)
2. Apply these tokens:
   - Corner radius: `component.browse.card-radius` (8px)
   - Fill: `color.surface-alt`
   - Stroke: `white-opacity.o08`, 1px
3. Apply Flex Layout (`Ctrl/Cmd+Shift+A`), set direction to
   **horizontal** (row)
4. Set padding to `component.browse.card-padding`
   (0.875rem ≈ 14px)
5. Set gap to `component.browse.card-gap` (0.75rem ≈ 12px)

### Step 2: Add the thumbnail

1. Inside the card board, press `R` for a rectangle
2. Apply width and height: `component.browse.thumb-size` (64px)
3. Apply corner radius: `component.browse.thumb-radius` (4px)
4. Fill with a placeholder color or image

### Step 3: Add the body

1. Press `B` for a board inside the card (to the right of the
   thumb)
2. Apply Flex Layout, set direction to **vertical** (column),
   gap 4px
3. Set "Fill container" for width (so it stretches)

### Step 4: Add text elements in the body

1. **Title:** Press `T`, type "Dataset Title"
   - Font size: apply `component.browse.title-size`
     (0.8rem ≈ 13px)
   - Font weight: apply `component.browse.title-weight` (600)
   - Color: `color.text`

2. **Description:** Press `T`, type "A brief description..."
   - Font size: apply `component.browse.desc-size`
     (0.7rem ≈ 11px)
   - Color: `color.text-muted`

3. **Keywords row:** Create a board with Flex Layout (horizontal),
   gap 3px. Inside, create small text labels:
   - Font size: `component.browse.keyword-size` (0.58rem ≈ 9px)
   - Background: `accent-opacity.o12`
   - Corner radius: `component.browse.keyword-radius` (3px)
   - Text color: `color.accent-hover`

### Step 5: Turn into component with variants

1. Select the card → make it a component (`.browse-card`)
2. Add variants (use `Property=Value` naming, e.g.,
   `State=Default`):
   - **State=Default** — as built
   - **State=Hover** — border `accent-opacity.o40`,
     bg `white-opacity.o08`
   - **State=Expanded** — thumbnail uses `thumb-size-expanded`
     (96px), turn off text truncation on description, add extra
     metadata text layers (source, categories)

> **Variant naming:** Both Penpot and Figma require
> `Property=Value` format. "Default" alone won't work — use
> "State=Default", "State=Hover", etc.

> **Truncated text:** To set a 2-line clamp on the description in
> the Default variant, select the text layer → in the Design panel
> find the text-overflow / max-lines control → set max lines to 2.
> In the Expanded variant, toggle truncation off.

> **Font weights:** If your design tool doesn't apply a numeric
> weight (like `600`) cleanly, set it manually in the text panel:
> `400` = Regular, `500` = Medium, `600` = Semi Bold,
> `700` = Bold. Penpot accepts numeric weights directly; Figma
> may need the named style.

---

## 8. Build the Search Bar Component

Go to the **Components** page.

1. Press `B` to create a board, set width to ~340px (it'll stretch
   to fill the panel)
2. Apply Flex Layout (`Ctrl/Cmd+Shift+A`), horizontal
3. Apply corner radius: `component.browse.search-radius` (6px)
4. Set fill to `color.surface`
5. Add a stroke: `white-opacity.o12`, 1px

**Inside the board:**

1. Press `T` to add a text element — type "Search datasets..."
   - Font size: `component.browse.search-size`
     (0.875rem ≈ 14px)
   - Color: `color.text-dim` (placeholder color)
2. Set the text to "Fill container" width so it stretches

**Turn it into a component:**

1. Select the board → `Ctrl/Cmd + K`
2. Name it `.browse-search`

---

## 9. Build Category Chip Components

Go to the **Components** page.

### Category chip

1. Press `B` → apply Flex Layout (`Ctrl/Cmd+Shift+A`), horizontal
2. Set padding to `5px 12px` (approximates `0.3rem 0.75rem`)
3. Apply corner radius: `component.browse.chip-radius`
   (999px — pill shape)
4. Set fill to `white-opacity.o05`
5. Add stroke: `white-opacity.o15`, 1px

**Inside:**

1. Press `T`, type "Category"
   - Font size: `component.browse.chip-size` (0.7rem ≈ 11px)
   - Color: `#aaa`

**Make it a component with variants:**

1. `Ctrl/Cmd + K` → name it `.browse-chip`
2. Add variants:
   - **State=Default** — as built
   - **State=Hover** — bg `white-opacity.o10`, text `#ddd`
   - **State=Active** — bg `color.accent-dark`, text `color.text`

---

## 10. Build the Chat Trigger Button

Go to the **Components** page.

1. Press `B` → apply Flex Layout (`Ctrl/Cmd+Shift+A`), horizontal,
   gap ~5px
2. Set height to `component.chat.trigger-height` (44px)
3. Apply corner radius: 999px (pill shape)
4. Set fill to `glass.bg`
5. Add stroke: `white-opacity.o12`, 1px
6. Add Background blur effect: `glass.blur` (12px)
7. Set padding to `0 14px 0 11px` (approximates
   `0 0.9rem 0 0.7rem`)
8. Center align children vertically

**Inside (left to right):**

1. Press `T`, type "💬" (speech balloon — the icon used in the
   app)
   - Font size: 1.2rem ≈ 19px
2. Press `T`, type "Ask Orbit"
   - Font size: 0.75rem ≈ 12px
   - Weight: Medium (500)
   - Color: `color.text-secondary`

**Make it a component with variants:**

1. `Ctrl/Cmd + K` → name it `.chat-trigger`
2. Add variants:
   - **State=Default** — pill shape, icon + "Ask Orbit" text
     label, border `white-opacity.o12`,
     text `color.text-secondary`
   - **State=Active** — same pill shape, border and text switch
     to `color.accent`, add a subtle glow: drop shadow
     `0 0 12px` with color `accent-opacity.o30`
   - **State=Collapsed** — circle (width = height = 44px),
     icon only, remove text label, border `white-opacity.o12`,
     corner radius 50%

> **Note:** The 💬 emoji won't change color when you apply a text
> color token — emoji render as images. The color change on the
> Active variant only affects the "Ask Orbit" text.

---

## 11. Build the Browse Button

Go to the **Components** page. This is the "Browse" pill that
opens the dataset browser. It lives in the bottom-right alongside
the gear toggle.

1. Press `B` → apply Flex Layout, horizontal, gap 5px
2. Set min-height: `component.tools-menu.btn-min-height` (34px)
3. Set padding to `6px 11px` (approximates `0.35rem 0.7rem`)
4. Apply corner radius: `component.tools-menu.btn-radius` (999px)
5. Set fill to `glass.bg-light`
6. Add stroke: `white-opacity.o12`, 1px
7. Add Background blur effect: `glass.blur` (12px)

**Inside (left to right):**

1. Press `T`, type "🗂" (card index dividers — the icon used in
   the app)
   - Font size: 0.95rem ≈ 15px
2. Press `T`, type "Browse"
   - Font size: `component.tools-menu.btn-font-size`
     (0.72rem ≈ 12px)
   - Color: `#ccc`
   - Weight: Medium (500)

**Make it a component with variants:**

1. `Ctrl/Cmd + K` → name it `.tools-menu-browse`
2. Add variants:
   - **State=Default** — as built
   - **State=Hover** — border color `rgba(77, 166, 255, 0.45)`,
     text `color.text`
   - **State=Expanded** — bg `accent-opacity.o18`,
     text and border `color.accent`

---

## 12. Build the Gear Toggle Button

Go to the **Components** page. This is the icon-only button next
to the Browse pill that opens the Tools popover.

1. Press `B` → apply Flex Layout, center aligned
2. Set width and height to
   `component.tools-menu.toggle-min-width` (34px) — it's a square
3. Set padding to `6px 9px` (approximates `0.35rem 0.55rem`)
4. Apply corner radius: `component.tools-menu.btn-radius` (999px)
5. Set fill to `glass.bg-light`
6. Add stroke: `white-opacity.o12`, 1px
7. Add Background blur effect: `glass.blur` (12px)

**Inside:**

1. Press `T`, type "🔧" (wrench — the icon used in the app)
   - Font size: 0.95rem ≈ 15px
   - Center aligned

**Make it a component with variants:**

1. `Ctrl/Cmd + K` → name it `.tools-menu-toggle`
2. Add variants:
   - **State=Default** — as built
   - **State=Hover** — border color `rgba(77, 166, 255, 0.45)`
   - **State=Expanded** — bg `accent-opacity.o18`,
     border `color.accent`, icon color `color.accent`

---

## 13. Assemble Full Panel Layouts

Go to the **Screens** page. Now that you have all the components,
you can assemble full layouts.

### Desktop layout (1440 × 900)

1. Press `B` → set to 1440 × 900
2. Fill with `color.bg` (the dark background)
3. Name it "Desktop — Default"

Now place **instances** of your components. To place an instance:
go to the **Assets** tab in the left sidebar (next to Layers /
Tokens), find the component, and drag it onto the canvas. Or copy
a component from the Components page and paste — it automatically
becomes an instance.

**Browse panel (right side):**

1. Create a board on the right edge, 420px wide × full height
2. Fill: `glass.bg-light`
3. Add stroke on left edge: `white-opacity.o08`, 1px
4. Apply Flex Layout, vertical
5. Inside, place instances of:
   - `.browse-search` at the top
   - A row of `.browse-chip` instances below the search
   - Several `.browse-card` instances in a grid below the chips

**Playback controls (bottom-right):**

1. Create a board with Flex Layout, horizontal, gap 3px
2. Apply glass surface properties (fill, blur, stroke, radius)
3. Place 5–6 `.transport-btn` instances inside (⏮ ⏪ ▶ ⏩ ⏭)

**Tools menu (bottom-right, above playback):**

1. Create a board with Flex Layout, horizontal, gap 6px
2. Place one `.tools-menu-browse` instance (🗂 Browse)
3. Place one `.tools-menu-toggle` instance (🔧 gear)

**Chat trigger (bottom-left):**

1. Drag a `.chat-trigger` instance to the bottom-left

> **Tip:** You don't need to replicate the globe — just use the
> dark background. The focus is on the UI chrome.

### Tablet layout (768 × 1024) — optional

1. Duplicate the desktop board (`Ctrl/Cmd + D`)
2. Resize to 768 × 1024
3. Switch the board to its **Tablet** mode in the Tokens panel
   so the responsive token values activate (Penpot supports
   per-board mode switching natively). For Figma + Tokens Studio,
   adjust component instances manually since the free tier
   doesn't support live mode switching in the UI.
4. Name it "Tablet — Default"

### Phone portrait (375 × 812) — optional

1. Duplicate again, resize to 375 × 812
2. Switch the board to its **Phone Portrait** mode
3. Browse panel becomes a bottom sheet (partial height from
   bottom)
4. Chat panel goes full-width
5. Name it "Phone Portrait — Default"

---

## 14. Keeping Things in Sync

The token JSON files in `tokens/` are the single source of truth.
Designers and developers stay in sync by importing/exporting that
JSON — no plugin sync, no GitHub PAT, no live integration.

### When a developer changes a token value

1. Pull the latest `tokens/*.json` from the repo (or have the file
   handed to you directly)
2. **Penpot:** open the Tokens panel → **Tools → Import** the
   updated JSON files (Penpot merges on token name)
   **Figma + Tokens Studio:** click the sync icon → **Pull from
   GitHub**
3. Any layers with those tokens applied reflect the new values
   automatically

### When you change a value in the design tool

1. Edit the token (click → edit value) in the Tokens panel /
   Tokens Studio
2. **Penpot:** export the tokens (Tokens panel → **Tools →
   Export** → download the JSON files)
   **Figma + Tokens Studio:** click the sync icon → **Push to
   GitHub**
3. Hand the updated JSON to a developer (or open a PR yourself)
   replacing the matching files under `tokens/`
4. The developer runs `npm run tokens` to regenerate
   `src/styles/tokens.css`

### What NOT to do

- Don't edit `src/styles/tokens.css` directly — it's generated
- Don't type hardcoded values in the design tool when a token
  exists — always apply via the Tokens panel / Tokens Studio so
  the binding sticks
- Don't rename tokens without coordinating with developers — the
  CSS references will break

---

## Glossary

Penpot terms first; Figma equivalents listed for cross-reference.

| Penpot term | Figma equivalent | Meaning |
|---|---|---|
| **Board** | Frame | A container (like a div). Used for everything. |
| **Flex Layout** | Auto Layout | CSS flexbox in the design tool. Children stack with gap and padding. |
| **Component** | Component | A reusable element. Edit the main, all instances update. |
| **Instance** | Instance | A copy of a component that stays linked to the main. |
| **Variant** | Variant | A state of a component (default, hover, expanded). |
| **Tokens panel** | Tokens Studio plugin | Where design tokens live. Right-click → Apply Token. |
| **Token** | Token | A named design value (color, size, radius) stored in JSON. |
| **Fill** | Fill | Background color of a shape or board. |
| **Stroke** | Stroke | Border around a shape or board. |
| **Effects** | Effects | Shadows and blurs. "Layer background blur" = CSS `backdrop-filter`. |
| **Design panel** | Design panel / Inspect | Right sidebar — properties of the selected element. |

---

## Reference

- `docs/COMPONENT_BRIEF.md` — exact token-to-property mapping for
  every component
- `docs/DESIGN_SYSTEM_PLAN.md` — architecture and decisions
- `tokens/README.md` — developer workflow for editing tokens
- `STYLE_GUIDE.md` — visual design rules and auto-generated token
  tables
