import sourceConfig from "@/sources.json";
import type { SourceConfig } from "@/lib/types";

const loadedSources = sourceConfig as SourceConfig[];

function validateSource(source: SourceConfig): SourceConfig {
  if (!source.id || !source.label || !source.type) {
    throw new Error(`Invalid source entry: ${JSON.stringify(source)}`);
  }

  if (source.type === "rss" && !source.url) {
    throw new Error(`RSS source "${source.id}" is missing "url".`);
  }

  if (source.type === "arxiv" && !source.category) {
    throw new Error(`arXiv source "${source.id}" is missing "category".`);
  }

  if (source.type === "crossref" && !source.issn) {
    throw new Error(`Crossref source "${source.id}" is missing "issn".`);
  }

  if (source.fallbackCrossrefIssn && source.type === "crossref") {
    throw new Error(`Crossref source "${source.id}" should not set "fallbackCrossrefIssn".`);
  }

  return source;
}

export const ENABLED_SOURCES: SourceConfig[] = loadedSources
  .filter((source) => source.enabled !== false)
  .map(validateSource);

export const SOURCE_OPTIONS = ENABLED_SOURCES.map((source) => ({
  id: source.id,
  label: source.label
}));
