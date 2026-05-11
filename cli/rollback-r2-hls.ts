/**
 * `terraviz rollback-r2-hls` — undo a single migrated dataset.
 *
 * Phase 3 commit F. Mirrors Phase 2's unmerged `rollback-stream`:
 * after a row has been migrated to R2/HLS, this subcommand
 * flips its `data_ref` back to `vimeo:<id>` and deletes the R2
 * bundle.
 *
 * Per-row pipeline:
 *
 *   1. GET the dataset, verify `data_ref` currently starts with
 *      `r2:videos/`. Refuses if it's already on `vimeo:` or any
 *      other scheme — caller error.
 *   2. PATCH `data_ref` back to `vimeo:<id>` (the operator
 *      provides the original vimeo id explicitly via
 *      `--to-vimeo=<n>`). **Commit point.** After this PATCH,
 *      the SPA's manifest endpoint resolves the row through the
 *      Vimeo proxy again.
 *   3. Delete the R2 bundle under the dataset's key prefix
 *      (cleanup). Non-fatal — if it fails, the row is already
 *      correctly back on `vimeo:` and an orphan R2 prefix is
 *      left behind for manual cleanup.
 *
 * The PATCH-before-DELETE ordering matters: PATCH failure
 * leaves the catalog correct (row still on r2:, bundle intact
 * and playable). DELETE failure after a successful PATCH leaves
 * the catalog correct (row on vimeo:, orphan R2 prefix is just
 * storage cost the operator can clean up later).
 *
 * Why explicit `--to-vimeo=<n>`? The original Vimeo id is
 * recoverable from the SOS snapshot or the legacy_id, but the
 * rollback tool stays deploy-agnostic: any operator who knows
 * the original `vimeo:<id>` can roll back regardless of whether
 * their catalog traces back to SOS or another source.
 */

import {
  deleteR2Prefix as deleteR2PrefixLib,
  loadR2ConfigFromEnv,
  type R2UploadConfig,
} from './lib/r2-upload'
import type { CommandContext } from './commands'
import { getString, getBool } from './lib/args'

interface DatasetGetEnvelope {
  dataset: { id: string; data_ref: string; title?: string }
}

interface DatasetUpdateEnvelope {
  dataset: { id: string; slug: string }
}

export interface RollbackR2HlsDeps {
  /** DI for the R2 prefix-delete helper. Defaults to the production import. */
  deleteR2Prefix?: typeof deleteR2PrefixLib
  /** R2 credentials. Defaults to reading R2_S3_ENDPOINT /
   * R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY from process.env. */
  r2Config?: R2UploadConfig
}

export async function runRollbackR2Hls(
  ctx: CommandContext,
  deps: RollbackR2HlsDeps = {},
): Promise<number> {
  const datasetId = ctx.args.positional[0]
  if (!datasetId) {
    ctx.stderr.write(
      'Usage: terraviz rollback-r2-hls <dataset_id> --to-vimeo=<vimeo_id> [--dry-run]\n',
    )
    return 2
  }
  const toVimeo = getString(ctx.args.options, 'to-vimeo')
  if (!toVimeo) {
    ctx.stderr.write('--to-vimeo=<vimeo_id> is required.\n')
    return 2
  }
  if (!/^\d+$/.test(toVimeo)) {
    ctx.stderr.write(`--to-vimeo must be a numeric Vimeo id (got "${toVimeo}").\n`)
    return 2
  }
  const dryRun = getBool(ctx.args.options, 'dry-run')

  // Stage 0 — fetch current state.
  const got = await ctx.client.get<DatasetGetEnvelope>(datasetId)
  if (!got.ok) {
    ctx.stderr.write(
      `Could not GET ${datasetId} (${got.status}): ${got.error}` +
        (got.message ? ` — ${got.message}` : '') +
        '\n',
    )
    return 1
  }
  const currentRef = got.body.dataset.data_ref
  if (!currentRef.startsWith('r2:videos/')) {
    ctx.stderr.write(
      `Dataset ${datasetId} data_ref is "${currentRef}", not r2:videos/. Nothing to roll back.\n`,
    )
    return 2
  }
  // Strip both the `r2:` scheme prefix and the trailing
  // `/master.m3u8` filename to get the bundle's key prefix.
  // Anything below the master playlist (variant playlists,
  // segments) lives under the same prefix in R2.
  const r2Key = currentRef.slice('r2:'.length).trim()
  if (!r2Key) {
    ctx.stderr.write(`Dataset ${datasetId} has a malformed r2: data_ref ("${currentRef}").\n`)
    return 1
  }
  const lastSlash = r2Key.lastIndexOf('/')
  const keyPrefix = lastSlash >= 0 ? r2Key.slice(0, lastSlash) : r2Key

  ctx.stdout.write(
    `Rollback plan:\n` +
      `  dataset:                ${datasetId}` +
      (got.body.dataset.title ? `  (${got.body.dataset.title})` : '') +
      '\n' +
      `  current data_ref:       ${currentRef}\n` +
      `  target data_ref:        vimeo:${toVimeo}\n` +
      `  R2 prefix to delete:    ${keyPrefix}/\n`,
  )

  if (dryRun) {
    ctx.stdout.write('\nDry run — no changes will be made.\n')
    return 0
  }

  // Stage 1 — flip data_ref. Commit point.
  const patched = await ctx.client.updateDataset<DatasetUpdateEnvelope>(datasetId, {
    data_ref: `vimeo:${toVimeo}`,
  })
  if (!patched.ok) {
    ctx.stderr.write(
      `data_ref PATCH failed (${patched.status}): ${patched.error}` +
        (patched.message ? ` — ${patched.message}` : '') +
        '\n',
    )
    return 1
  }
  ctx.stdout.write(`✓ data_ref flipped to vimeo:${toVimeo}\n`)

  // Stage 2 — delete the R2 bundle (cleanup; non-fatal).
  const r2Config = deps.r2Config ?? loadR2ConfigFromEnv()
  if (!r2Config.endpoint || !r2Config.accessKeyId || !r2Config.secretAccessKey) {
    ctx.stderr.write(
      `! R2 credentials unset — leaving orphan ${keyPrefix}/ in R2.\n` +
        `  data_ref is correctly on vimeo:; delete the orphan via the Cloudflare dashboard or API if needed.\n`,
    )
    return 0
  }
  const deleteImpl = deps.deleteR2Prefix ?? deleteR2PrefixLib
  try {
    const out = await deleteImpl(r2Config, keyPrefix)
    ctx.stdout.write(`✓ deleted ${out.deleted} R2 object(s) under ${keyPrefix}/\n`)
  } catch (e) {
    ctx.stderr.write(
      `! Could not delete R2 prefix ${keyPrefix}/: ${e instanceof Error ? e.message : String(e)}\n` +
        `  data_ref is already on vimeo:; delete the orphan via the Cloudflare dashboard or API.\n`,
    )
    return 0
  }

  ctx.stdout.write(`\nRollback complete.\n`)
  return 0
}
