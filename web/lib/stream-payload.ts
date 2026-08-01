import type { AgentEvent as RawAgentEvent, JsonValue } from "./agent-events.ts";
import type {
  ChartSpec,
  ChartSeries,
  EvidenceVerdict,
  Reference,
  ReferenceChunk,
  StreamChatHandlers,
  StreamMode,
  ToolName,
  VerdictName,
} from "./sse-types.ts";
import { decodeAgentsSdkToolOutput, evidenceSourceFromLinerOutput, linerFailureMessage } from "./trust-signals.ts";

type JsonRecord = { readonly [key: string]: JsonValue };

function isRecord(value: JsonValue): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function decoded(value: JsonValue | undefined): JsonValue | null {
  return decodeAgentsSdkToolOutput(value);
}

function nestedRecord(value: JsonValue, types: ReadonlySet<string>): JsonRecord | null {
  if (!isRecord(value)) return null;
  const type = stringField(value, "type");
  if (type !== null && types.has(type)) return value;
  for (const child of Object.values(value)) {
    const found = nestedRecord(child, types);
    if (found !== null) return found;
  }
  return null;
}

function toolName(value: string | null): ToolName | null {
  switch (value) {
    case "plan_research":
    case "liner_search":
    case "judge_evidence":
    case "render_visualization":
      return value;
    default:
      return null;
  }
}

function verdictName(value: string | null): VerdictName | null {
  switch (value) {
    case "supported":
    case "conflicting":
    case "insufficient":
    case "unsupported":
    case "not_atomic":
      return value;
    default:
      return null;
  }
}

function chartType(value: string | null): ChartSpec["type"] | null {
  switch (value) {
    case "bar":
    case "line":
    case "scatter":
      return value;
    default:
      return null;
  }
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function referencesFrom(value: JsonValue): { readonly byId: ReadonlyMap<string, Reference>; readonly items: readonly Reference[] } | null {
  if (!isRecord(value) || !Array.isArray(value.references)) return null;
  const byId = new Map<string, Reference>();
  const items: Reference[] = [];
  for (const entry of value.references) {
    if (!isRecord(entry)) return null;
    const title = stringField(entry, "title");
    const url = stringField(entry, "url");
    const host = url === null ? null : stringField(entry, "hostname") ?? hostname(url);
    if (title === null || url === null || host === null) return null;
    const reference: Reference = {
      title,
      url,
      hostname: host,
      ...(stringField(entry, "faviconUrl") ? { faviconUrl: stringField(entry, "faviconUrl") ?? undefined } : {}),
      ...(stringField(entry, "description") ? { description: stringField(entry, "description") ?? undefined } : {}),
      ...(stringField(entry, "date") ? { date: stringField(entry, "date") ?? undefined } : {}),
    };
    items.push(reference);
    const id = stringField(entry, "id");
    if (id !== null) byId.set(id, reference);
  }
  return { byId, items };
}

function chunksFrom(value: JsonValue, references: ReadonlyMap<string, Reference>): readonly ReferenceChunk[] | null {
  if (!isRecord(value)) return null;
  const raw = Array.isArray(value.chunks) ? value.chunks : value.referenceChunks;
  if (!Array.isArray(raw)) return null;
  const chunks: ReferenceChunk[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) return null;
    const content = stringField(entry, "content");
    const reference = references.get(stringField(entry, "reference_id") ?? "");
    const sourceTitle = stringField(entry, "sourceTitle") ?? reference?.title ?? null;
    const sourceUrl = stringField(entry, "sourceUrl") ?? reference?.url ?? null;
    if (content === null || sourceTitle === null || sourceUrl === null) return null;
    const num = entry.num;
    chunks.push({ num: typeof num === "number" ? num : index + 1, content, sourceTitle, sourceUrl });
  }
  return chunks;
}

function verdictsFrom(value: JsonValue): readonly EvidenceVerdict[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const verdicts: EvidenceVerdict[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const claim = stringField(entry, "claim");
    const verdict = verdictName(stringField(entry, "verdict"));
    const reason = stringField(entry, "reason");
    const supporting = entry.supporting_sources;
    const conflicting = entry.conflicting_sources;
    if (
      claim === null || verdict === null || reason === null ||
      !Array.isArray(supporting) || !supporting.every((item) => typeof item === "string") ||
      !Array.isArray(conflicting) || !conflicting.every((item) => typeof item === "string")
    ) return null;
    verdicts.push({
      claim,
      verdict,
      reason,
      supportingSources: supporting,
      conflictingSources: conflicting,
    });
  }
  return verdicts;
}

