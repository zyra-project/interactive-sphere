# Orbit Character — Vinyl Toy Redesign

Companion to `ORBIT_CHARACTER_DESIGN.md`. Records the pivot from the
original spectral single-eyed orb to a **"Cute, Tactile Vinyl Toy"**
with two eyes, designed to read as approachable rather than ominous.

**Status:** design committed. Implementation lives in
`src/services/orbitCharacter/`; the state machine, gesture system,
flight system, and Quest-tier performance constraints from the
original design are all retained.

-----

## Why we're changing it

User feedback on the original spectral single-eyed glowing orb: **too
creepy, a bit ominous.** The fresnel-lit iridescent body + single
inset lens read as alien, not approachable — exactly opposite of
what a museum docent for families needs.

The visual pivot: opaque matte "vinyl toy" body, paired neotenous
eyes with wet catchlights, warm off-white sparkle trails, and tight
dual orbiting satellites that cast soft eclipse shadows. Personality
still lives in parametric motion (pupils, head group, sub-sphere
behavior), not in any rigged mesh. The entire state machine, gesture
overlays, flight system, and reduced-motion hygiene carry forward
unchanged.

-----

## Design summary

| Aspect | Before | After |
|---|---|---|
| Body material | `ShaderMaterial`, fresnel + iridescent hue shift | `MeshStandardMaterial`, matte vinyl (rough 0.5, metal 0.0), warm-top → cool-bottom gradient (15° diagonal) via `onBeforeCompile` |
| Face | Single inset lens-eye (EVE / BB-8 lineage) | Two paired eyes only — larger, lower, wider; mammalian neoteny proportions |
| Eye structure | Flat accent-colored disc | Stacked iris rig: teal iris ring → navy pupil field → sparkle stars → black pupil dot → two catchlights, all gaze-tracked |
| Eye socket | Near-black (`#060810`) | Warm charcoal (`#1f1a24`) + widened rim zone reads as 3-D bezel |
| Catchlights | None | Two per eye (primary upper-right, secondary lower-left), parented to gaze-tracking pupil group |
| Sub-sphere material | `MeshBasicMaterial` (flat accent color) | `MeshStandardMaterial` with the vinyl gradient |
| Idle orbits | Single shared orbit phase | Two distinct crossing ellipses, tighter radius |
| Shadows | None | Sub-spheres cast eclipse shadows onto body (educational cue: planetary eclipses) |
| Trails | 42-point taper, always follows sub | 160-point buffer with downsampled writes + flat alpha body; wraps into a sparkle ring during steady idle orbit, reads as comet wake in breakaway sub-modes — one buffer, two natural visual reads (§4.1) |
| Backlight | None | Soft warm radial halo behind body — sells "luminous vinyl toy" without emissive on the matte material |
| Body dynamics | Subtle wobble | Procedural squash/stretch — breathing, velocity smear, surprise gasp, satellite anthropomorphism |

-----

## 1. Palette system

We **extend** the existing palettes rather than replacing them. Every
palette now carries a `warm` + `cool` anchor pair that drives the
body's horizontal gradient. The default palette (`cyan`) uses the
pink→blue gradient from the concept art; the other three palettes
offer alternatives that all read as "soft vinyl toy."

```ts
interface Palette {
  base:   string   // light surface wash (legacy, used by eye lid shader)
  accent: string   // pupil + trail color for expressive states
  glow:   string   // halo color (legacy)
  warm:   string   // left side of body gradient
  cool:   string   // right side of body gradient
}
```

| Key | Warm | Cool | Feel |
|---|---|---|---|
| `cyan`   | `#f7c9d6` (blush pink)     | `#c9e6e5` (seafoam)     | Reference — matches concept art |
| `green`  | `#d6f0c9` (mint)           | `#c9d6f0` (periwinkle)  | Spring, library-tone |
| `amber`  | `#f7d9b8` (peach)          | `#f2e9cf` (cream)       | Warm & plush |
| `violet` | `#e4cdf7` (lavender)       | `#f7cde0` (rose)        | Plum candy |

