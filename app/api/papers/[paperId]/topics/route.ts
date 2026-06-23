import { NextResponse } from "next/server";

import { saveManualTopics } from "@/lib/database";
import { TOPICS } from "@/lib/topics";

export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const expectedToken = process.env.CLASSIFICATION_ADMIN_TOKEN ?? process.env.REFRESH_TOKEN;

  if (!expectedToken) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("authorization") === `Bearer ${expectedToken}`;
}

export async function PUT(
  request: Request,
  context: { params: { paperId: string } }
): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as { topicIds?: unknown };

  if (!Array.isArray(body.topicIds) || !body.topicIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "topicIds must be an array of topic IDs." }, { status: 400 });
  }

  const knownIds = new Set(TOPICS.map((topic) => topic.id));

  if (body.topicIds.some((id) => !knownIds.has(id))) {
    return NextResponse.json({ error: "One or more topic IDs are invalid." }, { status: 400 });
  }

  try {
    const topics = await saveManualTopics(context.params.paperId, body.topicIds);

    return NextResponse.json({
      paperId: context.params.paperId,
      topics,
      classificationStatus: "classified",
      classifiedAt: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save manual topics." },
      { status: 500 }
    );
  }
}

