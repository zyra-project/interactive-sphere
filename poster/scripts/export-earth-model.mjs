#!/usr/bin/env node
// Apache-2.0
//
// Export the §8 "Tap to place Earth on your desk" model.
//
// Generates `poster/assets/xr/models/terraviz-earth.glb` from the
// Blue Marble diffuse texture hosted on the SOS CDN — the same one
// `src/services/photorealEarth.ts` loads at the 2048 tier. Output
// is a single GLB containing one textured-sphere mesh: ~3 MB.
//
// The USDZ counterpart is produced from the GLB with Apple's
// `usdzconvert` (from `usdpython`); see
// `poster/assets/xr/models/README.md` for the conversion step.
// We don't run it from this script because `usdzconvert` requires
// a Python toolchain we don't want as a poster dev dependency.
//
// Usage (run locally — the sandbox doesn't have outbound network
// to the SOS CDN):
//
//     node poster/scripts/export-earth-model.mjs
//
// Re-run when the upstream Blue Marble texture changes (rare —
// NASA updates Blue Marble approximately once per decade). Commit
// the regenerated GLB alongside any source changes that motivated
// the re-export.
//
// Stdlib only. No external Node deps; no Three.js — manual glTF
// construction is ~150 lines and avoids dragging the renderer into
// the poster's tooling surface.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// --- Configuration ----------------------------------------------------------

const TEXTURE_URL =
  'https://d3sik7mbbzunjo.cloudfront.net/terraviz/basemaps/earth_diffuse_2048.jpg'

// Trim 2 from the model-export design doc:
//   - 2048×1024 diffuse (Blue Marble), no specular, no clouds, no night
//     lights. Static lighting only — glTF can't carry runtime shaders.
const SPHERE_RADIUS = 0.5
const SPHERE_LONGITUDE_SEGMENTS = 64 // ring count
const SPHERE_LATITUDE_SEGMENTS = 32 // segments per ring (north→south)

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const OUT_GLB = resolve(REPO_ROOT, 'poster/assets/xr/models/terraviz-earth.glb')

// --- Sphere geometry --------------------------------------------------------

/**
 * Build a UV-sphere centered at the origin. Returns Float32 arrays
 * for positions / normals / texcoords and a Uint16 array for
 * triangle indices.
 *
 * Convention: latitude runs north→south (theta 0→π); longitude
 * runs west→east (phi 0→2π). UV.u maps to longitude (0 at the
 * antimeridian), UV.v maps to latitude (0 at the north pole, 1 at
 * the south pole) — matches glTF's image-origin convention where
 * texcoord (0,0) is the upper-left corner of the texture, and an
 * equirectangular Earth texture has the Arctic at top.
 */
function buildSphere() {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []

  // Vertices.
  for (let lat = 0; lat <= SPHERE_LATITUDE_SEGMENTS; lat++) {
    const theta = (lat * Math.PI) / SPHERE_LATITUDE_SEGMENTS
    const sinTheta = Math.sin(theta)
    const cosTheta = Math.cos(theta)

    for (let lon = 0; lon <= SPHERE_LONGITUDE_SEGMENTS; lon++) {
      const phi = (lon * 2 * Math.PI) / SPHERE_LONGITUDE_SEGMENTS
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      const x = cosPhi * sinTheta
      const y = cosTheta
      const z = sinPhi * sinTheta

      positions.push(SPHERE_RADIUS * x, SPHERE_RADIUS * y, SPHERE_RADIUS * z)
      normals.push(x, y, z)
      uvs.push(lon / SPHERE_LONGITUDE_SEGMENTS, lat / SPHERE_LATITUDE_SEGMENTS)
    }
  }

  // Indices — two triangles per quad.
  const ringSize = SPHERE_LONGITUDE_SEGMENTS + 1
  for (let lat = 0; lat < SPHERE_LATITUDE_SEGMENTS; lat++) {
    for (let lon = 0; lon < SPHERE_LONGITUDE_SEGMENTS; lon++) {
      const a = lat * ringSize + lon
      const b = a + ringSize
      const c = a + 1
      const d = b + 1
      indices.push(a, b, c, c, b, d)
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  }
}

// --- Binary chunk packing ---------------------------------------------------

function alignTo4(n) {
  return (n + 3) & ~3
}

function concatBuffers(buffers, padTo4 = true) {
  let total = 0
  for (const b of buffers) total += padTo4 ? alignTo4(b.byteLength) : b.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const b of buffers) {
    out.set(new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength), offset)
    offset += padTo4 ? alignTo4(b.byteLength) : b.byteLength
  }
  return out
}

