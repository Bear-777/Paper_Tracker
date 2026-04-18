import type { SourceErrorKind } from "@/lib/types";

export class SourceRequestError extends Error {
  readonly kind: SourceErrorKind;
  readonly url?: string;
  readonly statusCode?: number;
  readonly retryCount: number;

  constructor(params: {
    kind: SourceErrorKind;
    message: string;
    url?: string;
    statusCode?: number;
    retryCount?: number;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = "SourceRequestError";
    this.kind = params.kind;
    this.url = params.url;
    this.statusCode = params.statusCode;
    this.retryCount = params.retryCount ?? 0;
  }
}
