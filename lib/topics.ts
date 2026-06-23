import topicConfig from "@/topics.json";
import type { TopicDefinition } from "@/lib/types";

export const TOPICS = topicConfig as TopicDefinition[];
export const CLASSIFIABLE_TOPICS = TOPICS.filter((topic) => topic.id !== "other");
export const TOPIC_BY_ID = new Map(TOPICS.map((topic) => [topic.id, topic]));
export const CLASSIFIER_VERSION = "topics-v1";

