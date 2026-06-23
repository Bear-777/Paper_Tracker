import { fetchJson } from "@/lib/http";
import { CLASSIFIABLE_TOPICS, CLASSIFIER_VERSION, TOPIC_BY_ID } from "@/lib/topics";
import type {
  ClassificationStatus,
  Paper,
  PaperTopic
} from "@/lib/types";

const RULE_DIRECT_SCORE = 4;
const RULE_SECONDARY_SCORE = 3;
const MODEL_NAME = process.env.OPENAI_CLASSIFIER_MODEL ?? "gpt-5-mini";
const MODEL_CONFIDENCE_THRESHOLD = 0.55;

interface ClassificationResult {
  topics: PaperTopic[];
  status: ClassificationStatus;
  classifierVersion: string;
  classifiedAt: string;
}

interface ModelTopic {
  topicId: string;
  confidence: number;
  reason: string;
}

interface ResponsesApiResult {
  output_text?: string;
  output?: {
    content?: {
      type?: string;
      text?: string;
    }[];
  }[];
}

function normalizedText(paper: Paper): { title: string; body: string } {
  return {
    title: paper.title.toLowerCase(),
    body: `${paper.title}\n${paper.abstract}\n${paper.sourceLabel}`.toLowerCase()
  };
}

function scoreTopic(paper: Paper, topicId: string): number {
  const topic = TOPIC_BY_ID.get(topicId);

  if (!topic) {
    return 0;
  }

  const text = normalizedText(paper);
  let score = 0;

  for (const phrase of topic.phrases) {
    const normalized = phrase.toLowerCase();

    if (text.body.includes(normalized)) {
      score += text.title.includes(normalized) ? 5 : 3;
    }
  }

  for (const keyword of topic.keywords) {
    const normalized = keyword.toLowerCase();

    if (text.body.includes(normalized)) {
      score += text.title.includes(normalized) ? 2 : 1;
    }
  }

  return score;
}

function toRuleTopics(paper: Paper): { topics: PaperTopic[]; isCertain: boolean } {
  const ranked = CLASSIFIABLE_TOPICS.map((topic) => ({
    topic,
    score: scoreTopic(paper, topic.id)
  })).sort((left, right) => right.score - left.score);
  const topScore = ranked[0]?.score ?? 0;
  const secondScore = ranked[1]?.score ?? 0;
  const selected = ranked.filter(
    ({ score }) => score >= RULE_SECONDARY_SCORE && score >= topScore * 0.6
  );
  const isCertain =
    topScore >= RULE_DIRECT_SCORE &&
    (topScore - secondScore >= 2 || selected.length > 1);

  return {
    topics: selected.map(({ topic, score }) => ({
      topicId: topic.id,
      topicLabel: topic.label,
      confidence: Math.min(0.96, 0.56 + score * 0.055),
      method: "rule",
      reason: `Matched configured topic terms (rule score ${score}).`,
      isManual: false
    })),
    isCertain
  };
}

function extractResponseText(response: ResponsesApiResult): string {
  if (response.output_text) {
    return response.output_text;
  }

  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === "output_text" && content.text)
      ?.text ?? ""
  );
}

async function classifyWithModel(paper: Paper): Promise<PaperTopic[]> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return [];
  }

  const allowedTopicIds = CLASSIFIABLE_TOPICS.map((topic) => topic.id);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["topics"],
    properties: {
      topics: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["topicId", "confidence", "reason"],
          properties: {
            topicId: { type: "string", enum: allowedTopicIds },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string" }
          }
        }
      }
    }
  };
  const topicGuide = CLASSIFIABLE_TOPICS.map(
    (topic) => `${topic.id}: ${topic.description}`
  ).join("\n");
  const response = await fetchJson<ResponsesApiResult>(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        input: [
          {
            role: "system",
            content:
              "Classify physics papers into zero to three relevant topics. Use multiple topics only when each is materially represented. Do not infer a topic from a passing mention."
          },
          {
            role: "user",
            content: `Topics:\n${topicGuide}\n\nTitle: ${paper.title}\n\nAbstract: ${paper.abstract.slice(0, 8000) || "(missing)"}`
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "paper_topic_classification",
            strict: true,
            schema
          }
        }
      })
    },
    { timeoutMs: 30000, maxRetries: 1 }
  );
  const parsed = JSON.parse(extractResponseText(response)) as { topics?: ModelTopic[] };

  return (parsed.topics ?? [])
    .filter(
      (topic) =>
        TOPIC_BY_ID.has(topic.topicId) &&
        Number.isFinite(topic.confidence) &&
        topic.confidence >= MODEL_CONFIDENCE_THRESHOLD
    )
    .map((topic) => ({
      topicId: topic.topicId,
      topicLabel: TOPIC_BY_ID.get(topic.topicId)?.label ?? topic.topicId,
      confidence: Math.max(0, Math.min(1, topic.confidence)),
      method: "model",
      reason: topic.reason,
      isManual: false
    }));
}

function otherTopic(method: "rule" | "model", reason: string): PaperTopic {
  const topic = TOPIC_BY_ID.get("other");

  return {
    topicId: "other",
    topicLabel: topic?.label ?? "Other / Unclassified",
    confidence: 0.4,
    method,
    reason,
    isManual: false
  };
}

export async function classifyPaper(paper: Paper): Promise<ClassificationResult> {
  const ruleResult = toRuleTopics(paper);
  const classifiedAt = new Date().toISOString();
  let modelFailed = false;

  if (ruleResult.isCertain && ruleResult.topics.length > 0) {
    return {
      topics: ruleResult.topics,
      status: "classified",
      classifierVersion: CLASSIFIER_VERSION,
      classifiedAt
    };
  }

  try {
    const modelTopics = await classifyWithModel(paper);

    if (modelTopics.length > 0) {
      return {
        topics: modelTopics,
        status: modelTopics.some((topic) => topic.confidence < 0.7)
          ? "low_confidence"
          : "classified",
        classifierVersion: CLASSIFIER_VERSION,
        classifiedAt
      };
    }
  } catch (error) {
    modelFailed = true;
    console.warn("[classification-warning]", {
      paperId: paper.id,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  if (ruleResult.topics.length > 0) {
    return {
      topics: ruleResult.topics,
      status: modelFailed ? "pending" : "low_confidence",
      classifierVersion: CLASSIFIER_VERSION,
      classifiedAt
    };
  }

  return {
    topics: [
      otherTopic(
        process.env.OPENAI_API_KEY ? "model" : "rule",
        process.env.OPENAI_API_KEY
          ? "No configured topic reached the confidence threshold."
          : "No strong rule match; model review is not configured."
      )
    ],
    status: modelFailed ? "pending" : "low_confidence",
    classifierVersion: CLASSIFIER_VERSION,
    classifiedAt
  };
}
