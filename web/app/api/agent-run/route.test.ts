import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.ts";

const relayRequest = (): Request => new Request("http://localhost/api/agent-run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: "질문" }),
});

function restoreAgentBase(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.AGENT_API_BASE;
    return;
  }
  process.env.AGENT_API_BASE = value;
}

test("relays configured agent responses safely", async (t) => {
  await t.test("returns a safe gateway error when the configured upstream rejects the request", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.AGENT_API_BASE;
  let upstreamUrl = "";
  globalThis.fetch = async (input) => {
    upstreamUrl = String(input);
    return new Response("upstream secret", { status: 401 });
  };
  process.env.AGENT_API_BASE = "http://127.0.0.1:4123/";
  try {
    const response = await POST(relayRequest());

    assert.equal(upstreamUrl, "http://127.0.0.1:4123/api/run");
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "에이전트 연결에 실패했습니다." });
  } finally {
    globalThis.fetch = originalFetch;
    restoreAgentBase(originalBase);
  }
  });

  await t.test("returns a safe gateway error when the upstream has no stream body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 200 });
  try {
    const response = await POST(relayRequest());

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "에이전트 연결에 실패했습니다." });
  } finally {
    globalThis.fetch = originalFetch;
  }
  });

  await t.test("passes the client abort signal to the upstream stream", async () => {
  const originalFetch = globalThis.fetch;
  const capture: { signal: AbortSignal | null } = { signal: null };
  globalThis.fetch = async (_input, init) => {
    capture.signal = init?.signal ?? null;
    return new Response("data: {\"type\":\"completion\",\"ok\":true}\\n\\n", {
      headers: { "content-type": "text/event-stream" },
    });
  };
  try {
    const controller = new AbortController();
    const request = new Request("http://localhost/api/agent-run", {
      method: "POST",
      body: JSON.stringify({ question: "질문" }),
      signal: controller.signal,
    });

    await POST(request);
    assert.ok(capture.signal !== null);
    controller.abort();

    assert.equal(capture.signal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  });

  await t.test("returns a gateway error for a thrown upstream request but preserves client cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const fetchError = new Error("upstream unavailable");
  globalThis.fetch = async () => {
    throw fetchError;
  };
  try {
    const unavailableResponse = await POST(relayRequest());
    assert.equal(unavailableResponse.status, 502);
    assert.deepEqual(await unavailableResponse.json(), { error: "에이전트 연결에 실패했습니다." });

    const controller = new AbortController();
    const abortError = new DOMException("request aborted", "AbortError");
    globalThis.fetch = async () => {
      controller.abort();
      throw abortError;
    };
    const cancelledRequest = new Request("http://localhost/api/agent-run", {
      method: "POST",
      body: JSON.stringify({ question: "질문" }),
      signal: controller.signal,
    });

    await assert.rejects(POST(cancelledRequest), (error: unknown) => error === abortError);
  } finally {
    globalThis.fetch = originalFetch;
  }
  });
});