// --- glTF JSON --------------------------------------------------------------

/**
 * Compute the glTF accessor `min`/`max` arrays for a Float32 buffer
 * laid out as N × 3 vec3s. Required by the spec for POSITION
 * accessors so consumers can build a bounding box without scanning
 * the buffer themselves.
 */
function vec3MinMax(arr) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < arr.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = arr[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  return { min, max }
}

function buildGltf({ positions, normals, uvs, indices, textureBytes }) {
  const posBytes = positions.byteLength
  const normBytes = normals.byteLength
  const uvBytes = uvs.byteLength
  const idxBytes = indices.byteLength
  const texBytes = textureBytes.byteLength

  // Buffer view offsets. Each is aligned to 4-byte boundaries to
  // satisfy the glTF spec's component-type alignment rules.
  const posOffset = 0
  const normOffset = alignTo4(posOffset + posBytes)
  const uvOffset = alignTo4(normOffset + normBytes)
  const idxOffset = alignTo4(uvOffset + uvBytes)
  const texOffset = alignTo4(idxOffset + idxBytes)
  const totalBinSize = alignTo4(texOffset + texBytes)

  const { min: posMin, max: posMax } = vec3MinMax(positions)

  return {
    asset: {
      version: '2.0',
      generator: 'TerraViz poster export-earth-model.mjs',
    },
    scene: 0,
    scenes: [{ nodes: [0], name: 'Scene' }],
    nodes: [{ mesh: 0, name: 'Earth' }],
    meshes: [
      {
        name: 'Earth',
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: 'EarthDiffuse',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0, texCoord: 0 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        doubleSided: false,
      },
    ],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ bufferView: 4, mimeType: 'image/jpeg' }],
    samplers: [
      {
        magFilter: 9729, // LINEAR
        minFilter: 9987, // LINEAR_MIPMAP_LINEAR
        wrapS: 10497, // REPEAT
        wrapT: 33071, // CLAMP_TO_EDGE — avoid pole seam wraparound
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: positions.length / 3,
        type: 'VEC3',
        min: posMin,
        max: posMax,
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126,
        count: normals.length / 3,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        byteOffset: 0,
        componentType: 5126,
        count: uvs.length / 2,
        type: 'VEC2',
      },
      {
        bufferView: 3,
        byteOffset: 0,
        componentType: 5123, // UNSIGNED_SHORT
        count: indices.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: posOffset, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: normOffset, byteLength: normBytes, target: 34962 },
      { buffer: 0, byteOffset: uvOffset, byteLength: uvBytes, target: 34962 },
      { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes, target: 34963 },
      { buffer: 0, byteOffset: texOffset, byteLength: texBytes },
    ],
    buffers: [{ byteLength: totalBinSize }],
    _binSize: totalBinSize,
    _layout: { posOffset, normOffset, uvOffset, idxOffset, texOffset },
  }
}

// --- GLB packaging ----------------------------------------------------------

/**
 * Pack a glTF JSON + binary buffer into a single GLB binary file.
 * Spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#binary-gltf-layout
 *
 * Layout:
 *   header      (12 bytes)  magic "glTF" + version 2 + total length
 *   JSON chunk  (8 + N)     length, type "JSON", JSON bytes (ASCII-padded to 4)
 *   BIN chunk   (8 + M)     length, type "BIN\0", binary bytes (zero-padded to 4)
 */
