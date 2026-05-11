# VR / AR Device Support Expansion Plan

Companion to [`VR_INVESTIGATION_PLAN.md`](VR_INVESTIGATION_PLAN.md). That
plan landed an immersive mode tuned for Meta Quest. This plan
catalogs what the current implementation already supports beyond
Quest, identifies the gaps that block other WebXR-capable devices
from being usable in practice, and proposes phased work to close
those gaps.

Status: **draft for review, v4 — localization, tours, multi-globe on
small screens, and rollout cadence folded in on top of v3.**

> **Verification key:** ✓ = traced through code; ⚠ = inferred from spec
> or comments but not testable without hardware; ✗ = was incorrect in
> v1 of this doc, corrected below.

## Goal

Let any user on a WebXR-capable device — handheld AR on an Android
phone, Apple Vision Pro, HoloLens 2, Magic Leap 2, Pico, PCVR
through SteamVR — enter the immersive globe experience without
hardware-specific code paths or build flags. The Quest experience
stays as it is today; this is purely additive surface area on top
of the same `vrSession` / `vrScene` / `vrInteraction` pipeline.

## Non-goals

- **iOS Safari on iPhone / iPad.** Apple has only shipped WebXR on
  visionOS; mobile Safari has no `navigator.xr`. Polyfills like
  Mozilla's deprecated WebXR Viewer are out of scope.
- **Native iOS / Android apps.** This plan stays inside the WebXR
  API surface. A native ARKit / ARCore wrapper is a separate
  conversation (and probably a different repo).
- **Pre-ARCore Android devices.** Devices that can't run ARCore
  won't surface `immersive-ar` from `isSessionSupported`; they
  correctly land in the "button hidden" path today.
- **Re-architecting the interaction model.** The Quest-tuned
  controller bindings (trigger / grip / thumbstick) stay
  authoritative. Other devices get parallel input paths that emit
  the same semantic gestures, not a replacement input layer.
- **Poster updates ahead of validation.** The "Where it works"
  table in [`poster/sections/sec-08-immersive.html`](../poster/sections/sec-08-immersive.html)
  is *present-tense* marketing copy. Each row updates only after
  the device has been validated on real hardware, not when the
  standards-based codepath ships. The forward-looking device matrix
  lives in this plan; the poster stays a strict subset.

## Device support matrix

What works today, what's broken, and what's missing per device.
"Today" assumes the user can get the AR/VR button to render — the
WebXR feature detector in [vrCapability.ts](../src/utils/vrCapability.ts)
already handles that correctly via `isSessionSupported`.

| Device | Session mode | Today | Gaps |
|---|---|---|---|
| Meta Quest 2 / 3 / Pro | AR (passthrough) | Full | — (reference) |
| Quest Link / Air Link → PC | VR | Full | — |
| **Android phone (ARCore + Chrome)** | AR | Session starts; globe renders; **single tap places via screen input** but no rotate / zoom / exit; HUD targets unreachable | `targetRayMode === 'screen'` input handling; DOM touch overlay for pan / pinch-zoom / exit |
| **Apple Vision Pro** (Safari on visionOS) | AR + VR | Session starts; globe renders; transient-pointer pinch-to-select works on HUD; **no thumbstick → no zoom; no grip → can only exit via system gesture** | DOM/HUD-driven zoom alternative; HUD exit button for non-controller devices |
| **PCVR (SteamVR + Chrome/Edge)** Index / Vive / WMR / Varjo | VR | Should be full — same trigger / grip / thumbstick mapping as Quest. Untested on our hardware. | Verification only; no code changes expected |
| **Pico 4 / 4 Ultra** | AR + VR | Should match Quest — same controller layout, ARCore-style hit-test | Verification; persistent anchors are Meta-specific (silent no-op) |
| **Pico Neo 3** | VR | Should match Quest | Verification |
| **HoloLens 2** (Edge) | AR | Session starts; hand-ray pinch (`transient-pointer`) maps to `select` | No thumbstick zoom; no grip exit; persistent anchors not supported (silent) |
| **Magic Leap 2** | AR | One controller with trigger / bumper; should partly work | Single-controller assumptions; verification |
| **Lynx R-1** | AR + VR | Should match Quest pattern | Verification |
| iPhone / iPad (Safari) | — | No `navigator.xr` | Out of scope (non-goal) |

The matrix collapses to three input archetypes that need code:

1. **Two-controller-with-thumbstick** — Quest, PCVR, Pico, Lynx.
   Already supported.
2. **Screen-tap (handheld AR)** — Android phones via ARCore.
   `targetRayMode === 'screen'`, transient `XRInputSource` per tap.
3. **Hand-tracking / transient-pointer** — Vision Pro, HoloLens 2,
   Quest with hand mode toggled. `targetRayMode === 'transient-pointer'`,
   no persistent gamepad axes.

Magic Leap 2's single controller is a degenerate case of (1) that
falls out of the existing code without intervention.

## What the existing code assumes about input

[`vrInteraction.ts`](../src/services/vrInteraction.ts) was written
with Quest controllers in mind. The relevant assumptions, traced
through the code:

- ✓ **Per-frame thumbstick polling.** `updateThumbstickZoom`
  (vrInteraction.ts:1343–1404) iterates `inputSources[i]` and reads
  `source?.gamepad`. The `?.` chain means transient input sources
  without a gamepad (screen-tap, hand-tracking) silently no-op
  rather than throwing. So zoom is *absent* on those devices but
  not *broken*.
- ✓ **Grip = exit.** `controller.addEventListener('squeezestart',
  ...)` (vrInteraction.ts:1052) fires `onExit`. Screen-tap and
  transient-pointer never emit `squeezestart`, so the only way out
  is the system overlay (Android back gesture, visionOS crown).
- ✓ **`for (const i of [0, 1] as const)`** at vrInteraction.ts:1010
  hardcodes exactly two controllers. On a phone (one input source
  at a time), Three.js still creates two `XRTargetRaySpace`s but
  only `controllers[0]` ever receives events. Per-controller state
  is fully independent — the second controller silently sits idle.
- ✓ **Transient sources are already anticipated.** The comment at
  vrInteraction.ts:1054–1059 explicitly notes "transient-pointer /
  gaze sources don't have gamepads but still occupy an index in
  the list." The `connected`/`disconnected` listeners
  (vrInteraction.ts:1060–1065) populate `inputSources` defensively.
- ✓ **Select handling is input-source-agnostic.** `onSelectStart`
  (vrInteraction.ts:832–912) calls `pickHit(controllers[i])`, which
  raycasts from the controller's world pose. Three.js drives that
  pose from whichever `XRInputSource` the controller is bound to —
  controller, screen-tap, or transient-pointer pinch all just
  update the target-ray space. The HUD-armed / browse-armed /
  globe-grab state machine in `onSelectEnd` (vrInteraction.ts:914–984)
  uses identical "still pointing at the same thing on release"
  semantics, which match a tap-and-release on a screen.

⚠ **Net (with caveat):** I am confident from reading the code that
HUD taps and Place-button confirms work on phones unchanged. I am
*less* confident that drag-to-rotate gives a good feel on screen-
tap: the surface-pinned math reads the controller's full pose
(position + quaternion) frame-to-frame, and a screen-tap's target-
ray space is camera-aligned. That may produce a rotation that
feels "the globe drifts as I move my finger" rather than "the spot
I grabbed stays under my finger." Worth testing on actual hardware
before declaring Phase 1 small.

The missing pieces remain: zoom, exit, default-pose adjustment,
and telemetry plumbing.

## What the existing code assumes about session features

[`vrSession.ts`](../src/services/vrSession.ts) requests:

- ✓ `requiredFeatures: ['local-floor']` (vrSession.ts:466)
- ✓ `optionalFeatures: ['hit-test', 'anchors']` for AR only
  (vrSession.ts:454–461)

✗ **Correction from v1.** I claimed "PLACE_LIFT_Y is surface-relative
so the floor reference isn't load-bearing for placement; it's only
used to position the default-pose globe at eye level." That's
partially true but misses two things:

1. `local-floor` is also requested independently as
   `placementRefSpace` (vrSession.ts:608) to resolve **anchor poses
   each frame** — `frame.getPose(anchor.anchorSpace, refSpace)`. The
   comment at vrSession.ts:586–595 makes this explicit: an anchor
   restored from a persistent handle needs local-floor whether or
   not the user enters Place mode this session.