`accent` is left as-is so the pupil + expressive trails still read
against the vinyl body. `base`/`glow` stay so the eye-field lid
shader can blend lids against the body's dominant tone without
knowing about the gradient.

### Gradient injection (matte vinyl material)

`createBodyMaterial` returns a `MeshStandardMaterial` whose fragment
pipeline is modified via `onBeforeCompile`. The gradient axis is
**not** horizontal — the concept art shows a soft "warm top / cool
bottom" wash with a slight diagonal lean, mimicking natural lighting
from above. We project the object-space position onto a tilted unit
axis and mix:

```glsl
// uAxis ≈ (0.259, -0.966, 0.0) — 15° off vertical, warm side up
float g = clamp(dot(vObjSpacePos, uAxis) / uSpan * 0.5 + 0.5, 0.0, 1.0);
vec3 gradient = mix(uCool, uWarm, g);
diffuseColor.rgb = gradient;
```

`uAxis` is exposed on the bundle so future state-driven tweaks
(e.g. rotating the axis for a CONFUSED spiral) don't need a shader
recompile. `roughness: 0.5` and `metalness: 0.0` give the tactile
silicone catch-the-light feel. No textures — everything derives from
the two anchor uniforms.

-----

## 2. Face geometry

**Paired eyes only.** `EyeMode = 'two'` is narrowed to a single
literal; the legacy `'one'` code path and the central eye rig are
deleted. Callers (`orbitMain.ts`, `orbitDebugPanel.ts`,
`orbitPostMessageBridge.ts`) are simplified accordingly.

**Neoteny placement** — the concept art reads "approachable" because
the eyes sit low-and-wide on the face, large relative to the head.
We match:

| Constant | Before | After |
|---|---|---|
| `EYE_PAIR_OFFSET_X` | `0.022` | `0.028` (wider) |
| `EYE_PAIR_DISC_RADIUS` | `0.014` | `0.018` (bigger) |
| Eye group `.position.y` | `0` | `-0.012` (lower) |

### Stacked iris rig

The concept art's eye is anatomically structured — a teal iris ring
around a dark-navy pupil field speckled with white stars, a tiny
black pupil dot, and bright catchlights on top. Flat-disc
"pupil + glow" was wrong; we rebuild the eye as a stack of
concentric discs parented into a gaze-tracking pupil group:

```
eyeGroup (static, at face offset)
├── disc        (eye-field shader: lids + widened dark bezel)
└── pupilGroup  (moves for gaze)
    ├── irisGlow    (additive accent halo)
    ├── iris        (accent-colored disc, r=0.0108)    — "teal ring"
    ├── pupilField  (dark navy, r=0.0080)              — covers iris center
    ├── stars[3]    (tiny white 5-point sparkles)
    ├── pupilDot    (near-black, r=0.0025)             — anatomical pupil
    ├── catchPrimary  (additive white, r=0.0020, upper-right)
    └── catchSecondary (additive white, r=0.0010, lower-left)
```

Layer ordering uses Z offsets (`0.00045` → `0.00085` above the body
radius) so the stack renders back-to-front without a depth test.

**Why a group for gaze instead of moving individual meshes:**
moving one `pupilGroup` per eye keeps iris, pupil dot, stars, and
catchlights anatomically aligned under any gaze angle. The old code
moved pupil + glow separately and left catchlights static; the
catchlights drifted off the pupil on wide gaze.

**Socket bezel.** The eye-field shader's `rimFactor` now ramps from
`0.30` → `0.49` (was `0.36` → `0.48`), widening the dark ring around
the iris. Combined with `uEyeColor` `0x1f1a24` (warm charcoal) and a
darker `uRimColor` `0x0f0a12`, this reads as a 3-D socket bezel —
the mechanical-toy look from the concept art — without any extra
geometry.

**Iris color carrier.** The iris — not the pupil dot — is what
carries the palette accent and state-driven pupil color (SOLEMN
blue, CONFUSED amber, gesture flashes). The pupil dot stays near-
black and scales with `s.pupilSize` (so SURPRISED still constricts
the pupil to 0.55× while the iris stays full).

