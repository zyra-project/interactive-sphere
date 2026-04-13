# Getting Started with Figma — Interactive Sphere Design System

This guide walks you through building the Interactive Sphere component
library in Figma from scratch. It assumes you have Figma installed
and the Tokens Studio plugin connected (see Phase 3 in
`FIGMA_SYNC_PLAN.md`).

## Table of Contents

1. [Create the Figma File](#1-create-the-figma-file)
2. [Understand the Figma Interface](#2-understand-the-figma-interface)
3. [Set Up Your First Page Structure](#3-set-up-your-first-page-structure)
4. [Build the Glass Surface Foundation](#4-build-the-glass-surface-foundation)
5. [Apply Tokens with Tokens Studio](#5-apply-tokens-with-tokens-studio)
6. [Build Your First Component: Transport Button](#6-build-your-first-component-transport-button)
7. [Build the Browse Card Component](#7-build-the-browse-card-component)
8. [Assemble Full Panel Layouts](#8-assemble-full-panel-layouts)
9. [Keeping Things in Sync](#9-keeping-things-in-sync)

---

## 1. Create the Figma File

1. Open Figma (desktop app or figma.com)
2. Click **+ New design file** (or Drafts → New file)
3. Double-click the file name at the top and rename it to
   **"Interactive Sphere — Design System"**
4. You'll see a blank canvas — this is where you'll build everything

> Save the file URL somewhere accessible (the address bar in Figma
> desktop, or the browser URL). This is how collaborators will find
> the design file.

---

## 2. Understand the Figma Interface

If you're new to Figma, here are the key areas:

```
┌─────────────────────────────────────────────────────┐
│  Toolbar (top)                                       │
│  [Frame] [Rectangle] [Text] [Pen] ...               │
├──────────┬──────────────────────┬───────────────────┤
│  Layers  │                      │  Design Panel     │
│  panel   │     Canvas           │  (properties of   │
│  (left)  │     (center)         │   selected item)  │
│          │                      │                   │
│          │                      │  Fill, Stroke,    │
│          │                      │  Effects, Layout  │
├──────────┴──────────────────────┴───────────────────┤
│  Pages (top-left, above layers)                      │
└─────────────────────────────────────────────────────┘
```

**Key concepts:**
- **Frame** (shortcut `F`): A container, like a `<div>` in HTML. Use
  frames for everything — panels, cards, buttons, screens.
- **Rectangle** (shortcut `R`): A shape. Used for backgrounds,
  dividers, thumbnails.
- **Text** (shortcut `T`): A text layer.
- **Auto Layout** (shortcut `Shift+A`): Makes a frame behave like CSS
  flexbox — children stack horizontally or vertically with gaps and
  padding. This is the most important Figma feature for our work.
- **Component** (shortcut `Ctrl/Cmd+Alt+K`): A reusable element. When
  you update the main component, all instances update too.
- **Variant**: Different states of a component (default, hover, active)
  stored in one component set.

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

1. Press `F` to create a frame. In the right panel, set its size to
   `800 × 600`. Name it "Color Palette" in the layers panel.
2. Press `R` to create a rectangle. Set it to `60 × 60`.
3. Open **Tokens Studio** (Plugins → Tokens Studio in the menu, or
   it may already be open).
4. In Tokens Studio, find `global` → `color` → `accent`.
5. Select your rectangle on the canvas, then in Tokens Studio click
   the color swatch for `accent`. Click **"Apply to selection"** at
   the bottom. The rectangle should turn `#4da6ff`.
6. Duplicate the rectangle (`Ctrl/Cmd+D`) and apply the next color
   (`accent-hover`). Repeat for all colors.

> **Tip:** Select multiple rectangles, then press `Shift+A` to wrap
> them in an Auto Layout frame. Set the gap to 8px. Now they'll stay
> neatly arranged.

### Create the glass surface sample

1. Press `F` to create a frame, size `300 × 200`. Name it
   "Glass Surface".
2. **Fill:** In the right panel under "Fill", click the color and set
   it to `rgba(13, 13, 18, 0.88)`. Or use Tokens Studio: apply
   `glass > bg-light`.
3. **Stroke:** Click "+" next to Stroke in the right panel. Set color
   to the surface-border-subtle token. Weight 1px.
4. **Corner radius:** In the right panel, set to 8 (or apply
   `radius > lg` from Tokens Studio).
5. **Background blur:** In the right panel under "Effects", click "+".
   Change "Drop shadow" to **"Background blur"**. Set the blur to 12
   (or apply `glass > blur` from Tokens Studio).

This glass surface rectangle is the foundation for every panel in the
app. You'll reuse it as a component.

### Turn it into a component

1. Select the glass surface frame
2. Press `Ctrl/Cmd + Alt + K` (or right-click → Create component)
3. Name it `.glass-surface` in the layers panel
4. Now whenever you need a glass background, you'll create an
   **instance** of this component (copy-paste it, or drag from the
   Assets panel)

---

## 5. Apply Tokens with Tokens Studio

Here's the general workflow for applying any token:

### For colors (fills, strokes)
1. Select the layer
2. In Tokens Studio, find the color token (e.g., `color > accent`)
3. Right-click the token → choose **"Fill"** or **"Stroke"**
4. Or just click the token and hit "Apply to selection"

### For dimensions (width, height, padding, gap, radius)
1. Select the frame or layer
2. In Tokens Studio, find the dimension token
3. Right-click → choose the property: **"Width"**, **"Height"**,
   **"Border Radius"**, **"Gap"**, **"Padding"**, etc.

### For font sizes and weights
1. Select a text layer
2. Find the token in Tokens Studio
3. Right-click → **"Font Size"** or **"Font Weight"**

> **Important:** Always apply tokens through Tokens Studio rather than
> typing values manually. This binds the Figma property to the token
> so it updates automatically when the token changes.

---

## 6. Build Your First Component: Transport Button

Go to the **Components** page. We'll build a simple button first to
practice the workflow.

### Step 1: Create the frame

1. Press `F` to create a frame
2. In the right panel, set width to 28 and height to 28
   (or apply `component > playback > transport-btn-min-width`)
3. Set corner radius to 6 (apply `radius > md`)

### Step 2: Apply the glass surface properties

1. Set fill to `color > surface` token
2. Add a stroke: `white-opacity > o10`, weight 1px

### Step 3: Add the icon/label

1. Press `T` to create a text layer inside the frame
2. Type a play symbol: `▶` (or any placeholder)
3. Set color to `#ccc`
4. Set font size to the `component > playback > transport-btn-font-size`
   token (0.7rem ≈ 11.2px at default browser size)

> **rem to px:** Figma uses px, but our tokens use rem. At default
> browser font size (16px), the conversion is: `rem × 16 = px`.
> So `0.7rem = 11.2px`, `0.8rem = 12.8px`, etc. You can round to
> the nearest whole pixel.

### Step 4: Set up Auto Layout

1. Select the frame
2. Press `Shift+A` to add Auto Layout
3. Set alignment to center (both axes)
4. Set padding to `5px 6px` (approximates `0.3rem 0.4rem`)

### Step 5: Turn it into a component

1. Select the frame → `Ctrl/Cmd + Alt + K`
2. Name it `.transport-btn`

### Step 6: Add variants (optional but recommended)

1. In the right panel, click **"+"** next to "Variants"
2. This creates a variant container. Rename the variants:
   - **Default** — the one you just built
   - **Hover** — duplicate, change border to `accent-opacity > o40`,
     text color to `color > text`
   - **Active** — duplicate, change border and text to `color > accent`

---

## 7. Build the Browse Card Component

This is a more complex component. Go to the **Components** page.

### Step 1: Create the outer frame

1. Press `F` → set width to 300 (will be flexible in a grid)
2. Apply these tokens:
   - Corner radius: `component > browse > card-radius` (8px)
   - Fill: `color > surface-alt`
   - Stroke: `white-opacity > o08`, 1px
3. Add Auto Layout (`Shift+A`), set to **horizontal** (row)
4. Set padding to `component > browse > card-padding` (0.875rem ≈ 14px)
5. Set gap to `component > browse > card-gap` (0.75rem ≈ 12px)

### Step 2: Add the thumbnail

1. Inside the card frame, press `R` for a rectangle
2. Apply width and height: `component > browse > thumb-size` (64px)
3. Apply corner radius: `component > browse > thumb-radius` (4px)
4. Fill with a placeholder color or image

### Step 3: Add the body

1. Press `F` for a frame inside the card (to the right of the thumb)
2. Add Auto Layout, set to **vertical** (column), gap 4px
3. Set "Fill container" for width (so it stretches)

### Step 4: Add text layers in the body

1. **Title:** Press `T`, type "Dataset Title"
   - Font size: apply `component > browse > title-size` (0.8rem ≈ 13px)
   - Font weight: apply `component > browse > title-weight` (600)
   - Color: `color > text`

2. **Description:** Press `T`, type "A brief description..."
   - Font size: apply `component > browse > desc-size` (0.7rem ≈ 11px)
   - Color: `color > text-muted`

3. **Keywords row:** Create a frame with Auto Layout (horizontal),
   gap 3px. Inside, create small text labels:
   - Font size: `component > browse > keyword-size` (0.58rem ≈ 9px)
   - Background: `accent-opacity > o12`
   - Corner radius: `component > browse > keyword-radius` (3px)
   - Text color: `color > accent-hover`

### Step 5: Turn into component with variants

1. Select the card → make it a component (`.browse-card`)
2. Add variants:
   - **Default** — as built
   - **Hover** — border `accent-opacity > o40`, bg `white-opacity > o08`
   - **Expanded** — thumbnail uses `thumb-size-expanded` (96px),
     description fully visible, extra metadata rows

---

## 8. Assemble Full Panel Layouts

Go to the **Screens** page.

### Desktop layout (1440 × 900)

1. Press `F` → set to 1440 × 900
2. Fill with `color > bg` (the dark background)
3. Name it "Desktop — Default"

Now place instances of your components:

1. **Browse panel:** Create a frame on the right side
   - Width: `component > browse > panel-width` (420px)
   - Height: fill the viewport
   - Background: `glass > bg-light`
   - Inside: place search bar, chips, and a grid of browse card
     instances

2. **Playback controls:** Place a row of transport button instances
   at the bottom-right, with a glass surface background

3. **Tools menu:** Place the Browse and gear buttons at the bottom-right,
   above the playback controls

4. **Chat trigger:** Place in the bottom-left — an instance of the
   chat trigger button

> **Tip:** You don't need to replicate the globe — just use the dark
> background. The focus is on the UI chrome.

### Tablet layout (768 × 1024)

1. Duplicate the desktop frame (`Ctrl/Cmd + D`)
2. Resize to 768 × 1024
3. Adjust component instances to use tablet-sized values where needed
   (larger touch targets, wider popover, etc.)
4. Name it "Tablet — Default"

### Phone portrait (375 × 812)

1. Duplicate again, resize to 375 × 812
2. Browse panel becomes a bottom sheet (partial height from bottom)
3. Chat panel goes full-width
4. Name it "Phone Portrait — Default"

---

## 9. Keeping Things in Sync

### When a developer changes a token value

1. Open Tokens Studio in Figma
2. Click the sync icon → **Pull from GitHub**
3. The updated values appear in the plugin
4. Any layers with those tokens applied will reflect the new values

### When you change a value in Figma

1. Edit the token in Tokens Studio (click the token → edit value)
2. Click the sync icon → **Push to GitHub**
3. Tokens Studio creates a commit in the repo
4. A developer runs `npm run tokens` to regenerate the CSS

### What NOT to do

- Don't edit `src/styles/tokens.css` directly — it's generated
- Don't type hardcoded values in Figma when a token exists — always
  apply through Tokens Studio
- Don't rename tokens in Figma without coordinating with developers —
  the CSS references will break

---

## Glossary

| Term | Meaning |
|---|---|
| **Frame** | A container (like a div). Used for everything. |
| **Auto Layout** | CSS flexbox in Figma. Children stack with gap and padding. |
| **Component** | A reusable element. Edit the main, all instances update. |
| **Instance** | A copy of a component that stays linked to the main. |
| **Variant** | A state of a component (default, hover, expanded). |
| **Token** | A named design value (color, size, radius) stored in JSON. |
| **Tokens Studio** | Figma plugin that syncs tokens between Figma and Git. |
| **Fill** | Background color of a shape or frame. |
| **Stroke** | Border around a shape or frame. |
| **Effects** | Shadows, blurs. "Background blur" = CSS backdrop-filter. |

---

## Reference

- `docs/FIGMA_COMPONENT_BRIEF.md` — exact token-to-property mapping
  for every component
- `docs/FIGMA_SYNC_PLAN.md` — architecture and decisions
- `tokens/README.md` — developer workflow for editing tokens
- `STYLE_GUIDE.md` — visual design rules and auto-generated token
  tables
