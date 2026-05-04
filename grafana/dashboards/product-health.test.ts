/**
 * Structural validation for the Product Health dashboard's
 * migration row (Phase 2 commit G).
 *
 * Pins the load-bearing fields the dashboard relies on at import
 * time:
 *
 *   - Top-level identity (title, uid).
 *   - Standard environment / internal / DS_INFINITY templating
 *     vars are present.
 *   - Every panel's targets carry a non-empty SQL `data` field that
 *     selects from `terraviz_events` with the two standard filters.
 *   - The migration row's three panels exist with unique ids and
 *     descriptive titles.
 *   - The migration SQL pins blob1='migration_video' and uses
 *     blob7 for `outcome` — this matches `toDataPoint`'s
 *     alphabetical ordering of MigrationVideoEvent's string fields
 *     (dataset_id, legacy_id, outcome, stream_uid, vimeo_id at
 *     blob5..blob9). A future schema shift that reorders these
 *     would surface here.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DASHBOARD_PATH = resolve(__dirname, 'product-health.json')

interface Panel {
  id: number
  type: string
  title: string
  description: string
  gridPos: { x: number; y: number; w: number; h: number }
  targets: Array<{
    refId: string
    url_options?: { data?: string }
    columns?: Array<{ selector: string; text: string; type: string }>
  }>
}

interface Dashboard {
  title: string
  uid: string
  panels: Panel[]
  templating: { list: Array<{ name: string }> }
}

function load(): Dashboard {
  const raw = readFileSync(DASHBOARD_PATH, 'utf-8')
  return JSON.parse(raw) as Dashboard
}

describe('product-health dashboard — top-level structure', () => {
  const dashboard = load()

  it('declares the expected identity', () => {
    expect(dashboard.title).toBe('Terraviz — Product Health')
    expect(dashboard.uid).toBe('terraviz-product-health')
  })

  it('declares the standard environment / internal / DS_INFINITY templating vars', () => {
    const names = dashboard.templating.list.map(t => t.name).sort()
    expect(names).toEqual(['DS_INFINITY', 'environment', 'internal'])
  })

  it('every panel has unique ids and descriptive titles + descriptions', () => {
    const ids = dashboard.panels.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const panel of dashboard.panels) {
      expect(panel.title.length).toBeGreaterThan(0)
      expect(panel.description.length).toBeGreaterThan(0)
    }
  })

  it('every target queries terraviz_events with the standard environment + internal filters', () => {
    for (const panel of dashboard.panels) {
      for (const target of panel.targets) {
        const sql = target.url_options?.data ?? ''
        expect(sql.length).toBeGreaterThan(0)
        expect(sql).toMatch(/FROM\s+terraviz_events/)
        expect(sql).toMatch(/blob2\s*=\s*'\$environment'/)
        expect(sql).toMatch(/blob4\s*=\s*'\$internal'/)
      }
    }
  })

  it('every panel column list matches the columns referenced in its SQL', () => {
    for (const panel of dashboard.panels) {
      for (const target of panel.targets) {
        const cols = target.columns ?? []
        expect(cols.length).toBeGreaterThan(0)
        const sql = target.url_options?.data ?? ''
        for (const col of cols) {
          expect(sql).toMatch(new RegExp(`AS\\s+${col.selector}\\b`))
        }
      }
    }
  })
})

describe('product-health dashboard — Phase 2 migration row', () => {
  const dashboard = load()
  const migrationPanels = dashboard.panels.filter(p =>
    p.title.toLowerCase().includes('migration video'),
  )

  it('exposes three migration panels (commit 2/G)', () => {
    expect(migrationPanels).toHaveLength(3)
    const titles = migrationPanels.map(p => p.title).sort()
    expect(titles).toEqual([
      'Migration video — cumulative ok rows',
      'Migration video — failure breakdown',
      'Migration video — runs per day by outcome',
    ])
  })

  it('places the migration row on its own grid row', () => {
    const ys = new Set(migrationPanels.map(p => p.gridPos.y))
    expect(ys.size).toBe(1)
  })

  it('pins blob1 = migration_video on every migration query', () => {
    for (const panel of migrationPanels) {
      for (const target of panel.targets) {
        const sql = target.url_options?.data ?? ''
        expect(sql).toMatch(/blob1\s*=\s*'migration_video'/)
      }
    }
  })

  it('uses blob7 for outcome (alphabetical position in MigrationVideoEvent)', () => {
    // bytes_uploaded, dataset_id, duration_ms, legacy_id, outcome,
    // stream_uid, vimeo_id sorted alphabetically.
    // Strings only (blobs): dataset_id (5), legacy_id (6),
    // outcome (7), stream_uid (8), vimeo_id (9).
    // So `outcome` lives at blob7. Pin it explicitly.
    const failureBreakdown = migrationPanels.find(p =>
      p.title.includes('failure breakdown'),
    )
    expect(failureBreakdown).toBeDefined()
    const sql = failureBreakdown!.targets[0].url_options!.data!
    expect(sql).toMatch(/blob7\s+AS\s+outcome/)
    expect(sql).toMatch(/blob7\s*!=\s*'ok'/)
  })

  it('cumulative ok query filters blob7 = ok', () => {
    const cumulative = migrationPanels.find(p => p.title.includes('cumulative'))
    expect(cumulative).toBeDefined()
    const sql = cumulative!.targets[0].url_options!.data!
    expect(sql).toMatch(/blob7\s*=\s*'ok'/)
    expect(sql).toMatch(/AS\s+ok_rows/)
  })
})
