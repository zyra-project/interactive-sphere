/**
 * Atmospheric scattering constants and GLSL snippets, shared between
 * the boot Earth (MapLibre custom layer in `earthTileLayer.ts`) and
 * the VR/AR + Orbit Earth (Three.js in `photorealEarth.ts`).
 *
 * Single source of truth so the two renderers can produce the same
 * sky colour at the same sun elevation. Visual tuning happens here,
 * not in either consumer.
 *
 * The GLSL snippets are designed to be portable across both
 * renderers' shader dialects:
 *   - MapLibre passes use raw `#version 300 es` (GLSL 3.00 ES).
 *   - Three.js `ShaderMaterial` defaults to GLSL 1.00 — what
 *     `photorealEarth.ts` uses today.
 * Pure utility functions only — no varyings / in-out qualifiers,
 * no texture samplers, no version-specific built-ins. Each consumer
 * supplies its own vertex/fragment plumbing around these helpers.
 *
 * Reference: Maxime Heckel, "On Rendering the Sky, Sunsets, and
 * Planets", https://blog.maximeheckel.com/posts/on-rendering-the-sky-sunsets-and-planets/
 */

// ── Geometry ───────────────────────────────────────────────────────
//
// All length-like constants are in **kilometres**, matching the
// article's convention. Raymarch step sizes derived from these will
// also be in km, which keeps the scattering coefficients (also
// per-km) dimensionally consistent. Callers working in metres (e.g.
// Three.js world units that map to metres) can pass `radius * 1e3`.

/** Earth radius, km. */
export const PLANET_RADIUS_KM = 6371.0

/** Atmosphere thickness above sea level, km. ~Kármán line. */
export const ATMOSPHERE_HEIGHT_KM = 100.0

export const ATMOSPHERE_RADIUS_KM = PLANET_RADIUS_KM + ATMOSPHERE_HEIGHT_KM

/**
 * Atmosphere shell radius as a multiple of the planet's geometric
 * radius. Derived from `ATMOSPHERE_HEIGHT_KM / PLANET_RADIUS_KM` so
 * the shell mesh exactly bounds the atmosphere the raymarch
 * integrates over — no gap between the visible shell edge and the
 * ray-sphere `ATMOSPHERE_RADIUS` used inside the shader.
 *
 * Tier-1 used 1.012 for cosmetic reasons; Tier-2 needs the geometric
 * shell and the analytic atmosphere boundary to agree so the
 * front-face fragment IS the camera-side atmosphere entry point.
 */
export const ATMOSPHERE_RADIUS_FACTOR = ATMOSPHERE_RADIUS_KM / PLANET_RADIUS_KM

// ── Rayleigh ───────────────────────────────────────────────────────

/**
 * Rayleigh scattering coefficient, per km, RGB. Standard atmospheric-
 * optics values (Bucholtz 1995); match the article's
 * `vec3(0.0058, 0.0135, 0.0331)`. Blue scatters most → daytime sky
 * is blue.
 */
export const RAYLEIGH_BETA: readonly [number, number, number] = [0.0058, 0.0135, 0.0331]

/** Scale height of air molecules, km. */
export const RAYLEIGH_SCALE_HEIGHT_KM = 8.0

// ── Mie ────────────────────────────────────────────────────────────

/**
 * Mie scattering coefficient, per km. Aerosols are larger than air
 * molecules, so the wavelength dependence is weak — using a flat
 * grey value matches the article (`vec3(0.003)`).
 */
export const MIE_BETA_SCATTER: readonly [number, number, number] = [0.003, 0.003, 0.003]

/**
 * Mie extinction = scattering + absorption. Slightly larger than the
 * pure scattering term to model the small amount of light aerosols
 * absorb in addition to redirecting. The article notes that this
 * "makes far-away parts of the atmosphere appear hazier".
 */
export const MIE_BETA_EXT: readonly [number, number, number] = [0.0033, 0.0033, 0.0033]

/**
 * Aerosol scale height, km. Much smaller than Rayleigh — aerosols
 * concentrate near the surface, which is why haze sits at the
 * horizon.
 */
