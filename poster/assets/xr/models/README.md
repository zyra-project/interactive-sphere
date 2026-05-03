# §8 phone-AR Earth model — export pipeline

This directory holds the static 3D Earth model the §8 immersive
section serves to phone visitors via Google's `<model-viewer>`
web component:

| File | Used by | Source |
|---|---|---|
| `terraviz-earth.glb` | Android Scene Viewer + desktop preview | `poster/scripts/export-earth-model.mjs` |
| `terraviz-earth.usdz` | iOS AR Quick Look | converted from the GLB (see below) |

Neither is checked in until the export has been run; the
`<model-viewer>` tile in `sec-08-immersive.html` shows an
"asset export pending" poster until both files are present.
This README is the **how to produce them** half — run it
locally; the sandbox CI environment doesn't have outbound
network to the SOS CDN.

## What this model is — and isn't

The export bakes only what glTF / USDZ can carry: a sphere
with the Blue Marble equirectangular diffuse texture (Trim 2
from the design review). It is **not** the full photoreal
Earth that `src/services/photorealEarth.ts` renders in the
SPA. Custom shaders don't survive the conversion; in
particular the model loses:

- Day/night blending gated on real UTC sun position
- Specular sun glint
- Atmosphere ring
- Animated clouds
- Dynamic shadow

Visitors get a static Earth they can place on a desk — not
the live globe with controllers and datasets. The §8 copy
frames it accordingly.

## Step 1 — export the GLB

```sh
node poster/scripts/export-earth-model.mjs
```

Writes `terraviz-earth.glb` (~3 MB) here. Stdlib only — no
external Node deps.

The script fetches the diffuse texture from
`https://d3sik7mbbzunjo.cloudfront.net/terraviz/basemaps/earth_diffuse_2048.jpg`
— the same texture `photorealEarth.ts` loads at the 2048
tier — and embeds it inside a single textured-sphere mesh.

If the fetch fails with a 403, you're on a network without
egress to the SOS CDN. Run from a normal developer machine.

## Step 2 — convert to USDZ for iOS AR Quick Look

Apple's `usdzconvert` is the canonical tool. Install once
via the [`usdpython` toolkit](https://developer.apple.com/augmented-reality/tools/)
(macOS download from Apple) and run:

```sh
cd poster/assets/xr/models
usdzconvert terraviz-earth.glb terraviz-earth.usdz
```

Writes `terraviz-earth.usdz` (~4 MB) alongside the GLB.

### Alternative converters

If `usdpython` is awkward to install on your machine, these
also produce iOS-compatible USDZ:

- **Reality Composer** (macOS, GUI) — open the GLB, export
  as USDZ.
- **Reality Composer Pro** (macOS, GUI) — same idea, newer.
- **`gltf2usdz`** Node CLI — GitHub-installed, MIT-licensed.
  YMMV; verify on a real iPhone before merging.

Whatever tool you use, the resulting USDZ must:

- Embed the diffuse texture (not reference an external URL —
  AR Quick Look on iOS won't follow cross-origin asset
  fetches reliably).
- Use a `UsdPreviewSurface` material — Reality Composer's
  default. Other material networks render but lose the
  texture in some iOS versions.
- Pass the
  [Apple AR Quick Look validator](https://developer.apple.com/augmented-reality/tools/)
  if you want to be belt-and-suspenders about it.

## Step 3 — verify on real devices

Before committing the binaries, check both targets:

- **iPhone (any model running iOS 12+):** open the poster's
  preview URL, scroll to §8, tap the AR icon. The phone
  should switch into AR Quick Look and let you place the
  Earth on a real surface. Walk around it.
- **Pixel / recent Samsung (any ARCore-capable Android):**
  same — tap the AR icon, get Scene Viewer, place the Earth.
- **Desktop browser:** the model rotates inline at the §8
  scroll point. Drag to spin. The AR icon should be hidden
  (no AR available).

If iOS launches AR Quick Look but the Earth shows up
untextured grey, the USDZ material wasn't preserved — try
a different converter from the alternatives list.

## Step 4 — commit the binaries

```sh
git add poster/assets/xr/models/terraviz-earth.glb
git add poster/assets/xr/models/terraviz-earth.usdz
git commit -s -m "poster(P12.5): export Earth model for §8 phone-AR tile"
git push
```

Both binaries go into regular git pack storage —
**not Git LFS**. The repo's `.gitattributes` only puts
`*.jpg` / `*.png` / `*.mp4` etc. through LFS; `*.glb`
and `*.usdz` are deliberately excluded so a re-export
doesn't eat the project's free-tier LFS bandwidth quota.

Combined size: ~7 MB, one-time cost. Re-export only when
the upstream Blue Marble texture changes — NASA refreshes
Blue Marble approximately once per decade, so this should
not be a recurring expense.

## Why not a CI job

Tempting, but adds infrastructure for a one-time-ish task:

- Cross-platform `usdzconvert` requires macOS for canonical
  output. Linux / Windows GitHub runners can't run Apple's
  toolchain natively.
- Either of those constraints alone makes the CI job
  bigger than the manual procedure. We'd be optimising for
  a re-export cadence we don't expect.

If we ever add monthly Earth refreshes for some reason, the
CI option is worth revisiting.
