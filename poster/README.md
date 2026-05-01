# TerraViz Poster

A web-based presentation poster covering TerraViz —
companion to the existing series:

- [`zyra` poster](https://noaa-gsl.github.io/zyra/poster/)
- [`depot-explorer` poster](https://noaa-gsl.github.io/depot-explorer/)
- [`zyra-editor` poster](https://zyra-project.github.io/zyra-editor/)

The full plan, build phases, and section outline live in
[`docs/POSTER_PLAN.md`](../docs/POSTER_PLAN.md).

## Layout

| Path | Purpose |
|---|---|
| `sections/_head.html` | `<head>` — title, meta, fonts, `<!-- INLINE_CSS -->` marker |
| `sections/_styles.css` | All CSS; inlined into a `<style>` block by the build script |
| `sections/_body-open.html` | Opening `<body>`, sticky timer, `<main>` |
| `sections/_footer.html` | Closing tags, inline timer + scroll-fade JS |
| `sections/sec-NN-name.html` | One section per file, ordered by `NN` |
| `scripts/build_poster.py` | Concatenates templates + sections → `index.html` |
| `assets/` | Logos, QR codes, screenshots, XR captures, diagrams |
| `index.html` | **Build output — do not edit by hand.** |

## Authoring workflow

1. Edit a partial under `sections/`. Never edit `index.html`
   directly.
2. Re-render:

   ```sh
   python3 poster/scripts/build_poster.py
   ```

3. Inspect the result:

   ```sh
   git diff poster/index.html
   ```

   Confirm the rendered output changed the way the partial
   implies.
4. Commit both the partial and `poster/index.html` together so
   the deploy serves the rendered file with no build step. PR
   reviewers see source diff and rendered diff in one place.

## Build script

Stdlib-only Python 3. No third-party dependencies. Runs from
anywhere:

```sh
python3 poster/scripts/build_poster.py
```

What it does:

- Reads `_head.html`, `_styles.css`, `_body-open.html`, and
  `_footer.html` from `sections/`.
- Replaces the `<!-- INLINE_CSS -->` marker in `_head.html`
  with `<style>...</style>` wrapping the contents of
  `_styles.css` so the rendered file is self-contained and
  works under `file://`.
- Globs `sections/sec-*.html` in lexical (numeric) order and
  appends them between the opening body and the footer.
- Writes `poster/index.html`. Prints byte / line counts.

## Deploy

Cloudflare Pages, separate project (`terraviz-poster`).
Production: <https://poster.terraviz.zyra-project.org>.
Per-PR previews:
`https://<branch-alias>.terraviz-poster.pages.dev`.

Deploys are driven by `.github/workflows/poster.yml` —
`wrangler pages deploy poster/ --project-name terraviz-poster`
runs whenever `poster/**` (or the workflow file itself)
changes. Same `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
secrets the SPA pipeline already uses. The rendered
`index.html` is committed alongside the partials so wrangler
just uploads the static contents — no Python on CI.

## Drift guard (optional, P11)

A CI check re-runs `build_poster.py` and fails if
`git diff --exit-code poster/index.html` reports changes.
Same shape as `npm run check:privacy-page` in this repo.

## Build phases

Tracked in [`docs/POSTER_PLAN.md`](../docs/POSTER_PLAN.md#build-phases).
P1 (this commit) ships the scaffold, the build script, the
hero, and the placeholder section anchors. Subsequent phases
fill in one section per commit.
