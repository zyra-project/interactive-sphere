/**
 * Tests for the catalog wire-shape serializer.
 *
 * Today this just locks in the tour-row case — tour datasets must
 * carry a `tourJsonUrl` derived from the row's `data_ref` so the
 * SPA's tour engine can fetch the JSON directly instead of hitting
 * the manifest endpoint (which 415s tour formats by design).
 *
 * The video / image cases are exercised end-to-end by the manifest
 * endpoint tests; this file just covers the new tour branch and
 * the fall-back behaviour when the resolver is absent.
 */

import { describe, expect, it } from 'vitest'
import {
  serializeDataset,
  type DataRefResolver,
} from './dataset-serializer'
import type { DatasetRow, DecorationRows, NodeIdentityRow } from './catalog-store'

function fakeRow(overrides: Partial<DatasetRow> = {}): DatasetRow {
  return {
    id: 'DS_TEST',
    slug: 'ds-test',
    origin_node: 'NODE001',
    title: 'Test Tour',
    abstract: null,
    organization: null,
    format: 'tour/json',
    data_ref: 'url:https://example.com/tour.json',
    thumbnail_ref: null,
    sphere_thumbnail_ref: null,
    sphere_thumbnail_ref_lg: null,
    legend_ref: null,
    caption_ref: null,
    website_link: null,
    start_time: null,
    end_time: null,
    period: null,
    weight: 0,
    visibility: 'public',
    is_hidden: 0,
    run_tour_on_load: null,
    license_spdx: null,
    license_url: null,
    license_statement: null,
    attribution_text: null,
    rights_holder: null,
    doi: null,
    citation_text: null,
    schema_version: 1,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    published_at: '2026-05-01T00:00:00.000Z',
    retracted_at: null,
    publisher_id: null,
    legacy_id: null,
    color_table_ref: null,
    probing_info: null,
    bounding_variables: null,
    ...overrides,
  }
}

const emptyDecoration: DecorationRows = {
  tags: [],
  categories: [],
  keywords: [],
  developers: [],
  related: [],
}

const fakeIdentity: NodeIdentityRow = {
  node_id: 'NODE001',
  display_name: 'Test Node',
  base_url: 'https://test.example.com',
  description: null,
  contact_email: null,
  public_key: 'abc123',
  created_at: '2026-05-01T00:00:00.000Z',
}

const passthroughResolver: DataRefResolver = (ref) =>
  ref.startsWith('url:') ? ref.slice(4) : null

describe('serializeDataset — tour rows', () => {
  it('sets tourJsonUrl when format is tour/json and the resolver finds a URL', () => {
    const wire = serializeDataset(
      fakeRow({ format: 'tour/json', data_ref: 'url:https://cdn.example.com/t.json' }),
      emptyDecoration,
      fakeIdentity,
      passthroughResolver,
    )
    expect(wire.tourJsonUrl).toBe('https://cdn.example.com/t.json')
    // The manifest dataLink stays put — older clients fall back to
    // it; new clients prefer tourJsonUrl. Both shapes coexist.
    expect(wire.dataLink).toBe('/api/v1/datasets/DS_TEST/manifest')
  })

  it('omits tourJsonUrl when no resolver is supplied', () => {
    // This is the unit-test-friendly call form: skip the resolver,
    // get a wire row that explicitly doesn't claim tourJsonUrl.
    const wire = serializeDataset(
      fakeRow({ format: 'tour/json', data_ref: 'url:https://x.example/y.json' }),
      emptyDecoration,
      fakeIdentity,
    )
    expect(wire.tourJsonUrl).toBeUndefined()
  })

  it('omits tourJsonUrl when the resolver returns null (unsupported scheme)', () => {
    // A tour row with a scheme the resolver can't handle (e.g. a
    // misconfigured `vimeo:` data_ref) should leave tourJsonUrl
    // unset rather than emit a string that won't fetch.
    const wire = serializeDataset(
      fakeRow({ format: 'tour/json', data_ref: 'vimeo:123' }),
      emptyDecoration,
      fakeIdentity,
      passthroughResolver,
    )
    expect(wire.tourJsonUrl).toBeUndefined()
  })

  it('does not set tourJsonUrl on non-tour rows even when the resolver is present', () => {
    // The branch is gated on `format === 'tour/json'` — video and
    // image rows must never carry tourJsonUrl, since their assets
    // legitimately go through the manifest indirection.
    const wire = serializeDataset(
      fakeRow({ format: 'video/mp4', data_ref: 'url:https://example.com/v.mp4' }),
      emptyDecoration,
      fakeIdentity,
      passthroughResolver,
    )
    expect(wire.tourJsonUrl).toBeUndefined()
  })
})

describe('serializeDataset — Phase 3b columns', () => {
  // The three columns added in migration 0009: color_table_ref
  // (auxiliary asset URL, serialized verbatim) plus probing_info
  // and bounding_variables (JSON-stringified text in D1, parsed
  // to objects on the wire).
  it('emits colorTableLink from color_table_ref verbatim', () => {
    const wire = serializeDataset(
      fakeRow({ color_table_ref: 'https://example.org/colortable.png' }),
      emptyDecoration,
      fakeIdentity,
    )
    expect(wire.colorTableLink).toBe('https://example.org/colortable.png')
  })

  it('omits colorTableLink when color_table_ref is null', () => {
    const wire = serializeDataset(fakeRow({ color_table_ref: null }), emptyDecoration, fakeIdentity)
    expect(wire.colorTableLink).toBeUndefined()
  })

  it('parses probing_info JSON text on read', () => {
    const probing = {
      units: 'psu',
      minVal: 20,
      maxVal: 38,
      minPos: { x: 45, y: 99, XUnits: 'Pixels', YUnits: 'Pixels' },
      maxPos: { x: 277, y: 99, XUnits: 'Pixels', YUnits: 'Pixels' },
    }
    const wire = serializeDataset(
      fakeRow({ probing_info: JSON.stringify(probing) }),
      emptyDecoration,
      fakeIdentity,
    )
    expect(wire.probingInfo).toEqual(probing)
  })

  it('parses bounding_variables JSON text on read', () => {
    const bounding = { ranges: [[0, 100]] }
    const wire = serializeDataset(
      fakeRow({ bounding_variables: JSON.stringify(bounding) }),
      emptyDecoration,
      fakeIdentity,
    )
    expect(wire.boundingVariables).toEqual(bounding)
  })

  it('returns undefined for malformed JSON rather than 500-ing', () => {
    // The validator gates write-side shape, so the only way a row
    // ends up with malformed JSON here is an out-of-band DB edit.
    // We surface that as a missing field rather than a hard
    // serializer failure (the read endpoint stays available).
    const wire = serializeDataset(
      fakeRow({ probing_info: 'not json {' }),
      emptyDecoration,
      fakeIdentity,
    )
    expect(wire.probingInfo).toBeUndefined()
  })

  it('omits the fields entirely when both are null (default state)', () => {
    const wire = serializeDataset(fakeRow({}), emptyDecoration, fakeIdentity)
    expect(wire.probingInfo).toBeUndefined()
    expect(wire.boundingVariables).toBeUndefined()
  })
})