export const MIE_SCALE_HEIGHT_KM = 1.2

/**
 * Cornette-Shanks / Henyey-Greenstein asymmetry parameter, range
 * [0, 1]. 0 = isotropic, 1 = perfectly forward-scattering. ~0.76 is
 * typical for Earth aerosols and is what produces the bright haze
 * around the sun.
 */
export const MIE_G = 0.76

// ── Ozone ──────────────────────────────────────────────────────────

/**
 * Ozone absorption coefficient, per km, RGB. Chappuis-band absorption
 * peaks in green/yellow — this is what produces the purple/blue
 * ribbon at twilight after the warm sunset band has dimmed. Matches
 * the article's `vec3(0.00065, 0.00188, 0.00008)`.
 */
export const OZONE_BETA_ABS: readonly [number, number, number] = [0.00065, 0.00188, 0.00008]

/** Centre altitude of the ozone layer, km — stratospheric peak. */
export const OZONE_CENTER_HEIGHT_KM = 25.0

/** Half-width of the ozone density tent, km. */
export const OZONE_WIDTH_KM = 15.0

// ── Lighting ───────────────────────────────────────────────────────

/**
 * Direct-sun intensity multiplier applied to accumulated scattering.
 * Tuned so the noon-zenith sky reads as believable blue after ACES
 * tonemap. Re-tune if the tonemap or coefficients change.
 */
export const SUN_INTENSITY = 20.0

// ── Raymarch ───────────────────────────────────────────────────────

/** Default primary (view-ray) raymarch step count for Tier 2. */
export const PRIMARY_STEPS = 16

/** Default secondary (light-ray) raymarch step count for Tier 2. */
export const LIGHTMARCH_STEPS = 8

// ── GLSL ───────────────────────────────────────────────────────────
//
// Snippets are exported as template-literal strings, interpolated
// into shader sources the same way `earthTileLayer.ts` already
// interpolates `${NIGHT_DARKENING.toFixed(4)}` etc. The `/* glsl */`
// marker is a hint for editor syntax highlighters; it has no runtime
// effect.

/** GLSL `const` block. Inject ONCE near the top of a fragment shader. */
export const ATMOSPHERE_GLSL_CONSTANTS = /* glsl */ `
  const float PI = 3.14159265358979;
  const float PLANET_RADIUS = ${PLANET_RADIUS_KM.toFixed(1)};
  const float ATMOSPHERE_HEIGHT = ${ATMOSPHERE_HEIGHT_KM.toFixed(1)};
  const float ATMOSPHERE_RADIUS = ${ATMOSPHERE_RADIUS_KM.toFixed(1)};

  const vec3 RAYLEIGH_BETA = vec3(${RAYLEIGH_BETA.map(v => v.toFixed(6)).join(', ')});
  const float RAYLEIGH_SCALE_HEIGHT = ${RAYLEIGH_SCALE_HEIGHT_KM.toFixed(1)};

  const vec3 MIE_BETA_SCATTER = vec3(${MIE_BETA_SCATTER.map(v => v.toFixed(6)).join(', ')});
  const vec3 MIE_BETA_EXT = vec3(${MIE_BETA_EXT.map(v => v.toFixed(6)).join(', ')});
  const float MIE_SCALE_HEIGHT = ${MIE_SCALE_HEIGHT_KM.toFixed(1)};
  const float MIE_G = ${MIE_G.toFixed(2)};

  const vec3 OZONE_BETA_ABS = vec3(${OZONE_BETA_ABS.map(v => v.toFixed(6)).join(', ')});
  const float OZONE_CENTER_HEIGHT = ${OZONE_CENTER_HEIGHT_KM.toFixed(1)};
  const float OZONE_WIDTH = ${OZONE_WIDTH_KM.toFixed(1)};

  const float SUN_INTENSITY = ${SUN_INTENSITY.toFixed(1)};
`

/**
 * Density profiles. Altitude `h` is in km. Rayleigh and Mie are
 * exponential falloffs; ozone uses a tent centred on
 * `OZONE_CENTER_HEIGHT` (the stratospheric peak isn't well modelled
 * by an exponential).
 */
