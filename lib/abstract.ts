import { fetchWithRetry } from "@/lib/http";
import { decodeHtmlEntities, normalizeWhitespace, stripHtml } from "@/lib/utils";

const MIN_ABSTRACT_LENGTH = 40;
const PAGE_ABSTRACT_TIMEOUT_MS = Number(process.env.ABSTRACT_PAGE_TIMEOUT_MS ?? 10000);

export interface AbstractExtractionResult {
  abstract: string;
  strategy: string;
  failureReason?: string;
  finalUrl?: string;
  statusCode?: number;
}

interface AbstractCandidate {
  strategy: string;
  value: unknown;
}

type DebugPayload = Record<string, string | number | boolean | undefined>;

const META_ABSTRACT_KEYS = [
  "citation_abstract",
  "dc.description",
  "dcterms.abstract",
  "dcterms.description",
  "description",
  "og:description",
  "twitter:description"
];

export function isUsableAbstract(abstractText: string): boolean {
  return normalizeWhitespace(abstractText).length >= MIN_ABSTRACT_LENGTH;
}

export function cleanAbstractText(raw: string): string {
  let text = stripHtml(raw)
    .replace(/\b(?:show more|read more|view full text)\b\.?$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  for (let index = 0; index < 3; index += 1) {
    text = text
      .replace(/^(?:abstract|summary|background|objective|objectives|purpose|significance)\s*[:.\-\u2013\u2014]?\s*/i, "")
      .trim();
  }

  return normalizeWhitespace(text);
}

function emptyResult(strategy: string, failureReason: string): AbstractExtractionResult {
  return {
    abstract: "",
    strategy,
    failureReason
  };
}

function valueToText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(valueToText).filter(Boolean).join(" ");
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directKeys = ["#text", "__cdata", "_", "$text", "value", "content"];

  for (const key of directKeys) {
    const direct = valueToText(record[key]);

    if (direct) {
      return direct;
    }
  }

  return Object.entries(record)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, nested]) => valueToText(nested))
    .filter(Boolean)
    .join(" ");
}

export function pickBestAbstract(candidates: AbstractCandidate[], fallbackStrategy: string): AbstractExtractionResult {
  let longest = "";
  let longestStrategy = fallbackStrategy;

  for (const candidate of candidates) {
    const cleaned = cleanAbstractText(valueToText(candidate.value));

    if (cleaned.length > longest.length) {
      longest = cleaned;
      longestStrategy = candidate.strategy;
    }

    if (isUsableAbstract(cleaned)) {
      return {
        abstract: cleaned,
        strategy: candidate.strategy
      };
    }
  }

  if (longest) {
    return {
      abstract: longest,
      strategy: longestStrategy,
      failureReason: "candidate_shorter_than_expected"
    };
  }

  return emptyResult(fallbackStrategy, "no_abstract_candidate");
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([^\s"'=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(tag))) {
    const key = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";

    if (key) {
      attributes[key] = decodeHtmlEntities(value);
    }
  }

  return attributes;
}

function collectMetaCandidates(html: string): AbstractCandidate[] {
  const candidates: AbstractCandidate[] = [];
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of metaTags) {
    const attributes = parseAttributes(tag);
    const key = (attributes.name ?? attributes.property ?? attributes.itemprop ?? "").toLowerCase();
    const content = attributes.content;

    if (!content || !META_ABSTRACT_KEYS.includes(key)) {
      continue;
    }

    candidates.push({
      strategy: `meta:${key}`,
      value: content
    });
  }

  return candidates;
}

function collectStructuredCandidatesFromJson(value: unknown, candidates: AbstractCandidate[], path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStructuredCandidatesFromJson(item, candidates, `${path}.${index}`));

    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();

    if ((normalizedKey === "abstract" || normalizedKey === "description") && typeof nested === "string") {
      candidates.push({
        strategy: `jsonld:${path}.${normalizedKey}`,
        value: nested
      });
    }

    if (nested && typeof nested === "object") {
      collectStructuredCandidatesFromJson(nested, candidates, `${path}.${normalizedKey}`);
    }
  }
}

function collectJsonLdCandidates(html: string): AbstractCandidate[] {
  const candidates: AbstractCandidate[] = [];
  const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptPattern.exec(html))) {
    const raw = match[1]?.trim();

    if (!raw) {
      continue;
    }

    for (const candidateJson of [raw, decodeHtmlEntities(raw)]) {
      try {
        collectStructuredCandidatesFromJson(JSON.parse(candidateJson), candidates, "$");
        break;
      } catch {
        // Try the decoded variant before giving up on this script block.
      }
    }
  }

  return candidates;
}

