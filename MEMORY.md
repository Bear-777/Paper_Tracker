# Project Memory: Physics Papers Hub

Last updated: 2026-05-09
Workspace: `D:\Users\Jay\Desktop\Paper_Tracker`

## Conversation Memory (Latest)

- The project started as a Next.js + TypeScript public paper aggregator for physics papers.
- You requested robust source-level soft refresh cache semantics to avoid large result fluctuation when some sources fail.
- We introduced source status visibility (`success`, `stale cache`, `failed no cache`, `partial data`) and clearer warning semantics.
- You repeatedly reported two practical issues:
  - Nature Physics often showed 0 articles.
  - New Journal of Physics often showed 0 articles.

## Root Causes and Fixes Applied

### 1) Nature Physics zero results

Root cause:

- Nature RSS feed format can be RDF RSS 1.0 (`rdf:RDF`), but parser initially only consumed RSS 2.0/Atom paths.

Fix:

- `lib/fetchers/rss.ts` now extracts items from:
  - `rss.channel.item`
  - `rdf:RDF.item`
  - `feed.entry`
- Added `fallbackCrossrefIssn: 1745-2473` for `nature-physics` in `sources.json`.

### 2) New Journal of Physics zero results

Root cause:

- NJP configured as Crossref-only could return empty within specific windows despite official feed having recent entries.

Fix:

- Switched `new-journal-of-physics` to official IOP RSS:
  - `https://iopscience.iop.org/journal/rss/1367-2630`
- Kept Crossref fallback:
  - `fallbackCrossrefIssn: 1367-2630`

## Current Functional Baseline

- UTC-consistent 7-day window per refresh attempt.
- Stable dedupe and deterministic sorting.
- Source-level soft refresh with stale cache retention on failure.
- Search scope filter by field (all/title/authors/abstract).
- Missing metadata is explicitly labeled in UI instead of silently dropping records.

## Interpretation Guide

- `source_returned_empty`:
  - Upstream returned no papers in current UTC 7-day window.
  - Not necessarily a local parsing/fetch failure.
- `partial_data`:
  - Papers exist but a share of records lacks abstract/authors from upstream metadata.

## Open Risk Notes

- Upstream metadata quality is uneven.
- Even after enrichment, some papers may still have no abstract.
- In-memory cache is instance-local; serverless cold starts lose cache.

## Suggested Next Actions

1. Optional "7-day empty -> auto-check 14-day" mode with clear badge.
2. Persistent distributed cache for deployment stability.
3. Add small e2e regression tests for RDF feeds and source window edge cases.