2. `requiredFeatures: ['local-floor']` is the gating one — if the
   device can't provide it, `requestSession` throws and the session
   never starts. Falling back to `local` therefore changes three
   things simultaneously, not one:
   - the session feature list,
   - the default `GLOBE_POSITION = { x: 0, y: 1.3, z: -1.5 }` in
     vrScene.ts:47 (y=1.3 is "seated-user eye height above floor"
     and is meaningless in a non-floored space — would need to be
     camera-relative),
   - the anchor-restore path (the placementRefSpace request would
     need a `local` fallback, which the existing code does *not*
     do — it only handles `local-floor` failing with a debug log).

So the `local-floor` fallback is a slightly larger surface than I
implied. Still worth doing — HoloLens 2 in particular has had
spotty `local-floor` support — but it's not a one-liner.

✓ **`anchors` degrades cleanly.** Verified end-to-end:

- `vrPersistence.ts` is purely localStorage round-trip with
  try/catch on every call — no WebXR anchor API touched.
- The Meta-specific calls in vrSession.ts are gated on `if
  (restoreFn)` (line 658) and `if (requestFn)` (line 941); both
  silently skip when the device doesn't expose them.
- The `vr_placement` telemetry event already carries a `persisted:
  boolean` flag (vrSession.ts:940, 954), so we can already see how
  often the persistence path succeeds vs. falls back per device.

This means the v1 plan's Phase 2 item "add an explicit branch +
log for telemetry so we know how often the fallback hits" is
**redundant** — that telemetry already exists. Removing from
Phase 2 below.

## Phases

### Phase 1 — Android phone AR (highest value, smallest change)

Goal: a user on Chrome on an ARCore phone taps **Enter AR**, sees
the globe in their room, can tap to place it, can drag with one
finger to rotate (subject to the rotation-feel caveat above), can
pinch to zoom, can tap a clearly-visible exit button to leave.

The friend's fork suggests this is mostly free at the session-start
level. The new UX work is exit + zoom affordances.

**Changes:**

| File | Change | Verified? |
|---|---|---|
| `src/services/vrSession.ts` | Detect `targetRayMode === 'screen'` on any input source at session start (the existing `connected` listener at vrInteraction.ts:1060 already surfaces the `XRInputSource`); plumb an `inputClass: 'screen' \| 'controller' \| 'transient'` into the session struct. | Plumbing only — no risk |
| `src/services/vrInteraction.ts` | No change required for screen-tap. `updateThumbstickZoom` already null-guards `source?.gamepad` and silently no-ops when absent. | ✓ traced |
| `src/services/vrHud.ts` | Add a "✕ Exit" button to the HUD canvas, visible whenever `inputClass !== 'controller'`. Wires through existing `VrHudAction` channel. Existing HUD-armed/select machinery handles the tap. | ✓ traced (vrInteraction.ts:914–928) |
| `src/ui/vrZoomOverlay.ts` *(new)* | DOM overlay on top of the WebXR canvas: vertical zoom slider on the right edge for screen / transient devices. Updates `globe.scale` via a callback. Only mounted when `inputClass !== 'controller'`. Size estimate is a guess — could grow if pinch-to-zoom on touch turns out to need its own gesture state machine. **Placed under `src/ui/` (not `src/services/`) so the `check:i18n-strings` lint scans it for hard-coded strings.** | ⚠ unverified — needs spike |
| `src/services/vrSession.ts` | Mount/unmount the zoom overlay during enter/exit. | Straightforward |
| **`local-floor` fallback** — deferred to a separate slice. See revised scope note below. | | |
| `src/utils/vrCapability.ts` | Add `getInputArchetype(session)` helper consumed by `vrSession`. | New code; trivial |

**Revised scope note on `local-floor` fallback.** Touching three
places at once (session features, default `GLOBE_POSITION`, anchor
ref-space). Defer to its own PR so we don't entangle it with the
zoom/exit UX. Most likely device that needs it (HoloLens 2)
isn't gating Phase 1 success.

**Verification:**

- Pixel 7 / 8 (ARCore), Chrome stable: enter AR, place, drag-rotate,
  pinch-zoom, tap exit. Confirm globe stays anchored to the surface
  when the user walks around.
- Samsung Galaxy S22+: same.
- Confirm no behavior change on Quest 3 (still in `controller`
  archetype; zoom overlay never mounts; HUD exit button hidden).
- Confirm desktop / Tauri / non-XR browsers see zero bundle delta —
  `vrZoomOverlay.ts` is imported only from `vrSession.ts`, which is
  already in the lazy chunk.

