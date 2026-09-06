# Physics Papers Hub (Next.js + TypeScript)

A public-ready physics paper aggregation site focused on a consistent UTC 7-day window across arXiv and selected journals.

## Core Features

- Fixed left sidebar navigation on desktop, with mobile hamburger navigation:
  - Physics Papers Hub
  - Weekly Source Trends
  - Favorites
- Home page shows papers from the latest 7-day UTC window.
- Multi-source ingestion (official APIs/RSS first):
  - arXiv API (`export.arxiv.org/api/query`)
  - Journal RSS feeds
  - Crossref REST fallback by ISSN when configured
- Source filter (checkboxes):
  - arXiv quant-ph
  - PRL
  - PRA
  - PRX
  - PRX Quantum
  - Nature Physics
  - Physical Review Research
  - npj Quantum Information
  - New Journal of Physics
  - Quantum
- Keyword search scope selector:
  - Title + authors + abstract
  - Title only
  - Authors only
  - Abstract only
- Time window selector for displayed papers:
  - Past 7 UTC days
  - Past 3 UTC days
  - Past 1 UTC day
- Switchable quantum-themed background:
  - Light Quantum Background for clean long-form reading
  - Dark Quantum Background for low-light research sessions
- Weekly Source Trends view:
  - Counts each source's cached articles per UTC day across the current 7-day cache window.
  - Shows arXiv quant-ph separately from journal sources so journal trends are not compressed by arXiv volume.
  - Each chart uses its own integer y-axis scale with compact, readable tick intervals.
  - Uses the existing source cache only and does not issue extra external API requests.
- Favorites view:
  - Paper cards include a local Save/Saved button.
  - Saved papers persist in browser `localStorage` under `physics-paper-hub-favorites`.
- Back to Top button:
  - Appears after scrolling beyond 300px.
  - Smoothly returns to the top of the page.
- Home scroll restoration:
  - Leaving the Physics Papers Hub home view saves the current homepage scroll position.
  - Returning from Weekly Source Trends or Favorites restores the homepage reading position in the current browser session.
- Sort by publication time (newest/oldest).
- Each paper card shows title, authors, abstract, source, date, DOI/arXiv ID, and missing metadata hints.
- `POST /api/refresh` soft refresh with source-level independent cache.
- Source status panel:
  - `success`
  - `stale cache`
  - `failed no cache`
  - `partial data`
- Stable dedupe + stable sorting.
- Persistent Postgres storage when `DATABASE_URL` or `POSTGRES_URL` is configured.
- Daily Vercel Cron refresh at `00:00 UTC` (`08:00 Asia/Shanghai`).
- Multi-label topic classification:
  - configurable rule vocabulary in `topics.json`
  - optional OpenAI model review for uncertain papers
  - persisted classifier version, confidence, method, and manual overrides
- Topic filters, classification confidence badges, topic trends, and manual topic correction.

## Latest Stability Improvements

- Source-level independent cache (`articles`, `lastSuccessAt`, `lastAttemptAt`, `lastError`, `sourceStatus`).
- Soft refresh: failed source keeps previous successful data.
- Display-time filtering now supports 7-day, 3-day, and 1-day UTC windows while keeping the 7-day refresh/cache baseline unchanged.
- Added a lightweight CSS-only Light/Dark Quantum Background theme toggle without changing data fetching or filtering behavior.
- Request timeout/retry/backoff/concurrency/User-Agent.
- Unified UTC refresh timestamp for all sources in one refresh cycle.
- Better source warning/error classification.
- Metadata enrichment via DOI (Crossref + OpenAlex) to improve missing abstract/authors and clean malformed titles.
- More robust abstract extraction:
  - source fields from arXiv/RSS/Crossref/OpenAlex first
  - DOI metadata fallback via Crossref, OpenAlex, and Semantic Scholar
  - publisher/DOI landing-page fallback via JSON-LD, abstract meta tags, Open Graph, Dublin Core, and common abstract containers
  - development-only `[abstract-debug]` logs for strategy, URL, final URL, status code, and failure reason
- RSS parser now supports RSS 2.0, Atom, and RDF RSS 1.0 (`rdf:RDF`).
  - This is important for Nature-family and IOP feeds.

## Current Source Configuration Notes

Configured in [`sources.json`](./sources.json):

- APS sources use official APS recent RSS feeds plus Crossref ISSN fallback:
  - `prl`: RSS `http://feeds.aps.org/rss/recent/prl.xml`, fallback ISSN `0031-9007`
  - `pra`: RSS `http://feeds.aps.org/rss/recent/pra.xml`, fallback ISSN `2469-9926`
  - `prx`: RSS `http://feeds.aps.org/rss/recent/prx.xml`, fallback ISSN `2160-3308`
  - `prx-quantum`: RSS `http://feeds.aps.org/rss/recent/prxquantum.xml`, fallback ISSN `2691-3399`
  - `physical-review-research`: RSS `http://feeds.aps.org/rss/recent/prresearch.xml`, fallback ISSN `2643-1564`
