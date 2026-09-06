import crypto from "node:crypto";

import { dedupePapers } from "@/lib/dedupe";
import { SourceRequestError } from "@/lib/errors";
import { fetchBySource } from "@/lib/fetchers";
import { ENABLED_SOURCES } from "@/lib/sources";
import { cleanAbstractText } from "@/lib/abstract";
import { classifyPaper, reusableClassification } from "@/lib/classifier";
import {
  completeRefreshRun,
  createRefreshRun,
  isDatabaseConfigured,
  loadLatestRefreshRun,
  loadPersistedState,
  loadStoredClassifications,
  persistPapers,
  persistSourceState
} from "@/lib/database";
import { TOPICS } from "@/lib/topics";
import type {
  AggregatedResult,
  FetchedPaper,
  Paper,
  RefreshRun,
  SourceCacheRecord,
  SourceCacheState,
  SourceConfig,
  SourceDailyCount,
  SourceErrorInfo,
  SourceStatus,
  SourceType,
  SourceView
} from "@/lib/types";
import {
  buildFromDate,
  getUtcWindowStartMs,
  isWithinLast7Days,
  normalizeWhitespace,
  stripHtml,
  toErrorMessage,
  toIsoDate
} from "@/lib/utils";

const SOURCE_REFRESH_CONCURRENCY = Number(process.env.SOURCE_REFRESH_CONCURRENCY ?? 3);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 30 * 60 * 1000);

declare global {
  var __sourceCacheState: SourceCacheState | undefined;
  var __sourceRefreshPromise: Promise<SourceCacheState> | undefined;
  var __sourceStateLoadPromise: Promise<SourceCacheState> | undefined;
  var __paperClassifications:
    | Map<string, Pick<Paper, "topics" | "classificationStatus" | "classifierVersion" | "classifiedAt">>
    | undefined;
  var __latestRefreshRun: RefreshRun | undefined;
  var __activeRefreshRun: RefreshRun | undefined;
}

function createDefaultSourceRecord(source: SourceConfig): SourceCacheRecord {
  return {
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    articles: [],
    sourceStatus: "failed_no_cache",
    usingStaleCache: false,
    failureStreak: 0
  };
}

function createInitialState(): SourceCacheState {
  const sources: Record<string, SourceCacheRecord> = {};

  for (const source of ENABLED_SOURCES) {
    sources[source.id] = createDefaultSourceRecord(source);
  }

  return {
    refreshVersion: 0,
    sources
  };
}

export function reconcileSourceState(state: SourceCacheState): SourceCacheState {
  state.sources = Object.fromEntries(ENABLED_SOURCES.map((source) => [source.id,
    state.sources[source.id] ?? createDefaultSourceRecord(source)]));
  return state;
}

function getState(): SourceCacheState {
  if (!global.__sourceCacheState) {
    global.__sourceCacheState = createInitialState();
  }

  return reconcileSourceState(global.__sourceCacheState);
}

async function ensureStateLoaded(): Promise<SourceCacheState> {
  if (global.__sourceStateLoadPromise) {
    return global.__sourceStateLoadPromise;
  }

  global.__sourceStateLoadPromise = (async () => {
    if (global.__sourceCacheState?.currentRefreshAttemptAt || !isDatabaseConfigured()) {
      return getState();
    }

    try {
      const persisted = await loadPersistedState();

      if (persisted) {
        const defaults = createInitialState();

        global.__sourceCacheState = {
          ...persisted,
          sources: {
            ...defaults.sources,
            ...persisted.sources
          }
        };
      }

      global.__latestRefreshRun = await loadLatestRefreshRun();
    } catch (error) {
      console.error("[database-load-error]", error);
    }

    return getState();
  })();

  return global.__sourceStateLoadPromise;
}

function hasUsableCache(record: SourceCacheRecord | undefined): boolean {
  return Boolean(record && record.lastSuccessAt && record.articles.length > 0);
}

function hasMeaningfulAbstract(abstractText: string): boolean {
  return normalizeWhitespace(abstractText).length >= 60;
}

