import assert from "node:assert/strict";
import test from "node:test";
import { streamChat, type ChartSpec, type EvidenceSource, type EvidenceVerdict, type Reference, type ReferenceChunk, type StreamMode, type ToolName } from "./sse.ts";

const encoder = new TextEncoder();

function event(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function fakeResponse(events: readonly string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const item of events) controller.enqueue(encoder.encode(item));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

interface Capture {
  readonly order: string[];
  readonly references: Reference[];
  readonly chunks: ReferenceChunk[];
  readonly verdicts: EvidenceVerdict[];
  readonly charts: ChartSpec[];
  readonly tools: string[];
  readonly evidenceSources: EvidenceSource[];
  evidenceSource: EvidenceSource | null;
  text: string;
  errors: string[];
}

async function runWithStub(response: Response, mode: StreamMode = "live", question = "애플 실적"): Promise<{ readonly capture: Capture; readonly request: { url: string; body: string } }> {
  const originalFetch = globalThis.fetch;
  const request = { url: "", body: "" };
  const capture: Capture = { order: [], references: [], chunks: [], verdicts: [], charts: [], tools: [], evidenceSources: [], evidenceSource: null, text: "", errors: [] };
  const stub: typeof fetch = async (input, init) => {
    request.url = String(input);
    request.body = typeof init?.body === "string" ? init.body : "";
    return response;
  };
  globalThis.fetch = stub;
  try {
    await streamChat([{ role: "user", content: question }], {
      onStart: () => capture.order.push("start"),
      onTool: (name: ToolName, status) => {
        capture.tools.push(`${name}:${status}`);
        capture.order.push("tool");
      },
      onEvidenceSource: (source) => { capture.evidenceSources.push(source); capture.evidenceSource = source; },
      onReferences: (items) => capture.references.push(...items),
      onChunks: (items) => capture.chunks.push(...items),
      onVerdicts: (items) => capture.verdicts.push(...items),
      onTextDelta: (delta) => { capture.text += delta; },
      onChart: (chart) => capture.charts.push(chart),
      onFinish: () => capture.order.push("finish"),
      onError: (error) => {
        capture.errors.push(error.code);
        if (error.code === "liner_provenance_invalid") capture.evidenceSource = null;
      },
      onDone: () => capture.order.push("done"),
    }, { mode });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { capture, request };
}

function toolCall(callId: string, name: ToolName): string {
  return event({
    type: "run_item_stream_event",
    name: "tool_called",
    item: { type: "tool_call_item", rawItem: { type: "function_call", callId, name, arguments: "{}" } },
  });
}

function toolOutput(callId: string, name: ToolName, output: unknown): string {
  const encoded = JSON.stringify(output);
  return event({
    type: "run_item_stream_event",
    name: "tool_output",
    item: {
      type: "tool_call_output_item",
      rawItem: { type: "function_call_result", callId, name, status: "completed", output: encoded },
      output: encoded,
    },
  });
}

const supportedVerdict = {
  claim: "매출은 100이다.",
  verdict: "supported",
  reason: "독립 출처가 뒷받침합니다.",
  supporting_sources: ["ref-1", "ref-2"],
  conflicting_sources: [],
};

const chartSpec = {
  type: "bar",
  title: "매출 비교",
  x_axis: "기업",
  y_axis: "십억 달러",
  series: [{ name: "매출", data: [{ x: "Apple", y: 100 }] }],
};

test("drives the live main surface from raw Agents SDK tool and text events", async () => {
  const search = {
    source: "live",
    sq_id: "sq1",
    references: [{ id: "ref-1", title: "공식 실적", url: "https://example.com/results" }],
    chunks: [{ id: "chunk-1", reference_id: "ref-1", content: "매출은 100입니다." }],
  };
  const stream = [
    toolCall("search-1", "liner_search"),
    toolOutput("search-1", "liner_search", search),
    toolCall("judge-1", "judge_evidence"),
    toolOutput("judge-1", "judge_evidence", [supportedVerdict]),
    event({ type: "raw_model_stream_event", data: { type: "output_text_delta", delta: "분석 결과입니다." } }),
    toolCall("chart-1", "render_visualization"),
    toolOutput("chart-1", "render_visualization", chartSpec),
    event({ type: "completion", ok: true, final_output: "분석 결과입니다." }),
  ];

  const { capture, request } = await runWithStub(fakeResponse(stream));

  assert.equal(request.url, "/api/agent-run");
  assert.deepEqual(JSON.parse(request.body), { question: "애플 실적" });
  assert.equal(capture.text, "분석 결과입니다.");
  assert.deepEqual(capture.references, [{ title: "공식 실적", url: "https://example.com/results", hostname: "example.com" }]);
  assert.deepEqual(capture.chunks, [{ num: 1, content: "매출은 100입니다.", sourceTitle: "공식 실적", sourceUrl: "https://example.com/results" }]);
  assert.equal(capture.verdicts[0]?.verdict, "supported");
  assert.deepEqual(capture.charts[0], { type: "bar", title: "매출 비교", xAxis: "기업", yAxis: "십억 달러", series: [{ name: "매출", data: [{ x: "Apple", y: 100 }] }] });
  assert.deepEqual(capture.tools, [
    "liner_search:started", "liner_search:completed",
    "judge_evidence:started", "judge_evidence:completed",
    "render_visualization:started", "render_visualization:completed",
  ]);
  assert.deepEqual(capture.evidenceSources, ["live"]);
  assert.deepEqual(capture.order, ["start", "tool", "tool", "tool", "tool", "tool", "tool", "finish", "done"]);
  assert.deepEqual(capture.errors, []);
});

for (const [description, output] of [
  ["missing", { references: [], chunks: [] }],
  ["unknown", { source: "preview", references: [], chunks: [] }],
  ["malformed", { source: ["live"], references: [], chunks: [] }],
] as const) {
  test(`does not emit LIVE provenance to the main UI when the Liner source is ${description}`, async () => {
    const stream = [
      toolCall("search-1", "liner_search"),
      toolOutput("search-1", "liner_search", output),
      event({ type: "completion", ok: true }),
    ];

    const { capture } = await runWithStub(fakeResponse(stream));

    assert.deepEqual(capture.evidenceSources, []);
  });
}

test("emits mock provenance from an explicit Liner fallback tool output", async () => {
  const stream = [
    toolCall("search-1", "liner_search"),
    toolOutput("search-1", "liner_search", { source: "mock", references: [], chunks: [] }),
    event({ type: "completion", ok: true }),
  ];

  const { capture } = await runWithStub(fakeResponse(stream));

  assert.deepEqual(capture.evidenceSources, ["mock"]);
});

test("fails closed after a valid Liner source when a later result is missing", async () => {
  const stream = [
    toolCall("search-1", "liner_search"),
    toolOutput("search-1", "liner_search", { source: "live", references: [], chunks: [] }),
    toolCall("search-2", "liner_search"),
    event({ type: "completion", ok: true }),
  ];

  const { capture } = await runWithStub(fakeResponse(stream));

  assert.deepEqual(capture.evidenceSources, ["live"]);
  assert.equal(capture.evidenceSource, null);
  assert.deepEqual(capture.errors, ["liner_provenance_invalid"]);
});

for (const [description, output] of [
  ["unknown", { source: "preview", references: [], chunks: [] }],
  ["malformed", { source: ["live"], references: [], chunks: [] }],
] as const) {
  test(`fails closed after live provenance when the later Liner result is ${description}`, async () => {
    const stream = [
      toolCall("search-1", "liner_search"),
      toolOutput("search-1", "liner_search", { source: "live", references: [], chunks: [] }),
      toolOutput("search-1", "liner_search", output),
      toolOutput("search-2", "liner_search", { source: "live", references: [], chunks: [] }),
      event({ type: "completion", ok: true }),
    ];

    const { capture } = await runWithStub(fakeResponse(stream));

    assert.deepEqual(capture.evidenceSources, ["live"]);
    assert.equal(capture.evidenceSource, null);
    assert.deepEqual(capture.errors, ["liner_provenance_invalid"]);
  });
}

test("rejects a Liner result with a mismatched tool name", async () => {
  const stream = [
    toolCall("search-1", "liner_search"),
    toolOutput("search-1", "judge_evidence", { source: "live", references: [], chunks: [] }),
    event({ type: "completion", ok: true }),
  ];

  const { capture } = await runWithStub(fakeResponse(stream));

  assert.deepEqual(capture.evidenceSources, []);
  assert.equal(capture.evidenceSource, null);
  assert.deepEqual(capture.errors, ["liner_provenance_invalid"]);
});

test("ignores provenance-shaped output from another tool in mixed calls", async () => {
  const stream = [
    toolCall("search-1", "liner_search"),
    toolCall("judge-1", "judge_evidence"),
    toolOutput("judge-1", "judge_evidence", { source: "live", references: [], chunks: [] }),
    toolOutput("search-1", "liner_search", { source: "live", references: [], chunks: [] }),
    event({ type: "completion", ok: true }),
  ];

  const { capture } = await runWithStub(fakeResponse(stream));

  assert.deepEqual(capture.evidenceSources, ["live"]);
  assert.deepEqual(capture.errors, []);
});

test("rejects a reused call ID even when a later valid Liner result arrives", async () => {
  const stream = [
    toolCall("search-1", "liner_search"),
    toolCall("search-1", "judge_evidence"),
    toolOutput("search-1", "judge_evidence", { source: "live", references: [], chunks: [] }),
    toolCall("search-2", "liner_search"),
    toolOutput("search-2", "liner_search", { source: "live", references: [], chunks: [] }),
    event({ type: "completion", ok: true }),
  ];

  const { capture } = await runWithStub(fakeResponse(stream));

  assert.deepEqual(capture.evidenceSources, []);
  assert.equal(capture.evidenceSource, null);
  assert.deepEqual(capture.errors, ["liner_provenance_invalid"]);
});

test("preserves direct object Liner tool output fixtures", async () => {
  const stream = [
    toolCall("search-1", "liner_search"),
    event({
      type: "run_item_stream_event",
      name: "tool_output",
      item: {
        type: "tool_call_output_item",
        rawItem: {
          type: "function_call_result",
          callId: "search-1",
          name: "liner_search",
          status: "completed",
          output: { source: "mock", references: [], chunks: [] },
        },
      },
    }),
    event({ type: "completion", ok: true }),
  ];

  const { capture } = await runWithStub(fakeResponse(stream));

  assert.deepEqual(capture.evidenceSources, ["mock"]);
});

test("emits mock provenance from an Agents SDK text output envelope", async () => {
  const stream = [
    toolCall("search-1", "liner_search"),
    event({
      type: "run_item_stream_event",
      name: "tool_output",
      item: {
        type: "tool_call_output_item",
        rawItem: {
          type: "function_call_result",
          callId: "search-1",
          name: "liner_search",
          status: "completed",
          output: { type: "text", text: JSON.stringify({ source: "mock", references: [], chunks: [] }) },
        },
      },
    }),
    event({ type: "completion", ok: true }),
  ];

  const { capture } = await runWithStub(fakeResponse(stream));

  assert.deepEqual(capture.evidenceSources, ["mock"]);
});

test("maps Liner-specific SSE errors without discarding the stream", async () => {
  const stream = [
    event({ type: "error", code: "liner_search_failed", message: "Liner API returned HTTP 502" }),
    event({ type: "completion", ok: false }),
  ];
  const { capture } = await runWithStub(fakeResponse(stream));

  assert.deepEqual(capture.errors, ["liner_search_failed"]);
});

for (const verdict of ["conflicting", "insufficient", "unsupported"] as const) {
  test(`suppresses charts when the judge verdict is ${verdict}`, async () => {
    const blocked = { ...supportedVerdict, verdict, reason: `${verdict} 근거` };
    const stream = [
      toolCall("judge-1", "judge_evidence"),
      toolOutput("judge-1", "judge_evidence", [blocked]),
      toolCall("chart-1", "render_visualization"),
      toolOutput("chart-1", "render_visualization", chartSpec),
      event({ type: "completion", ok: true, final_output: "판정 결과" }),
    ];

    const { capture } = await runWithStub(fakeResponse(stream));

    assert.equal(capture.verdicts[0]?.verdict, verdict);
    assert.equal(capture.charts.length, 0);
  });
}

test("uses only the existing offline visual-answer endpoint and validates its streamed chart data", async () => {
  const mockConfig = { title: "오프라인 비교", unit: "%", labels: ["A", "B"], series: [{ name: "점유율", color: "#fff", values: [60, 40] }] };
  const html = `<script>const CFG = ${JSON.stringify(mockConfig)};</script>`;
  const stream = [
    event({ type: "data-search-references", data: { references: [{ title: "Mock source", url: "https://mock.example/source", hostname: "mock.example" }] } }),
    event({ type: "text-delta", delta: "오프라인 결과" }),
    event({ type: "data-update", data: { atlasArtifact: { html } } }),
    event({ type: "finish", text: "오프라인 결과" }),
    "data: [DONE]\n\n",
  ];

  const { capture, request } = await runWithStub(fakeResponse(stream), "mock");

  assert.equal(request.url, "http://localhost:5001/api/v1/agents/visual-answer");
  assert.deepEqual(JSON.parse(request.body), { messages: [{ role: "user", content: "애플 실적" }] });
  assert.equal(capture.text, "오프라인 결과");
  assert.equal(capture.charts[0]?.title, "오프라인 비교");
  assert.deepEqual(capture.charts[0]?.series[0]?.data, [{ x: "A", y: 60 }, { x: "B", y: 40 }]);
});

test("reports connection failures and completes exactly once", async () => {
  const { capture } = await runWithStub(new Response("unavailable", { status: 503 }));

  assert.deepEqual(capture.errors, ["HTTP_503"]);
  assert.deepEqual(capture.order, ["done"]);
});