export const ATMOSPHERE_GLSL_DENSITY = /* glsl */ `
  float rayleighDensity(float h) {
    return exp(-max(h, 0.0) / RAYLEIGH_SCALE_HEIGHT);
  }
  float mieDensity(float h) {
    return exp(-max(h, 0.0) / MIE_SCALE_HEIGHT);
  }
  float ozoneDensity(float h) {
    return max(0.0, 1.0 - abs(h - OZONE_CENTER_HEIGHT) / OZONE_WIDTH);
  }
`

/**
 * Phase functions. `mu = dot(viewDir, sunDir)`, range [-1, +1].
 *
 * Rayleigh: 3/(16π)(1+μ²) — classic dipole-radiation phase.
 * Cornette-Shanks: improved Henyey-Greenstein; better behaved at
 * back-scatter angles than raw HG, and properly normalised over 4π
 * so the integral matches the scattering coefficient. The `1e-4`
 * floor inside the `pow` protects against the singularity at
 * `mu = 1, g = 1`.
 */
export const ATMOSPHERE_GLSL_PHASE = /* glsl */ `
  float rayleighPhase(float mu) {
    return 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  }
  float cornetteShanksPhase(float mu) {
    float gg = MIE_G * MIE_G;
    float num = 3.0 * (1.0 - gg) * (1.0 + mu * mu);
    float den = 8.0 * PI * (2.0 + gg) * pow(max(1.0 + gg - 2.0 * MIE_G * mu, 1e-4), 1.5);
    return num / den;
  }
`

/**
 * Ray-sphere intersection. Returns `vec2(tNear, tFar)`; both negative
 * = miss. `tNear` may be negative when the origin is inside the
 * sphere (in which case `tFar > 0`).
 *
 * Reference: iquilezles.org/articles/intersectors
 */
export const ATMOSPHERE_GLSL_INTERSECT = /* glsl */ `
  vec2 raySphereIntersect(vec3 rayOrigin, vec3 rayDir, vec3 sphereCenter, float sphereRadius) {
    vec3 oc = rayOrigin - sphereCenter;
    float b = dot(oc, rayDir);
    float c = dot(oc, oc) - sphereRadius * sphereRadius;
    float disc = b * b - c;
    if (disc < 0.0) return vec2(-1.0, -1.0);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
  }
`

/**
 * Narkowicz 2015 ACES filmic tonemap approximation — same one the
 * article uses. Cheap, close enough to full ACES for real-time work.
 * Use as the final step before sRGB encode in any pass that needs
 * tonemapping (the MapLibre passes other than atmosphere don't use
 * tonemap and shouldn't, so this is per-pass, not global).
 */
export const ATMOSPHERE_GLSL_TONEMAP = /* glsl */ `
  vec3 acesFilm(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }
`

/**
 * Bounded raymarch for atmospheric scattering. The camera-outside-
 * atmosphere "rendering planets" case from the article. All inputs
 * are in kilometres; the planet is assumed centred at the origin.
 *
 *   - Intersects the ray with the atmosphere sphere and the planet
 *     sphere to bound the segment; bails early if the ray misses
 *     the atmosphere.
 *   - PRIMARY_STEPS samples along the segment; each accumulates
 *     Rayleigh, Mie and ozone optical depths.
 *   - LIGHTMARCH_STEPS samples from each primary sample toward the
 *     sun, accumulating the sun-side optical depth; a sample whose
 *     light ray dips below the planet surface gets a huge optical
 *     depth, effectively shadowing it.
 *   - In-scattering at each sample is weighted by combined
 *     transmittance from camera-to-sample-to-sun.
 *   - Ozone contributes to extinction only (no scattering term).
 *
 * Returns the HDR scattered colour. Caller is responsible for
 * tonemapping and blending. With additive blending, just write
 * `colour * alpha` where `alpha` is your fragment's coverage.
 *
 * Depends on the other GLSL chunks (CONSTANTS, DENSITY, PHASE,
 * INTERSECT) being injected ahead of this one.
 */
