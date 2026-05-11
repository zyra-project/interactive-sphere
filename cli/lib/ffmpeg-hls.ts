/**
 * FFmpeg HLS encoder wrapper — multi-rendition equirectangular.
 *
 * Phase 3 commit A. Drives an `ffmpeg` child process that takes a
 * source MP4 (typically the highest-quality download from the
 * Vimeo proxy, e.g. 4096x2048 equirectangular spherical) and
 * produces an adaptive-bitrate HLS bundle with three renditions
 * at 2:1 aspect ratio:
 *
 *   - 4K spherical (4096x2048) — matches NOAA's SOS source
 *     dimensions; preserves full source resolution.
 *   - 1080p stretched to 2:1 (2160x1080) — the typical desktop
 *     viewing tier. Stream's standard plan capped at this; on
 *     R2 we own the rendition policy so we keep it as one tier
 *     of an ABR ladder rather than the ceiling.
 *   - 720p stretched to 2:1 (1440x720) — mobile / slow-connection
 *     fallback.
 *
 * 6-second segments (VOD-style — fewer files than the 2-4 second
 * range Apple recommends for live, plenty precise for VOD seek).
 * H.264 main profile + AAC 192kbps audio. Master playlist named
 * `master.m3u8`; variant playlists at `stream_<n>/playlist.m3u8`
 * with segments alongside.
 *
 * Output directory layout after a successful encode:
 *
 *   outputDir/
 *     master.m3u8                      (master playlist; 3 variants)
 *     stream_0/                        (4K rendition)
 *       playlist.m3u8
 *       segment_000.ts
 *       segment_001.ts
 *       ...
 *     stream_1/                        (1080p rendition)
 *       playlist.m3u8
 *       segment_*.ts
 *     stream_2/                        (720p rendition)
 *       playlist.m3u8
 *       segment_*.ts
 *
 * The bundle is self-contained — uploading the whole directory
 * to R2 under one key prefix gives a working HLS asset; the
 * master playlist's variant URIs are relative paths that resolve
 * against the master's location.
 *
 * Caller is responsible for cleaning up `outputDir`. The helper
 * does not delete on failure — operator can inspect the partial
 * output for debugging via `--keep-workdir` on the migrate
 * subcommand.
 *
 * `child_process.spawn` is dependency-injected for tests. The
 * production caller passes nothing and gets `spawn` from
 * `node:child_process`.
 */

import { spawn as nodeSpawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync, mkdirSync, statSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Readable, Writable } from 'node:stream'

/** Type-narrowed spawn that returns a process with streamable
 * stdio. We don't pipe stdin; the source comes from `-i <path>`. */
type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: { stdio?: ('pipe' | 'ignore' | 'inherit')[] },
) => ChildProcessByStdio<Writable | null, Readable, Readable>

export interface HlsRendition {
  /** Output height in pixels. Width = 2 × height (2:1 aspect). */
  height: number
  /** x264 CRF (lower = higher quality, bigger files). 18-23 is
   * the typical visually-transparent range for VOD. */
  crf: number
  /** Suggested max bitrate in kbps. Caps the encoder's rate
   * decisions for ABR ladder predictability. */
  maxBitrateKbps: number
}

/**
 * Default rendition ladder. Operator-facing decision per the
 * Phase 3 brief: 4K + 1080p + 720p at 2:1 spherical. The CRF
 * values are graded — 4K gets the lowest CRF (highest quality)
 * because aliasing artifacts in the source resolution are the
 * most visible after sphere-projection magnification.
 */
export const DEFAULT_RENDITIONS: readonly HlsRendition[] = [
  { height: 2048, crf: 18, maxBitrateKbps: 25_000 }, // 4K spherical (4096x2048)
  { height: 1080, crf: 20, maxBitrateKbps: 8_000 },  //   1080p (2160x1080)
  { height: 720,  crf: 22, maxBitrateKbps: 4_000 },  //   720p  (1440x720)
] as const

export const DEFAULT_SEGMENT_SECONDS = 6
export const DEFAULT_AUDIO_BITRATE_KBPS = 192
export const MASTER_PLAYLIST_NAME = 'master.m3u8'

export interface EncodeHlsOptions {
  /** Source MP4 file path. Must exist. */
  inputPath: string
  /** Output directory. Created (recursively) if missing. */
  outputDir: string
  /** Override the default rendition ladder. */
  renditions?: readonly HlsRendition[]
  /** Segment length in seconds. Defaults to 6. */
  segmentSeconds?: number
  /** Audio bitrate in kbps. Defaults to 192. */
  audioBitrateKbps?: number
  /** Override the ffmpeg binary path. Defaults to `ffmpeg` on PATH. */
  ffmpegBin?: string
  /** Test injection — defaults to `node:child_process`'s `spawn`. */
  spawnImpl?: SpawnFn
  /** Called for each line FFmpeg writes to stderr. FFmpeg uses
   * stderr for both progress and errors; the operator CLI prints
   * each line for visibility. */
  onProgress?: (line: string) => void
}

