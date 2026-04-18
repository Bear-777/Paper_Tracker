export type SourceType = "arxiv" | "rss" | "crossref";

export type SourceStatus = "success" | "stale_cache" | "failed_no_cache" | "partial_data";

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

export interface Paper extends FetchedPaper {
  id: string;
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
  articleCount: number;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  lastError?: SourceErrorInfo;
}

export interface AggregatedResult {
  papers: Paper[];
  totalBeforeDedupe: number;
  sourceViews: SourceView[];
  currentRefreshAttemptAt?: string;
  lastSuccessfulRefreshAt?: string;
}