function packGlb(gltf, binChunk) {
  // Drop our private layout fields before serialisation.
  const { _binSize, _layout, ...gltfPublic } = gltf
  void _binSize
  void _layout
  const jsonText = JSON.stringify(gltfPublic)
  const jsonBytes = new TextEncoder().encode(jsonText)
  const jsonChunkBody = new Uint8Array(alignTo4(jsonBytes.byteLength))
  jsonChunkBody.set(jsonBytes, 0)
  // Pad with ASCII space (per spec) — not zero — so consumers that
  // accidentally read trailing bytes get a parse error rather than
  // a NUL embedded in JSON.
  for (let i = jsonBytes.byteLength; i < jsonChunkBody.byteLength; i++) {
    jsonChunkBody[i] = 0x20
  }
  const binChunkBody = new Uint8Array(alignTo4(binChunk.byteLength))
  binChunkBody.set(binChunk, 0)

  const total = 12 + 8 + jsonChunkBody.byteLength + 8 + binChunkBody.byteLength
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)

  // Header.
  out.set(new TextEncoder().encode('glTF'), 0)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, total, true)

  // JSON chunk.
  dv.setUint32(12, jsonChunkBody.byteLength, true)
  out.set(new TextEncoder().encode('JSON'), 16)
  out.set(jsonChunkBody, 20)

  // BIN chunk.
  const binChunkStart = 20 + jsonChunkBody.byteLength
  dv.setUint32(binChunkStart, binChunkBody.byteLength, true)
  out.set(new TextEncoder().encode('BIN\0'), binChunkStart + 4)
  out.set(binChunkBody, binChunkStart + 8)

  return out
}

// --- Main -------------------------------------------------------------------

console.log(`[export-earth-model] Fetching ${TEXTURE_URL}`)
const res = await fetch(TEXTURE_URL)
if (!res.ok) {
  console.error(
    `[export-earth-model] Texture fetch failed: ${res.status} ${res.statusText}`,
  )
  console.error(
    "[export-earth-model] Run this from a network with outbound HTTPS to the SOS CDN — sandboxed environments without permissioned egress (CI runners with restricted network policies, dev containers behind strict proxies) typically fail with 403.",
  )
  process.exit(1)
}
const textureBytes = new Uint8Array(await res.arrayBuffer())
console.log(`[export-earth-model]   ${textureBytes.byteLength} bytes`)

console.log('[export-earth-model] Building sphere geometry')
const geometry = buildSphere()
console.log(
  `[export-earth-model]   ${geometry.positions.length / 3} vertices, ${geometry.indices.length / 3} triangles`,
)

console.log('[export-earth-model] Assembling glTF + binary chunk')
const gltf = buildGltf({ ...geometry, textureBytes })
const binChunk = new Uint8Array(gltf._binSize)
binChunk.set(new Uint8Array(geometry.positions.buffer), gltf._layout.posOffset)
binChunk.set(new Uint8Array(geometry.normals.buffer), gltf._layout.normOffset)
binChunk.set(new Uint8Array(geometry.uvs.buffer), gltf._layout.uvOffset)
binChunk.set(new Uint8Array(geometry.indices.buffer), gltf._layout.idxOffset)
binChunk.set(textureBytes, gltf._layout.texOffset)

console.log('[export-earth-model] Packing GLB')
const glb = packGlb(gltf, binChunk)

mkdirSync(dirname(OUT_GLB), { recursive: true })
writeFileSync(OUT_GLB, glb)
console.log(
  `[export-earth-model] Wrote ${relative(REPO_ROOT, OUT_GLB)} (${glb.byteLength} bytes)`,
)
console.log(
  '[export-earth-model] Convert to USDZ next: see poster/assets/xr/models/README.md',
)