export interface EncodedHls {
  /** Absolute path to the master playlist. */
  masterPlaylistPath: string
  /** All produced files relative to `outputDir`, including the
   * master playlist, variant playlists, and `.ts` segments. */
  files: string[]
  /** Wall-clock encoding duration in ms. */
  durationMs: number
  /** Sum of all output files' bytes. */
  outputBytes: number
}

export class FfmpegError extends Error {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  /** Last ~4KB of stderr captured before the process exited.
   * Surfaced verbatim so the operator can read the actual ffmpeg
   * error message rather than just an exit code. */
  readonly stderrTail: string

  constructor(
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    stderrTail: string,
    message: string,
  ) {
    super(message)
    this.name = 'FfmpegError'
    this.exitCode = exitCode
    this.signal = signal
    this.stderrTail = stderrTail
  }
}

/**
 * Build the FFmpeg argv for the multi-rendition HLS encode.
 * Exported so tests can assert on the exact command shape — the
 * encoder's output quality is determined by this argv, so pinning
 * it explicitly catches regressions like a missing `-crf` or a
 * silent profile change.
 *
 * The `-filter_complex` pipeline splits the input video into N
 * branches, scales each branch to a different height (width
 * derived as 2 × height to preserve 2:1 aspect), and labels them
 * `[v0]`..`[vN-1]` for `-map` to pick up. Audio is shared across
 * all renditions — one AAC encode, referenced from each variant
 * playlist via `-var_stream_map`.
 */
export function buildFfmpegArgs(
  inputPath: string,
  outputDir: string,
  renditions: readonly HlsRendition[],
  segmentSeconds: number,
  audioBitrateKbps: number,
): string[] {
  const splits = renditions.length
  const filterParts: string[] = [`[0:v]split=${splits}` + renditions.map((_, i) => `[s${i}]`).join('')]
  for (let i = 0; i < renditions.length; i++) {
    const r = renditions[i]
    const width = r.height * 2
    filterParts.push(`[s${i}]scale=${width}:${r.height}[v${i}]`)
  }
  const filterComplex = filterParts.join(';')

  const args: string[] = ['-y', '-i', inputPath, '-filter_complex', filterComplex]

  // Per-rendition video output streams. -map "[vN]" picks up the
  // labelled output from the filter graph; -c:v:N / -crf:v:N /
  // -maxrate:v:N target the Nth video output specifically.
  for (let i = 0; i < renditions.length; i++) {
    const r = renditions[i]
    args.push('-map', `[v${i}]`)
    args.push(`-c:v:${i}`, 'libx264')
    args.push(`-profile:v:${i}`, 'main')
    args.push(`-preset:v:${i}`, 'slow')
    args.push(`-crf:v:${i}`, String(r.crf))
    args.push(`-maxrate:v:${i}`, `${r.maxBitrateKbps}k`)
    // bufsize ~ 2x maxrate is the standard CBR-ish recommendation.
    args.push(`-bufsize:v:${i}`, `${r.maxBitrateKbps * 2}k`)
    args.push(`-keyint_min:v:${i}`, String(segmentSeconds * 30)) // assume up to 30 fps
    args.push(`-g:v:${i}`, String(segmentSeconds * 30))
    args.push(`-sc_threshold:v:${i}`, '0')
  }

  // One audio output, shared across all variants.
  args.push('-map', 'a:0?')
  args.push('-c:a', 'aac')
  args.push('-b:a', `${audioBitrateKbps}k`)
  args.push('-ac', '2')

  // HLS muxer config.
  args.push('-f', 'hls')
  args.push('-hls_time', String(segmentSeconds))
  args.push('-hls_playlist_type', 'vod')
  args.push('-hls_segment_filename', join(outputDir, 'stream_%v', 'segment_%03d.ts'))
  args.push('-master_pl_name', MASTER_PLAYLIST_NAME)

  // `-var_stream_map` tells the HLS muxer which input streams go
  // in which variant. Each variant gets one video output (v:i) +
  // the shared audio (a:0). Three variants → three v:N a:0 pairs.
  const streamMap = renditions.map((_, i) => `v:${i},a:0`).join(' ')
  args.push('-var_stream_map', streamMap)

  // Variant playlist filename pattern — `%v` is replaced by the
  // variant index. With our stream-map this yields stream_0,
  // stream_1, stream_2 directories alongside the master playlist.
  args.push(join(outputDir, 'stream_%v', 'playlist.m3u8'))

  return args
}

/**
 * Encode a source MP4 to a multi-rendition HLS bundle. Resolves
 * when ffmpeg exits cleanly + the master playlist exists; rejects
 * with `FfmpegError` on a non-zero exit or a missing master
 * playlist.
 */
