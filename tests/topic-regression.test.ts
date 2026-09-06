import assert from "node:assert/strict";
import test from "node:test";
import { classificationVersion, classifyPaper, parseModelTopics, reusableClassification, toRuleTopics } from "@/lib/classifier";
import { activePaperTopics, TOPICS } from "@/lib/topics";
import type { Paper, PaperTopic } from "@/lib/types";

export function sample(title: string, abstract = "We derive analytical bounds and verify the predicted performance numerically across a range of noise strengths."): Paper {
  return { id: "fixture", title, abstract, authors: ["Test Author"], sourceId: "quantum", sourceLabel: "Quantum",
    sourceType: "rss", publishedAt: new Date().toISOString(), url: "https://example.org/paper", topics: [], classificationStatus: "pending" };
}

const cases: [string, string[], string[]][] = [
  ["Indefinite causal order in noisy channels", ["indefinite-causal-order"], []],
  ["Quantum switches with many parties", ["indefinite-causal-order"], []],
  ["Witnessing causal nonseparability", ["indefinite-causal-order"], []],
  ["Causally nonseparable processes", ["indefinite-causal-order"], []],
  ["Superposition of causal orders", ["indefinite-causal-order"], []],
  ["Quantum computations without definite causal structure", ["indefinite-causal-order", "quantum-computing"], []],
  ["Quantum-switch-assisted quantum communication", ["indefinite-causal-order", "quantum-information"], []],
  ["Quantum metrology with entangled probes", ["quantum-metrology"], []],
  ["Quantum Fisher information under noise", ["quantum-metrology"], []],
  ["Quantum multiparameter estimation", ["quantum-metrology"], []],
  ["Quantum sensors for weak magnetic fields", ["quantum-metrology"], []],
  ["Sub-shot-noise measurement of optical phase", ["quantum-metrology"], []],
  ["Quantum-enhanced interferometry with squeezed light", ["quantum-metrology", "quantum-optics"], []],
  ["Quantum sensing with trapped ions", ["quantum-metrology", "atomic-molecular-optical"], []],
  ["Quantum metrology through a quantum switch", ["quantum-metrology", "indefinite-causal-order"], []],
  ["Entanglement distillation in quantum networks", ["quantum-information"], []],
  ["Entanglement dynamics in open quantum systems", ["quantum-information"], []],
  ["Bell inequalities for multipartite nonlocality", ["quantum-information"], []],
  ["Quantum key distribution with photon pairs", ["quantum-information", "quantum-optics"], []],
  ["Quantum algorithms for many body physics", ["quantum-computing"], []],
  ["Single-photon sources in cavity QED", ["quantum-optics"], []],
  ["Ultracold gases in an optical lattice", ["atomic-molecular-optical"], []],
  ["Classical network switches and routing protocols", [], ["indefinite-causal-order"]],
  ["Optical switches in a photonic network", [], ["indefinite-causal-order"]],
  ["Causal inference in classical dynamical systems", [], ["indefinite-causal-order"]],
  ["Quantum phase estimation algorithms on qubits", ["quantum-computing"], ["quantum-metrology"]],
  ["Classical parameter estimation and Fisher information", [], ["quantum-metrology"]],
  ["Precision measurement of bridge displacement", [], ["quantum-metrology", "atomic-molecular-optical"]],
  ["Variational methods for electronic circuit compilation", [], ["quantum-computing"]],
  ["Coherence and fidelity in classical signal processing", [], ["quantum-information"]],
  ["Anatomy of a graph decomposition algorithm", [], ["atomic-molecular-optical"]],
  ["Stochastic thermodynamics of complex networks", [], ["quantum-information"]],
  ["Black holes and classical gravity", [], ["quantum-information"]],
  ["Editorial: journal announcements", [], ["quantum-information", "quantum-computing"]]
];

for (const [title, expected, excluded] of cases) {
  test(`rules: ${title}`, () => {
    const ids = toRuleTopics(sample(title)).topics.map((topic) => topic.topicId);
    for (const id of expected) assert.ok(ids.includes(id), `Missing ${id}: ${ids}`);
    for (const id of excluded) assert.ok(!ids.includes(id), `Unexpected ${id}: ${ids}`);
  });
}

