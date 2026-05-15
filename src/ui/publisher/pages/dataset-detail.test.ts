import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderDatasetDetailPage } from './dataset-detail'
import type { PublisherDatasetDetail } from '../types'

function dataset(
  overrides: Partial<PublisherDatasetDetail> = {},
): PublisherDatasetDetail {
  return {
    id: '01AAAAAAAAAAAAAAAAAAAAAAAA',
    slug: 'sst-anomaly-2026-04',
    title: 'Sea Surface Temperature Anomaly — April 2026',
    abstract: 'Monthly mean SST anomaly relative to 1991-2020 climatology.',
    organization: 'NOAA/PMEL',
    format: 'video/mp4',
    visibility: 'public',
    created_at: '2026-04-30T12:00:00Z',
    updated_at: '2026-04-30T12:30:00Z',
    published_at: '2026-04-30T12:30:00Z',
    retracted_at: null,
    publisher_id: 'PUB001',
    legacy_id: null,
    data_ref: 'r2:videos/01ABC/master.m3u8',
    thumbnail_ref: 'r2:datasets/01ABC/thumbnail.jpg',
    legend_ref: null,
    caption_ref: null,
    website_link: 'https://www.pmel.noaa.gov/sst-anomaly',
    start_time: '2026-04-01',
    end_time: '2026-04-30',
    period: 'P1M',
    run_tour_on_load: null,
    license_spdx: 'CC0-1.0',
    license_url: null,
    license_statement: null,
    attribution_text: 'Visualization by NOAA/PMEL',
    rights_holder: 'U.S. Government',
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

describe('renderDatasetDetailPage', () => {
  let mount: HTMLDivElement

  beforeEach(() => {
    mount = document.createElement('div')
    document.body.appendChild(mount)
    sessionStorage.clear()
  })

  it('fetches /api/v1/publish/datasets/:id with the URL-encoded id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetDetailPage(mount, 'has/slash', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/publish/datasets/has%2Fslash',
      expect.anything(),
    )
  })

  it('renders the title, slug, and status badge in the header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.querySelector('.publisher-detail-title')?.textContent).toBe(
      'Sea Surface Temperature Anomaly — April 2026',
    )
    expect(mount.querySelector('.publisher-detail-slug')?.textContent).toBe(
      'sst-anomaly-2026-04',
    )
    expect(mount.querySelector<HTMLElement>('.publisher-badge-status')?.textContent).toBe(
      'Published',
    )
  })

  it('renders the back-to-list link', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const back = mount.querySelector<HTMLAnchorElement>('.publisher-back-link')
    expect(back?.getAttribute('href')).toBe('/publish/datasets')
    expect(back?.textContent).toContain('Back to all datasets')
  })

  it('renders the abstract section when abstract is non-null', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.textContent).toContain('Monthly mean SST anomaly')
  })

  it('omits the abstract section when abstract is null', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(detailResponse(dataset({ abstract: null })))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.querySelector('.publisher-detail-abstract')).toBeNull()
  })

  it('renders identity, lifecycle, assets, and licensing section headings', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const headings = Array.from(
      mount.querySelectorAll('.publisher-card-heading'),
    ).map(h => h.textContent)
    expect(headings).toContain('Identity')
    expect(headings).toContain('Lifecycle')
    expect(headings).toContain('Assets')
    expect(headings).toContain('Licensing & attribution')
  })

  it('renders the data_ref in a monospace value cell', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const monoValues = Array.from(
      mount.querySelectorAll('.publisher-field-value-mono'),
    ).map(el => el.textContent)
    expect(monoValues).toContain('r2:videos/01ABC/master.m3u8')
  })

  it('skips field rows with null values rather than rendering empty cells', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset({ doi: null })))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.textContent).not.toContain('DOI')
  })

  it('renders the not-found card on a 404 response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await renderDatasetDetailPage(mount, 'missing', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.textContent).toContain('Dataset not found')
    // Back link still rendered so the user can recover.
    expect(mount.querySelector('.publisher-back-link')).not.toBeNull()
    // No Refresh button on the not-found state — the back link
    // is the right recovery action.
    expect(mount.querySelector('.publisher-button')).toBeNull()
  })

  it('renders keywords + tags as chips in the categorization card', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      detailResponse(dataset(), {
        keywords: ['sst', 'anomaly'],
        tags: ['demo'],
      }),
    )
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const headings = Array.from(
      mount.querySelectorAll('.publisher-card-heading'),
    ).map(h => h.textContent)
    expect(headings).toContain('Keywords & tags')
    const chipTexts = Array.from(mount.querySelectorAll('.publisher-chip-text')).map(
      el => el.textContent,
    )
    expect(chipTexts).toEqual(expect.arrayContaining(['sst', 'anomaly', 'demo']))
  })

  it('omits the categorization card when keywords and tags are empty', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const headings = Array.from(
      mount.querySelectorAll('.publisher-card-heading'),
    ).map(h => h.textContent)
    expect(headings).not.toContain('Keywords & tags')
  })

  it('renders an Edit button linking to the edit page', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const edit = mount.querySelector<HTMLAnchorElement>('.publisher-detail-edit')
    expect(edit).not.toBeNull()
    expect(edit?.getAttribute('href')).toBe(
      '/publish/datasets/01AAAAAAAAAAAAAAAAAAAAAAAA/edit',
    )
    expect(edit?.textContent).toBe('Edit')
  })

  it('Edit button delegates to routerNavigate on a plain click', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    const routerNavigate = vi.fn<(path: string) => void>()
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
      routerNavigate,
    })
    const edit = mount.querySelector<HTMLAnchorElement>('.publisher-detail-edit')!
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    edit.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(routerNavigate).toHaveBeenCalledWith(
      '/publish/datasets/01AAAAAAAAAAAAAAAAAAAAAAAA/edit',
    )
  })

  it('Edit button lets the browser handle modifier-clicks', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    const routerNavigate = vi.fn<(path: string) => void>()
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
      routerNavigate,
    })
    const edit = mount.querySelector<HTMLAnchorElement>('.publisher-detail-edit')!
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    })
    edit.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(routerNavigate).not.toHaveBeenCalled()
  })

  it('renders a Publish button on a draft row', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset({ published_at: null })))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.querySelector('.publisher-detail-publish')?.textContent).toBe(
      'Publish',
    )
    expect(mount.querySelector('.publisher-detail-retract')).toBeNull()
  })

  it('renders a Retract button on a published row', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset()))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.querySelector('.publisher-detail-retract')?.textContent).toBe(
      'Retract',
    )
    expect(mount.querySelector('.publisher-detail-publish')).toBeNull()
  })

  it('renders a Publish button on a retracted row (re-publish path)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(detailResponse(dataset({ retracted_at: '2026-05-01T00:00:00Z' })))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.querySelector('.publisher-detail-publish')?.textContent).toBe(
      'Publish',
    )
  })

  it('skips the publish action when the publisher cancels the confirm prompt', async () => {
    const fetchFn = vi.fn().mockResolvedValue(detailResponse(dataset({ published_at: null })))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
      confirmFn: () => false,
    })
    mount.querySelector<HTMLButtonElement>('.publisher-detail-publish')?.click()
    await new Promise(r => setTimeout(r, 0))
    // Only the initial GET — no POST to the publish endpoint.
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('POSTs to /publish on confirm and refreshes the view', async () => {
    const draft = dataset({ published_at: null })
    const published = dataset({ published_at: '2026-05-10T00:00:00Z' })
    const fetchFn = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce(detailResponse(draft))
      // POST publish
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ dataset: published, keywords: [], tags: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // post-action GET
      .mockResolvedValueOnce(detailResponse(published))
    await renderDatasetDetailPage(mount, '01AAAAAAAAAAAAAAAAAAAAAAAA', {
      fetchFn: fetchFn as unknown as typeof fetch,
      confirmFn: () => true,
    })
    mount.querySelector<HTMLButtonElement>('.publisher-detail-publish')!.click()
    await new Promise(r => setTimeout(r, 0))
    // Wait for the post-action refetch to settle.
    await new Promise(r => setTimeout(r, 0))
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      '/api/v1/publish/datasets/01AAAAAAAAAAAAAAAAAAAAAAAA/publish',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mount.querySelector<HTMLElement>('.publisher-badge-status')?.textContent).toBe(
      'Published',
    )
    expect(mount.querySelector('.publisher-detail-retract')).not.toBeNull()
  })

  it('POSTs to /retract on a published row', async () => {
    const published = dataset()
    const retracted = dataset({ retracted_at: '2026-05-10T00:00:00Z' })
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(detailResponse(published))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ dataset: retracted, keywords: [], tags: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(detailResponse(retracted))
    await renderDatasetDetailPage(mount, '01AAAAAAAAAAAAAAAAAAAAAAAA', {
      fetchFn: fetchFn as unknown as typeof fetch,
      confirmFn: () => true,
    })
    mount.querySelector<HTMLButtonElement>('.publisher-detail-retract')!.click()
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      '/api/v1/publish/datasets/01AAAAAAAAAAAAAAAAAAAAAAAA/retract',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces a validation error inline without flipping the badge', async () => {
    const draft = dataset({ published_at: null })
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(detailResponse(draft))
      // POST publish → 400 with validation errors
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [{ field: 'data_ref', code: 'required', message: 'data_ref required' }],
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      // post-action refetch — still a draft
      .mockResolvedValueOnce(detailResponse(draft))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
      confirmFn: () => true,
    })
    mount.querySelector<HTMLButtonElement>('.publisher-detail-publish')!.click()
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(mount.querySelector('.publisher-detail-action-error')?.textContent).toMatch(
      /validation/i,
    )
    expect(mount.querySelector<HTMLElement>('.publisher-badge-status')?.textContent).toBe(
      'Draft',
    )
  })

  it('renders the retracted-state badge for a retracted row', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(detailResponse(dataset({ retracted_at: '2026-05-01T00:00:00Z' })))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const badge = mount.querySelector<HTMLElement>('.publisher-badge-status')
    expect(badge?.textContent).toBe('Retracted')
    expect(badge?.dataset.status).toBe('suspended')
  })

  it('renders the server-error card on a 5xx response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(mount.textContent).toContain('server returned an error')
  })

  it('delegates session errors to the shared handler', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    const navigate = vi.fn()
    await renderDatasetDetailPage(mount, '01ABC', {
      fetchFn: fetchFn as unknown as typeof fetch,
      navigate,
    })
    expect(navigate).toHaveBeenCalledOnce()
  })
})