### Sparkle stars

Three tiny white five-point stars per eye, built from a shared
`BufferGeometry` (one triangle fan, 11 vertices). Positions are a
fixed per-eye table so the two eyes read as distinct "star charts"
but never shimmer between frames. Additive white, shared material
across both eyes.

Total new geometry cost: **2 × (1 iris + 1 iris-glow + 1 pupil-field
+ 3 stars + 1 pupil-dot + 2 catchlights) = 18 meshes,** all sharing
materials. Well under the Quest budget.

### Catchlights (both sizes, bigger)

Two additive white discs per eye, now parented to the gaze-tracking
`pupilGroup` (not the static eye group). Big anime-style rigs track
catchlights with the iris; a floating static highlight reads as
misaligned parallax under wide gaze. Sizes bumped from the first
pass:

| | Primary | Secondary |
|---|---|---|
| Offset (x, y) | `+0.0035, +0.0035` | `-0.0024, -0.0020` |
| Radius | `0.0020` | `0.0010` |
| Opacity | `1.0` | `0.70` |

The primary catchlight covers ~18% of the iris radius — the
dominant upper-right gleam from the concept art.

-----

## 3. Sub-spheres + shadows

**Material:** swap `MeshBasicMaterial` → `MeshStandardMaterial` with
the same matte-vinyl gradient injection. They read as "smaller
siblings of Orbit," not "flat dots."

**Idle orbit geometry (`effSubMode === 'orbit'`):** two distinct
crossing ellipses. Each sub carries `userData.orbitBasis` — a
precomputed orthonormal basis representing the plane of its
ellipse, tilted at different angles so the orbits cross visibly
when viewed head-on:

```ts
// computed once in buildScene
sub[0].userData.orbitBasis = tiltedBasis( +0.62)  // ~35° tilt
sub[1].userData.orbitBasis = tiltedBasis(-0.87)   // ~-50° tilt
```

The per-frame math becomes `pos = basis.u * cos(phase) * r + basis.v * sin(phase) * r` — one add per axis, cheap.

Radius tightens: `SUB_ORBIT_RADIUS 0.14 → 0.11`. Other sub-modes
(point, trace, figure8, burst, scatter, listening, cluster,
confused, nod, shake) keep their current logic — only the idle
path changes so the expressive breakaways still read as "breaking
away."

**Shadows (educational cue: planetary eclipses):**

- `WebGLRenderer.shadowMap.enabled = true`, `type = PCFSoftShadowMap`.
- Body: `castShadow = true, receiveShadow = true`.
- Subs: `castShadow = true, receiveShadow = false`.
- Key light (new): directional, tight shadow frustum (~0.5 units
  each side), `mapSize = 512`. Cheap on Quest.
- Earth stack is not a shadow participant — its materials remain
  untouched.

-----

## 4. Trail sparkle

`orbitTrails.ts` keeps the `THREE.Points` point-sprite pipeline
(`THREE.Line` widths break on mobile GPUs — that hazard hasn't
changed). Two tweaks:

1. **Color decision** moves into `updateTrails`:
   - For idle / low-excitement states (`IDLE`, `CHATTING`,
     `LISTENING`, `THINKING`, `SOLEMN`, `SLEEPY`, `YES`, `NO`) →
     warm off-white (`#fff0d8`).
   - For expressive states (`TALKING`, `POINTING`, `PRESENTING`,
     `EXCITED`, `HAPPY`, `CURIOUS`, `SURPRISED`, `CONFUSED`) →
     palette accent.
   - A single helper `trailColorFor(state, palette)` owns the
     decision; new states fall into the idle bucket by default.
2. **Sparkle shader:**
   - Per-vertex `seed` attribute (random `[0, 1)` at build time).
   - Fragment `fade = pow(fade, 2.2)` (sharper, more spark-like
     than the current `1.5`).
   - Per-vertex twinkle: `alpha *= 0.6 + 0.4 * sin(uTime * 6 + seed * 6.28)`.
   - New `uTime` uniform written by `updateTrails`.