function collectSelectorCandidates(html: string): AbstractCandidate[] {
  const candidates: AbstractCandidate[] = [];
  const selectorPatterns: { strategy: string; pattern: RegExp }[] = [
    {
      strategy: "selector:arxiv-blockquote",
      pattern: /<blockquote\b[^>]*(?:class|id)=["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/blockquote>/gi
    },
    {
      strategy: "selector:abstract-container",
      pattern:
        /<(section|div|article|p|span)\b[^>]*(?:class|id|data-title|aria-label)=["'][^"']*(?:abstract|summary)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi
    },
    {
      strategy: "selector:heading-following-block",
      pattern:
        /<h[1-6]\b[^>]*>\s*(?:abstract|summary|background)\s*<\/h[1-6]>\s*<(section|div|p)\b[^>]*>([\s\S]*?)<\/\1>/gi
    },
    {
      strategy: "selector:nature-article-section",
      pattern:
        /<section\b[^>]*(?:data-title|aria-labelledby)=["'][^"']*abstract[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi
    }
  ];

  for (const { strategy, pattern } of selectorPatterns) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html))) {
      candidates.push({
        strategy,
        value: match[2] ?? match[1] ?? ""
      });
    }
  }

  return candidates;
}

function getHtmlFailureReason(html: string): string {
  const cleaned = normalizeWhitespace(stripHtml(html)).toLowerCase();

  if (!cleaned) {
    return "empty_html";
  }

  if (/captcha|access denied|forbidden|too many requests|enable javascript|verify you are human/.test(cleaned)) {
    return "blocked_or_dynamic_page";
  }

  if (cleaned.length < 160) {
    return "html_too_short";
  }

  return "no_abstract_candidate";
}

export function extractAbstractFromHtml(html: string, pageUrl?: string): AbstractExtractionResult {
  const candidates = [
    ...collectJsonLdCandidates(html),
    ...collectMetaCandidates(html),
    ...collectSelectorCandidates(html)
  ];
  const result = pickBestAbstract(candidates, "html:fallback");

  if (!result.abstract) {
    return {
      ...result,
      failureReason: getHtmlFailureReason(html),
      finalUrl: pageUrl
    };
  }

  return {
    ...result,
    finalUrl: pageUrl
  };
}

export function debugAbstractExtraction(event: string, payload: DebugPayload): void {
  if (process.env.NODE_ENV === "production" && process.env.ABSTRACT_DEBUG !== "1") {
    return;
  }

  console.info("[abstract-debug]", {
    event,
    ...payload
  });
}

export async function fetchAbstractFromLandingPage(
  url: string | undefined,
  context: { doi?: string; sourceId?: string }
): Promise<AbstractExtractionResult> {
  if (!url) {
    return emptyResult("html:landing-page", "missing_url");
  }

  try {
    const response = await fetchWithRetry(
      url,
      {
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      },
      {
        maxRetries: 1,
        timeoutMs: PAGE_ABSTRACT_TIMEOUT_MS
      }
    );
    const contentType = response.headers.get("content-type") ?? "";
    const finalUrl = response.url || url;

    if (contentType && !/html|xml|text/i.test(contentType)) {
      const failure = emptyResult("html:landing-page", "unsupported_content_type");

      debugAbstractExtraction("landing-page-abstract", {
        sourceId: context.sourceId,
        doi: context.doi,
        url,
        finalUrl,
        statusCode: response.status,
        strategy: failure.strategy,
        failureReason: failure.failureReason
      });

      return {
        ...failure,
        finalUrl,
        statusCode: response.status
      };
    }

    const html = await response.text();
    const result = extractAbstractFromHtml(html, finalUrl);

    debugAbstractExtraction("landing-page-abstract", {
      sourceId: context.sourceId,
      doi: context.doi,
      url,
      finalUrl,
      statusCode: response.status,
      strategy: result.strategy,
      hasAbstract: Boolean(result.abstract),
      failureReason: result.failureReason
    });

    return {
      ...result,
      finalUrl,
      statusCode: response.status
    };
  } catch (error) {
    const statusCode =
      typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : undefined;
    const failure = emptyResult(
      "html:landing-page",
      statusCode
        ? `request_failed_status:${statusCode}`
        : error instanceof Error
          ? `request_failed:${error.message}`
          : "request_failed"
    );

    debugAbstractExtraction("landing-page-abstract", {
      sourceId: context.sourceId,
      doi: context.doi,
      url,
      statusCode,
      strategy: failure.strategy,
      hasAbstract: false,
      failureReason: failure.failureReason
    });

    return failure;
  }
}