function hasMeaningfulAuthors(authors: string[]): boolean {
  return authors.some((author) => normalizeWhitespace(author).length > 0 && !/^anonymous$/i.test(author.trim()));
}

function normalizeArticle(paper: FetchedPaper, source: SourceConfig, refreshAttemptAt: string): FetchedPaper | null {
  const normalizedPublished = toIsoDate(paper.publishedAt) ?? refreshAttemptAt;
  const normalizedTitle = normalizeWhitespace(stripHtml(paper.title)) || "Untitled";
  const normalizedAuthors = (paper.authors ?? [])
    .map((author) => normalizeWhitespace(author))
    .filter((author) => author.length > 0);
  const normalizedUrl = normalizeWhitespace(paper.url || "");
  const normalizedAbstract = cleanAbstractText(paper.abstract || "");

  if (!normalizedPublished) {
    return null;
  }

  return {
    ...paper,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    title: normalizedTitle,
    authors: normalizedAuthors,
    abstract: normalizedAbstract,
    publishedAt: normalizedPublished,
    url: normalizedUrl
  };
}

function toSourceErrorInfo(
  source: SourceConfig,
  error: unknown,
  fallbackKind: SourceErrorInfo["kind"],
  retryCount: number
): SourceErrorInfo {
  if (error instanceof SourceRequestError) {
    return {
      kind: error.kind,
      message: error.message,
      url: error.url,
      statusCode: error.statusCode,
      retryCount: error.retryCount,
      stack: error.stack,
      at: new Date().toISOString()
    };
  }

  return {
    kind: fallbackKind,
    message: toErrorMessage(error),
    url: source.url,
    retryCount,
    stack: error instanceof Error ? error.stack : undefined,
    at: new Date().toISOString()
  };
}

function logSourceIssue(
  source: SourceConfig,
  sourceUrl: string | undefined,
  statusCode: number | undefined,
  error: SourceErrorInfo
): void {
  const payload = {
    sourceId: source.id,
    sourceLabel: source.label,
    url: sourceUrl,
    statusCode,
    errorKind: error.kind,
    message: error.message,
    retryCount: error.retryCount ?? 0,
    stack: error.stack
  };

  if (error.kind === "source_returned_empty") {
    console.info("[source-refresh-info]", payload);

    return;
  }

  if (error.kind === "source_temporarily_unavailable") {
    console.warn("[source-refresh-warning]", payload);

    return;
  }

  console.error("[source-refresh-error]", payload);
}

function getSourceStatusFromArticles(articles: FetchedPaper[]): SourceStatus {
  if (articles.length === 0) {
    return "success";
  }

  const incompleteCount = articles.filter(
    (paper) => !hasMeaningfulAbstract(paper.abstract) || !hasMeaningfulAuthors(paper.authors)
  ).length;

  if (incompleteCount === 0) {
    return "success";
  }

  const incompleteRatio = incompleteCount / articles.length;

  return incompleteRatio >= 0.1 ? "partial_data" : "success";
}

function stableSortArticles(articles: FetchedPaper[]): FetchedPaper[] {
  return [...articles].sort((left, right) => {
    const publishedDiff = new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();

    if (publishedDiff !== 0) {
      return publishedDiff;
    }

    const sourceDiff = left.sourceLabel.localeCompare(right.sourceLabel);

    if (sourceDiff !== 0) {
      return sourceDiff;
    }

    return left.title.localeCompare(right.title);
  });
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const size = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: size }, async () => {
      while (true) {
        const current = nextIndex;
        nextIndex += 1;

        if (current >= items.length) {
          return;
        }

        await worker(items[current]);
      }
    })
  );
}

