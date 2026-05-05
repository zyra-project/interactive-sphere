# §8 phone-AR Earth model — export pipeline

This directory holds the static 3D Earth model the §8 immersive
section serves to phone visitors via Google's `<model-viewer>`
web component:

| File | Used by | Source |
|---|---|---|
| `terraviz-earth.glb` | Android Scene Viewer + desktop preview | `poster/scripts/export-earth-model.mjs` |
| `terraviz-earth.usdz` | iOS AR Quick Look | `poster/scripts/export-earth-model.mjs` (same run) |

Both files come out of a single `node` invocation, share the same
canonical sphere geometry, and reuse the same Blue Marble texture
bytes — so they can't drift apart. Neither is checked in until the
export has been run; the `<model-viewer>` tile in
`sec-08-immersive.html` shows an "asset export pending" poster
until both files are present. This README is the **how to produce
them** half — run it locally; the sandbox CI environment doesn't
have outbound network to the SOS CDN.

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

## Step 1 — export both binaries

```sh
node poster/scripts/export-earth-model.mjs
```

Writes `terraviz-earth.glb` (~700 KB) and `terraviz-earth.usdz`
(~880 KB) here in a single run. Stdlib only — no external Node
deps, no Apple toolchain, no Blender.

The script fetches the diffuse texture from
`https://d3sik7mbbzunjo.cloudfront.net/terraviz/basemaps/earth_diffuse_2048.jpg`
— the same texture `photorealEarth.ts` loads at the 2048 tier —
and embeds it into both outputs. The GLB carries it as a binary
chunk; the USDZ packages a USDA (text USD) document plus the JPEG
in a STORED-only zip with 64-byte-aligned data offsets, which is
what Apple AR Quick Look requires.

If the fetch fails with a 403, you're on a network without egress
to the SOS CDN. Run from a normal developer machine.

The USDZ uses a `UsdPreviewSurface` material with a single
`UsdUVTexture` — the AR Quick Look-canonical material network.
The same UV array drives both outputs, so the texture orientation
is consistent across all three viewers.

## Step 2 — verify on real devices

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

A note on the iOS V-flip: AR Quick Look's `UsdUVTexture` samples
with V=0 at the bottom of the texture (OpenGL convention), not
V=0 at the top (glTF / image convention). To keep the same UV
array driving both outputs, `buildUsda()` inserts a
`UsdTransform2d` shader between the primvar reader and the
texture sampler with `scale = (1, -1)` and `translation = (0, 1)`,
which flips V at sample time. If a future iOS version changes
its sampling convention and the Earth starts rendering
upside-down again, removing those two lines flips it back.

## Step 3 — commit the binaries

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

Combined size: ~1.6 MB, one-time cost. Re-export only when
the upstream Blue Marble texture changes — NASA refreshes
Blue Marble approximately once per decade, so this should
not be a recurring expense.

## Why not a CI job

Tempting, but adds infrastructure for a one-time-ish task. The
script is now stdlib-only Node, so a Linux GitHub runner could
run it — the previous Apple-toolchain blocker is gone. The
remaining reason is cadence: a re-export per decade isn't worth
the workflow file. If Blue Marble ever starts refreshing more
often, this is a small lift.