### 4.1 Trails wrap into rings during steady orbit

The concept-art reference shows bright sparkle rings wrapping Orbit
during idle. We deliberately **don't** render rings as separate
geometry — a separate ring wouldn't follow the satellite's actual
position when the sub breaks away for POINTING/TRACE/BURST, and
would misrepresent what's happening. Instead, the **same** trail
that comet-tails behind the sub during expressive modes is tuned
long enough that during steady idle orbit the rolling buffer wraps
all the way around the orbital path — reading as a closed sparkle
ring while still strictly following the sub's current position.

Tuning numbers:

| Parameter | Value | Rationale |
|---|---|---|
| `TRAIL_LENGTH` | `160` points | Was `42`. Long enough to cover most of an IDLE orbit period. |
| `TRAIL_WRITE_EVERY_N_FRAMES` | `2` | Downsamples the rolling-buffer shift. At 60 fps that's 30 writes/sec; 160 / 30 ≈ 5.3 s of coverage, close to the ~6.3 s IDLE orbit period. |
| Alpha profile | Head spike + flat body + soft tail fade | Was a linear `1 → 0` taper. A linear taper reads as a dimming spiral when it wraps; a flat profile with a gentle tail fade reads as a closed ring. Head spike keeps the sub's current position legible. |

When the sub is in idle-orbit sub-mode, the trail grows into a nearly
complete ring over ~5 seconds with a subtle bright spot marking the
current sub position. When the sub breaks into POINTING/TRACE/BURST,
the buffer still follows its current motion — now as a comet wake.
No state switching, no hidden geometry: one buffer, two natural
visual reads.

**Intensity** reads `expressionFor(state).trailIntensity` (part of
the shared EXPRESSIONS table in §5.1). New states inherit the
default (`0.80`, clearly visible) without edits. Per-state overrides:

| State | trailIntensity | Notes |
|---|---|---|
| _default_ | `0.80` | All unlisted states inherit this |
| `SLEEPY` | `0.25` | Barely-there wake, matches low-energy read |
| `SOLEMN` | `0.35` | Dim, reverent |
| `THINKING` | `0.30` | Subs cluster near body; little motion to trail |
| `CURIOUS`, `HAPPY` | `0.90-0.95` | Warm sparkle ring |
| `TALKING` | `0.95` | figure-8 sub-mode leaves a lemniscate wake |
| `POINTING`, `PRESENTING` | `1.10` | Trail IS the communication in these modes |
| `EXCITED` | `1.15` | burst sub-mode + bright trail |
| `SURPRISED` | `0.90` | Scatter wake |

**Color** still comes from `trailColorFor(state, palette)` — warm
off-white for idle / quiet register, palette accent for expressive.

Cost: 2 trails × 160 points = 320 points. Same sparkle shader as
before, same uniform writes per frame. Well inside Quest budget.

### 4.2 Backlight halo

A single additive disc parented to the head group, behind the body
(`z = -BODY_RADIUS * 0.8`), 3.2× body radius. Radial-gradient
shader fades from warm-white center to transparent rim. Sells
"luminous vinyl toy" without pumping emissive on the matte body
material (which would fight the vinyl look).

The color is **constant warm** across palettes — a palette-tinted
halo makes cool palettes read as sickly. Warm ambient light from
behind flatters every palette equally.

Cost: one `CircleGeometry(BODY_RADIUS * 3.2, 48)` + one
`ShaderMaterial`. No per-frame work; the disc faces +Z and all scale
presets put the camera at +Z, so no billboard math is needed.

-----

## 5. Squash & stretch dynamics

Procedural scale deformation applied at the end of `updateCharacter`
— a new section *after* sub-sphere positions and *before* trails —
so any state or gesture can re-run next frame without interference.
No new animation clips; all math.

### 5.1 Architecture for extensibility

This is the core correctness requirement from the pivot: **adding a
new state in the future must not require editing five files.**