async function refreshSingleSource(
  state: SourceCacheState,
  source: SourceConfig,
  refreshTimestampMs: number,
  refreshAttemptAt: string
): Promise<void> {
  const previous = state.sources[source.id] ?? createDefaultSourceRecord(source);
  const nextRecord: SourceCacheRecord = {
    ...previous,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceType: source.type,
    lastAttemptAt: refreshAttemptAt
  };
  const fromDate = buildFromDate(refreshTimestampMs);

  try {
    const fetched = await fetchBySource(source, fromDate);
    const normalized = fetched
      .map((paper) => normalizeArticle(paper, source, refreshAttemptAt))
      .filter((paper): paper is FetchedPaper => paper !== null);
    const withinWindow = normalized.filter((paper) => isWithinLast7Days(paper.publishedAt, refreshTimestampMs));

    if (withinWindow.length === 0) {
      const emptyError: SourceErrorInfo = {
        kind: "source_returned_empty",
        message: `Source returned no articles in UTC 7-day window (${fromDate} ~ ${refreshAttemptAt.slice(0, 10)}).`,
        url: source.url,
        at: refreshAttemptAt
      };

      if (hasUsableCache(previous)) {
        state.sources[source.id] = {
          ...nextRecord,
          articles: previous.articles,
          sourceStatus: "stale_cache",
          usingStaleCache: true,
          failureStreak: previous.failureStreak + 1,
          lastSuccessAt: previous.lastSuccessAt,
          lastError: emptyError
        };
      } else {
        state.sources[source.id] = {
          ...nextRecord,
          articles: [],
          sourceStatus: "success",
          usingStaleCache: false,
          failureStreak: 0,
          lastSuccessAt: refreshAttemptAt,
          lastError: emptyError
        };
      }

      logSourceIssue(source, source.url, undefined, emptyError);

      return;
    }

    const sorted = stableSortArticles(withinWindow);
    state.sources[source.id] = {
      ...nextRecord,
      articles: sorted,
      sourceStatus: getSourceStatusFromArticles(sorted),
      usingStaleCache: false,
      failureStreak: 0,
      lastSuccessAt: refreshAttemptAt,
      lastError: undefined
    };
  } catch (error) {
    const errorInfo = toSourceErrorInfo(source, error, "source_fetch_failed", 0);
    const statusCode = error instanceof SourceRequestError ? error.statusCode : undefined;

    logSourceIssue(source, errorInfo.url ?? source.url, statusCode, errorInfo);

    if (hasUsableCache(previous)) {
      state.sources[source.id] = {
        ...nextRecord,
        articles: previous.articles,
        sourceStatus: "stale_cache",
        usingStaleCache: true,
        failureStreak: previous.failureStreak + 1,
        lastSuccessAt: previous.lastSuccessAt,
        lastError: errorInfo
      };

      return;
    }

    state.sources[source.id] = {
      ...nextRecord,
      articles: [],
      sourceStatus: "failed_no_cache",
      usingStaleCache: false,
      failureStreak: previous.failureStreak + 1,
      lastError: errorInfo
    };
  }
}

function toSourceViews(state: SourceCacheState): SourceView[] {
  return Object.values(state.sources)
    .map((source) => ({
      sourceId: source.sourceId,
      sourceLabel: source.sourceLabel,
      sourceType: source.sourceType,
      sourceStatus: source.sourceStatus,
      usingStaleCache: source.usingStaleCache,
      failureStreak: source.failureStreak,
      articleCount: source.articles.length,
      lastSuccessAt: source.lastSuccessAt,
      lastAttemptAt: source.lastAttemptAt,
      lastError: source.lastError
    }))
    .sort((left, right) => left.sourceLabel.localeCompare(right.sourceLabel));
}

function getRefreshAnchorMs(state: SourceCacheState): number {
  const parsed = new Date(state.currentRefreshAttemptAt ?? state.lastSuccessfulRefreshAt ?? Date.now()).getTime();

  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function buildUtcDateWindow(anchorMs: number): string[] {
  const startMs = getUtcWindowStartMs(anchorMs, 7);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startMs + index * 24 * 60 * 60 * 1000);

    return date.toISOString().slice(0, 10);
  });
}

