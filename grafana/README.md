# Grafana dashboards — Terraviz analytics

Two dashboards visualize the telemetry stream landed in Cloudflare
Workers Analytics Engine by `functions/api/ingest.ts`:

- **`product-health.json`** — sessions, layer load times, error
  rates, perf samples, VR session funnels, tour completion. Tier A
  signal only (works regardless of user opt-in).
- **`spatial-attention.json`** — `camera_settled` and `map_click`
  heatmaps, dataset-scoped attention bins, projection split (2D
  globe vs VR/AR). Tier A.

A third research dashboard (Tier B, requires opt-in via Tools →
Privacy) is sketched in `dashboards/research.json` — lands fully
fleshed out alongside the Tier B call sites in Commit 14.

## Data source setup (Cloudflare AE → Grafana)

Grafana doesn't ship a Cloudflare AE plugin. The two viable options:

### Option A: Infinity plugin (recommended)

The [grafana-infinity-datasource](https://grafana.com/grafana/plugins/yesoreyeram-infinity-datasource/)
plugin can call any HTTP API and parse JSON. Works against
Cloudflare's AE SQL HTTP endpoint:

1. **Install the plugin** in Grafana (or wherever you run dashboards).
2. **Add data source → Infinity**:
   - Auth: **Bearer Token**, value: a Cloudflare API token with
     **Account Analytics → Read** permission scoped to your account.
   - URL base: `https://api.cloudflare.com/client/v4/accounts/<YOUR_ACCOUNT_ID>/analytics_engine`
3. **Per-panel query setup**:
   - Type: `JSON`
   - Source: `URL`
   - URL: `${INFINITY_BASE}/sql`
   - Method: `POST`
   - Headers: `Content-Type: text/plain`
   - Body: the SQL query (see `docs/ANALYTICS_QUERIES.md`)
   - Parser: `Backend` with root `data.[*]` selector

### Option B: Custom data-source proxy

Run a tiny Cloudflare Worker that accepts Grafana's HTTP queries,
hits the AE SQL API server-side (so the API token never reaches
the browser), and returns the result. Useful if you want
Grafana-native field-mapping or row-set caching. Out of scope for
this commit; sketch on the follow-up issue tracker.

## Importing the dashboards

In Grafana: **Dashboards → New → Import → Upload JSON file**, point
at `dashboards/product-health.json`. After import, edit each panel
to point at your Infinity data source UID (the JSON ships with a
placeholder `${DS_INFINITY}` variable).

The dashboard JSON files are intentionally minimal — they wire up
the queries from `docs/ANALYTICS_QUERIES.md` as starting panels.
Polish (panel layout, colour ramps, geo-map tile servers) is
expected to be done in-Grafana after import; export and re-commit
the polished JSON so the repo stays the source of truth.

## Variables

Both dashboards expect the following Grafana variables (defined in
the JSON):

| Variable | Default | Description |
|---|---|---|
| `$environment` | `production` | Filters `blob2 = $environment` |
| `$internal` | `false` | Filters `blob4 = $internal` (set to `true` to see internal staff sessions) |
| `$country` | `All` | Filters `blob3 = $country` when set; `All` disables the filter |
| `$timeRange` | `Last 7 days` | Built-in Grafana time range, applied to `WHERE timestamp > $__from` |

## Maintenance

- **Refresh interval ≥ 60 s.** AE has a few-second ingestion lag;
  faster refresh just hits cached results.
- **Sampling.** Use `sum(_sample_interval)` for volume questions
  (event totals); use `count(DISTINCT index1)` for cardinality
  questions (unique sessions). See `docs/ANALYTICS_QUERIES.md`
  "Sampling" notes.
- **Schema drift.** When `src/types/index.ts` adds an event field,
  the alphabetical-blob ordering shifts. Re-check the affected
  dashboard panels and update any positional queries.
- **Tier B panels** (research dashboard) only show data when at
  least one user has opted into Research mode. Empty panels in a
  fresh deployment are expected.