We introduce one additive table, in `orbitStates.ts`, colocated with
`STATES` but kept separate so the locked `STATES` tuning is not
touched:

```ts
export interface ExpressionConfig {
  breathRate:     number   // cycles per second
  breathAmp:      number   // peak Y-scale offset (X/Z move inversely)
  meltXZ:         number   // extra XZ widening (sleepy/solemn)
  hopAmp:         number   // rhythmic Y hop (excited)
  surpriseGasp:   boolean  // one-shot spring on state entry
  talkPulse:      boolean  // subs pulse with pupil pulse
  trailIntensity: number   // sparkle trail brightness (§4.1)
}

export const EXPRESSION_DEFAULT: ExpressionConfig = {
  breathRate: 0.8, breathAmp: 0.012, meltXZ: 0, hopAmp: 0,
  surpriseGasp: false, talkPulse: false, trailIntensity: 0.80,
}

export const EXPRESSIONS: Partial<Record<StateKey, Partial<ExpressionConfig>>> = {
  SLEEPY:     { breathRate: 0.35, breathAmp: 0.018, meltXZ: 0.025, trailIntensity: 0.25 },
  SOLEMN:     { breathRate: 0.40, breathAmp: 0.015, meltXZ: 0.018, trailIntensity: 0.35 },
  EXCITED:    { breathRate: 2.4,  breathAmp: 0.006, hopAmp: 0.010, trailIntensity: 1.15 },
  SURPRISED:  { breathRate: 0.8,  breathAmp: 0.004, surpriseGasp: true, trailIntensity: 0.90 },
  THINKING:   { breathRate: 0.55, breathAmp: 0.014, trailIntensity: 0.30 },
  TALKING:    { talkPulse: true, trailIntensity: 0.95 },
  HAPPY:      { trailIntensity: 0.95 },
  CURIOUS:    { trailIntensity: 0.90 },
  POINTING:   { trailIntensity: 1.10 },
  PRESENTING: { trailIntensity: 1.10 },
  // states omitted from this table get EXPRESSION_DEFAULT
}

export function expressionFor(state: StateKey): ExpressionConfig {
  return { ...EXPRESSION_DEFAULT, ...(EXPRESSIONS[state] ?? {}) }
}
```

**Why this shape:**
- `STATES` stays locked — its tuning is the output of nine prototype
  iterations and comes with a design-doc update rule. Breathing
  parameters are orthogonal to `STATES` (motion vs. shape), so they
  get their own table.
- `EXPRESSION_DEFAULT` + `Partial` means new states automatically
  get sensible breathing without touching the table at all.
- Every new state **must** have a `StateKey` entry; the compiler
  catches typos. Adding new fields to `ExpressionConfig` defaults
  to the sensible value through the spread — old entries don't
  need edits.
- `expressionFor(state)` is the only lookup site in
  `updateCharacter`; all math reads from the merged config.

Same pattern can be extended later for any per-state shape
parameter (e.g., cheek flush color, antenna bob amplitude) without
editing `STATES`.

### 5.2 Math

Per frame, after sub-sphere positions are written:

1. **Breathing** (always on):
   ```
   yAmp = cfg.breathAmp * sin(time * cfg.breathRate * 2π)
   hop  = cfg.hopAmp    * max(0, sin(time * cfg.breathRate * 2π * 2))
   sx = 1 + cfg.meltXZ - yAmp * 0.3
   sy = 1 + yAmp + hop
   sz = sx
   ```

2. **Velocity smear** (during flight):
   Track `prevHeadPos` on `AnimationState`. `speed = dist/dt`.
   Stretch along gaze-forward (approximated as world-Z): `sz *= 1 +
   0.4 * speed`, `sx *= 1 - 0.2 * speed`. On mode transition
   out of flight, record `arrivalTime` and apply a brief
   squash pulse (`sy *= 0.92` for 0.12 s then ease back).

3. **Affirm nod accent:**
   Inside `gestureFrame` branch, if `activeGesture.kind === 'affirm'`
   and `t ∈ [0.45, 0.55]`, `sy *= 0.96`. Reads as the "weight" of
   the nod's low point.