**Telemetry:** extend `vr_session_started.device_class` enum with
`android-ar` (UA contains `Android` and session is `immersive-ar`).
Update the catalog row in [`ANALYTICS.md`](ANALYTICS.md) and the
positional layout in [`ANALYTICS_QUERIES.md`](ANALYTICS_QUERIES.md).

### Phase 2 — Vision Pro and hand-tracking devices

Goal: a user on Vision Pro (or Quest with hands enabled, or
HoloLens 2) can enter immersive mode, look-and-pinch to interact
with the HUD, drag the globe by pinch-and-move, zoom via the HUD
zoom slider added in Phase 1, and exit via the HUD exit button.

**Changes:**

| File | Change |
|---|---|
| `src/services/vrInteraction.ts` | No change strictly required — `select` listeners already fire on transient-pointer pinch. Spike on Vision Pro to confirm the gaze-aligned ray feels reasonable for drag-to-rotate; if not, may need a `ROTATION_SENSITIVITY` override for `inputClass === 'transient'`. |
| `src/services/vrInteraction.ts` | Suppress two-hand pinch+rotate when both inputs are transient — Vision Pro's two-hand pinch semantics differ from Quest's grip+grip pattern. Defer dual-input parity to Phase 4. |
| `src/services/vrSession.ts` | When `inputClass === 'transient'`, mount the DOM zoom overlay and show the HUD exit button. Same code path as Phase 1; the only change is widening the gating condition. |
| ~~`src/utils/vrPersistence.ts`~~ | ~~Add an explicit branch + log for telemetry~~ — **removed**. The `persisted: boolean` field on the `vr_placement` event already gives us this data. |

**Telemetry:** add `device_class` values `vision-pro` (already
present), `hololens`, `magic-leap`, `pico`.

**Verification:**

- Vision Pro (need physical device or cloud test): enter AR, pinch
  HUD buttons, pinch-drag globe, zoom via DOM slider, exit via HUD
  button.
- Quest 3 with hands enabled: same flow; confirm we don't break
  the existing controller path when both modalities are present
  (Quest publishes both an `XRInputSource` per hand and per
  controller depending on grip state).
- HoloLens 2 Edge if available; otherwise document as "should work,
  not verified" in the matrix.

### Phase 3 — PCVR verification pass

No code changes expected. The PCVR controllers (Index knuckles,
Vive wands, WMR controllers) all map to `XRInputSource` with the
same trigger / grip / axes layout that Three.js abstracts behind
`getController()` and the gamepad API.

**Work:**

- Test on at least one PCVR rig (Index or Vive) through
  Chrome / Edge SteamVR.
- Document any rough edges in the support matrix.
- If thumbstick axes differ (some PCVR controllers use axes
  `[0,1]` instead of `[2,3]` for the primary stick), generalize
  the axis-selection logic in `updateThumbstickZoom`. This is the
  one bit of Quest-specific magic in the input layer.

### Phase 4 — Polish (deferred)

Items worth doing eventually but not gating broader device support:

- Vision Pro two-hand gesture parity (pinch + pinch → rotate + scale).
- Hand-tracking-aware HUD layout — HUD buttons that grow under
  gaze, so the pinch target is forgiving.
- Magic Leap 2 single-controller affordances (no second hand for
  the two-hand pinch).
- ARCore depth-API integration so the globe occludes correctly
  behind real-world objects on supported phones.
- **Multi-globe layout clamp on small screens.** The 4-globe layout
  on a 6-inch phone in AR is likely unusable — four overlapping
  spheres in front of the camera at 1.5 m. Phase 1 inherits the
  existing `MAX_PANELS = 4` cap without changes; if user feedback
  surfaces this as a real problem, clamp to 1 or 2 when
  `inputClass === 'screen'` at the panel-switcher UI level (not in
  `vrScene` — keep the engine flexible). Deferred because it isn't
  a correctness issue, just a UX one, and we don't have data yet.

## Localization (non-negotiable)

