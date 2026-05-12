import { SourceRequestError } from "@/lib/errors";
import { fetchWithRetry } from "@/lib/http";
import { cleanAbstractText } from "@/lib/abstract";
import { normalizeDoi, stripHtml } from "@/lib/utils";

interface SemanticScholarAuthor {
  name?: string;
}

interface SemanticScholarPaper {
  title?: string;
  abstract?: string;
  url?: string;
  year?: number;
  authors?: SemanticScholarAuthor[];
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
  };
}

export interface SemanticScholarMetadata {
  title?: string;
  abstract?: string;
  authors?: string[];
  doi?: string;
  arxivId?: string;
  url?: string;
  year?: number;
}

export async function fetchSemanticScholarByDoi(doi: string): Promise<SemanticScholarMetadata | null> {
  const queryDoi = normalizeDoi(doi);

  if (!queryDoi) {
    return null;
  }

  const params = new URLSearchParams({
    fields: "title,abstract,authors.name,externalIds,url,year"
  });
  const endpoint = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(queryDoi)}?${params}`;
  let response: Response;

  try {
    response = await fetchWithRetry(
      endpoint,
      {
        headers: {
          Accept: "application/json"
        }
      },
      { maxRetries: 1 }
    );
  } catch (error) {
    if (error instanceof SourceRequestError && error.statusCode === 404) {
      return null;
    }

    throw error;
  }

  let paper: SemanticScholarPaper;

  try {
    paper = (await response.json()) as SemanticScholarPaper;
  } catch (error) {
    throw new SourceRequestError({
      kind: "source_parsing_failed",
      message: `Semantic Scholar response parsing failed: ${error instanceof Error ? error.message : String(error)}`,
      url: endpoint,
      cause: error
    });
  }

  return {
    title: paper.title ? stripHtml(paper.title) : undefined,
    abstract: paper.abstract ? cleanAbstractText(paper.abstract) : "",
    authors:
      paper.authors
        ?.map((author) => author.name?.trim() ?? "")
        .filter(Boolean)
        .filter((author) => !/^anonymous$/i.test(author)) ?? [],
    doi: normalizeDoi(paper.externalIds?.DOI ?? queryDoi),
    arxivId: paper.externalIds?.ArXiv,
    url: paper.url,
    year: paper.year
  };
}
