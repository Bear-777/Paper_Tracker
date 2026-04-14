import { NextResponse } from "next/server";

import { refreshPaperCache } from "@/lib/cache";
import { SOURCE_OPTIONS } from "@/lib/sources";

export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const expectedToken = process.env.REFRESH_TOKEN;

  if (!expectedToken) {
    return true;
  }

  const authHeader = request.headers.get("authorization");

  return authHeader === `Bearer ${expectedToken}`;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cache = await refreshPaperCache();

  return NextResponse.json({
    updatedAt: cache.updatedAt,
    total: cache.papers.length,
    papers: cache.papers,
    sourceErrors: cache.sourceErrors,
    sources: SOURCE_OPTIONS
  });
}
