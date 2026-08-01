import type { JsonValue } from "./agent-events.ts";
import type { EvidenceSource, SseErrorPayload } from "./sse-types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function parseJsonValue(value: string): JsonValue | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonValue(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function decodeAgentsSdkToolOutput(output: JsonValue | undefined): JsonValue | null {
  if (output === undefined) return null;
  if (isRecord(output) && output.type === "text") {
    return typeof output.text === "string" ? parseJsonValue(output.text) : null;
  }
  return typeof output === "string" ? parseJsonValue(output) : output;
}

export function evidenceSourceFromLinerOutput(output: unknown): EvidenceSource | null {
  if (!isRecord(output)) return null;
  switch (output.source) {
    case "mock":
      return "mock";
    case "live":
      return "live";
    default:
      return null;
  }
}

export function evidenceTrustLabel(source: EvidenceSource): string {
  switch (source) {
    case "live":
      return "LIVE";
    case "mock":
      return "MOCK (폴백)";
  }
}

export function isLinerSearchFailure(error: Pick<SseErrorPayload, "code" | "message">): boolean {
  return error.code.toLowerCase().startsWith("liner_") || error.message.toLowerCase().includes("liner");
}

export function linerFailureMessage(error: Pick<SseErrorPayload, "code" | "message">): string {
  return isLinerSearchFailure(error) ? "Liner 연결 실패" : error.message;
}
