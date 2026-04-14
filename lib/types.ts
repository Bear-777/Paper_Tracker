export type SourceType = "arxiv" | "rss" | "crossref";

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

export interface SourceError {
  sourceId: string;
  sourceLabel: string;
  message: string;
}

export interface FetchResult {
  papers: Paper[];
  sourceErrors: SourceError[];
  totalFetched: number;
}

export interface CacheState extends FetchResult {
  updatedAt: string;
  updatedAtMs: number;
}
