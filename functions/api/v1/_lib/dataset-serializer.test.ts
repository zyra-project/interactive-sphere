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