export function parseChartSpec(value: JsonValue): ChartSpec | null {
  if (!isRecord(value)) return null;
  const type = chartType(stringField(value, "type"));
  if (type === null) return null;
  const title = stringField(value, "title");
  const xAxis = stringField(value, "x_axis");
  const yAxis = stringField(value, "y_axis");
  if (title === null || xAxis === null || yAxis === null || !Array.isArray(value.series) || value.series.length === 0) return null;
  const series = value.series.map((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.data) || entry.data.length === 0) return null;
    const name = stringField(entry, "name");
    const data = entry.data.map((point) => {
      if (!isRecord(point) || !["string", "number"].includes(typeof point.x) || typeof point.y !== "number" || !Number.isFinite(point.y)) return null;
      const x = point.x;
      return typeof x === "string" || typeof x === "number" ? { x, y: point.y } : null;
    });
    return name === null || data.some((point) => point === null) ? null : { name, data: data.filter((point) => point !== null) };
  });
  if (series.some((entry) => entry === null)) return null;
  return { type, title, xAxis, yAxis, series: series.filter((entry) => entry !== null) };
}

function mockChartFrom(html: string): ChartSpec | null {
  const match = /const CFG = (\{[^\n]+\});/.exec(html);
  if (match?.[1] === undefined) return null;
  const cfg = decoded(match[1]);
  if (!isRecord(cfg)) return null;
  const labelsValue = cfg.labels;
  const seriesValue = cfg.series;
  if (!Array.isArray(labelsValue) || !labelsValue.every((label) => typeof label === "string") || !Array.isArray(seriesValue)) return null;
  const labels = labelsValue.filter((label) => typeof label === "string");
  const series: ChartSeries[] = [];
  for (const entry of seriesValue) {
    if (!isRecord(entry) || typeof entry.name !== "string" || !Array.isArray(entry.values)) return null;
    const values = entry.values;
    if (!values.every((item) => typeof item === "number" && Number.isFinite(item)) || values.length !== labels.length) return null;
    const data = values.map((y, index) => typeof y === "number" ? { x: labels[index] ?? index, y } : null);
    if (data.some((point) => point === null)) return null;
    series.push({ name: entry.name, data: data.filter((point) => point !== null) });
  }
  if (typeof cfg.title !== "string" || series.length === 0) return null;
  return { type: "bar", title: cfg.title, xAxis: "기간", yAxis: typeof cfg.unit === "string" ? cfg.unit : "값", series };
}

