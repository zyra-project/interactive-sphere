# Localization & Language Support — Planning Document

**Status:** draft for review
**Date:** 2026-05-07
**Owner:** Eric Hackathorn

## Context

Terraviz's mission is to bring Earth data to the masses, but the
masses don't all speak English. Today the app is hard-coded
English end-to-end:

- **~800–1,200 distinct user-facing strings** across `index.html`,
  17+ UI modules in `src/ui/`, `src/services/docentEngine.ts`,
  `src/services/docentContext.ts`, and tour JSON in
  `public/assets/`.
- **Zero i18n scaffolding.** No `t()`, no locale switching, no
  language preference persisted. `<html lang="en">` is hardcoded.
  Date/number formatting is hardcoded `'en-US'`
  (`src/utils/time.ts`).
- The catalog data model
  ([`CATALOG_DATA_MODEL.md`](CATALOG_DATA_MODEL.md)) is
  monolingual: `title`, `abstract`, `attribution_text` etc. have
  no language column.

The user wants to:

1. Ship localization JSON in the repo, deployed with the app.
2. Allow partners to customize / add languages via the publish
   admin dashboard (planned catalog Phase 3, ~Q3 2026).
3. Provide an easy path for partner translations to flow back
   into the canonical repo.

This plan delivers the foundation in **L1** (ships independently
now), wires partner overrides in **L2** (gated on catalog Phase
3), and lights up dataset metadata in **L3** (gated on catalog
Phases 3 + 4).

---

## Design Goals

1. **Zero new always-loaded bundle weight beyond ~15 KB English
   defaults.** Three.js's lazy-load discipline is the precedent;
   i18n must respect it.
2. **Type-safe keys.** Wrong key fails the build, not at runtime.
3. **Repo is canonical.** The `locales/*.json` files in this repo
   are the source of truth. Partner overrides are clearly scoped
   as overrides, not as a parallel editorial channel.
4. **Translators get translator-grade tools.** Weblate, not git
   CLI.
5. **Codegen-from-JSON, mirroring the `tokens/` pattern.** No new
   build philosophies.
6. **Incremental migration.** No flag day, no freeze. Module-by-
   module conversion with English fallback at runtime keeps the
   app shippable throughout.

---

## Non-Goals

- **Dataset metadata translations** (titles, abstracts) — these
  are catalog-backend territory, deferred to L3 (depends on
  catalog Phases 3 + 4).
- **Tour narration translations** — deferred to a separate phase.
  Tour JSON files keep their English captions until then; new
  tours stay English-only in L1/L2.
- **Right-to-left layout** — RTL infrastructure (`dir`, locale
  set) ships in L1; the L1.5 CSS audit converts physical inline-
  axis properties (`padding-left`, `margin-right`, `text-align:
  left`, etc.) to logical equivalents and adds an explicit
  `:root[dir="rtl"]` override for the Browse panel slide. Arabic (`ar`)
  is wired into `NATIVE_NAMES` with an empty `locales/ar.json`
  so the layout can be verified via `?lang=ar`. Strings still
  need a translator before Arabic appears in the public picker
  (≥80% coverage gate).
- **Auto-translation via LLM** — a "Translate from English"
  button in the publisher portal is a future-tense option, not
  delivered here.
- **Locale-aware analytics** — `navigator.language` is already
  captured in `src/analytics/session.ts:detectLocale()`; that's
  enough for now.

---

## L1 Scope (this plan)

Per user decision (2026-05-07): **UI chrome + Orbit/LLM**.

| Surface | Strategy |
|---|---|
| `index.html` shell + loading screen | `data-i18n*` HTML attributes, walked by `applyI18nAttributes()` on boot and on locale change |
| `src/ui/*.ts` (browse, chat, tools, help, privacy, downloads, playback, VR button, disclosure banner, credits) | `t('key')` and `plural()` at render time |
| `src/services/docentEngine.ts` (local fallback) | All response templates moved into `locales/*.json` |
| `src/services/docentContext.ts` (LLM system prompt) | Prompt augmented with `Respond in {language_name}.` directive when locale is non-English; LLM does the translation work |
| `src/utils/time.ts` and other formatters | Replace hardcoded `'en-US'` with locale-aware helpers from `src/i18n/format.ts` |

