import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceSourceFromLinerOutput,
  evidenceTrustLabel,
  linerFailureMessage,
} from "./trust-signals.ts";

test("renders explicit live Liner evidence visibly LIVE", () => {
  const liveSource = evidenceSourceFromLinerOutput({ source: "live", references: [], chunks: [] });

  assert.equal(liveSource, "live");
  assert.equal(evidenceTrustLabel(liveSource), "LIVE");
});

for (const [description, output] of [
  ["missing", { references: [], chunks: [] }],
  ["unknown", { source: "preview", references: [], chunks: [] }],
  ["malformed", { source: ["live"], references: [], chunks: [] }],
] as const) {
  test(`returns null when the Liner source is ${description}`, () => {
    const source = evidenceSourceFromLinerOutput(output);

    assert.equal(source, null);
  });
}

test("renders explicit mock Liner evidence with the fallback trust marker", () => {
  const source = evidenceSourceFromLinerOutput({ source: "mock", references: [], chunks: [] });

  assert.equal(source, "mock");
  assert.equal(evidenceTrustLabel(source), "MOCK (폴백)");
  assert.notEqual(evidenceTrustLabel(source), "LIVE");
});

test("renders Liner stream failures with the honest Korean status", () => {
  const message = linerFailureMessage({
    code: "liner_search_failed",
    message: "Liner API returned HTTP 502",
  });

  assert.equal(message, "Liner 연결 실패");
});

test("does not relabel malformed or generic agent failures as Liner failures", () => {
  const message = linerFailureMessage({ code: "agent_run_failed", message: "에이전트 실행에 실패했습니다." });

  assert.equal(message, "에이전트 실행에 실패했습니다.");
});
