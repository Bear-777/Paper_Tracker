export function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function decodeNumericHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, value: string) => {
      const codePoint = Number(value);

      if (!Number.isFinite(codePoint)) {
        return _;
      }

      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => {
      const codePoint = Number.parseInt(value, 16);

      if (!Number.isFinite(codePoint)) {
        return _;
      }

      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return _;
      }
    });
}

export function decodeHtmlEntities(text: string): string {
  let decoded = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-");
  const namedEntities: Record<string, string> = {
    "&alpha;": "α",
    "&beta;": "β",
    "&gamma;": "γ",
    "&delta;": "δ",
    "&Delta;": "Δ",
    "&epsilon;": "ε",
    "&theta;": "θ",
    "&lambda;": "λ",
    "&mu;": "μ",
    "&nu;": "ν",
    "&pi;": "π",
    "&rho;": "ρ",
    "&sigma;": "σ",
    "&tau;": "τ",
    "&phi;": "φ",
    "&chi;": "χ",
    "&psi;": "ψ",
    "&omega;": "ω",
    "&Omega;": "Ω",
    "&times;": "×",
    "&minus;": "−"
  };

  for (const [entity, value] of Object.entries(namedEntities)) {
    decoded = decoded.replace(new RegExp(entity, "g"), value);
  }

  return decodeNumericHtmlEntities(decoded);
}

export function stripHtml(text: string): string {
  const decoded = decodeHtmlEntities(text);
  const withoutTags = decoded.replace(/<[^>]*>/g, " ");

  return normalizeWhitespace(withoutTags);
}

export function normalizeTitleForMatch(title: string): string {
  return normalizeWhitespace(stripHtml(title).toLowerCase().replace(/[^a-z0-9\s]/g, " "));
}

export function hasMarkupArtifacts(text: string): boolean {
  return /<[^>]+>|xmlns:[a-z]+=/i.test(text);
}

export function xmlValueToText(value: unknown): string {
  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const candidateKeys = ["#text", "__cdata", "@_href", "@_term", "@_value"];

  for (const key of candidateKeys) {
    const candidate = record[key];

    if (typeof candidate === "string") {
      return normalizeWhitespace(candidate);
    }
  }

  return "";
}

export function normalizeDoi(doi: string | undefined): string | undefined {
  if (!doi) {
    return undefined;
  }

  const normalized = doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .toLowerCase();

  return normalized || undefined;
}

export function extractDoi(text: string): string | undefined {
  const match = text.match(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/i);

  return normalizeDoi(match?.[0]);
}

export function extractArxivId(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  const match =
    normalized.match(/arxiv\.org\/abs\/([^?/]+)/i) ||
    normalized.match(/arxiv\.org\/pdf\/([^?/]+)/i) ||
    normalized.match(/^([^/]+)$/);

  return match?.[1]?.replace(/\.pdf$/i, "");
}

export function toIsoDate(value: string | number | Date | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

export function isWithinLast7Days(isoDate: string, nowMs: number = Date.now()): boolean {
  const targetDate = new Date(isoDate);

  if (Number.isNaN(targetDate.getTime())) {
    return false;
  }

  const now = new Date(nowMs);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - 6);

  return targetDate.getTime() >= start.getTime();
}

export function buildFromDate(nowMs: number = Date.now()): string {
  const now = new Date(nowMs);
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  fromDate.setUTCDate(fromDate.getUTCDate() - 6);

  return fromDate.toISOString().slice(0, 10);
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
