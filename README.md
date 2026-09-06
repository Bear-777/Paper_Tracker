# Physics Papers Hub

[English](./README.md) | [简体中文](./README.zh-CN.md)

A physics literature tracker built with Next.js and TypeScript. It aggregates recent papers from arXiv quant-ph and selected journals, with source/topic filters, keyword search, reading links, and local favorites. Its configured topics emphasize quantum information, indefinite causal order, and quantum metrology.

This README describes the implemented application, not a claim that every paper is collected or that a cloud deployment is already running. The application UI currently uses English; both README versions document the same functionality.

## Contents

- [Features](#features)
- [Sources](#sources)
- [Topics and Classification](#classification)
- [Data Flow and Storage](#storage)
- [Local Setup](#local-setup)
- [Environment Variables](#environment)
- [Vercel Deployment](#deployment)
- [API Reference](#api)
- [Tests](#tests)
- [Project Structure](#structure)
- [Troubleshooting](#troubleshooting)
- [Limitations and Next Steps](#limitations)
- [Documentation Maintenance](#maintenance)

<a id="features"></a>
## Features

- Home: paper cards with title, authors, abstract, source, publication date, topic scores, and DOI/arXiv links. Missing metadata is indicated rather than silently dropping the paper.
- Combined filters: sources, topics, publication-time window, and keyword. Multiple sources or topics match **any** selected value; different filter dimensions are combined with **AND**.
- Search scopes: title + authors + abstract, title only, authors only, or abstract only. Search is a case-insensitive substring match, not semantic search or Boolean query parsing.
- Display windows: 7, 3, or 1 UTC calendar days, anchored to the refresh timestamp. The 7-day window starts at 00:00 UTC six dates before the refresh date and ends at the refresh timestamp; it is not a rolling 168-hour interval.
- Sorting: newest or oldest publication first, with source label and title as tie-breakers.
- Topic shortcuts: All topics, Quantum information, Unclassified, and Low confidence. Unclassified selects the `other` label; Low confidence includes `pending`, `low_confidence`, and `failed` statuses.
- Source status: collapsed by default, expandable by mouse or keyboard, with cached counts, attempt/success times, warnings, and repeated-failure highlighting.
- Weekly Source Trends: separate arXiv and journal charts, plus topic trends with consistent topic colors. Source charts count source-cache records; topic charts count deduplicated papers in each assigned topic. Totals can differ and are not measurements of all publications in a field. Switching to this view makes no additional upstream requests.
- Favorites: Save/Saved buttons store papers in this browser's `localStorage`; no account or cross-device synchronization. Saved papers can remain visible after leaving the current date window.
- Reading UI: light/dark themes, desktop sidebar, mobile navigation, Back to Top after 300px, and homepage scroll restoration when returning from other views.
- Refresh: a manual button, stale-cache refresh on requests, and a configured daily Vercel Cron route.
- Optional Neon Postgres persistence and optional model-assisted multi-label classification. Manual topic correction requires a working database.

<a id="sources"></a>
## Sources

The enabled source list and endpoints are defined in [sources.json](./sources.json).

| Source ID | Display name | Ingestion | Crossref ISSN |
| --- | --- | --- | --- |
| `arxiv-quant-ph` | arXiv quant-ph | arXiv API | N/A |
| `prl` | PRL | RSS + Crossref | `0031-9007` |
| `pra` | PRA | RSS + Crossref | `2469-9926` |
| `prx` | PRX | RSS + Crossref | `2160-3308` |
| `prx-quantum` | PRX Quantum | RSS + Crossref | `2691-3399` |
| `nature-physics` | Nature Physics | RSS + Crossref | `1745-2473` |
| `physical-review-research` | Physical Review Research | RSS + Crossref | `2643-1564` |
| `npj-quantum-information` | npj Quantum Information | RSS + Crossref | `2056-6387` |
| `new-journal-of-physics` | New Journal of Physics | RSS + Crossref | `1367-2630` |
| `quantum` | Quantum | RSS + Crossref | `2521-327X` |

For these journals, RSS and Crossref are requested in parallel and merged, so Crossref is both a supplement and a fallback, not only a retry after RSS fails. RSS 2.0, Atom, and RDF RSS 1.0 are supported.

Quantum uses `https://quantum-journal.org/feed/` and accepts RSS entries only under `https://quantum-journal.org/papers/`. npj Quantum Information uses `https://www.nature.com/npjqi.rss`; publication notices that merely repeat the title are not treated as abstracts.

Communications Physics and Journal of Physics A are no longer enabled. Cache restoration reconciles enabled sources against configuration; retired database rows may remain, but they do not populate active feeds or source trends. Browser favorites are separate saved records.

**Coverage limit:** arXiv currently retrieves the latest 120 entries without pagination. Journal Crossref requests use `max(rows, 250)`, currently 250 per request, also without pagination. RSS length and upstream indexing delays can further limit coverage.

<a id="classification"></a>
## Topics and Classification

[topics.json](./topics.json) controls topic order, labels, descriptions, colors, keywords, and phrases. UI labels remain in English.

| Topic ID | UI label |
| --- | --- |
| `indefinite-causal-order` | Indefinite Causal Order & Quantum Switch |
| `quantum-metrology` | Quantum Metrology |
| `quantum-information` | Quantum Information |
| `quantum-computing` | Quantum Computing |
| `quantum-optics` | Quantum Optics & Photonics |
| `atomic-molecular-optical` | Atomic, Molecular & Optical Physics |
| `other` | Other / Unclassified |

Classification is implemented in [lib/classifier.ts](./lib/classifier.ts):

1. Normalize title and abstract text, including case, accents, separators, and simple plural matching. Match whole words/phrases, weight title evidence more highly, and avoid double-counting nested terms.
2. Evaluate each topic independently for multi-label output. Journal names are not included as classification evidence.
3. Accept strong rule matches directly. Otherwise, use optional model review when `OPENAI_API_KEY` is configured; without it, retain tentative rule labels or Other / Unclassified.
4. Model review uses the Responses API, the configured topic definitions, and validated structured output. It sends the title and up to 8,000 abstract characters to OpenAI; enabling it involves external data processing and API usage costs.
5. During aggregation, at most eight model requests are attempted, each with a 12-second request timeout and no immediate retry. Failure or budget exhaustion keeps papers visible as `pending`. Pending/failed results become eligible for retry on later requests after one hour, not through a separate background worker.
6. Store labels, method, confidence, classifier version, and time. The `topics-v2` content/configuration fingerprint changes when the normalized title, abstract, topic definitions, or model mode/name changes.
7. Reuse active manual labels ahead of automatic results. Retired labels are hidden; records with only retired labels can be reclassified. An intentionally empty manual assignment is retained.

Scores are heuristics, **not calibrated probabilities or accuracy guarantees**. Missing/short abstracts (under roughly 60 characters after normalization or trimming) cap confidence at 0.64. The classifier is rule-based with optional zero-shot model review, not a supervised classifier trained on an expert-labeled corpus. See [the regression tests](./tests/topic-regression.test.ts) for its tested cases, not a real-world accuracy estimate.

<a id="storage"></a>
## Data Flow and Storage

The main path is:

```text
Page/API request -> load source state -> refresh if needed
-> fetch/enrich -> normalize + UTC window filter -> source cache
-> deduplicate -> reuse/classify topics -> persist -> return results
```

- Each source refreshes independently. A failure, or an empty current window with usable old data, retains that source's previous cache. Old retained papers still undergo display-window filtering.
- Default cache TTL is 30 minutes. It is checked when requests arrive; it is not a local timer. Initial requests and newly added sources can trigger fetching. Browser filtering uses already loaded data.
- DOI-based enrichment for RSS papers attempts Crossref, OpenAlex, Semantic Scholar, and finally publisher/DOI landing-page HTML. HTML fallback extracts JSON-LD, metadata, and abstract containers; the project does not download or parse full-text PDFs.
- Deduplication chooses a key in this order: normalized DOI, arXiv ID, canonical URL, normalized title + first author. It keeps a preferred record for each key. IDs are derived from that key, so they can change when a previously missing DOI becomes available; preprint/journal-version merging is not guaranteed.
- Classification and persistence are awaited during aggregation. This is not a durable job queue; reading the page/API can cause writes and optional model calls.

Without either database URL, server-side data is instance-local temporary memory and disappears on restart/cold start. Favorites and theme settings are browser-local and independent of server storage.

With a valid Neon connection, [lib/database.ts](./lib/database.ts) creates the following tables and required indexes on first use:

| Table | Purpose |
| --- | --- |
| `papers` | Metadata, classification status/version/time, first/last seen timestamps |
| `source_states` | Per-source cached articles, status, errors, and failure streak |
| `refresh_runs` | Refresh trigger, start/end times, counts, and outcome |
| `topics` | Configured topic definitions |
| `paper_topics` | Multi-label assignments, confidence, method, and manual flags |

The connection role needs permission to create/update the schema. Initialization is not a general-purpose migration system. The driver is `@neondatabase/serverless` using Neon's HTTP interface; an arbitrary TCP-only Postgres URL is not a drop-in replacement.

The current page/API reads the recent source caches, **not the entire historical `papers` table**. The UI shows the latest refresh summary, not a browsable refresh-history page. `Storage: Postgres` indicates a configured URL, not a successful connectivity check. Caught database errors can leave the page usable without guaranteeing persistence. In memory mode, `newPaperCount` is 0 and is not a reliable count of newly discovered papers.

<a id="local-setup"></a>
## Local Setup

Use Node.js 24.x and npm. The root package still declares `>=18.17.0`, but the installed Neon driver requires `>=19.0.0`; do not rely on Node.js 18 for the full project. Keep the local and deployed major versions aligned; see [Vercel's Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

From the project root:

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Initial fetching/enrichment can take time and requires upstream network access. To choose another port:

```bash
npm run dev -- --port 3001
```

No database or model key is needed for a basic memory-mode preview. When configuring services, copy [.env.example](./.env.example) only if `.env.local` does not already exist:

```bash
cp .env.example .env.local
```

PowerShell equivalent:

```powershell
Copy-Item .env.example .env.local
```

**Edit before restarting:** the sample database URL and tokens are placeholders, not working credentials. For memory mode, remove both `DATABASE_URL` and `POSTGRES_URL` from local configuration and ensure neither is inherited from your shell. For database mode, use a real Neon connection string. Replace token placeholders with distinct random secrets, and replace sample contact emails with your own or omit them. Keep `OPENAI_API_KEY` unset/empty to use rules only. Do not commit secrets.

For a local production build:

```bash
npm run build
npm run start
```

This starts the application server, not a Cron scheduler.

<a id="environment"></a>
## Environment Variables

These are server-side settings; do not prefix secrets with `NEXT_PUBLIC_`. Next.js reads local configuration from `.env.local`; cloud variables belong in the deployment platform's settings. Restart/redeploy after changes.

| Variable | Default / behavior |
| --- | --- |
| `DATABASE_URL` | Unset: use memory unless `POSTGRES_URL` is supplied; takes precedence when defined |
| `POSTGRES_URL` | Alternate Neon connection string when `DATABASE_URL` is undefined |
| `CRON_SECRET` | Required for production Cron authorization |
| `REFRESH_TOKEN` | Optional in code; if absent, the manual refresh API is public, including in production |
| `CLASSIFICATION_ADMIN_TOKEN` | Manual-correction secret; falls back to `REFRESH_TOKEN` when undefined |
| `OPENAI_API_KEY` | Optional; enables model review |
| `OPENAI_CLASSIFIER_MODEL` | `gpt-5-mini`; requires access to the configured model |
| `CROSSREF_MAILTO` | Optional contact email used in Crossref requests |
| `OPENALEX_MAILTO` | Optional contact email; falls back to `CROSSREF_MAILTO` |
| `CACHE_TTL_MS` | `1800000` (30 minutes) |
| `REQUEST_TIMEOUT_MS` | `15000` per general upstream request |
| `REQUEST_MAX_RETRIES` | `2` retries after the initial request |
| `REQUEST_BACKOFF_BASE_MS` | `500`; exponential backoff with jitter |
| `REQUEST_USER_AGENT` | `physics-paper-hub/1.0 (+https://example.com)` |
| `SOURCE_REFRESH_CONCURRENCY` | `3` source workers |
| `METADATA_ENRICH_CONCURRENCY` | `3` DOI workers per enrichment batch |
| `ABSTRACT_PAGE_TIMEOUT_MS` | `10000` for landing-page requests |
| `ABSTRACT_DEBUG` | Set to `1` for production abstract-debug logs; enabled outside production |

Use positive finite values for durations/concurrency and non-negative integers for retry counts. Numeric environment values are not comprehensively validated. Individual request paths override general defaults, including model review and some metadata fallbacks.

<a id="deployment"></a>
## Vercel Deployment

1. Push the repository to GitHub and import it into Vercel, using the Next.js preset and project root. Align the Node.js version with local setup.
2. Connect Neon through the Vercel Marketplace, or set a real `DATABASE_URL` in project environment variables. Confirm the connection belongs to the intended environment.
3. Configure distinct `CRON_SECRET`, `REFRESH_TOKEN`, and `CLASSIFICATION_ADMIN_TOKEN` values for Production. On a terminal with OpenSSL, run `openssl rand -hex 32` three times to generate separate secrets. Never use the sample values.
4. Optionally configure contact emails and model review. A first deployment without `OPENAI_API_KEY` runs rules only. Isolate Preview from Production data and credentials.
5. Deploy, or redeploy after adding/changing environment variables. First database use initializes the schema; verify database rows and runtime logs rather than trusting the storage label alone.
6. Verify the Cron entry and its execution logs in the Vercel project. Test persistence after a new deployment and check individual source outcomes.

[vercel.json](./vercel.json) configures `GET /api/cron/refresh` with `0 0 * * *`: daily at 00:00 UTC, or 08:00 in Asia/Shanghai. Vercel sends `CRON_SECRET` in the Bearer authorization header. Cron runs on production deployments, not the local development server. Hobby scheduling can occur anywhere within the specified hour; do not promise an exact 08:00 execution. See [Vercel Cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Both refresh routes declare `maxDuration = 300` seconds; actual platform limits and workload still apply. The page's next-refresh time is calculated, not confirmation that a scheduler is enabled.

For a manual Cron-route check in a POSIX shell, set `BASE_URL` to your deployment URL and securely supply its `CRON_SECRET` as a shell variable. The Next.js `.env.local` file is not automatically loaded by your shell.

```bash
BASE_URL=https://your-project.vercel.app
curl --fail-with-body -H "Authorization: Bearer ${CRON_SECRET}" "${BASE_URL}/api/cron/refresh"
```

This performs a real refresh and may incur model costs. Inspect `latestRefreshRun.status`, per-source state, and database writes; `ok: true` alone does not mean all sources, classifications, and persistence succeeded. Before public deployment, review dependency security advisories and the access/operational limits below.

<a id="api"></a>
## API Reference

All routes use the Node.js runtime. Requesting the home page or `GET /api/papers` can trigger stale-cache refresh and classification.

| Method and path | Behavior / authorization |
| --- | --- |
| `GET /api/papers` | Public filtered aggregation |
| `POST /api/refresh` | Manual refresh; Bearer `REFRESH_TOKEN` if configured |
| `GET /api/cron/refresh` | Automatic-trigger refresh; Bearer `CRON_SECRET`; missing secret is rejected in production |
| `PUT /api/papers/:paperId/topics` | Manual labels; requires a working database and Bearer admin token (fallback: refresh token); missing secret is rejected in production |

When a secret is unset, Cron/manual-topic routes allow local non-production requests. Manual refresh allows requests without a token in any environment when `REFRESH_TOKEN` is unset.

### Paper query parameters

| Parameter | Supported values / default |
| --- | --- |
| `source` | Comma-separated source IDs; omitted means all |
| `topic` | Comma-separated topic IDs; omitted means all; matches any selected topic |
| `q` | Case-insensitive substring; empty means no keyword filter |
| `field` | `all`, `title`, `authors`, `abstract`; default `all` |
| `days` | `1`, `3`, `7`; default `7` |
| `sort` | `asc`, `desc`; default `desc` |
| `classificationStatus` | `pending`, `low_confidence`, `failed`; omitted means no status filter |

```bash
curl "http://localhost:3000/api/papers?source=quantum,npj-quantum-information&topic=quantum-metrology&days=7&q=quantum&field=all&sort=desc"
```

The response contains `papers`, `total`, `totalBeforeDedupe`, `sources`, `sourceViews`, `sourceDailyCounts`, `topics`, `persistenceMode`, `timeWindowDays`, `searchField`, refresh timestamps, and optional `latestRefreshRun` / `nextScheduledRefreshAt`. `total` is the filtered count; `totalBeforeDedupe` is the raw aggregate count before query filters. See [lib/types.ts](./lib/types.ts) and [the route](./app/api/papers/route.ts) for exact fields.

Manual refresh returns the unfiltered aggregate and status metadata. Cron returns `ok`, `total`, `latestRefreshRun`, and `lastSuccessfulRefreshAt`.

### Manual topic correction

Send this JSON to `PUT /api/papers/:paperId/topics`, using an existing persisted paper ID:

```json
{ "topicIds": ["indefinite-causal-order", "quantum-metrology"] }
```

The assignment replaces the paper's labels. An empty array intentionally clears them. Invalid topic IDs or a non-string-array payload return 400; failed authorization returns 401; caught database failures return 500. Success returns `paperId`, `topics`, `classificationStatus`, and `classifiedAt`.

The UI's Refresh data and Edit topics actions prompt for their token after an initial 401 and keep it in `sessionStorage`. After changing a token, clear the stored token or start a fresh browser session if an old token continues to fail. These shared admin tokens are not a user-account system.

<a id="tests"></a>
## Tests

Run the default checks with no real model key exported in the test shell:

```bash
npm test
npm run lint
```

`npm test` runs abstract fixtures, classification regression, and mocked source/API tests. It does not include browser tests, live upstream checks, or a real Neon/model integration test. The shell-driven tests do not automatically load Next.js environment files.

| Command | Coverage |
| --- | --- |
| `npm run test:abstract` | Abstract extraction, HTML metadata, entity cleanup |
| `npm run test:classification` | Topic rules, multi-label cases, reuse/manual overrides, mocked model failures |
| `npm run test:sources` | RSS/RDF, fallback merging, retired sources, combined API filtering |
| `npm run test:ui` | Built-app browser regression using synthetic fixtures |

Browser checks require a production build and Chromium. Stop any development server using the same `.next` directory before building/testing:

```bash
npm run build
npx playwright install chromium
npm run test:ui
```

The UI test starts an isolated server at `127.0.0.1:3107`, removes database/model configuration from that fixture server, tests desktop/mobile and dark mode, writes screenshots to `/tmp/paper-tracker-ui`, and stops the server. Fixture papers are never loaded by the normal application entry point. Optional overrides: `UI_TEST_PORT`, `UI_SCREENSHOT_DIR`, and `PLAYWRIGHT_MODULE`. Set a writable `UI_SCREENSHOT_DIR` when the default path is unsuitable for your operating system.

Optional live abstract checks need network access and may be affected by upstream blocks/rate limits.

macOS/Linux:

```bash
ABSTRACT_LIVE_TEST=1 npm run test:abstract
```

PowerShell:

```powershell
$env:ABSTRACT_LIVE_TEST = "1"
npm run test:abstract
Remove-Item Env:ABSTRACT_LIVE_TEST
```

Synthetic test success is not a guarantee of classification accuracy, full ingestion coverage, or production reliability.

<a id="structure"></a>
## Project Structure

```text
app/
  page.tsx                         Server-rendered homepage
  layout.tsx, globals.css           Layout and styles
  api/papers/route.ts               Filtered paper API
  api/papers/[paperId]/topics/route.ts  Manual topic API
  api/refresh/route.ts              Manual refresh API
  api/cron/refresh/route.ts          Cron refresh API
components/paper-dashboard.tsx      Filters, cards, trends, favorites
lib/
  cache.ts                         Refresh orchestration and aggregation
  database.ts                      Neon persistence and schema initialization
  classifier.ts, topics.ts          Classification and active taxonomy
  fetchers/                        arXiv, RSS, Crossref, DOI metadata adapters
  abstract.ts                      Abstract cleanup and HTML fallback
  dedupe.ts, utils.ts               Identity, ordering, text/date utilities
  sources.ts, types.ts, errors.ts   Configuration, contracts, errors
  http.ts, paper-service.ts         HTTP retries and service compatibility shim
scripts/                           Abstract and browser-check tooling
tests/                             Classification and source regression tests
sources.json, topics.json          Source and topic configuration
.env.example                       Placeholder configuration only
vercel.json                        Deployment preset and daily schedule
package.json, package-lock.json    Commands and dependency versions
README.md, README.zh-CN.md         Matching English and Chinese documentation
```

<a id="troubleshooting"></a>
## Troubleshooting

| Symptom | Interpretation / action |
| --- | --- |
| `Storage: temporary memory` | No effective database connection string; configure Neon for durable data |
| `Storage: Postgres` but no saved rows | Check the URL, schema permissions, and database error logs; the label is configuration-based |
| `0 new papers` | In memory mode this is always 0; with persistence it counts inserts for that aggregation, not your unread papers |
| `success` with zero source articles | No papers found in the current window can be valid; check coverage limits |
| `partial_data` | At least 10% of records lack meaningful authors or an abstract of at least 60 characters; not necessarily a fetch failure |
| `stale_cache` | Current fetch failed or returned no in-window papers, so previous usable data was retained |
| `failed_no_cache` | Fetch failed and no usable previous cache exists |
| `source_returned_empty` | Empty-window diagnostic, not necessarily a parser crash |
| Refresh/correction returns 401 | Check the matching secret and any old browser session token |
| Correction returns 500 in memory mode | Manual corrections require a working database |
| Classification stays pending | Review model availability, request budget, and logs; retry eligibility does not itself launch a worker |
| Local page shows a future automatic refresh | The displayed time is only an estimate; local execution has no built-in daily scheduler |
| Papers or abstracts are missing | Check filters, source status, upstream access, and finite fetch limits before assuming all available papers were collected |

<a id="limitations"></a>
## Limitations and Next Steps

- No full-history search, custom date ranges, ingestion pagination, unread tracking, saved searches, subscriptions, or notification delivery yet.
- No semantic search, full-text PDF reader, citation export, or reliable preprint/journal-version linking yet.
- Favorites are local to the browser and site origin; clearing browser storage removes them.
- Persistence and manual labels exist, but database writes are not one atomic refresh transaction, and refresh coordination is instance-local rather than a distributed lock. Treat overlapping serverless invocations as an operational risk.
- Public read requests can trigger costly work. The project has no application-level rate limiting or full authentication system; secure admin endpoints and evaluate abuse controls before exposing it widely.
- External source availability and metadata quality vary. Existing dependency versions also require security review before public deployment; a successful build does not certify security.
- Classification uses imperfect evidence and optional external inference. Evaluate an independently expert-labeled set before claiming precision/recall. Future work should prioritize ingestion completeness, historical database queries, unread state, and saved research views before larger recommendation features.

These are future directions, not currently available features.

<a id="maintenance"></a>
## Documentation Maintenance

Keep [README.md](./README.md) and [README.zh-CN.md](./README.zh-CN.md) synchronized in the same change. Update both source/topic tables, commands, environment defaults, API contracts, limitations, and deployment instructions when the corresponding implementation changes. The files use matching section anchors to make cross-language review easier.

For current behavior, prefer executable code and configuration over older historical notes in `Agent.md` or `MEMORY.md`. Do not add unverified deployment status, fixed live paper counts, or accuracy promises to either README.