**Not in L1:** dataset metadata, tour captions, partner overrides,
RTL, auto-translation.

**Seed locales (per user decision):** English (source) + Spanish
(`es`). Other locales onboarded via Weblate after L1 ships.

---

## Architecture

### Approach: thin custom layer + JSON codegen

A ~1 KB runtime `t()` plus a build-time codegen that mirrors the
`tokens/*.json → src/styles/tokens.css` pattern. **No i18n
library.** Bundle math defends this: `i18next` is ~16 KB gzipped,
`@formatjs/intl` is ~24 KB gzipped, and the project's chrome
strings are 99% fixed labels — full ICU MessageFormat is
genuinely overkill. The handful of plurals ("Found N datasets")
go through a small `plural()` helper backed by
`Intl.PluralRules`, which is built into every supported runtime.

| Approach | Bundle | Type-safe keys | Verdict |
|---|---|---|---|
| **Thin custom layer (chosen)** | ~1 KB | Yes via `keyof typeof messages.en` | Mirrors `tokens/`, no new deps, no upgrade churn |
| `@formatjs/intl` | ~24 KB gz | Yes | Overkill; ICU not needed |
| `i18next` | ~16 KB gz | Weak | Heavier API surface than we need |
| `polyglot.js` | ~4 KB gz | No | Smaller but loses type safety we get for free |

### Runtime sketch

```ts
// src/i18n/index.ts
import { messages, type MessageKey } from './messages' // generated
export function t<K extends MessageKey>(
  key: K,
  params?: Record<string, string | number>,
): string {
  const raw = table[key] ?? messages.en[key] ?? key
  return params ? interpolate(raw, params) : raw
}
export function plural(
  count: number,
  forms: { one: MessageKey; other: MessageKey; ... },
  params?: Record<string, string | number>,
): string { /* Intl.PluralRules dispatch */ }
```

Missing-key fallback chain: `messages[active][key] →
messages.en[key] → raw key string` (with a one-time dev console
warning, gated behind `__BUNDLED_DEV__` so it dead-code-eliminates
in production).

### Key naming

Flat dotted keys, namespaced by surface:
`<surface>.<element>.<role>`. Examples:

```
app.title                        = "Terraviz"
app.skipLink                     = "Skip to globe visualization"
loading.status.initializing      = "Initializing…"
browse.search.placeholder        = "Search datasets…"
browse.search.clear.aria         = "Clear search"
browse.count.zero                = "No datasets"
browse.count.one                 = "1 dataset"
browse.count.other               = "{count} datasets"
docent.greeting.default          = "Hello! I'm here to guide you…"
docent.results.found.one         = "I found 1 dataset matching \"{query}\"."
docent.results.found.other       = "I found {count} datasets matching \"{query}\"."
```

Flat keys give `keyof typeof messages.en` directly, keep grep
useful, and stay JSON-Schema-validatable.

### File structure

```
locales/
  en.json                source of truth
  es.json                first non-English locale
  _explanations.json     optional sidecar — per-string developer
                         notes pushed to Weblate via
                         `scripts/sync-weblate-metadata.ts`. The
                         underscore prefix tells both Weblate and
                         the codegen that this is sidecar metadata,
                         not a locale file.
scripts/
  generate-locales.ts    validate + emit (mirrors build-privacy-page.ts).
                         Acts as the canonical validator (key regex,
                         flat string→string, forbidden-pattern gate);
                         no separate JSON-Schema file is maintained.
  generate-locales.test.ts
src/i18n/
  index.ts               t(), plural(), setLocale(), getLocale(), interpolate()
  detect.ts              navigator.language → BCP-47 fallback chain
  format.ts              formatDate, formatNumber, formatList, formatRelative
  persistence.ts         localStorage 'sos-locale-prefs' (mirrors viewPreferences)
  rtl.ts                 RTL_LOCALES set + dir helpers
  applyI18nAttributes.ts DOM walker for data-i18n* attributes
  messages.ts            GENERATED, gitignored — entry module
  messages.<locale>.ts   GENERATED per non-source locale, gitignored
                         (one chunk per locale; lazy-loaded by
                         localeLoaders in messages.ts)
  __tests__/index.test.ts
  __tests__/detect.test.ts
```