function toSourceDailyCounts(state: SourceCacheState): SourceDailyCount[] {
  const anchorMs = getRefreshAnchorMs(state);
  const dates = buildUtcDateWindow(anchorMs);
  const dateSet = new Set(dates);

  return Object.values(state.sources)
    .map((source) => {
      const countsByDate = new Map(dates.map((date) => [date, 0]));

      for (const article of source.articles) {
        const publishedMs = new Date(article.publishedAt).getTime();

        if (Number.isNaN(publishedMs) || publishedMs > anchorMs) {
          continue;
        }

        const date = new Date(publishedMs).toISOString().slice(0, 10);

        if (!dateSet.has(date)) {
          continue;
        }

        countsByDate.set(date, (countsByDate.get(date) ?? 0) + 1);
      }

      return {
        sourceId: source.sourceId,
        sourceLabel: source.sourceLabel,
        counts: dates.map((date) => ({
          date,
          count: countsByDate.get(date) ?? 0
        }))
      };
    })
    .sort((left, right) => left.sourceLabel.localeCompare(right.sourceLabel));
}

async function classifyAndPersistPapers(papers: Paper[]): Promise<{ papers: Paper[]; newPaperCount: number }> {
  const memoryClassifications =
    global.__paperClassifications ??
    new Map<string, Pick<Paper, "topics" | "classificationStatus" | "classifierVersion" | "classifiedAt">>();
  global.__paperClassifications = memoryClassifications;
  let stored = new Map<
    string,
    Pick<Paper, "topics" | "classificationStatus" | "classifierVersion" | "classifiedAt">
  >();

  try {
    stored = await loadStoredClassifications(papers.map((paper) => paper.id));
  } catch (error) {
    console.error("[classification-load-error]", error);
  }

  const classified: Paper[] = [];
  // Bound semantic review during taxonomy migrations to fit serverless time limits.
  const modelBudget = { remaining: 8 };

  for (const paper of papers) {
    const existing = stored.get(paper.id) ?? memoryClassifications.get(paper.id);
    const current = reusableClassification(paper, existing);

    if (current) {
      classified.push({
        ...paper,
        ...current
      });
      continue;
    }

    const result = await classifyPaper(paper, modelBudget);
    const nextPaper: Paper = {
      ...paper,
      topics: result.topics,
      classificationStatus: result.status,
      classifierVersion: result.classifierVersion,
      classifiedAt: result.classifiedAt
    };

    memoryClassifications.set(paper.id, {
      topics: nextPaper.topics,
      classificationStatus: nextPaper.classificationStatus,
      classifierVersion: nextPaper.classifierVersion,
      classifiedAt: nextPaper.classifiedAt
    });
    classified.push(nextPaper);
  }

  try {
    return {
      papers: classified,
      newPaperCount: await persistPapers(classified)
    };
  } catch (error) {
    console.error("[paper-persistence-error]", error);

    return { papers: classified, newPaperCount: 0 };
  }
}

function nextScheduledRefreshAt(): string {
  const next = new Date();

  next.setUTCHours(24, 0, 0, 0);

  return next.toISOString();
}

async function finalizeActiveRefresh(papers: Paper[], newPaperCount: number): Promise<void> {
  const run = global.__activeRefreshRun;

  if (!run) {
    return;
  }

  const state = getState();
  const sourceRecords = Object.values(state.sources);
  const failureCount = sourceRecords.filter((source) => source.sourceStatus === "failed_no_cache").length;
  const degradedCount = sourceRecords.filter((source) => source.sourceStatus === "stale_cache").length;
  const completed: RefreshRun = {
    ...run,
    status: failureCount > 0 || degradedCount > 0 ? "partial" : "success",
    completedAt: new Date().toISOString(),
    sourceSuccessCount: sourceRecords.length - failureCount - degradedCount,
    sourceFailureCount: failureCount + degradedCount,
    paperCount: papers.length,
    newPaperCount
  };

  global.__activeRefreshRun = undefined;
  global.__latestRefreshRun = completed;

  try {
    await completeRefreshRun(completed);
  } catch (error) {
    console.error("[refresh-run-persistence-error]", error);
  }
}

