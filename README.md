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
  - Communications Physics
  - New Journal of Physics
  - Journal of Physics A
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

# Optional live checks against real arXiv/APS/DOI/example.com pages:
# PowerShell
$env:ABSTRACT_LIVE_TEST='1'; npm run test:abstract; Remove-Item Env:ABSTRACT_LIVE_TEST
```

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

## API

### `GET /api/papers`

Query params:

- `source=prl,pra`
- `q=quantum`
- `field=all|title|authors|abstract`
- `days=7|3|1`
- `sort=desc|asc`

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
- In-memory cache is per running instance. On serverless restarts, cache is rebuilt by next refresh.
