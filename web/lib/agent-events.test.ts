import assert from "node:assert/strict";
import test from "node:test";
import { AgentStreamError, agentRunUrl, createAgentEventParser, streamAgentRun, type AgentEvent } from "./agent-events.ts";

test("uses the same-origin relay for browser agent requests", () => {
  assert.equal(agentRunUrl(), "/api/agent-run");
});

test("pairs raw function calls and outputs by callId while preserving payloads", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });
  const callPayload = '{ "type":"raw_model_stream_event", "data":{"item":{"type":"function_call","call_id":"call-7","name":"liner_search","arguments":"{\\"query\\":\\"AI\\"}"}}}';

  parser.push(`data: ${callPayload}\n\n`);
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-7","output":"{\\"results\\":[]}"}}}\n\n');
  parser.finish();

  const toolEvents = events.filter(hasTool);
  assert.equal(toolEvents.length, 2);
  assert.equal(toolEvents[0]?.tool?.kind, "tool_call");
  assert.equal(toolEvents[0]?.tool?.callId, "call-7");
  assert.equal(toolEvents[1]?.tool?.kind, "tool_result");
  assert.equal(toolEvents[1]?.tool?.callId, "call-7");
  assert.equal(toolEvents[0]?.rawJson, callPayload);
});

test("records malformed SSE data without interrupting following raw events", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push("data: not-json\n\n");
  parser.push('data: {"type":"completion","ok":false}\n\n');
  parser.finish();

  assert.equal(events[0]?.kind, "malformed");
  assert.equal(events[1]?.kind, "completion");
  assert.equal(events[1]?.kind === "completion" ? events[1].ok : undefined, false);
});

test("preserves fetch and reader failures for the run owner to handle", async (t) => {
  await t.test("rejects when the relay request cannot connect", async () => {
    const networkError = new Error("connection refused");

    await withFetch(async () => Promise.reject(networkError), async () => {
      await assert.rejects(streamAgentRun(agentRunRequest()), (error: unknown) => error === networkError);
    });
  });

  await t.test("rejects when a successful response stream fails while reading", async () => {
    const readerError = new Error("stream interrupted");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(readerError);
      },
    });

    await withFetch(async () => new Response(body), async () => {
      await assert.rejects(streamAgentRun(agentRunRequest()), (error: unknown) => error === readerError);
    });
  });
});

test("rejects unusable relay responses with their connection status", async (t) => {
  await t.test("rejects a non-OK response", async () => {
    await withFetch(async () => new Response(null, { status: 503 }), async () => {
      await assert.rejects(
        streamAgentRun(agentRunRequest()),
        (error: unknown) => error instanceof AgentStreamError && error.status === 503,
      );
    });
  });

  await t.test("rejects a successful response without a readable body", async () => {
    await withFetch(async () => new Response(null, { status: 200 }), async () => {
      await assert.rejects(
        streamAgentRun(agentRunRequest()),
        (error: unknown) => error instanceof AgentStreamError && error.status === 200,
      );
    });
  });
});

function hasTool(event: AgentEvent): event is Extract<AgentEvent, { readonly kind: "event" }> {
  return event.kind === "event" && event.tool !== null;
}

function agentRunRequest(): Parameters<typeof streamAgentRun>[0] {
  return {
    question: "질문",
    signal: new AbortController().signal,
    onEvent: () => undefined,
  };
}

async function withFetch<T>(fetchStub: typeof fetch, action: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