- `nature-physics` uses RSS + Crossref fallback:
  - RSS: `https://www.nature.com/nphys.rss`
  - fallback ISSN: `1745-2473`
- `new-journal-of-physics` uses official IOP RSS + Crossref fallback:
  - RSS: `https://iopscience.iop.org/journal/rss/1367-2630`
  - fallback ISSN: `1367-2630`

This avoids frequent zero-result fluctuation caused by using Crossref-only for NJP.

## Project Structure

```text
.
|- app/
|  |- api/
|  |  |- papers/route.ts
|  |  |- refresh/route.ts
|  |- globals.css
|  |- layout.tsx
|  |- page.tsx
|- components/
|  |- paper-dashboard.tsx
|- lib/
|  |- fetchers/
|  |  |- arxiv.ts
|  |  |- crossref.ts
|  |  |- doi-resolver.ts
|  |  |- index.ts
|  |  |- openalex.ts
|  |  |- rss.ts
|  |  |- semantic-scholar.ts
|  |- abstract.ts
|  |- cache.ts
|  |- dedupe.ts
|  |- errors.ts
|  |- http.ts
|  |- paper-service.ts
|  |- sources.ts
|  |- types.ts
|  |- utils.ts
|- sources.json
|- .env.example
|- package.json
|- next.config.mjs
|- vercel.json
```

## Install and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production:

```bash
npm run build
npm run start
```

Abstract extraction checks:

```bash
npm run test:abstract
npm run test:classification
# or run all checks
npm test

# Optional live checks against real arXiv/APS/DOI/example.com pages:
# PowerShell
$env:ABSTRACT_LIVE_TEST='1'; npm run test:abstract; Remove-Item Env:ABSTRACT_LIVE_TEST
```

Browser regression (after `npm run build`): `npx playwright install chromium`, then `npm run test:ui`.
It starts an isolated loopback-only fixture server on port 3107, tests desktop/mobile controls and layouts,
writes screenshots to `/tmp/paper-tracker-ui`, and stops the fixture server. Override `UI_TEST_PORT` or
`UI_SCREENSHOT_DIR` as needed. Fixture papers are synthetic; production never loads them.

## Environment Variables

Copy `.env.example` to `.env.local`.

```bash
# macOS/Linux
cp .env.example .env.local

# PowerShell
Copy-Item .env.example .env.local
```

Main vars:

- `CROSSREF_MAILTO`
- `OPENALEX_MAILTO`
- `CACHE_TTL_MS`
- `REQUEST_TIMEOUT_MS`
- `REQUEST_MAX_RETRIES`
- `REQUEST_BACKOFF_BASE_MS`
- `REQUEST_USER_AGENT`
- `SOURCE_REFRESH_CONCURRENCY`
- `METADATA_ENRICH_CONCURRENCY`
- `REFRESH_TOKEN` (optional)
- `CRON_SECRET` (required for production Cron authentication)
- `CLASSIFICATION_ADMIN_TOKEN` (manual topic corrections; falls back to `REFRESH_TOKEN`)
- `DATABASE_URL` or `POSTGRES_URL` (Neon/Postgres connection string)
- `OPENAI_API_KEY` (optional; enables model review for uncertain classifications)
- `OPENAI_CLASSIFIER_MODEL` (defaults to `gpt-5-mini`)

## Vercel Deployment and Automation

1. Import the repository into Vercel.
2. Add a Neon Postgres integration from the Vercel Marketplace, or provide `DATABASE_URL`.
3. Add `CRON_SECRET`, `REFRESH_TOKEN`, and `CLASSIFICATION_ADMIN_TOKEN`.
4. Optionally add `OPENAI_API_KEY` for model-assisted classification.
5. Deploy. The application creates/updates its database tables on first use.

[`vercel.json`](./vercel.json) schedules:

```text
GET /api/cron/refresh
0 0 * * *  (daily at 00:00 UTC / 08:00 Asia/Shanghai)
```

Vercel sends `Authorization: Bearer <CRON_SECRET>` to the Cron route. Normal page visits still perform an
on-demand refresh when the cache is stale, and the manual Refresh button remains available.

Without a database URL the project deliberately falls back to temporary in-memory storage for local development.
The UI displays the active storage mode so an accidental non-persistent production setup is visible.

## Topic Classification

The taxonomy and rule vocabulary live in [`topics.json`](./topics.json). Papers can have multiple topics.

1. Strong title/abstract phrase matches are classified locally.
2. Ambiguous papers are sent to the configured OpenAI model when `OPENAI_API_KEY` is available.
3. Model failures leave the paper available and mark classification as pending.
4. Existing classifications are reused only when taxonomy, title, abstract, and model mode match.
5. Manual topic assignments are stored with `method=manual` and are never overwritten by automatic refreshes.

