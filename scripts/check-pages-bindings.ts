/**
 * scripts/check-pages-bindings.ts — audit Pages bindings against
 * the expected manifest.
 *
 * The Phase 1d/AB walkthrough surfaced one foot-gun more than any
 * other: the dashboard's per-environment Production / Preview
 * toggle. Forgetting to mirror a binding into both environments
 * yields the silent-failure pattern "works on the preview deploy,
 * 503s on the prod URL" (or the reverse). This script makes that
 * automated: read the project's actual binding set from the
 * Cloudflare REST API, diff against `scripts/lib/expected-bindings.ts`,
 * print a table.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... \
 *   CLOUDFLARE_ACCOUNT_ID=... \
 *   [CLOUDFLARE_PAGES_PROJECT_NAME=terraviz] \
 *   npx tsx scripts/check-pages-bindings.ts
 *
 * Exit codes:
 *   0 — every required binding present in every environment it
 *       declares (extras are informational, not a failure).
 *   1 — at least one required binding is missing somewhere.
 *   2 — usage / configuration error (missing env vars, bad token,
 *       network failure).
 *
 * Why REST and not Wrangler? Wrangler has `pages project list /
 * create / delete` but no `project info` for the deployment
 * configs that carry the binding-level data. The REST endpoint is
 * the same one the dashboard's "Variables and Bindings" tab reads
 * from — the script's view matches the dashboard's view.
 */

import { EXPECTED_BINDINGS } from './lib/expected-bindings.ts'
import {
  diffBindings,
  formatDiffTable,
  RestApiSource,
  type DiffEntry,
} from './lib/cf-pages-api.ts'

interface CliEnv {
  CLOUDFLARE_API_TOKEN?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_PAGES_PROJECT_NAME?: string
}

export interface RunDeps {
  env: CliEnv
  stdout: { write: (s: string) => void }
  stderr: { write: (s: string) => void }
  fetchImpl?: typeof fetch
}

export async function runCheck(deps: RunDeps): Promise<number> {
  const token = deps.env.CLOUDFLARE_API_TOKEN
  const accountId = deps.env.CLOUDFLARE_ACCOUNT_ID
  const projectName = deps.env.CLOUDFLARE_PAGES_PROJECT_NAME ?? 'terraviz'

  if (!token || !accountId) {
    deps.stderr.write(
      'check-pages-bindings: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.\n' +
        'Mint a read-only token at https://dash.cloudflare.com/profile/api-tokens\n' +
        '(scope: "Pages → Read"), and set CLOUDFLARE_ACCOUNT_ID to the owning account.\n',
    )
    return 2
  }

  const source = new RestApiSource({
    apiToken: token,
    accountId,
    projectName,
    fetchImpl: deps.fetchImpl,
  })
  let actual
  try {
    actual = await source.fetchProject()
  } catch (e) {
    deps.stderr.write(
      `check-pages-bindings: failed to fetch project "${projectName}": ${
        e instanceof Error ? e.message : String(e)
      }\n`,
    )
    return 2
  }

  const entries = diffBindings(EXPECTED_BINDINGS, actual)
  deps.stdout.write(`Pages bindings audit — project "${projectName}"\n\n`)
  deps.stdout.write(formatDiffTable(entries) + '\n')

  const missing = entries.filter(e => e.status === 'missing')
  const summary = summariseMissing(missing)
  if (missing.length === 0) {
    deps.stdout.write(
      '\nAll required bindings present in both Production and Preview. ✓\n',
    )
    return 0
  }
  deps.stdout.write(`\n${summary}\n`)
  return 1
}

function summariseMissing(missing: DiffEntry[]): string {
  if (missing.length === 0) return ''
  const byEnv = new Map<string, number>()
  for (const m of missing) byEnv.set(m.environment, (byEnv.get(m.environment) ?? 0) + 1)
  const parts = [...byEnv.entries()].map(([env, n]) => `${n} in ${env}`)
  return (
    `${missing.length} required binding(s) missing — ${parts.join(', ')}.\n` +
    'Wire them in the dashboard under Settings → Variables and Bindings,\n' +
    'then trigger a redeploy (Step 5 of CATALOG_BACKEND_DEVELOPMENT.md).'
  )
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv?.[1] !== undefined &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, '/')}`, 'file://').toString()

if (isMain) {
  void runCheck({
    env: process.env as CliEnv,
    stdout: process.stdout,
    stderr: process.stderr,
  }).then(code => {
    process.exit(code)
  })
}
