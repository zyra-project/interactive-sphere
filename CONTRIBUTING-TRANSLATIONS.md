# Contributing Translations

Terraviz ships in English by default and adds locales as community
translators contribute them. This doc covers the two ways to
translate the app and the rules every translation has to follow
before it lands.

## TL;DR

- **Translate via Weblate** (recommended): <https://hosted.weblate.org/engage/terraviz/>
- **Or open a PR directly** if you're a developer comfortable with
  git: edit `locales/<bcp47>.json` and submit.
- Every commit needs DCO sign-off (`git commit -s`); Weblate
  enforces this on its outbound PRs.
- Locales appear in the Tools → Language picker once they reach
  ≥80% key coverage. Below that, they're available behind the
  `?lang=<code>` query flag for testing.

---

## What lives where

The repo root has two pieces:

```
locales/
  en.json        Source of truth — every key originates here
  es.json        Spanish — the L1 seed locale
  …              one file per supported locale

src/types/
  locale.schema.json   JSON-Schema validator for the key/value shape.
                       Lives outside locales/ so Weblate's
                       (non-recursive) locales/*.json filemask
                       doesn't pick it up as a translation file.
```

Each locale file is a flat JSON object mapping a dotted key like
`browse.search.placeholder` to its translated string. Strings
support `{name}` interpolation (handled by the runtime `t()`
function) and CLDR plural categories via `plural()` for one /
other variants — see `docs/I18N_PLAN.md` §Architecture for the
full runtime API.

When the source key set changes, the build's `npm run check:locales`
gate flags drift in CI. Missing-in-target keys emit a warning;
extra-in-target keys (orphans the source no longer has) fail the
build until cleaned up.

### Canonical formatting (no whitespace churn)

