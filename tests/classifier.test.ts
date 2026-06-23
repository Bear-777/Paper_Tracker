import assert from "node:assert/strict";
import test from "node:test";

import { classifyPaper } from "@/lib/classifier";
import type { Paper } from "@/lib/types";

function paper(overrides: Partial<Paper>): Paper {
  return {
    id: "paper-1",
    title: "Untitled physics paper",
    authors: ["Ada Researcher"],
    abstract: "",
    sourceId: "arxiv-quant-ph",
    sourceLabel: "arXiv quant-ph",
    sourceType: "arxiv",
    publishedAt: "2026-06-20T00:00:00.000Z",
    url: "https://example.com/paper",
    topics: [],
    classificationStatus: "pending",
    ...overrides
  };
}

test("classifies an explicit quantum information paper", async () => {
  const result = await classifyPaper(
    paper({
      title: "Entanglement-assisted quantum communication over noisy quantum channels",
      abstract:
        "We study quantum information transmission, quantum channel capacity, and entanglement resources for communication networks."
    })
  );

  assert.ok(result.topics.some((topic) => topic.topicId === "quantum-information"));
  assert.equal(result.status, "classified");
});

test("supports multiple materially represented topics", async () => {
  const result = await classifyPaper(
    paper({
      title: "Photonic quantum computing with error-corrected entangled qubits",
      abstract:
        "A quantum photonics architecture combines single photon circuits, quantum error correction, and fault-tolerant quantum computing."
    })
  );
  const topicIds = new Set(result.topics.map((topic) => topic.topicId));

  assert.ok(topicIds.has("quantum-optics"));
  assert.ok(topicIds.has("quantum-computing") || topicIds.has("quantum-information"));
});

test("falls back to other when no configured topic has evidence", async () => {
  const result = await classifyPaper(
    paper({
      title: "A short editorial note",
      abstract: "This note summarizes changes to the journal publication workflow."
    })
  );

  assert.equal(result.topics[0]?.topicId, "other");
  assert.equal(result.status, "low_confidence");
});

