import assert from "node:assert/strict";
import test from "node:test";
import { nextStateForEvent } from "./run-state.ts";
import type { AgentEvent } from "./agent-events.ts";

test("moves a connecting run to streaming when its first event is nonterminal", () => {
  const event: AgentEvent = {
    kind: "event",
    raw: { type: "raw_model_stream_event" },
    rawJson: '{"type":"raw_model_stream_event"}',
    tool: null,
  };

  assert.equal(nextStateForEvent("connecting", event), "streaming");
});

test("marks unsuccessful completion as an error", () => {
  const event: AgentEvent = {
    kind: "completion",
    ok: false,
    raw: { type: "completion", ok: false },
    rawJson: '{"type":"completion","ok":false}',
  };

  assert.equal(nextStateForEvent("streaming", event), "error");
});