`scripts/generate-locales.ts` is the canonical formatter for
`locales/*.json`. Every `npm run locales` (which runs from
`postinstall`, `predev`, `prebuild`, and `type-check`) rewrites
each locale file in the exact format Weblate's GitHub bridge
produces — 2-space indent, LF line endings, trailing newline, no
interior blank lines, alphabetically-sorted keys (matching
Weblate's "Sort JSON keys" component setting), literal Unicode for
BMP characters. CI runs `npm run check:locales`, which fails any
PR whose locale JSON drifts from canonical.

The practical effect: no matter what style a developer types their
edits in, predev/prebuild normalize the file before commit, so
Weblate's incoming PRs against `main` never produce
whitespace-only diffs. If you want to preview the canonical form
of your changes, run `npm run locales` and re-stage.

---

## Translating via Weblate (recommended for non-developers)

Weblate is a web UI for translators: glossaries, translation
memory, suggestion voting, side-by-side context. It rounds-trips
to GitHub as commits/PRs so translations end up in the same
review flow as code.

1. Open <https://hosted.weblate.org/engage/terraviz/>.
2. Sign in (GitHub OAuth works) and pick the language you want
   to translate. New languages can be requested directly from the
   project page if they don't exist yet.
3. Translate strings in the editor. Each entry shows the English
   source, the existing translation (if any), context comments
   from the source code, and a "Save" button. Suggestions can be
   left for review without committing.
4. Save. Weblate batches commits and opens a PR against the
   `main` branch on this repo every few hours, or sooner via the
   "commit pending changes" action.
5. A reviewer (see [§Reviewers](#reviewers)) approves the PR.
   Merged translations ship in the next deploy.

Weblate's GitHub bridge is configured to enforce DCO sign-off
on every commit it generates, matching the repo's
[`CLAUDE.md`](CLAUDE.md) "all commits must be DCO signed-off"
rule.

### Glossary

A small project glossary is maintained on Weblate so consistent
terminology survives across waves and translators. Key entries:

| English | Notes |
|---|---|
| **Terraviz** | Brand. Do not translate. |
| **Orbit** | The digital docent's name. Do not translate. |
| **Science On a Sphere / SOS** | NOAA program name. Do not translate. |
| **Browse / Tools / Help** | These are UI button labels. Translate to whatever feels natural in your language; just keep the choice consistent across all the places the same word appears. |

When in doubt, prioritize natural phrasing over literal accuracy.
The audience is curious learners, not engineers reading the manual.

---

## Translating via a GitHub PR (developers)

If you'd rather edit JSON in your editor:

1. Fork the repo.
2. Edit the relevant `locales/<bcp47>.json`. Add new keys only by
   first adding them to `locales/en.json` — the source-of-truth
   gate catches orphan keys in non-source locales and fails the
   build.
3. Run `npm run check:locales` locally to confirm drift-free
   output.
4. Commit with DCO sign-off: `git commit -s -m "i18n: …"`.
5. Open a PR against `main`.

Both paths land the same way; Weblate just adds a friendly UI
in front of step 2.

---

## Adding a new language

1. **Via Weblate**: from the project page, click "Start new
   translation" and pick the BCP-47 tag. Weblate creates the file
   and pre-fills it with empty entries. Commit something to make
   the bridge produce the initial PR.
2. **Via PR**: copy `locales/en.json` to `locales/<bcp47>.json`,
   replace each value with your translation, run
   `npm run check:locales`, commit, and open a PR. The codegen
   picks the new locale up automatically — no other code changes
   needed for the build to recognize it.
3. Add a **native name** for the new locale to the
   `NATIVE_NAMES` table in `scripts/generate-locales.ts` (this is
   what shows in the Tools → Language picker). Without an entry
   the picker falls back to the BCP-47 tag, which is functional
   but ugly.
4. The locale appears in the picker once it reaches **≥80% key
   coverage**. Below that threshold the locale is hidden from the
   public picker but is reachable via `?lang=<bcp47>` query
   flag for testing.

---

## Reviewers

Translation PRs need at least one native-speaker review before
merging. We use `CODEOWNERS` to route PRs to the right reviewer
team:

```
locales/es.json @es-reviewers-team
locales/fr.json @fr-reviewers-team
…
```

If you'd like to be a reviewer for a language, open an issue with
the team you'd like to join (or start) and we'll add you.

If a language has **no reviewer team yet**, the locale stays in
`experimental` status — translations can land via merge by a
maintainer doing a best-effort review, but the locale stays
behind the query flag until a native-speaker team forms.

---

## Coverage gates and stale flagging

- **≥80% coverage** before a locale appears in the public Tools
  → Language picker. Enforced by the codegen at build time
  (warnings only — translations still ship for `?lang=<code>`
  testing); the picker reads coverage from a small generated
  manifest.
- **Stale-source flagging**: each entry stores a hash of its
  English source string at translate time. When the English
  source changes, Weblate renders the entry as needs-review and
  the runtime falls back to the (now-stale) English while the
  retranslation is pending. Translators see the stale entries
  surfaced first in their queue.

---

## What stays in English

A few categories are deliberately not translated as part of L1.
This isn't laziness — they're scoped to later phases:

- **Dataset metadata** (`title`, `abstract`, organization,
  attribution, etc.) — owned by the catalog backend; multi-
  language support lands in catalog phases 3+ (see
  `docs/I18N_PLAN.md` §Phasing for details).
- **Tour narration** (`params.caption` text in tour JSON files
  in `public/assets/`) — deferred to its own L4 wave with
  authoring tooling.
- **Orbit's LLM responses** — not literally translated; instead
  the LLM is instructed to respond in the user's locale. Quality
  varies by model. The local fallback engine (`docentEngine.ts`)
  IS translated, so users always get a localized fallback when
  the LLM is unavailable or disabled.

If you spot what looks like a missing translation in the running
app, double-check it isn't one of the above before filing an issue.

---

## License + DCO

Translations are contributed under the same license as the rest
of the repo (Apache 2.0; see `LICENSE`). No separate CLA. Every
commit needs DCO sign-off — Weblate enforces this on its GitHub
bridge, and direct PRs are gated by the same CI hook.

By contributing a translation you confirm that you have the
right to release it under Apache 2.0 (you wrote it yourself, or
it's a permissively licensed translation you have authority to
relicense).

---

## Questions

Open an issue with the `i18n` label, or start a thread on the
project's Weblate page.
