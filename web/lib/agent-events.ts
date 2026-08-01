export type JsonValue = boolean | null | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

type JsonRecord = { readonly [key: string]: JsonValue };

export interface ToolEvent {
  readonly callId: string;
  readonly kind: "tool_call" | "tool_result";
  readonly name: string | null;
}

export type AgentEvent =
  | { readonly kind: "event"; readonly raw: JsonValue; readonly rawJson: string; readonly tool: ToolEvent | null }
  | { readonly kind: "completion"; readonly ok: boolean; readonly raw: JsonValue; readonly rawJson: string }
  | { readonly kind: "error"; readonly message: string; readonly raw: JsonValue; readonly rawJson: string }
  | { readonly kind: "malformed"; readonly raw: string };

export interface AgentEventParserOptions {
  readonly onEvent: (event: AgentEvent) => void;
}

export interface AgentEventParser {
  readonly events: AgentEvent[];
  push(chunk: string): void;
  finish(): void;
}

export class AgentStreamError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AgentStreamError";
    this.status = status;
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

function isRecord(value: JsonValue): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function eventTool(value: JsonValue): ToolEvent | null {
  if (!isRecord(value)) return null;
  const type = stringValue(value, "type");
  if (type === "function_call" || type === "function_call_output") {
    const callId = stringValue(value, "call_id") ?? stringValue(value, "callId");
    if (callId !== null) {
      return {
        callId,
        kind: type === "function_call" ? "tool_call" : "tool_result",
        name: stringValue(value, "name"),
      };
    }
  }
  for (const child of Object.values(value)) {
    const found = eventTool(child);
    if (found !== null) return found;
  }
  return null;
}

function parsedEvent(value: JsonValue, rawJson: string): AgentEvent {
  if (!isRecord(value)) return { kind: "event", raw: value, rawJson, tool: null };
  if (stringValue(value, "type") === "completion") {
    return { kind: "completion", ok: value.ok === true, raw: value, rawJson };
  }
  if (stringValue(value, "type") === "error") {
    return {
      kind: "error",
      message: stringValue(value, "message") ?? "에이전트 실행 중 오류가 발생했습니다.",
      raw: value,
      rawJson,
    };
  }
  return { kind: "event", raw: value, rawJson, tool: eventTool(value) };
}

export function agentRunUrl(): string {
  return "/api/agent-run";
}

export function createAgentEventParser(options: AgentEventParserOptions): AgentEventParser {
  const events: AgentEvent[] = [];
  let buffer = "";
  let dataLines: string[] = [];

  const emit = (event: AgentEvent): void => {
    events.push(event);
    options.onEvent(event);
  };
  const flush = (): void => {
    if (dataLines.length === 0) return;
    const raw = dataLines.join("\n");
    dataLines = [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isJsonValue(parsed)) {
        emit({ kind: "malformed", raw });
        return;
      }
      emit(parsedEvent(parsed, raw));
    } catch {
      emit({ kind: "malformed", raw });
    }
  };
  const line = (input: string): void => {
    const value = input.endsWith("\r") ? input.slice(0, -1) : input;
    if (value === "") {
      flush();
      return;
    }
    if (value.startsWith(":")) return;
    if (value.startsWith("data:")) {
      dataLines.push(value.slice(5).replace(/^ /, ""));
      return;
    }
    if (!value.startsWith("event:") && !value.startsWith("id:") && !value.startsWith("retry:")) {
      dataLines.push(value);
    }
  };

  return {
    events,
    push(chunk) {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        line(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
    },
    finish() {
      if (buffer.length > 0) line(buffer);
      buffer = "";
      flush();
    },
  };
}

export async function streamAgentRun(request: {
  readonly question: string;
  readonly signal: AbortSignal;
  readonly onEvent: (event: AgentEvent) => void;
}): Promise<void> {
  const response = await fetch(agentRunUrl(), {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ question: request.question }),
    signal: request.signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new AgentStreamError(response.status, `에이전트 연결에 실패했습니다. (${response.status})`);
  }
  if (response.body === null) throw new AgentStreamError(response.status, "에이전트 스트림 본문이 없습니다.");
  const parser = createAgentEventParser({ onEvent: request.onEvent });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    parser.push(decoder.decode(next.value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.finish();
}