`locales/` peer to `tokens/`, treated identically. Generated TS
joins `src/styles/tokens.css` in `.gitignore`.

### Build pipeline integration

| Hook | Action |
|---|---|
| `postinstall` | `npm run tokens && npm run locales` |
| `predev` / `prebuild` | `npm run locales` (regenerates if locale JSON changed) |
| `type-check` | `npm run locales && tsc --noEmit` (so types stay current) |
| CI | `npm run check:locales` — `--check` mode regenerates to a temp string and byte-compares; fails on drift |

`generate-locales.ts` follows the exact shape of
[`scripts/build-privacy-page.ts`](../scripts/build-privacy-page.ts):

1. Read `locales/*.json`.
2. Validate each locale against the flat-string contract
   enforced in code (`KEY_RE = ^[a-z][a-zA-Z0-9.]*$`, value must be
   string, forbidden-pattern gate for script-class HTML).
3. Diff every non-source locale's keys against `en.json`. Missing
   in target = warn; extra in target = fail; missing in source =
   fail.
4. **Canonicalize** each `locales/*.json` in place — 2-space
   indent, LF, trailing newline, no interior blank lines, keys
   sorted alphabetically, literal Unicode for BMP characters.
   Matches Weblate's GitHub-bridge output exactly so translator
   round-trips never produce whitespace-only diffs against `main`,
   and `--check` in CI catches anyone who edits a locale without
   running the codegen. The codegen is the canonical formatter —
   developers can type whatever style they like; predev/prebuild
   normalize before commit.
5. Emit `src/i18n/messages.ts` (entry: English bundle inline,
   `Locale` / `MessageKey` types, `localeLoaders` map for lazy
   chunks) plus one `src/i18n/messages.<locale>.ts` per
   non-source locale (the lazy chunks).
6. `--check` flag: regenerate to memory, byte-compare, exit 1 on
   drift.
7. Forbidden-pattern gate: reject any locale value containing
   `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`,
   `<style>`, on*-handlers, `javascript:` / `vbscript:` / `data:`
   URLs. Pairs with the runtime allowlist sanitizer in
   `src/ui/sanitizeHtml.ts` for the help-guide HTML blobs.

### Loading model

**English ships inline; non-English locales lazy-load via dynamic
`import()`.** Codegen emits one TS file per non-source locale
(`messages.en.ts`, `messages.es.ts`) so Vite splits chunks
naturally.

Boot flow in `src/main.ts`:

1. `setLocale('en')` synchronously (English available
   immediately).
2. `detectLocale()` walks `localStorage` → `?lang=` query →
   `navigator.languages[]` BCP-47 ladder → `'en'` default.
3. If non-English: `await load(detected)` → `setLocale(detected)`.
4. `applyI18nAttributes(document)` to apply translations to HTML
   `data-i18n*` attributes.
5. Continue existing UI bootstrap.

Sizing: ~1,000 strings × ~50 bytes ≈ 50 KB JSON per locale →
~15 KB gzipped chunk. Inline English ≈ 15 KB gzipped, well under
the implicit 50 KB ceiling.

### Locale picker UI

A new "Language" section in the Tools menu
([`src/ui/toolsMenuUI.ts`](../src/ui/toolsMenuUI.ts)) between
"View" and "Layout". Single `<select>` populated from the
supported locale set with native names (`English`, `Español`).
**Switching reloads the page.** The vanilla TS architecture has
no reactive framework to re-render arbitrary modules, and locale
switches are session-rare; reload is the honest UX.

No first-launch language modal. Detection is good enough; the
picker is discoverable in Tools.

### Orbit / LLM language

[`src/services/docentContext.ts`](../src/services/docentContext.ts)`:buildSystemPromptForTurn()`
appends one line when the active locale is non-English:

```
Respond in {LOCALE_NAME}. Even when the user writes in English,
your reply, dataset summaries, and any captions must be in
{LOCALE_NAME}. Keep <<LOAD:DATASET_ID>> markers and tool-call
syntax exactly as specified.
```