export const ATMOSPHERE_GLSL_RAYMARCH = /* glsl */ `
  vec3 computeAtmosphereScattering(vec3 rayOriginKm, vec3 rayDirKm, vec3 sunDir) {
    vec2 atmHit = raySphereIntersect(rayOriginKm, rayDirKm, vec3(0.0), ATMOSPHERE_RADIUS);
    if (atmHit.y <= 0.0) return vec3(0.0);

    vec2 planetHit = raySphereIntersect(rayOriginKm, rayDirKm, vec3(0.0), PLANET_RADIUS);

    float tNear = max(atmHit.x, 0.0);
    float tFar = atmHit.y;
    if (planetHit.x > 0.0) tFar = min(tFar, planetHit.x);
    if (tFar <= tNear) return vec3(0.0);

    float segmentLen = tFar - tNear;
    float stepSize = segmentLen / float(${PRIMARY_STEPS});

    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    float viewOdR = 0.0;
    float viewOdM = 0.0;
    float viewOdO = 0.0;

    for (int i = 0; i < ${PRIMARY_STEPS}; i++) {
      float t = tNear + (float(i) + 0.5) * stepSize;
      vec3 samplePos = rayOriginKm + rayDirKm * t;
      float h = length(samplePos) - PLANET_RADIUS;
      if (h < 0.0 || h > ATMOSPHERE_HEIGHT) continue;

      float dR = rayleighDensity(h);
      float dM = mieDensity(h);
      float dO = ozoneDensity(h);

      viewOdR += dR * stepSize;
      viewOdM += dM * stepSize;
      viewOdO += dO * stepSize;

      // Light march from this sample toward the sun. If the ray
      // dips through the planet, the sample is in geometric shadow.
      vec2 sunHit = raySphereIntersect(samplePos, sunDir, vec3(0.0), ATMOSPHERE_RADIUS);
      float sunStep = max(sunHit.y, 0.0) / float(${LIGHTMARCH_STEPS});
      float sunOdR = 0.0;
      float sunOdM = 0.0;
      float sunOdO = 0.0;
      bool shadowed = false;
      for (int j = 0; j < ${LIGHTMARCH_STEPS}; j++) {
        float st = (float(j) + 0.5) * sunStep;
        vec3 sunPos = samplePos + sunDir * st;
        float sh = length(sunPos) - PLANET_RADIUS;
        if (sh < 0.0) { shadowed = true; break; }
        if (sh > ATMOSPHERE_HEIGHT) break;
        sunOdR += rayleighDensity(sh) * sunStep;
        sunOdM += mieDensity(sh) * sunStep;
        sunOdO += ozoneDensity(sh) * sunStep;
      }
      if (shadowed) continue;

      vec3 tau =
        RAYLEIGH_BETA   * (viewOdR + sunOdR) +
        MIE_BETA_EXT    * (viewOdM + sunOdM) +
        OZONE_BETA_ABS  * (viewOdO + sunOdO);
      vec3 transmittance = exp(-tau);

      sumR += dR * transmittance * stepSize;
      sumM += dM * transmittance * stepSize;
    }

    float mu = dot(rayDirKm, sunDir);
    float pR = rayleighPhase(mu);
    float pM = cornetteShanksPhase(mu);

    return SUN_INTENSITY * (
      pR * RAYLEIGH_BETA      * sumR +
      pM * MIE_BETA_SCATTER   * sumM
    );
  }
`

/**
 * Everything in one block. Convenience export for consumers that
 * want all helpers; consumers that only need a subset can import the
 * individual exports above.
 */
export const ATMOSPHERE_GLSL_ALL = [
  ATMOSPHERE_GLSL_CONSTANTS,
  ATMOSPHERE_GLSL_DENSITY,
  ATMOSPHERE_GLSL_PHASE,
  ATMOSPHERE_GLSL_INTERSECT,
  ATMOSPHERE_GLSL_TONEMAP,
  ATMOSPHERE_GLSL_RAYMARCH,
].join('\n')
