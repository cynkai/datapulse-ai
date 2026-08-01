import { createAgentEventParser } from "./agent-events.ts";
import { createStreamPayloadParser } from "./stream-payload.ts";
import type { ChatMessage, StreamChatHandlers, StreamMode } from "./sse-types.ts";

export type {
  AgentEvent,
  ChartPoint,
  ChartSeries,
  ChartSpec,
  ChatMessage,
  EvidenceSource,
  EvidenceVerdict,
  Reference,
  ReferenceChunk,
  SseErrorPayload,
  StreamChatHandlers,
  StreamMode,
  ToolName,
  VerdictName,
} from "./sse-types";

interface StreamChatOptions {
  readonly mode?: StreamMode;
  readonly signal?: AbortSignal;
}

function streamRequest(messages: readonly ChatMessage[], mode: StreamMode, signal: AbortSignal): RequestInit & { readonly url: string } {
  if (mode === "mock") {
    const base = process.env.NEXT_PUBLIC_MOCK_API_BASE ?? "http://localhost:5001";
    return {
      url: new URL("/api/v1/agents/visual-answer", base).toString(),
      method: "POST",
      headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      cache: "no-store",
      signal,
    };
  }
  const question = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  return {
    url: "/api/agent-run",
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    cache: "no-store",
    signal,
  };
}

export async function streamChat(
  messages: readonly ChatMessage[],
  handlers: StreamChatHandlers,
  options: StreamChatOptions = {},
): Promise<void> {
  const mode = options.mode ?? "live";
  const signal = options.signal ?? new AbortController().signal;
  const request = streamRequest(messages, mode, signal);
  let done = false;
  const complete = (): void => {
    if (done) return;
    done = true;
    handlers.onDone?.();
  };

  try {
    const response = await fetch(request.url, request);
    if (!response.ok || response.body === null) {
      handlers.onError?.({ code: `HTTP_${response.status}`, message: `에이전트 연결에 실패했습니다. (${response.status})` });
      complete();
      return;
    }
    handlers.onStart?.();
    const payload = createStreamPayloadParser(handlers, mode);
    const parser = createAgentEventParser({ onEvent: payload });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (!signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        parser.push(decoder.decode(next.value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.finish();
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      complete();
      return;
    }
    handlers.onError?.({
      code: "STREAM_ERROR",
      message: error instanceof Error ? error.message : "스트림을 읽는 중 오류가 발생했습니다.",
    });
  }
  complete();
}
