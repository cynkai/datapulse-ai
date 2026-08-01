export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface Reference {
  readonly title: string;
  readonly url: string;
  readonly hostname: string;
  readonly faviconUrl?: string;
  readonly description?: string;
  readonly date?: string;
}

export interface ReferenceChunk {
  readonly num: number;
  readonly content: string;
  readonly sourceTitle: string;
  readonly sourceUrl: string;
}

export type VerdictName = "supported" | "conflicting" | "insufficient" | "unsupported" | "not_atomic";

export interface EvidenceVerdict {
  readonly claim: string;
  readonly verdict: VerdictName;
  readonly reason: string;
  readonly supportingSources: readonly string[];
  readonly conflictingSources: readonly string[];
}

export interface ChartPoint {
  readonly x: string | number;
  readonly y: number;
}

export interface ChartSeries {
  readonly name: string;
  readonly data: readonly ChartPoint[];
}

export interface ChartSpec {
  readonly type: "bar" | "line" | "scatter";
  readonly title: string;
  readonly xAxis: string;
  readonly yAxis: string;
  readonly series: readonly ChartSeries[];
}

export type StreamMode = "live" | "mock";
export type EvidenceSource = "live" | "mock";
export type ToolName = "plan_research" | "liner_search" | "judge_evidence" | "render_visualization";

export interface SseErrorPayload {
  readonly code: string;
  readonly message: string;
}

export interface StreamChatHandlers {
  readonly onStart?: () => void;
  readonly onTool?: (name: ToolName, status: "started" | "completed") => void;
  readonly onEvidenceSource?: (source: EvidenceSource) => void;
  readonly onReferences?: (references: readonly Reference[]) => void;
  readonly onChunks?: (chunks: readonly ReferenceChunk[]) => void;
  readonly onVerdicts?: (verdicts: readonly EvidenceVerdict[]) => void;
  readonly onTextDelta?: (delta: string) => void;
  readonly onChart?: (chart: ChartSpec) => void;
  readonly onFinish?: () => void;
  readonly onError?: (error: SseErrorPayload) => void;
  readonly onDone?: () => void;
}

export type AgentEvent =
  | { readonly type: "start" }
  | { readonly type: "tool"; readonly name: ToolName; readonly status: "started" | "completed" }
  | { readonly type: "evidence-source"; readonly source: EvidenceSource }
  | { readonly type: "references"; readonly references: readonly Reference[] }
  | { readonly type: "chunks"; readonly chunks: readonly ReferenceChunk[] }
  | { readonly type: "verdicts"; readonly verdicts: readonly EvidenceVerdict[] }
  | { readonly type: "chart"; readonly chart: ChartSpec }
  | { readonly type: "finish" }
  | { readonly type: "cancel" }
  | { readonly type: "error"; readonly error: SseErrorPayload };