export async function encodeHls(options: EncodeHlsOptions): Promise<EncodedHls> {
  if (!existsSync(options.inputPath)) {
    throw new Error(`encodeHls: input ${options.inputPath} does not exist`)
  }
  mkdirSync(options.outputDir, { recursive: true })

  const renditions = options.renditions ?? DEFAULT_RENDITIONS
  if (renditions.length === 0) {
    throw new Error('encodeHls: renditions must be non-empty')
  }
  const segmentSeconds = options.segmentSeconds ?? DEFAULT_SEGMENT_SECONDS
  const audioBitrateKbps = options.audioBitrateKbps ?? DEFAULT_AUDIO_BITRATE_KBPS
  const ffmpegBin = options.ffmpegBin ?? 'ffmpeg'
  const spawnImpl = (options.spawnImpl ?? (nodeSpawn as unknown as SpawnFn))

  // `mkdir -p stream_<n>` for each variant up front — FFmpeg's
  // `-hls_segment_filename` and variant-playlist patterns expect
  // the directories to exist before the muxer starts writing.
  for (let i = 0; i < renditions.length; i++) {
    mkdirSync(join(options.outputDir, `stream_${i}`), { recursive: true })
  }

  const args = buildFfmpegArgs(
    options.inputPath,
    options.outputDir,
    renditions,
    segmentSeconds,
    audioBitrateKbps,
  )

  const start = Date.now()
  const stderrChunks: string[] = []
  const STDERR_TAIL_BYTES = 4096

  return await new Promise<EncodedHls>((resolve, reject) => {
    const child = spawnImpl(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    // FFmpeg writes nothing useful to stdout for our config; we
    // still pipe it to consume the buffer so the process doesn't
    // block on a full pipe.
    if (child.stdout) {
      child.stdout.on('data', () => {})
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf-8')
      let partial = ''
      child.stderr.on('data', (chunk: string) => {
        // FFmpeg uses '\r' for in-line progress updates AND '\n'
        // for new log lines. Split on either so onProgress sees
        // each update separately.
        partial += chunk
        const lines = partial.split(/[\r\n]/)
        partial = lines.pop() ?? ''
        for (const line of lines) {
          if (line.length === 0) continue
          stderrChunks.push(line + '\n')
          options.onProgress?.(line)
        }
      })
      child.stderr.on('end', () => {
        if (partial.length > 0) {
          stderrChunks.push(partial)
          options.onProgress?.(partial)
        }
      })
    }

    child.on('error', err => {
      reject(
        new FfmpegError(
          null,
          null,
          stderrTail(stderrChunks, STDERR_TAIL_BYTES),
          `ffmpeg spawn failed: ${err.message}. Is '${ffmpegBin}' on PATH?`,
        ),
      )
    })

    child.on('close', (code, signal) => {
      const tail = stderrTail(stderrChunks, STDERR_TAIL_BYTES)
      if (code !== 0) {
        reject(
          new FfmpegError(
            code,
            signal,
            tail,
            `ffmpeg exited with code ${code}${signal ? ` (signal ${signal})` : ''}`,
          ),
        )
        return
      }

      const masterPlaylistPath = join(options.outputDir, MASTER_PLAYLIST_NAME)
      if (!existsSync(masterPlaylistPath)) {
        reject(
          new FfmpegError(
            code,
            signal,
            tail,
            `ffmpeg exited 0 but master playlist ${MASTER_PLAYLIST_NAME} was not produced`,
          ),
        )
        return
      }

      const files: string[] = []
      let outputBytes = 0
      collectFiles(options.outputDir, options.outputDir, files, size => {
        outputBytes += size
      })

      resolve({
        masterPlaylistPath,
        files,
        durationMs: Date.now() - start,
        outputBytes,
      })
    })
  })
}

/** Concatenate the captured stderr lines and return the last N
 * bytes — bounded so a chatty FFmpeg run doesn't bloat the error
 * message past usefulness. */
function stderrTail(chunks: string[], maxBytes: number): string {
  const all = chunks.join('')
  return all.length <= maxBytes ? all : all.slice(-maxBytes)
}

/** Recursive directory walk producing relative paths. Stays
 * shallow on the common case (master + 3 dirs × ~30 segments)
 * so a synchronous walk is fine. */
function collectFiles(
  root: string,
  cur: string,
  out: string[],
  onSize: (n: number) => void,
): void {
  for (const entry of readdirSync(cur, { withFileTypes: true })) {
    const full = join(cur, entry.name)
    if (entry.isDirectory()) {
      collectFiles(root, full, out, onSize)
      continue
    }
    if (!entry.isFile()) continue
    out.push(relative(root, full))
    onSize(statSync(full).size)
  }
}