4. **Surprise gasp:**
   If `cfg.surpriseGasp` and we just entered this state, record
   `surpriseStart = time`. Spring: `sy *= 1 + 0.12 * exp(-5τ) *
   cos(14τ)` where `τ = time - surpriseStart`, until `τ > 1.2`.

5. **Satellite anthropomorphism:**
   If `cfg.talkPulse`, every sub's scale gets `1 + 0.15 * sin(time *
   9)` — same frequency as the existing pupil pulse. Reads as the
   subs "breathing with the voice."

All writes go through `lerp` for framerate hygiene. Apply to
`handles.body.scale` and `sub.scale[i]` directly (no intermediate
objects, keeps GC quiet).

### 5.3 AnimationState additions

```ts
interface AnimationState {
  // … existing fields
  prevHeadPos:     THREE.Vector3
  surpriseStart:   number         // -1 when not active
  arrivalSquashStart: number      // -1 when not active
  lastStateKey:    StateKey       // for gasp on-entry detection
}
```

-----

## 6. Dispose hygiene

`OrbitController.dispose()` already traverses the scene and calls
`dispose()` on any `.geometry` / `.material` it finds. The new
catchlight meshes, the key light, and every new `MeshStandardMaterial`
are reached by the traversal. Lights dispose their shadow cameras
when garbage-collected. Gradient uniforms are plain JS objects with
no GPU resources beyond the material they're attached to — no
change needed.

-----

## 7. Files touched

| File | Change |
|---|---|
| `orbitTypes.ts` | `EyeMode = 'two'`; `warm`/`cool` fields on `Palette`; populate anchors |
| `orbitStates.ts` | Add `ExpressionConfig`, `EXPRESSION_DEFAULT`, `EXPRESSIONS`, `expressionFor` |
| `orbitMaterials.ts` | Rewrite `createBodyMaterial` to vinyl `MeshStandardMaterial` + gradient injection; warmer eye socket; lid reads body gradient |
| `orbitScene.ts` | Remove single-eye rig; reposition pair; catchlights; lights + shadow config; vinyl sub-spheres; dual-ellipse idle orbits; squash/stretch in `updateCharacter` |
| `orbitTrails.ts` | Warm-white idle default; per-vertex sparkle; `trailColorFor` helper |
| `index.ts` | `renderer.shadowMap` config; simplify `eyeMode` handling |
| `src/orbitMain.ts` | Drop `'one'` from URL-param validation |
| `src/ui/orbitDebugPanel.ts` | Drop "One" option |
| `src/ui/orbitPostMessageBridge.ts` | Narrow eye-mode validation |

-----

## 8. Non-goals

- **Rigged animation.** Squash/stretch stays procedural. No
  `AnimationMixer`, no imported glTF.
- **Re-tuning `STATES`.** Motion parameters (orbit speed, pupil
  size, lid angles) are locked; only the orthogonal `EXPRESSIONS`
  shape table is new.
- **Re-tuning `GESTURES`.** The four gesture compute functions are
  locked; the `affirm` squash accent is a per-frame overlay, not
  a `GestureFrame` field change.
- **Mobile line-width workaround.** Trails stay `THREE.Points`.
- **Desktop-only features.** Everything ships on Quest and web.

-----

## 9. Verification

- `npm run type-check` — green.
- `npm run test` — green (no orbit unit tests today; expression
  defaults get a small spot-check if time permits).
- Manual: cycle every `StateKey` at `/orbit` and confirm body reads
  as vinyl (not iridescent), eyes track, catchlights stay put
  during pupil sweep, subs cast moving shadows, trails go
  warm-white at IDLE and accent-colored at TALKING, breathing is
  visible at SLEEPY, gasp triggers on SURPRISED entry.
- Performance: frame budget on Quest 2 should stay under the
  existing baseline — `MeshStandardMaterial` is more expensive per
  pixel than the hand-rolled fresnel shader but the tri count is
  unchanged and shadow map is small.