The ordered topics are Indefinite Causal Order & Quantum Switch, Quantum Metrology, Quantum Information,
Quantum Computing, Quantum Optics & Photonics, Atomic/Molecular/Optical Physics, and Other / Unclassified.

Source status is collapsed by default; click or keyboard-toggle its summary to see details and warnings.
Enabled sources are reconciled against `sources.json` on cache restore. Retired source rows may remain in
Postgres as history, but are excluded from active feeds, filters, and trends. Newly added sources trigger a refresh.
Retired topic labels are hidden, including in saved favorites. Active manual labels retain priority; papers with
only retired labels are reclassified. No manual database migration or clearing of existing papers is required.

### Classification v2

- Whole-word/phrase matching with hyphen, accent and plural normalization replaces substring matching.
- Titles receive higher weight; nested phrases do not count twice. Each label has an independent evidence
  threshold, so a strong primary category cannot suppress a valid secondary category.
- Generic `circuit`, `coherence`, and `fidelity` no longer create labels. Publisher names are not evidence.
  Nature RSS publication notices are not treated as abstracts; missing abstracts use DOI metadata enrichment.
- Ambiguous or title-only results use semantic model review when configured. The model gets topic definitions,
  exclusion criteria and all allowed labels. Malformed responses and unavailable models leave papers pending.
- Confidence is a heuristic score, **not a calibrated probability**. Missing/very short abstracts cap it below 0.7.
- A content/configuration fingerprint invalidates old automatic classifications when abstracts are enriched.
  At most eight model reviews run per aggregation (12-second timeout, no immediate retry). Deferred or failed
  classifications remain visible and become eligible for retry on later requests after one hour.

This is a precision-oriented rule plus zero-shot semantic classifier, not a trained supervised classifier.
Common [TF-IDF document classifiers](https://scikit-learn.org/stable/auto_examples/text/plot_document_classification_20newsgroups.html)
need representative labeled examples. With no expert-labeled corpus yet, configurable rules plus
[zero-shot multi-label review](https://huggingface.co/tasks/zero-shot-classification) preserve the existing
low-cost architecture. The regression tests include positive, cross-domain and adversarial synthetic cases;
their pass rate is not a real-world accuracy claim. Next evaluate 50-100 independently expert-labeled papers,
report per-topic precision/recall (especially the two new topics), and tune thresholds on a separate split.

The new feeds are [Quantum RSS](https://quantum-journal.org/feed/) (ISSN 2521-327X) and
[npj Quantum Information RSS](https://www.nature.com/npjqi.rss) (ISSN 2056-6387), both with Crossref fallback.
Quantum feed entries outside `/papers/` are excluded to avoid treating announcements as research papers.

## API

### `GET /api/papers`

Query params:

- `source=prl,pra`
- `q=quantum`
- `field=all|title|authors|abstract`
- `days=7|3|1`
- `sort=desc|asc`
- `topic=quantum-information,quantum-optics`
- `classificationStatus=pending|low_confidence|failed`

Response includes:

- `papers`
- `sourceViews`
- `sourceDailyCounts`
- `lastSuccessfulRefreshAt`
- `currentRefreshAttemptAt`
- `totalBeforeDedupe`
- `timeWindowDays`

### `POST /api/refresh`

- Soft refresh all sources.
- Successful sources overwrite their own cache.
- Failed sources keep stale cache if available.
- If `REFRESH_TOKEN` is set, call with:
  - `Authorization: Bearer <REFRESH_TOKEN>`

### `GET /api/cron/refresh`

- Used by Vercel Cron for the daily automatic refresh.
- Requires `Authorization: Bearer <CRON_SECRET>` in production.

### `PUT /api/papers/:paperId/topics`

Body:

```json
{ "topicIds": ["quantum-information", "quantum-optics"] }
```

- Saves an authoritative manual override in Postgres.
- Requires `CLASSIFICATION_ADMIN_TOKEN`, falling back to `REFRESH_TOKEN`.

## Dedupe and Ordering

Dedupe priority:

1. DOI
2. arXiv ID
3. canonical URL
4. normalized title fallback

Stable ordering:

1. `publishedAt desc`
2. `sourceLabel asc`
3. `title asc`

## Expected "0 articles" Cases

If a source has no papers in the current UTC 7-day window, `articles: 0` can be valid.

Check source status and warning text:

- `source_returned_empty`: upstream returned no papers in that window (not a local crash).
- `failed no cache`: source failed and has no prior cache.
- `stale cache`: source failed now but prior cache is kept.

## Vercel Deployment

1. Push repo to GitHub.
2. Import into Vercel.
3. Configure env vars (at least `CROSSREF_MAILTO`; optional `REFRESH_TOKEN`).
4. Deploy with default Next.js settings.

## Notes

- This project avoids direct HTML scraping by design.
- Postgres is required for durable production data. In-memory mode remains a local-development fallback.
