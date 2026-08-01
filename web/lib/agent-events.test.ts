import assert from "node:assert/strict";
import test from "node:test";
import { AgentStreamError, agentRunUrl, createAgentEventParser, linerEvidenceSourceFromEvents, streamAgentRun, type AgentEvent } from "./agent-events.ts";

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

test("detects explicit mock provenance from a paired raw Liner tool result", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-7","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-7","output":"{\\"source\\":\\"mock\\",\\"references\\":[],\\"chunks\\":[]}"}}}\n\n');
  parser.finish();

  assert.equal(linerEvidenceSourceFromEvents(events), "mock");
});

test("detects explicit mock provenance from the SDK function_call_result shape", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"run_item_stream_event","item":{"rawItem":{"type":"function_call","callId":"call-8","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"run_item_stream_event","item":{"rawItem":{"type":"function_call_result","callId":"call-8","output":"{\\"source\\":\\"mock\\",\\"references\\":[],\\"chunks\\":[]}"}}}\n\n');
  parser.finish();

  assert.equal(linerEvidenceSourceFromEvents(events), "mock");
});

test("detects explicit mock provenance from an SDK text output envelope", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"run_item_stream_event","item":{"rawItem":{"type":"function_call","callId":"call-9","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"run_item_stream_event","item":{"rawItem":{"type":"function_call_result","callId":"call-9","output":{"type":"text","text":"{\\"source\\":\\"mock\\",\\"references\\":[],\\"chunks\\":[]}"}}}}\n\n');
  parser.finish();

  assert.equal(linerEvidenceSourceFromEvents(events), "mock");
});

test("does not promote unknown Liner provenance to live", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-10","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-10","output":"{\\"source\\":\\"preview\\",\\"references\\":[],\\"chunks\\":[]}"}}}\n\n');
  parser.finish();

  assert.equal(linerEvidenceSourceFromEvents(events), null);
});

test("does not promote missing Liner provenance to live", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-11","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-11","output":"{\\"references\\":[],\\"chunks\\":[]}"}}}\n\n');
  parser.finish();

  assert.equal(linerEvidenceSourceFromEvents(events), null);
});

test("does not promote malformed Liner provenance to live", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-12","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-12","output":"{\\"source\\":[\\"live\\"],\\"references\\":[],\\"chunks\\":[]}"}}}\n\n');
  parser.finish();

  assert.equal(linerEvidenceSourceFromEvents(events), null);
});

test("binds provenance to the exact Liner call and tool name across mixed calls", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-14","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-15","name":"judge_evidence"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-15","name":"judge_evidence","output":"{\\"source\\":\\"live\\"}"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-14","name":"judge_evidence","output":"{\\"source\\":\\"live\\"}"}}}\n\n');
  parser.finish();

  assert.equal(linerEvidenceSourceFromEvents(events), null);
});

test("ignores provenance-shaped output from another tool in mixed calls", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-21","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-22","name":"judge_evidence"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-22","name":"judge_evidence","output":"{\\"source\\":\\"live\\"}"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-21","name":"liner_search","output":"{\\"source\\":\\"live\\"}"}}}\n\n');
  parser.finish();

  assert.equal(linerEvidenceSourceFromEvents(events), "live");
});

test("fails closed after live provenance when a Liner result is unknown or malformed", () => {
  for (const output of ['{"source":"preview"}', '{"source":["live"]}']) {
    const events: AgentEvent[] = [];
    const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });
    parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-16","name":"liner_search"}}}\n\n');
    parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-16","output":"{\\"source\\":\\"live\\"}"}}}\n\n');
    parser.push(`data: ${JSON.stringify({ type: "raw_model_stream_event", data: { item: { type: "function_call_output", call_id: "call-16", output } } })}\n\n`);
    parser.finish();
    assert.equal(linerEvidenceSourceFromEvents(events), null);
  }
});

test("fails closed after live provenance when a later Liner call has no result", () => {
  const missingEvents: AgentEvent[] = [];
  const missingParser = createAgentEventParser({ onEvent: (event) => missingEvents.push(event) });
  missingParser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-18","name":"liner_search"}}}\n\n');
  missingParser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-18","output":"{\\"source\\":\\"live\\"}"}}}\n\n');
  missingParser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-19","name":"liner_search"}}}\n\n');
  missingParser.finish();
  assert.equal(linerEvidenceSourceFromEvents(missingEvents), null);
});

test("does not accept a reused call ID for Liner provenance", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-20","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-20","name":"judge_evidence"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-20","name":"judge_evidence","output":"{\\"source\\":\\"live\\"}"}}}\n\n');
  parser.finish();

  assert.equal(linerEvidenceSourceFromEvents(events), null);
});

test("detects explicit live provenance from a paired raw Liner tool result", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-13","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-13","output":"{\\"source\\":\\"live\\",\\"references\\":[],\\"chunks\\":[]}"}}}\n\n');
  parser.finish();

  assert.equal(linerEvidenceSourceFromEvents(events), "live");
});

test("fails closed after explicit live provenance when a Liner error follows", () => {
  const events: AgentEvent[] = [];
  const parser = createAgentEventParser({ onEvent: (event) => events.push(event) });

  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call","call_id":"call-23","name":"liner_search"}}}\n\n');
  parser.push('data: {"type":"raw_model_stream_event","data":{"item":{"type":"function_call_output","call_id":"call-23","output":"{\\"source\\":\\"live\\",\\"references\\":[],\\"chunks\\":[]}"}}}\n\n');
  parser.finish();
  events.push({
    kind: "error",
    code: "liner_api_failed",
    message: "Liner search failed.",
    raw: { kind: "error", code: "liner_api_failed", message: "Liner search failed." },
    rawJson: '{"kind":"error","code":"liner_api_failed","message":"Liner search failed."}',
  });

  assert.equal(linerEvidenceSourceFromEvents(events), null);
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