`{LOCALE_NAME}` resolves via `Intl.DisplayNames(locale,
{type:'language'}).of(locale)` — no extra translation table
needed. The local docent fallback engine
([`src/services/docentEngine.ts`](../src/services/docentEngine.ts))
reads its response templates from `locales/*.json` like any
other UI surface.

Quality risk: smaller models occasionally inject English. We
accept that in L1; it's less bad than not localizing Orbit at
all, and the worst case is a partial-English response, not a
broken UI.

---

## Migration Strategy

Incremental, surface-by-surface, English fallback always wins on
missing keys. The type union is built from `en.json` only — a
key missing from `es.json` falls back at runtime, not at compile
time, so `t('foo.bar')` either compiles (key exists in English)
or fails the build.

| Wave | Scope | Strings | Effort |
|---|---|---|---|
| 0 | Scaffolding only — `src/i18n/`, codegen, CI gate, types | 0 | 1 d |
| 1 | `src/index.html` shell + loading screen + `applyI18nAttributes` | ~80 | 1 d |
| 2 | `toolsMenuUI` + `mapControlsUI` + language picker | ~70 | 1 d |
| 3 | `browseUI` + ARIA | ~120 | 1.5 d |
| 4 | `chatUI` + `docentEngine` fallback strings + `docentContext` `Respond in $LANG` augmentation | ~180 | 2 d |
| 5 | `tourUI` + `playbackController` (controls only — tour captions stay English) | ~150 | 1.5 d |
| 6 | `helpUI` + `creditsPanel` + `privacyUI` + `disclosureBanner` + `downloadUI` | ~200 | 2 d |
| 7 | `vrButton`, debug panels (English-acceptable but translatable) | ~30 | 0.5 d |

Total: ~10 working days of migration after scaffolding. Each
wave is a stand-alone PR.

### CI gates

- `npm run check:locales` — fails on locale drift, missing-in-
  source keys, schema violations, or extra keys in non-source
  locales.
- New-string lint (heuristic, in `npm test`): grep `src/ui/*.ts`
  and `src/services/docent*.ts` for string literals containing
  `≥3 consecutive ASCII letters and a space`. Flag unless
  suppressed with `// i18n-exempt: <reason>` on the same line.
  Catches ~90% of regressions; not perfect but cheap.

### HTML migration pattern

```html
<button id="browse-close"
        data-i18n-title="browse.close.aria"
        data-i18n-aria-label="browse.close.aria">&#x2715;</button>
```

`applyI18nAttributes(root)` reads `data-i18n`, `data-i18n-aria-
label`, `data-i18n-title`, `data-i18n-placeholder` attributes
and rewrites the corresponding text/attribute. Run once after
DOMContentLoaded and again on locale change (before reload, so
the first paint after reload is correct).

---

## Phasing

| Phase | Scope | Depends on | Status |
|---|---|---|---|
| **L1** | i18n foundation, UI chrome + Orbit, English + Spanish, Weblate inbound | Nothing | This plan |
| **L1.5** | RTL CSS audit (logical properties throughout `src/styles/`); Arabic locale wired in for layout verification (translators still needed) | L1 | CSS shipped; Arabic translation in progress on Weblate |
| **L2** | Partner UI overrides via `/api/v1/locale/<lang>` overlay endpoint, publisher portal locale-override editor, Tauri offline snapshot | Catalog backend Phase 3 (publisher portal) | Q3+ 2026 |
| **L3** | Dataset metadata translations: `dataset_translations` sidecar table, CLI `--lang` sidecar files, federation propagation of signed translation rows | Catalog backend Phases 3 + 4 | 2027+ |
| **L4** | Tour narration translations | L3 + tour authoring tooling | TBD |

**L1 is shippable immediately.** L2 and L3 are blocked on catalog
backend phases that don't exist yet — call out so the user knows
what's blocking what.

---

## Partner Customization (L2 preview, not delivered here)

Per user decision: **defer to L2 after publisher portal exists.**

When L2 lands:

- `GET /api/v1/locale/<bcp47>` → `{ "version": "<sha256>",
  "overrides": { "browse.title": "Datasets", … } }`. Sparse —
  only keys the partner overrode. Edge-cached 5 min with
  `stale-while-revalidate=86400`.
