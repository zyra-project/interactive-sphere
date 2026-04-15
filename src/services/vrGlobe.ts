/**
 * Minimal vanilla-WebGL2 textured globe for the WebXR scene.
 *
 * Draws a unit UV-sphere at a caller-supplied model transform, sampled
 * from a single equirectangular texture. Intentionally does NOT depend
 * on Three.js — this is Phase 1 scaffolding for
 * {@link file://./../../docs/VR_INVESTIGATION_PLAN.md VR_INVESTIGATION_PLAN.md};
 * the shader will grow into the full day/night/cloud/specular
 * composite (mirroring `earthTileLayer.ts`) in a later phase.
 *
 * The only public surface is `createVrGlobe()` → `{ render, dispose }`.
 * `render()` expects:
 *   - the view matrix (inverse of the eye transform)
 *   - the projection matrix (from `XRView.projectionMatrix`)
 *   - the model matrix (where to place the globe in the scene)
 *
 * All three arrive directly from the WebXR frame loop.
 */

/* Matrix helpers — just the two ops we need. Kept inline because
 * pulling in a full math library for 40 lines is overkill, and
 * because the semantics are tight enough to eyeball. */

/**
 * Build a column-major 4×4 translation matrix. Exported so the session
 * module can place the globe in the scene. WebXR matrices are already
 * column-major Float32Arrays, so we match that convention here.
 */
export function mat4Translation(x: number, y: number, z: number): Float32Array {
  const m = new Float32Array(16)
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1
  m[12] = x; m[13] = y; m[14] = z
  return m
}

/**
 * Generate a UV-sphere: rows of latitude × columns of longitude. Returns
 * interleaved position + normal + uv (8 floats per vertex) plus an
 * index buffer for `drawElements(TRIANGLES)`.
 *
 * For a unit sphere, vertex position == normal, so we store both and
 * let the shader keep them separate for future lighting work.
 */
function buildSphere(latBands: number, lonBands: number) {
  const vertexCount = (latBands + 1) * (lonBands + 1)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint16Array(latBands * lonBands * 6)

  let vi = 0
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands
    const sinT = Math.sin(theta)
    const cosT = Math.cos(theta)
    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands
      const sinP = Math.sin(phi)
      const cosP = Math.cos(phi)
      const x = cosP * sinT
      const y = cosT
      const z = sinP * sinT
      positions[vi * 3] = x
      positions[vi * 3 + 1] = y
      positions[vi * 3 + 2] = z
      normals[vi * 3] = x
      normals[vi * 3 + 1] = y
      normals[vi * 3 + 2] = z
      uvs[vi * 2] = 1 - lon / lonBands
      uvs[vi * 2 + 1] = 1 - lat / latBands
      vi++
    }
  }

  let ii = 0
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const first = lat * (lonBands + 1) + lon
      const second = first + lonBands + 1
      indices[ii++] = first
      indices[ii++] = second
      indices[ii++] = first + 1
      indices[ii++] = second
      indices[ii++] = second + 1
      indices[ii++] = first + 1
    }
  }

  return { positions, normals, uvs, indices }
}

const VERT_SRC = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;

out vec2 vUV;
out vec3 vNormal;

void main() {
  vUV = aUV;
  vNormal = aNormal;
  gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
}
`

/**
 * Placeholder shader — samples a single equirectangular texture and
 * darkens the night side with a hard-coded sun direction. Matches
 * nothing fancy in `earthTileLayer.ts` yet; that port is Phase 2.
 */
const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUV;
in vec3 vNormal;

uniform sampler2D uTexture;

out vec4 outColor;

void main() {
  vec3 sun = normalize(vec3(0.6, 0.4, 0.7));
  float lambert = clamp(dot(normalize(vNormal), sun), 0.0, 1.0);
  // Soft terminator: 30 % ambient so the night side is still visible
  // in VR instead of pitch black.
  float light = 0.3 + 0.7 * lambert;
  vec4 albedo = texture(uTexture, vUV);
  outColor = vec4(albedo.rgb * light, 1.0);
}
`

function compileShader(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Failed to allocate shader')
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error'
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed: ${log}`)
  }
  return shader
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('Failed to allocate program')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error'
    gl.deleteProgram(program)
    throw new Error(`Program link failed: ${log}`)
  }
  return program
}

/**
 * Load an image URL into a WebGL2 `TEXTURE_2D`. A 1×1 placeholder is
 * uploaded synchronously so the first frames draw something sensible
 * while the real image decodes.
 */
async function loadTexture(gl: WebGL2RenderingContext, url: string): Promise<WebGLTexture> {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Failed to allocate texture')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // 1×1 mid-blue placeholder so draws before the image loads aren't undefined.
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([0x1a, 0x3a, 0x6a, 0xff]),
  )
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`Failed to load texture: ${url}`))
    img.src = url
  })
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  return texture
}

/** Render handle returned by `createVrGlobe`. */
export interface VrGlobe {
  /**
   * Draw the globe for the current view.
   * @param view  column-major 4×4 view matrix (typically `XRView.transform.inverse.matrix`)
   * @param projection  column-major 4×4 projection matrix (from `XRView.projectionMatrix`)
   * @param model  world placement of the globe
   */
  render(view: Float32Array, projection: Float32Array, model: Float32Array): void
  dispose(): void
}

/**
 * Initialize GPU resources for the VR globe. Resolves once the
 * texture has loaded so the first rendered frame shows real pixels
 * rather than the 1×1 placeholder. Caller is responsible for calling
 * `dispose()` when the VR session ends.
 */
export async function createVrGlobe(
  gl: WebGL2RenderingContext,
  textureUrl: string,
): Promise<VrGlobe> {
  // --- Shader program ---
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
  const program = linkProgram(gl, vs, fs)
  gl.deleteShader(vs)
  gl.deleteShader(fs)

  const uModel = gl.getUniformLocation(program, 'uModel')
  const uView = gl.getUniformLocation(program, 'uView')
  const uProjection = gl.getUniformLocation(program, 'uProjection')
  const uTexture = gl.getUniformLocation(program, 'uTexture')

  // --- Geometry ---
  // 48×96 bands is plenty for a globe that fills ~30° of the viewer's
  // FOV; higher resolution would just burn fill rate.
  const { positions, normals, uvs, indices } = buildSphere(48, 96)

  const vao = gl.createVertexArray()
  if (!vao) throw new Error('Failed to allocate VAO')
  gl.bindVertexArray(vao)

  const positionBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)

  const normalBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0)

  const uvBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(2)
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0)

  const indexBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)

  gl.bindVertexArray(null)

  // --- Texture ---
  const texture = await loadTexture(gl, textureUrl)

  return {
    render(view, projection, model) {
      gl.useProgram(program)
      gl.bindVertexArray(vao)

      gl.enable(gl.DEPTH_TEST)
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1i(uTexture, 0)

      // WebXR matrices arrive column-major as Float32Arrays, so we
      // pass them straight through. The model·view·projection combine
      // happens in the vertex shader.
      gl.uniformMatrix4fv(uModel, false, model)
      gl.uniformMatrix4fv(uView, false, view)
      gl.uniformMatrix4fv(uProjection, false, projection)

      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0)

      gl.bindVertexArray(null)
    },
    dispose() {
      gl.deleteProgram(program)
      gl.deleteBuffer(positionBuffer)
      gl.deleteBuffer(normalBuffer)
      gl.deleteBuffer(uvBuffer)
      gl.deleteBuffer(indexBuffer)
      gl.deleteVertexArray(vao)
      gl.deleteTexture(texture)
    },
  }
}
