import topicConfig from "@/topics.json";
import type { PaperTopic, TopicDefinition } from "@/lib/types";

export const TOPICS = topicConfig as TopicDefinition[];
export const CLASSIFIABLE_TOPICS = TOPICS.filter((topic) => topic.id !== "other");
export const TOPIC_BY_ID = new Map(TOPICS.map((topic) => [topic.id, topic]));
export const CLASSIFIER_VERSION = "topics-v2";

// Archive retired labels in storage, but exclude them from active views.
export function activePaperTopics(topics: PaperTopic[]): PaperTopic[] {
  return topics.filter((topic) => TOPIC_BY_ID.has(topic.topicId)).map((topic) => ({
    ...topic,
    topicLabel: TOPIC_BY_ID.get(topic.topicId)!.label
  }));
}