- Client merges:
  `messages = { ...repoEn, ...repoLocale, ...overlayLocale }`.
  Partner wins, English fills gaps.
- Tauri snapshots last successful overlay into
  `app_data/locale-overlay.json` for offline use (mirrors the
  tile-cache pattern).
- Publisher portal: flat key/value editor with English source as
  placeholder, prefix-filterable. Explicitly a re-skin surface,
  not a translation editor — new languages still come through
  Weblate.

L1 does NOT need to model this; the L2 endpoint plugs into the
existing fallback chain at the front of the merge order.

---

## Contribution-Back Loop

Per user decision: **Weblate as canonical inbound, GitHub PRs
always available as the developer escape hatch.**

- **Live Weblate project**:
  <https://hosted.weblate.org/projects/terraviz/> — translator
  landing page is the engage URL,
  <https://hosted.weblate.org/engage/terraviz/>. Connected to
  the GitHub repo on the libre-project free tier; round-trips
  translations as commits/PRs against `main`. Translators get
  glossaries, translation memory, voting, and progress
  dashboards. Workflow + glossary documented in
  [`CONTRIBUTING-TRANSLATIONS.md`](../CONTRIBUTING-TRANSLATIONS.md).
- **GitHub PRs** remain available; Weblate's output _is_ a PR, so
  there is one canonical inbound channel with two on-ramps
  (Weblate UI for translators, git CLI for developers).
- **DCO sign-off** is enforced on Weblate's GitHub bridge,
  matching the project's existing
  ["all commits must be DCO signed-off"](../CLAUDE.md) rule.
- **Reviewers**: a `CODEOWNERS` entry per locale
  (`locales/es.json @es-reviewers-team`). PRs require one native-
  speaker reviewer; if no reviewer team exists for a language,
  the locale stays in `experimental` status, hidden from the
  public picker behind `?lang=<code>`.
- **Coverage gate**: locale ships in the picker only when ≥80% of
  keys are translated. Below 80% = experimental, query-flag-only.
- **Stale flagging**: locale JSON entries store `{ value,
  source_hash }`. When the English source key's hash diverges,
  Weblate renders the entry as needs-review and runtime falls
  back to English.

A new `CONTRIBUTING-TRANSLATIONS.md` clarifies the workflow and
the DCO requirement. License unchanged — translations land under
the project license, no separate CLA.

---

## Critical Files

**Create:**

- `locales/en.json` (source of truth; populated incrementally
  during waves)
- `locales/es.json` (Spanish seed; can begin empty and fill via
  Weblate)
- `scripts/generate-locales.ts` (mirrors
  [`scripts/build-privacy-page.ts`](../scripts/build-privacy-page.ts))
- `scripts/generate-locales.test.ts`
- `src/i18n/index.ts` — `t()`, `plural()`, `setLocale()`,
  `getLocale()`, `interpolate()`
- `src/i18n/detect.ts`
- `src/i18n/format.ts` — `formatDate`, `formatNumber`,
  `formatList`, `formatRelative`
- `src/i18n/persistence.ts` (mirrors
  [`src/utils/viewPreferences.ts`](../src/utils/viewPreferences.ts))
- `src/i18n/rtl.ts`
- `src/i18n/applyI18nAttributes.ts`
- `src/i18n/__tests__/index.test.ts`
- `src/i18n/__tests__/detect.test.ts`
- [`CONTRIBUTING-TRANSLATIONS.md`](../CONTRIBUTING-TRANSLATIONS.md)
  — Weblate + DCO instructions

**Modify:**

- [`.gitignore`](../.gitignore) — add `src/i18n/messages.ts` and
  `src/i18n/messages.*.ts` (the per-locale lazy chunks)
- [`package.json`](../package.json) — add `locales` and
  `check:locales` scripts; chain into `postinstall`, `predev`,
  `prebuild`, `build`, `type-check`
- [`src/main.ts`](../src/main.ts) — bootstrap: detect, lazy-load,
  `setLocale()`, `applyI18nAttributes()`
