import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderDatasetEditPage } from './dataset-edit'
import type { PublisherDatasetDetail } from '../types'

function dataset(
  overrides: Partial<PublisherDatasetDetail> = {},
): PublisherDatasetDetail {
  return {
    id: '01EDIT0000000000000000000',
    slug: 'edit-me',
    title: 'Existing dataset',
    abstract: 'Original abstract.',
    organization: 'NOAA',
    format: 'video/mp4',
    visibility: 'public',
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-02T00:00:00Z',
    published_at: null,
    retracted_at: null,
    publisher_id: 'PUB001',
    legacy_id: null,
    data_ref: 'vimeo:123',
    thumbnail_ref: null,
    legend_ref: null,
    caption_ref: null,
    website_link: null,
    start_time: null,
    end_time: null,
    period: null,
    run_tour_on_load: null,
    license_spdx: 'CC0-1.0',
    license_url: null,
    license_statement: null,
    attribution_text: null,
    rights_holder: null,
    doi: null,
    citation_text: null,
    ...overrides,
  }
}

function detailResponse(
  d: PublisherDatasetDetail,
  extras: { keywords?: string[]; tags?: string[] } = {},
): Response {
  return new Response(
    JSON.stringify({
      dataset: d,
      keywords: extras.keywords ?? [],
      tags: extras.tags ?? [],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

describe('renderDatasetEditPage', () => {
  let mount: HTMLDivElement

  beforeEach(() => {
    mount = document.createElement('div')
    document.body.appendChild(mount)
    sessionStorage.clear()
  })

  it('fetches /api/v1/publish/datasets/:id with the URL-encoded id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetEditPage(mount, 'has/slash', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/publish/datasets/has%2Fslash',
      expect.anything(),
    )
  })

  it('renders the edit heading and prefills the title field', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetEditPage(mount, '01EDIT0000000000000000000', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.querySelector('.publisher-detail-title')?.textContent).toBe(
      'Edit dataset',
    )
    expect(mount.querySelector<HTMLInputElement>('#dataset-title')?.value).toBe(
      'Existing dataset',
    )
  })

  it('prefills the data_ref input from the existing row', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      detailResponse(dataset({ data_ref: 'r2:videos/01XYZ/master.m3u8' })),
    )
    await renderDatasetEditPage(mount, '01EDIT0000000000000000000', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.querySelector<HTMLInputElement>('#dataset-data-ref')?.value).toBe(
      'r2:videos/01XYZ/master.m3u8',
    )
  })

  it('prefills keyword chips from the decoration arrays', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      detailResponse(dataset(), { keywords: ['sst', 'anomaly'], tags: ['demo'] }),
    )
    await renderDatasetEditPage(mount, '01EDIT0000000000000000000', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const chipTexts = Array.from(mount.querySelectorAll('.publisher-chip-text')).map(
      el => el.textContent,
    )
    expect(chipTexts).toEqual(expect.arrayContaining(['sst', 'anomaly', 'demo']))
  })

  it('renders the not-found card on a 404 response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await renderDatasetEditPage(mount, 'missing', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.textContent).toContain('Dataset not found')
    expect(mount.querySelector('.publisher-back-link')).not.toBeNull()
    expect(mount.querySelector('form.publisher-form')).toBeNull()
  })

  it('renders the server-error card on a 5xx response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    await renderDatasetEditPage(mount, '01EDIT0000000000000000000', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.textContent).toContain('server returned an error')
    expect(mount.querySelector('form.publisher-form')).toBeNull()
  })

  it('PUTs to /api/v1/publish/datasets/:id on submit', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(detailResponse(dataset()))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ dataset: dataset() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    const routerNavigate = vi.fn()
    await renderDatasetEditPage(mount, '01EDIT0000000000000000000', {
      fetchFn: fetchFn as unknown as typeof fetch,
      routerNavigate,
    })
    const form = mount.querySelector<HTMLFormElement>('form.publisher-form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 0))
    expect(fetchFn).toHaveBeenLastCalledWith(
      '/api/v1/publish/datasets/01EDIT0000000000000000000',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