export function createStreamPayloadParser(handlers: StreamChatHandlers, mode: StreamMode) {
  const calls = new Map<string, { readonly name: ToolName | null; readonly resultSeen: boolean; readonly invalid: boolean }>();
  let references = new Map<string, Reference>();
  let chartAllowed = mode === "mock";
  let emittedText = false;
  let pendingError: { readonly code: string; readonly message: string } | null = null;
  let linerProvenanceInvalid = false;
  let finished = false;

  const reportError = (error: { readonly code: string; readonly message: string }): void => {
    pendingError = { ...error, message: linerFailureMessage(error) };
  };
  const invalidateLinerProvenance = (): void => {
    if (linerProvenanceInvalid) return;
    linerProvenanceInvalid = true;
    chartAllowed = false;
    reportError({ code: "liner_provenance_invalid", message: "Liner provenance result is invalid." });
  };
  const toolOutput = (name: ToolName, output: JsonValue): void => {
    if (name === "liner_search") {
      const source = evidenceSourceFromLinerOutput(output);
      if (source === null || linerProvenanceInvalid) return;
      handlers.onEvidenceSource?.(source);
      const parsedReferences = referencesFrom(output);
      if (parsedReferences !== null) {
        references = new Map([...references, ...parsedReferences.byId]);
        handlers.onReferences?.(parsedReferences.items);
      }
      const chunks = chunksFrom(output, references);
      if (chunks !== null) handlers.onChunks?.(chunks);
    }
    if (name === "judge_evidence") {
      const verdicts = verdictsFrom(output);
      if (verdicts !== null) {
        chartAllowed = verdicts.every((item) => item.verdict === "supported");
        handlers.onVerdicts?.(verdicts);
      }
    }
    if (name === "render_visualization" && chartAllowed) {
      const chart = parseChartSpec(output);
      if (chart !== null) handlers.onChart?.(chart);
    }
  };
  const validateLinerProvenance = (): void => {
    if (linerProvenanceInvalid) return;
    for (const call of calls.values()) {
      if (call.name === "liner_search" && (!call.resultSeen || call.invalid)) {
        invalidateLinerProvenance();
        return;
      }
    }
  };
  const finish = (): void => {
    if (finished) return;
    validateLinerProvenance();
    finished = true;
    handlers.onFinish?.();
  };

  return (event: RawAgentEvent): void => {
    if (event.kind === "error") {
      reportError({ code: event.code ?? "agent_run_failed", message: event.message });
      return;
    }
    if (event.kind === "completion") {
      if (isRecord(event.raw) && !emittedText && typeof event.raw.final_output === "string") handlers.onTextDelta?.(event.raw.final_output);
      if (event.ok) {
        pendingError = null;
        finish();
      } else {
        const error = pendingError ?? { code: "agent_run_failed", message: "에이전트 실행에 실패했습니다." };
        pendingError = null;
        handlers.onError?.(error);
      }
      return;
    }
    if (event.kind !== "event" || !isRecord(event.raw)) return;

    const topType = stringField(event.raw, "type");
    const data = isRecord(event.raw.data) ? event.raw.data : event.raw;
    const dataType = stringField(data, "type");
    const delta = stringField(event.raw, "delta") ?? stringField(data, "delta");
    if ((topType === "text-delta" || dataType === "output_text_delta" || dataType === "response.output_text.delta") && delta !== null) {
      emittedText = true;
      handlers.onTextDelta?.(delta);
    }
    if (topType === "finish") finish();
    if (topType === "data-error") {
      const error = {
        code: stringField(data, "code") ?? "mock_error",
        message: stringField(data, "message") ?? "오프라인 모드 오류가 발생했습니다.",
      };
      reportError(error);
    }

    const call = nestedRecord(event.raw, new Set(["function_call"]));
    if (call !== null) {
      const name = toolName(stringField(call, "name"));
      const callId = stringField(call, "callId") ?? stringField(call, "call_id");
      if (callId !== null) {
        const previous = calls.get(callId);
        if (previous !== undefined) {
          if (previous.name === "liner_search" || name === "liner_search") invalidateLinerProvenance();
          calls.set(callId, { name, resultSeen: false, invalid: true });
        } else {
          calls.set(callId, { name, resultSeen: false, invalid: false });
        }
        if (name !== null) handlers.onTool?.(name, "started");
      }
    }
    const result = nestedRecord(event.raw, new Set(["function_call_result", "function_call_output"]));
    if (result !== null) {
      const callId = stringField(result, "callId") ?? stringField(result, "call_id");
      if (callId === null) return;
      const call = calls.get(callId);
      if (call === undefined || call.invalid || call.name === null) return;
      const resultNameValue = stringField(result, "name");
      const resultName = toolName(resultNameValue);
      if (resultNameValue !== null && resultName !== call.name) {
        if (call.name === "liner_search") invalidateLinerProvenance();
        return;
      }
      if (call.resultSeen) {
        if (call.name === "liner_search") invalidateLinerProvenance();
        return;
      }
      const output = decoded(result.output);
      if (call.name === "liner_search") {
        if (output === null || evidenceSourceFromLinerOutput(output) === null || linerProvenanceInvalid) {
          invalidateLinerProvenance();
          return;
        }
      } else if (output === null) {
        return;
      }
      calls.set(callId, { ...call, resultSeen: true });
      toolOutput(call.name, output);
      handlers.onTool?.(call.name, "completed");
    }

    const oldReferences = referencesFrom(data);
    if (oldReferences !== null) {
      references = new Map([...references, ...oldReferences.byId]);
      handlers.onReferences?.(oldReferences.items);
    }
    const oldChunks = chunksFrom(data, references);
    if (oldChunks !== null) handlers.onChunks?.(oldChunks);
    const artifact = isRecord(data.atlasArtifact) ? data.atlasArtifact : null;
    if (mode === "mock" && artifact !== null && typeof artifact.html === "string") {
      const chart = mockChartFrom(artifact.html);
      if (chart !== null) handlers.onChart?.(chart);
    }
  };
}