- `src/orbitMain.ts` — same bootstrap on the `/orbit` entry
  point (if separate)
- [`src/utils/time.ts`](../src/utils/time.ts) — remove hardcoded
  `'en-US'`, route display formatters through
  `src/i18n/format.ts`
- [`src/services/docentContext.ts`](../src/services/docentContext.ts)
  — append `Respond in {language_name}.` directive when locale
  ≠ `en`
- [`src/services/docentEngine.ts`](../src/services/docentEngine.ts)
  — extract response templates to `locales/*.json`
- [`src/ui/toolsMenuUI.ts`](../src/ui/toolsMenuUI.ts) — add
  Language section + `<select>` picker
- [`CLAUDE.md`](../CLAUDE.md) — note the i18n CI gate
  (`check:locales`) and the "no new hardcoded strings" rule
- `AGENTS.md` — short Localization section pointing at
  `docs/I18N_PLAN.md`
- [`index.html`](../index.html) — `data-i18n*` attributes
  throughout (Wave 1)
- All `src/ui/*.ts` (Waves 2–7)

**Untouched in L1:** `src/services/dataService.ts` (catalog
metadata reader — stays monolingual until L3); all tour JSON
files in `public/assets/`; `functions/api/v1/` (no L1 server
work).

---

## Verification

End-to-end test plan:

1. **Build**: `npm install` triggers `postinstall` →
   `tokens` + `locales` codegen runs; no errors. `npm run
   type-check` passes.
2. **Unit tests**: `src/i18n/__tests__/*` cover fallback chain,
   parameter interpolation, `Intl.PluralRules` plural dispatch,
   BCP-47 ladder (`pt-BR` → `pt` → `en`), missing-key fallback,
   and `<html lang>` / `dir` attribute updates.
3. **Codegen tests**: `scripts/generate-locales.test.ts` covers
   schema violations, missing-in-source key, extra-in-target
   key, drift detection (`--check` exits non-zero).
4. **Visual regression**: run `npm run dev` (web) and `npm run
   dev:desktop` (Tauri).
   - Open Tools → Language → switch to Español. Page reloads.
     Verify all migrated UI strings render in Spanish; ARIA
     labels in Spanish (inspect DOM).
   - Open Orbit, ask a question in English. LLM responds in
     Spanish (assuming a non-`enabled: false` LLM config).
   - Disable LLM, ask Orbit a greeting. Local fallback responds
     in Spanish.
   - Switch back to English. All strings render in English on
     reload.
5. **Locale-switch persistence**: switch to Spanish, close tab,
   reopen — picker shows Spanish, app loads in Spanish.
6. **Tauri offline**: build Tauri desktop app with both locales
   bundled; verify Spanish loads with no network.
7. **CI**: open a PR that adds a key to `en.json` but not
   `es.json` — `check:locales` reports it as a warning (below
   80% gate). Open a PR that adds a key to `es.json` but not
   `en.json` — `check:locales` fails the build. Open a PR that
   regenerates `messages.ts` inconsistently — `check:locales
   --check` fails with a diff message.
8. **Bundle size**: `npm run build` and inspect `dist/assets/` —
   English locale inline ≈ 15 KB gzipped, Spanish a separate
   chunk ≈ 15 KB gzipped, main bundle within ±5 KB of pre-i18n
   baseline.
9. **Weblate connection** (out-of-band): connect Weblate to the
   GitHub repo, configure DCO bridge, confirm a test
   translation round-trips into a PR.

---

## Open Questions for Future Phases

These don't block L1, but should be tracked:

- L1.5 — RTL audit: which CSS files (`src/styles/*.css`) and
  inline styles use directional properties (`left`, `right`,
  `margin-left`, etc.) that need converting to logical
  properties?
- L2 — Publisher portal locale-override UX: form layout, search/
  filter behavior, "Copy default" button per row.
- L3 — `dataset_translations` schema migration: composite primary
  key includes `origin_node` so partners can author translations
  of upstream datasets without origin cooperation. Federation
  propagation requires Phase 4.
- L4 — Tour narration: how do tour authors edit captions per
  locale? Sidecar `*.es.json` files? Inline in tour JSON with
  language-keyed objects?
