export type SourceType = "arxiv" | "rss" | "crossref";

export type SourceStatus = "success" | "stale_cache" | "failed_no_cache" | "partial_data";
export type ClassificationStatus = "pending" | "classified" | "low_confidence" | "failed";
export type ClassificationMethod = "rule" | "model" | "manual";

export type SourceErrorKind =
  | "source_fetch_failed"
  | "source_returned_empty"
  | "source_parsing_failed"
  | "source_temporarily_unavailable";

export interface SourceConfig {
  id: string;
  label: string;
  type: SourceType;
  enabled?: boolean;
  url?: string;
  category?: string;
  issn?: string;
  fallbackCrossrefIssn?: string;
  rows?: number;
}

export interface FetchedPaper {
  title: string;
  authors: string[];
  abstract: string;
  sourceId: string;
  sourceLabel: string;
  sourceType: SourceType;
  publishedAt: string;
  doi?: string;
  arxivId?: string;
  url: string;
}

export interface TopicDefinition {
  id: string;
  label: string;
  description: string;
  color: string;
  keywords: string[];
  phrases: string[];
}

export interface PaperTopic {
  topicId: string;
  topicLabel: string;
  confidence: number;
  method: ClassificationMethod;
  reason?: string;
  isManual: boolean;
}

export interface Paper extends FetchedPaper {
  id: string;
  topics: PaperTopic[];
  classificationStatus: ClassificationStatus;
  classifierVersion?: string;
  classifiedAt?: string;
}

export interface SourceErrorInfo {
  kind: SourceErrorKind;
  message: string;
  url?: string;
  statusCode?: number;
  retryCount?: number;
  stack?: string;
  at: string;
}

export interface SourceCacheRecord {
  sourceId: string;
  sourceLabel: string;
  sourceType: SourceType;
  articles: FetchedPaper[];
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastError?: SourceErrorInfo;
  sourceStatus: SourceStatus;
  usingStaleCache: boolean;
  failureStreak: number;
}

export interface SourceCacheState {
  refreshVersion: number;
  currentRefreshAttemptAt?: string;
  lastSuccessfulRefreshAt?: string;
  sources: Record<string, SourceCacheRecord>;
}

export interface SourceView {
  sourceId: string;
  sourceLabel: string;
  sourceType: SourceType;
  sourceStatus: SourceStatus;
  usingStaleCache: boolean;
  failureStreak: number;
  articleCount: number;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastError?: SourceErrorInfo;
}

export interface SourceDailyCount {
  sourceId: string;
  sourceLabel: string;
  counts: {
    date: string;
    count: number;
  }[];
}

export interface RefreshRun {
  id: string;
  trigger: "automatic" | "manual" | "on_demand";
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  completedAt?: string;
  sourceSuccessCount: number;
  sourceFailureCount: number;
  paperCount: number;
  newPaperCount: number;
  errorMessage?: string;
}

export interface AggregatedResult {
  papers: Paper[];
  totalBeforeDedupe: number;
  sourceViews: SourceView[];
  sourceDailyCounts: SourceDailyCount[];
  currentRefreshAttemptAt?: string;
  lastSuccessfulRefreshAt?: string;
  topics: TopicDefinition[];
  latestRefreshRun?: RefreshRun;
  nextScheduledRefreshAt?: string;
  persistenceMode: "postgres" | "memory";
}