test("taxonomy order and retired labels", () => {
  assert.deepEqual(TOPICS.map((topic) => topic.id), ["indefinite-causal-order", "quantum-metrology", "quantum-information", "quantum-computing", "quantum-optics", "atomic-molecular-optical", "other"]);
});
test("abstract semantics terms are included even without title matches", () => {
  const result = toRuleTopics(sample("Noise-resilient protocols", "We investigate indefinite causal order and causal witnesses using a quantum switch in the laboratory."));
  assert.ok(result.topics.some((topic) => topic.topicId === "indefinite-causal-order"));
  assert.equal(result.isCertain, true);
});
test("independent labels survive a much stronger primary topic", () => {
  const result = toRuleTopics(sample("Quantum sensing and quantum computing", "Quantum computers execute quantum algorithms with quantum circuits, quantum processors and quantum gates for quantum simulation."));
  assert.ok(result.topics.some((topic) => topic.topicId === "quantum-metrology"));
});
test("missing abstracts cap confidence and require review", () => {
  const result = toRuleTopics(sample("Quantum metrology with quantum sensors", ""));
  assert.equal(result.isCertain, false);
  assert.ok(result.topics.every((topic) => topic.confidence < 0.7));
});
test("publisher name does not become classification evidence", () => {
  assert.equal(toRuleTopics({ ...sample("Editorial"), sourceLabel: "npj Quantum Information" }).topics.length, 0);
});
test("metadata enrichment invalidates the classification fingerprint", () => {
  assert.notEqual(classificationVersion(sample("Quantum metrology", "")), classificationVersion(sample("Quantum metrology")));
});

const label = (topicId: string, isManual = false): PaperTopic => ({ topicId, topicLabel: "Old label", isManual,
  method: isManual ? "manual" : "rule", confidence: 0.9 });
test("manual active labels survive taxonomy changes but retired ones disappear", () => {
  const paper = sample("Quantum metrology");
  const current = reusableClassification(paper, { topics: [label("condensed-matter", true), label("quantum-information", true)], classificationStatus: "classified", classifierVersion: "manual" });
  assert.deepEqual(current?.topics.map((topic) => topic.topicId), ["quantum-information"]);
  assert.equal(current?.topics[0].topicLabel, "Quantum Information");
  assert.equal(reusableClassification(paper, { topics: [label("condensed-matter", true)], classificationStatus: "classified", classifierVersion: "manual" }), undefined);
});
test("intentional empty manual correction is preserved", () => {
  assert.ok(reusableClassification(sample("Quantum metrology"), { topics: [], classificationStatus: "classified", classifierVersion: "manual" }));
});
test("current results reuse, old version and expired pending results retry", () => {
  const paper = sample("Quantum metrology");
  const existing = { topics: [label("quantum-metrology")], classificationStatus: "pending" as const, classifierVersion: classificationVersion(paper), classifiedAt: new Date().toISOString() };
  assert.ok(reusableClassification(paper, existing));
  assert.equal(reusableClassification(paper, existing, Date.now() + 3600001), undefined);
  assert.equal(reusableClassification(paper, { ...existing, classifierVersion: "topics-v1" }), undefined);
  assert.deepEqual(activePaperTopics([label("fields-particles-gravity"), label("statistical-complex")]), []);
});
test("model output is validated and missing abstract confidence is capped", () => {
  const json = JSON.stringify({ topics: [{ topicId: "quantum-metrology", confidence: 0.94, reason: "Quantum Fisher information is the main object." }] });
  assert.equal(parseModelTopics(json, true)[0].confidence, 0.94);
  assert.equal(parseModelTopics(json, false)[0].confidence, 0.64);
  for (const value of ["null", "{}", '{"topics":{}}', '{"topics":[null]}', '{"topics":[{"topicId":"condensed-matter","confidence":0.9,"reason":"old"}]}']) {
    assert.throws(() => parseModelTopics(value, true));
  }
});
test("model outage leaves readable pending papers; budget defers rather than drops", async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const oldFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-only-never-sent";
  let calls = 0;
  global.fetch = async () => { calls += 1; return new Response("rate limited", { status: 429 }); };
  try {
    const result = await classifyPaper(sample("Uncertain research direction"));
    assert.equal(result.status, "pending");
    assert.equal(result.topics[0].topicId, "other");
    const before = calls;
    assert.equal((await classifyPaper(sample("Uncertain"), { remaining: 0 })).status, "pending");
    assert.equal(calls, before);
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; }
});
