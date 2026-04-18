# Physics Papers Hub (Next.js + TypeScript)

A public-ready paper aggregation website focused on the most recent 7 days of selected physics sources.

## Features

- Home page lists papers from the last 7 days.
- Data sources:
  - arXiv via official API (`export.arxiv.org/api/query`)
  - Journal RSS feeds
  - Crossref REST API fallback for sources configured as `crossref`
- Source filters:
  - PRL
  - PRA
  - Nature Physics
  - arXiv quant-ph
  - Physical Review Research
  - Communications Physics
  - New Journal of Physics
  - Journal of Physics A
- Keyword search over title, abstract, and authors.
- Sort by publication time.
- Each paper includes title, authors, abstract, source, publication date, and DOI/arXiv identifier.
- Server-side refresh endpoint to pull and cache data.
- Source-level independent cache with soft refresh (failed source keeps previous successful cache).
- Source status visibility: `success`, `stale cache`, `failed no cache`, `partial data`.
- Fetching logic is modularized and configured by `sources.json`.
- De-duplication removes duplicated papers across journal/Crossref copies.
- DOI-based metadata enrichment (Crossref + OpenAlex) fills missing abstracts/authors and cleans malformed titles.
- APS short DOI canonicalization is supported before enrichment (improves PRL/PRA metadata completion).
- Missing metadata fields are explicitly labeled in the UI when upstream sources do not provide them.

## Project Structure

```text
.
├─ app
│  ├─ api
│  │  ├─ papers/route.ts
│  │  └─ refresh/route.ts
│  ├─ globals.css
│  ├─ layout.tsx
│  └─ page.tsx
├─ components
│  └─ paper-dashboard.tsx
├─ lib
│  ├─ fetchers
│  │  ├─ arxiv.ts
│  │  ├─ crossref.ts
│  │  ├─ index.ts
│  │  └─ rss.ts
│  ├─ cache.ts
│  ├─ dedupe.ts
│  ├─ http.ts
│  ├─ paper-service.ts
│  ├─ sources.ts
│  ├─ types.ts
│  └─ utils.ts
├─ .env.example
├─ package.json
├─ sources.json
├─ tsconfig.json
├─ next.config.mjs
└─ vercel.json
```

## Install

```bash
npm install
```

## Run (Local)

```bash
npm run dev
```

Open `http://localhost:3000`.

## Build and Production Run

```bash
npm run build
npm run start
```

## Environment Variables

Copy `.env.example` to `.env.local`:

```bash
# macOS / Linux
cp .env.example .env.local

# Windows PowerShell
Copy-Item .env.example .env.local
```

Variables:

- `CROSSREF_MAILTO`: optional but recommended for polite Crossref usage.
- `OPENALEX_MAILTO`: optional; used for OpenAlex DOI-based metadata enrichment.
- `CACHE_TTL_MS`: server cache TTL in milliseconds.
- `REQUEST_TIMEOUT_MS`: per-source request timeout.
- `REQUEST_MAX_RETRIES`: retry count for retryable failures.
- `REQUEST_BACKOFF_BASE_MS`: exponential backoff base milliseconds.
- `REQUEST_USER_AGENT`: explicit User-Agent for external requests.
- `SOURCE_REFRESH_CONCURRENCY`: source refresh concurrency.
- `METADATA_ENRICH_CONCURRENCY`: DOI enrichment concurrency for Crossref/OpenAlex lookups.
- `REFRESH_TOKEN`: optional bearer token for protecting `POST /api/refresh`.

## Source Configuration (`sources.json`)

Each source is defined as:

```json
{
  "id": "prl",
  "label": "PRL",
  "type": "rss",
  "url": "https://feeds.aps.org/rss/recent/prl.xml",
  "rows": 100,
  "enabled": true
}
```

Supported source types:

- `arxiv`: needs `category` (example: `quant-ph`)
- `rss`: needs `url`
- `crossref`: needs `issn`

Optional for RSS:

- `fallbackCrossrefIssn`: use Crossref automatically when RSS fails or returns no results.

## API Endpoints

- `GET /api/papers`
  - Query params:
    - `source=prl,pra`
    - `q=quantum error correction`
    - `field=all|title|authors|abstract`
    - `sort=desc|asc`
  - Response includes:
    - `sourceViews` (each source status + cache freshness)
    - `lastSuccessfulRefreshAt`
    - `currentRefreshAttemptAt`
- `POST /api/refresh`
  - Soft refreshes each source independently and updates only successful sources.
  - If `REFRESH_TOKEN` is set, include header:
    - `Authorization: Bearer <REFRESH_TOKEN>`

## De-duplication Strategy

Priority key:

1. DOI
2. arXiv ID
3. Fallback key from normalized title + first author + publication day

If duplicates are found, non-Crossref entries are preferred over Crossref entries, then richer metadata is preferred.

## Vercel Deployment

1. Push this repository to GitHub.
2. Import the repo in Vercel.
3. Set environment variables in Vercel Project Settings:
   - `CROSSREF_MAILTO`
   - `CACHE_TTL_MS`
   - `REQUEST_TIMEOUT_MS`
   - `REFRESH_TOKEN` (optional)
4. Deploy using defaults:
   - Framework Preset: `Next.js`
   - Build Command: `next build`
   - Output: `.next`
5. After deployment, your home page is publicly accessible.

## Notes

- Time filtering is unified to the latest 7 days.
- Time filtering is based on a single UTC refresh timestamp for consistency across all sources.
- The app intentionally avoids scraping HTML pages directly and prioritizes official APIs/RSS.
- On serverless environments, memory cache is warm-instance scoped (restarts clear cache), and `POST /api/refresh` can repopulate it on demand.