async function aggregateFromState(state: SourceCacheState): Promise<AggregatedResult> {
  const allArticles = Object.values(state.sources).flatMap((source) => source.articles);
  const deduped = dedupePapers(allArticles);
  const classified = await classifyAndPersistPapers(deduped);

  await finalizeActiveRefresh(classified.papers, classified.newPaperCount);

  return {
    papers: classified.papers,
    totalBeforeDedupe: allArticles.length,
    sourceViews: toSourceViews(state),
    sourceDailyCounts: toSourceDailyCounts(state),
    currentRefreshAttemptAt: state.currentRefreshAttemptAt,
    lastSuccessfulRefreshAt: state.lastSuccessfulRefreshAt,
    topics: TOPICS,
    latestRefreshRun: global.__latestRefreshRun,
    nextScheduledRefreshAt: nextScheduledRefreshAt(),
    persistenceMode: isDatabaseConfigured() ? "postgres" : "memory"
  };
}

function shouldAutoRefresh(state: SourceCacheState): boolean {
  if (ENABLED_SOURCES.some((source) => !state.sources[source.id]?.lastAttemptAt)) return true;
  if (!state.lastSuccessfulRefreshAt) {
    return true;
  }

  const lastSuccessMs = new Date(state.lastSuccessfulRefreshAt).getTime();

  if (Number.isNaN(lastSuccessMs)) {
    return true;
  }

  return Date.now() - lastSuccessMs > CACHE_TTL_MS;
}

export async function softRefreshSources(
  trigger: RefreshRun["trigger"] = "on_demand"
): Promise<SourceCacheState> {
  if (global.__sourceRefreshPromise) {
    return global.__sourceRefreshPromise;
  }

  global.__sourceRefreshPromise = (async () => {
    const state = await ensureStateLoaded();
    const refreshTimestampMs = Date.now();
    const refreshAttemptAt = new Date(refreshTimestampMs).toISOString();
    const run: RefreshRun = {
      id: crypto.randomUUID(),
      trigger,
      status: "running",
      startedAt: refreshAttemptAt,
      sourceSuccessCount: 0,
      sourceFailureCount: 0,
      paperCount: 0,
      newPaperCount: 0
    };

    global.__activeRefreshRun = run;
    global.__latestRefreshRun = run;

    try {
      await createRefreshRun(run);
    } catch (error) {
      console.error("[refresh-run-create-error]", error);
    }

    state.refreshVersion += 1;
    state.currentRefreshAttemptAt = refreshAttemptAt;

    const orderedSources = [...ENABLED_SOURCES].sort((left, right) => left.id.localeCompare(right.id));

    await runWithConcurrency(orderedSources, SOURCE_REFRESH_CONCURRENCY, async (source) => {
      await refreshSingleSource(state, source, refreshTimestampMs, refreshAttemptAt);
    });

    const succeeded = Object.values(state.sources).some((source) => source.lastSuccessAt === refreshAttemptAt);

    if (succeeded) {
      state.lastSuccessfulRefreshAt = refreshAttemptAt;
    }

    global.__sourceCacheState = state;

    try {
      await persistSourceState(state);
    } catch (error) {
      console.error("[source-state-persistence-error]", error);
    }

    return state;
  })().catch(async (error) => {
    const active = global.__activeRefreshRun;

    if (active) {
      const failed: RefreshRun = {
        ...active,
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : String(error)
      };
      global.__activeRefreshRun = undefined;
      global.__latestRefreshRun = failed;

      try {
        await completeRefreshRun(failed);
      } catch (persistenceError) {
        console.error("[refresh-run-persistence-error]", persistenceError);
      }
    }

    throw error;
  }).finally(() => {
    global.__sourceRefreshPromise = undefined;
  });

  return global.__sourceRefreshPromise;
}

export async function getAggregatedPapers(): Promise<AggregatedResult> {
  const state = await ensureStateLoaded();

  if (shouldAutoRefresh(state) || !state.currentRefreshAttemptAt) {
    await softRefreshSources("on_demand");
  }

  return aggregateFromState(getState());
}

export async function refreshAndGetAggregatedPapers(
  trigger: RefreshRun["trigger"] = "manual"
): Promise<AggregatedResult> {
  await softRefreshSources(trigger);

  return aggregateFromState(getState());
}