Per [`CLAUDE.md`](../CLAUDE.md) §Localization: **every new user-facing
string must go through the i18n layer.** That applies even to the
HUD canvas (which the lint can't see) and to error messages.

**New strings introduced by Phase 1 / Phase 2:**

| String slot | Suggested key | Notes |
|---|---|---|
| HUD "✕ Exit" button label | `vr.hud.exit` | New canvas-drawn text. |
| HUD "✕ Exit" aria-label | `vr.hud.exit.aria` | Used by HUD's accessibility surface. |
| Zoom-slider title / tooltip | `vr.zoomSlider.title` | DOM slider — lint-scanned. |
| Zoom-slider aria-label | `vr.zoomSlider.aria` | DOM slider — lint-scanned. |
| Button-tooltip refresh (e.g. "Enter AR (place globe in your room)") | `vr.button.ar.title.handheld` | Reword for phone-AR — see §Open questions below. |

**Process for each PR that adds a string:**

1. Add the key to `locales/en.json` (sorted; `npm run locales` will
   canonicalize).
2. Read via `t('vr.hud.exit')` from `src/i18n/index.ts`.
3. Run `npm run locales` so the codegen rebuilds the `MessageKey`
   union — any unresolved key fails type-check.
4. If the string has placeholders / preserve-as-literal semantics,
   add a one-liner to `locales/_explanations.json` (auto-syncs to
   Weblate).
5. Confirm `npm run type-check` passes (`check:i18n-strings` is in
   that chain).

**Lint-scope follow-up (do this in PR 1, not later).** The
`check-i18n-strings.ts` script currently scans `src/ui/` and
`src/services/docent*.ts` only. The HUD canvas
([`src/services/vrHud.ts`](../src/services/vrHud.ts)) and any new
`src/services/vr*.ts` aren't covered, so a developer can still
slip a literal through. Extend the lint config to add
`src/services/vr*.ts` to the scan roots **and** widen the
heuristic to also catch `ctx.fillText('...')` patterns (HUD text
is drawn via Canvas 2D, not DOM properties). One commit, ~30 LOC
plus an updated test fixture.

**Coverage gate.** A separate CI check enforces ≥80% translation
coverage on the language picker (see commit `75fb44d`). Adding
five new English keys without translations could drop a marginal
locale below that threshold and fail CI. Weblate auto-PRs once
keys are pushed, but the merge order matters: don't ship the
TypeScript that *uses* the new keys until at least the source
en.json + an explanations entry have been pushed, so translators
have a turn to fill in before the gate trips.

**RTL safety.** The new zoom-slider overlay uses
`inset-inline-end` / `padding-inline-*` rather than `right` /
`padding-left`. See [`CLAUDE.md`](../CLAUDE.md) §Localization §CSS.
The HUD canvas isn't affected — it's not in the DOM flow.

## Success criteria

A phase isn't "done" because the PR merged. Each phase has one
hands-on criterion a reviewer can hold the work to:

- **Phase 1 (Android phone AR).** A team member can hand a phone to
  a stranger, they tap Enter AR, place the globe, drag-rotate,
  zoom in, and exit — without verbal instruction. The HUD and zoom
  affordances are self-explanatory or the phase isn't done.
- **Phase 2 (hand-tracking / transient-pointer).** Same criterion
  on Vision Pro (or Quest hand-mode if Vision Pro hardware isn't
  available). Pinch-to-select on the HUD, pinch-drag rotates the
  globe, zoom slider works.
- **Phase 3 (PCVR).** A Quest user couldn't tell the difference
  between PCVR and standalone Quest behaviour during the rotate /
  zoom / place flow. Any rough edges captured in the device matrix.
- **Phase 4 (polish).** No fixed criterion — each polish item ships
  on its own merits.

## Testing

Unit tests cover the code-shaped parts; the WebXR session lifecycle
itself isn't unit-testable and falls to the on-device spike below.

**Unit tests (Phase 1 PR 1):**

- `getInputArchetype(session)` against mocked `XRSession.inputSources`
  shapes: empty array (idle), one source with `targetRayMode='screen'`,
  one with `'transient-pointer'`, two with `'tracked-pointer'`, mixed
  cases. Lives alongside [`vrCapability.test.ts`](../src/utils/vrCapability.test.ts)
  if present, otherwise a new file.
- Zoom-overlay slider → `globe.scale` mapping in isolation: input
  value 0 maps to `MIN_GLOBE_SCALE`, value 1 to `MAX_GLOBE_SCALE`,
  with whatever curve we settle on (linear or log). No XR session
  needed.

**Phase 1 on-device spike (precondition for PR 2):**

The spike has exactly one go/no-go question: *does select-drag on
a phone feel like grabbing the globe, or does it feel disconnected?*

- Output: short screen capture + a one-line yes/no.
- Yes → PR 2 scope holds (zoom slider, HUD exit, ~200 LOC).
- No → PR 2 grows by a touch-pan gesture state machine on the DOM
  overlay rather than relying on the WebXR `select`-drag pose. Re-
  estimate the PR scope before opening it.
- Anything else (zoom feel, exit-button placement) is recoverable
  in code review and not part of the spike's go/no-go.

**On-device verification (per phase):**

- Phase 1: Pixel 7/8 + Samsung Galaxy S22+, Chrome stable.
- Phase 2: Vision Pro + Quest 3 hand-mode. HoloLens 2 if available.
- Phase 3: Index or Vive via SteamVR + Chrome / Edge.
- Every phase: regress-check on Quest 3 standalone — controller flow,
  zoom overlay never mounts, HUD exit button hidden.
- **Tour interactions on phone-AR (Phase 1).** The tour overlay
  (`vrTourOverlay`), tour controls strip (`vrTourControls`), and
  question-answer flow all funnel through the same `pickHit` /
  `onSelectStart` / `onSelectEnd` machinery as the HUD. They
  *should* work unchanged on screen-tap input — same confidence
  level as HUD taps — but I haven't independently traced each
  call site, so it goes on the spike checklist: load a tour with a
  question prompt, confirm answer selection registers from a phone
  tap. If it doesn't, the fix is the same shape as anything else
  going through `pickHit`, so no separate plan slice needed.

**Bundle-size guard (every phase):**

`npm run build` after each PR and confirm:

1. The non-VR main chunk byte size is unchanged within tolerance.
2. The lazy VR chunk has grown by the expected amount (proves new
   code landed in the right place and isn't being pulled in by the
   main entry).

## Bundle and performance impact

- **No Three.js bundle delta.** All new code lives inside the
  already-lazy VR chunk.
- **New DOM overlay (`vrZoomOverlay`).** ~80 LOC of vanilla TS plus
  a small CSS block. Mounted only when entering a screen / transient
  session; torn down on exit. Zero impact on the 2D app or
  controller-class sessions.
- **HUD canvas redraw.** Adding the "✕ Exit" element bumps the HUD
  canvas redraw work slightly. The canvas already redraws on dataset
  / playback state change; one extra hit-region check per frame is
  immaterial.

## Risks and tradeoffs

1. **Vision Pro testing access.** Without a physical device or a
   cloud-test rig, Phase 2 ships "should work, partly verified."
   Friends with Vision Pros plus a session recording would be
   enough; alternatively, gate the Phase 2 branch on a feature flag
   and roll out behind it.

2. **`local-floor` fallback may shift the default pose.** Some
   browsers grant `local` but place the user at origin facing -Z
   with no floor offset. The retry path needs to set the globe's
   default-pose Y to roughly eye level (1.5–1.7 m) rather than
   floor-relative. Easy, but easy to get wrong and ship with the
   globe floating at the user's knees.

3. **Touch zoom slider vs. native pinch.** A DOM slider is the
   smallest change and the most discoverable affordance. Native
   pinch-to-zoom through pointer events on the WebXR canvas is
   nicer but tangles with the WebXR session's input event delivery
   — pointer events do still fire to the underlying DOM during an
   AR session on Chrome, but the behavior isn't fully spec'd. A
   slider is the safe choice for v1; native pinch is a Phase 4
   nice-to-have.

4. **Anchors on non-Quest AR.** Persistent placement won't survive
   sessions on Vision Pro, HoloLens, or current ARCore Chrome. The
   current code degrades silently. Worth a one-line user-facing
   note in the Place button tooltip on non-Quest devices, but not
   blocking.

5. **The friend's fork — promoted to precondition.** Whatever
   change they made to enable Android is the closest thing to
   empirical evidence we have for Phase 1's load-bearing claim
   ("the existing code path already works for screen-tap"). Get
   their diff (or at minimum a video and a description of what
   they changed) **before opening PR 1**. If their fork uses a
   meaningfully different approach to ours — e.g. they
   disabled hit-test, or removed the Place button entirely, or
   touched `requiredFeatures` — that should reshape Phase 1's
   scope, not be discovered mid-PR. Cost of asking is low; cost of
   re-doing PR 1 around an incompatible assumption is much higher.

## Open questions

- Should we attempt to detect "this is handheld AR" *before*
  session start to swap the button label from "Enter AR" to "View
  in your room" — friendlier on phones, possibly confusing on
  headsets that also support AR. Probably yes for phones, but
  needs a way to distinguish that's more reliable than UA sniffing.
- Vision Pro's `transient-pointer` ray is gaze-aligned, not
  hand-aligned. Does that change the surface-pinned rotate-drag
  feel enough to need a separate tuning constant for
  `ROTATION_SENSITIVITY`?
- Persistent placement on Vision Pro will eventually be possible
  via the Apple-specific anchor extensions Safari is rumored to
  add. Worth watching the spec; no work to do today.

## Rollout cadence

The existing AR/VR button auto-appears on any device that passes
`isImmersiveArSupported` / `isImmersiveVrSupported`. That means
once PR 2 ships, every ARCore Android user on the next page load
sees "Enter AR" with no soft-launch buffer. Given the unverified
drag-feel risk (see Testing §spike), that's more confidence than
the verification level warrants.

**Proposed rollout for the user-visible phone-AR PR (PR 2):**

1. **Default off.** Add a `flags.vrPhoneArEnabled` boolean (default
   `false`) in `localStorage` under the existing `sos-docent-config`
   pattern, surfaced in **Tools → Privacy / Experimental** (next to
   the existing telemetry tier picker). When false, `vrButton`
   treats `inputClass === 'screen'` as unsupported and hides the
   button — exactly the pre-Phase-1 behaviour.
2. **Opt-in for testers and dogfooders.** Anyone who flips the
   toggle sees Enter AR on their phone immediately. Telemetry's
   `device_class === 'android-ar'` then tells us how often they
   actually use it, with a sample size we control.
3. **Default-on flip lands as a separate one-line PR** after the
   spike has come back positive *and* at least two team members
   have used the feature on different phone models for a non-toy
   workload (look at a real dataset, place + walk around, exit
   cleanly, re-enter).
4. **Quest is never gated by this flag.** Controller-class devices
   keep the existing default-on behaviour. The flag only affects
   `inputClass !== 'controller'`.

Same pattern applies in Phase 2 for `vrTransientInputEnabled` (or
collapse to one flag — `vrExperimentalDevicesEnabled` — if that
reads simpler to users).

Vision Pro deserves its own thought here: by the time Phase 2
lands the device might already have an installed base, in which
case soft-launching feels overcautious. Revisit when Phase 2 is
scoped, not now.

## Implementation order

Recommended PR sequence, each independently shippable behind the
existing AR/VR button:

1. **PR 1 — Phase 1 scaffolding:** `getInputArchetype` helper +
   unit tests, `inputClass` plumbed through `vrSession`,
   `device_class` enum extension. Includes the analytics
   contributing checklist work end-to-end — row in
   [`ANALYTICS.md`](ANALYTICS.md), positional layout in
   [`ANALYTICS_QUERIES.md`](ANALYTICS_QUERIES.md), Grafana panel —
   so we can verify in production that non-Quest sessions are
   actually showing up before the user-visible PR lands. No
   user-visible change. ~80 LOC of TS + the docs.
2. **PR 2 — Phase 1 phone-AR UX:** zoom overlay, HUD exit button,
   gating. **Precondition: the one-day on-device spike described
   in Testing has come back with a go.** If no-go, re-estimate
   scope before opening this PR. |
3. **PR 3 — `local-floor` → `local` fallback:** session features,
   default `GLOBE_POSITION`, anchor ref-space. Held back from
   PR 2 because it touches three independent things and the
   primary phone-AR target doesn't need it.
4. **PR 4 — Phase 2 hand-tracking widening:** widen the
   `inputClass !== 'controller'` gate to cover transient-pointer,
   suppress two-hand pinch when transient. Vision Pro / HoloLens /
   hand-mode Quest. Pairs with a Vision Pro test pass.
5. **PR 5 — Phase 3 PCVR verification:** any axis-mapping
   generalization that falls out of testing. Likely small.
6. **PR 6 — Documentation pass:** update
   [`VR_INVESTIGATION_PLAN.md`](VR_INVESTIGATION_PLAN.md) status
   header, the device matrix in this doc, and
   [`ANALYTICS.md`](ANALYTICS.md) `device_class` enum.

Each PR keeps the Quest experience identical (verified by the
existing VR tests + a manual Quest pass) and adds one device
class to the supported set.
