/**
 * Unit tests for `cli/transcode-from-dispatch.ts`.
 *
 * The script itself drives the full transcode pipeline against a
 * real ffmpeg + R2 + publisher API — that's an end-to-end test
 * that lives on the GHA workflow runner, not in vitest. These
 * tests pin the two parts that are pure logic: the argv parser
 * and the env loader. Everything else is a wrapper around the
 * already-tested helpers in `cli/lib/`.
 */

import { describe, expect, it } from 'vitest'
import { parseArgs, loadServerEnv } from './transcode-from-dispatch'

const GOOD_DS = '01HXAAAAAAAAAAAAAAAAAAAAAA'
const GOOD_UP = '01HYAAAAAAAAAAAAAAAAAAAAAA'
const GOOD_KEY = `uploads/${GOOD_DS}/source.mp4`
const GOOD_DIGEST = 'sha256:' + 'a'.repeat(64)

describe('parseArgs', () => {
  it('parses a well-formed argv', () => {
    const r = parseArgs([
      `--dataset-id=${GOOD_DS}`,
      `--upload-id=${GOOD_UP}`,
      `--source-key=${GOOD_KEY}`,
      `--source-digest=${GOOD_DIGEST}`,
    ])
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.datasetId).toBe(GOOD_DS)
    expect(r.uploadId).toBe(GOOD_UP)
    expect(r.sourceKey).toBe(GOOD_KEY)
    expect(r.sourceDigest).toBe(GOOD_DIGEST)
    expect(r.workdir).toBe(`/tmp/terraviz-transcode/${GOOD_DS}-${GOOD_UP}`)
    expect(r.cleanupOnFailure).toBe(false)
  })

  it('rejects a malformed dataset id', () => {
    const r = parseArgs([
      `--dataset-id=not-a-ulid`,
      `--upload-id=${GOOD_UP}`,
      `--source-key=${GOOD_KEY}`,
      `--source-digest=${GOOD_DIGEST}`,
    ])
    expect('error' in r).toBe(true)
    if ('error' in r) {
      expect(r.error).toMatch(/dataset-id/)
    }
  })

  it('rejects a malformed upload id', () => {
    const r = parseArgs([
      `--dataset-id=${GOOD_DS}`,
      `--upload-id=not-a-ulid`,
      `--source-key=${GOOD_KEY}`,
      `--source-digest=${GOOD_DIGEST}`,
    ])
    expect('error' in r).toBe(true)
    if ('error' in r) {
      expect(r.error).toMatch(/upload-id/)
    }
  })

  it('rejects a source key outside the uploads/ namespace', () => {
    const r = parseArgs([
      `--dataset-id=${GOOD_DS}`,
      `--upload-id=${GOOD_UP}`,
      `--source-key=datasets/${GOOD_DS}/by-digest/sha256/abc/asset.mp4`,
      `--source-digest=${GOOD_DIGEST}`,
    ])
    expect('error' in r).toBe(true)
    if ('error' in r) {
      expect(r.error).toMatch(/source-key/)
    }
  })

  it('rejects a malformed digest', () => {
    const r = parseArgs([
      `--dataset-id=${GOOD_DS}`,
      `--upload-id=${GOOD_UP}`,
      `--source-key=${GOOD_KEY}`,
      `--source-digest=md5:abcdef`,
    ])
    expect('error' in r).toBe(true)
  })

  it('respects --workdir and --cleanup-on-failure', () => {
    const r = parseArgs([
      `--dataset-id=${GOOD_DS}`,
      `--upload-id=${GOOD_UP}`,
      `--source-key=${GOOD_KEY}`,
      `--source-digest=${GOOD_DIGEST}`,
      `--workdir=/var/transcode`,
      '--cleanup-on-failure',
    ])
    if ('error' in r) throw new Error(r.error)
    expect(r.workdir).toBe('/var/transcode')
    expect(r.cleanupOnFailure).toBe(true)
  })
})

describe('loadServerEnv', () => {
  const FULL_ENV = {
    TERRAVIZ_SERVER: 'https://terraviz.example.com/',
    CF_ACCESS_CLIENT_ID: 'id.access',
    CF_ACCESS_CLIENT_SECRET: 'secret',
  }

  it('strips the trailing slash from TERRAVIZ_SERVER', () => {
    const r = loadServerEnv(FULL_ENV)
    if ('error' in r) throw new Error(r.error)
    expect(r.server).toBe('https://terraviz.example.com')
  })

  it('errors when any env var is missing', () => {
    for (const key of Object.keys(FULL_ENV) as Array<keyof typeof FULL_ENV>) {
      const { [key]: _missing, ...rest } = FULL_ENV
      const r = loadServerEnv(rest)
      expect('error' in r).toBe(true)
      if ('error' in r) {
        expect(r.error).toContain(key)
      }
    }
  })
})
