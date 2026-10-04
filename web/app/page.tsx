"use client";

import { useCallback, useState } from "react";
import AgentProgress, { type AgentPhase } from "@/components/AgentProgress";
import ChatInterface from "@/components/ChatInterface";
import CitationList from "@/components/CitationList";
import { PulseIcon } from "@/components/icons";
import type { AgentEvent, Reference, ReferenceChunk, StreamMode, ToolName } from "@/lib/sse";
import { evidenceTrustLabel, isLinerSearchFailure } from "@/lib/trust-signals";
import type { EvidenceSource } from "@/lib/sse";

const TASKS = ["질문 계획", "근거 검색", "근거 판정", "데이터 시각화"];

const TOOL_INDEX: Record<ToolName, number> = {
  plan_research: 0,
  liner_search: 1,
  judge_evidence: 2,
  render_visualization: 3,
};

const SUGGESTIONS = [
  "애플 vs 마이크로소프트 2025 실적 비교",
  "AI 반도체 시장 점유율 2026",
  "국내외 생성형 AI 시장 전망",
];

const STATUS_PILL: Record<AgentPhase, { label: string; dot: string; text: string }> = {
  idle: { label: "대기 중", dot: "bg-frost-500", text: "text-frost-500" },
  running: { label: "에이전트 작업 중", dot: "bg-pulse-400 animate-pulse-soft", text: "text-pulse-300" },
  done: { label: "작업 완료", dot: "bg-mint-400", text: "text-mint-400" },
  error: { label: "오류", dot: "bg-coral-400", text: "text-coral-400" },
  cancelled: { label: "취소됨", dot: "bg-amber-400", text: "text-amber-400" },
};

export default function Page() {
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [progress, setProgress] = useState({ completed: 0, current: -1 });
  const [references, setReferences] = useState<Reference[]>([]);
  const [chunks, setChunks] = useState<ReferenceChunk[]>([]);
  const [mode, setMode] = useState<StreamMode>("live");
  const [evidenceSource, setEvidenceSource] = useState<EvidenceSource | null>(null);
  const [linerFailed, setLinerFailed] = useState(false);
  const [visualizationBlocked, setVisualizationBlocked] = useState<string | null>(null);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "start":
        setPhase("running");
        setProgress({ completed: 0, current: 0 });
        setReferences([]);
        setChunks([]);
        setEvidenceSource(null);
        setLinerFailed(false);
        setVisualizationBlocked(null);
        break;
      case "tool": {
        const index = TOOL_INDEX[event.name];
        setProgress((previous) => event.status === "started"
          ? { completed: Math.max(previous.completed, index), current: index }
          : { completed: Math.max(previous.completed, index + 1), current: -1 });
        break;
      }
      case "evidence-source":
        setEvidenceSource((previous) => previous === "mock" || event.source === "mock" ? "mock" : event.source);
        break;
      case "references":
        setReferences([...event.references]);
        break;
      case "chunks":
        setChunks([...event.chunks]);
        break;
      case "verdicts": {
        const blocked = event.verdicts.find((verdict) => verdict.verdict !== "supported");
        if (blocked) setVisualizationBlocked(`${blocked.verdict}: ${blocked.reason}`);
        break;
      }
      case "chart":
        setVisualizationBlocked(null);
        setProgress({ completed: TASKS.length, current: -1 });
        break;
      case "finish":
        setLinerFailed(false);
        setPhase("done");
        setProgress((previous) => ({ ...previous, current: -1 }));
        break;
      case "cancel":
        setPhase("cancelled");
        setProgress((previous) => ({ ...previous, current: -1 }));
        break;
      case "error":
        if (isLinerSearchFailure(event.error)) {
          setEvidenceSource(null);
          setLinerFailed(true);
        }
        setPhase("error");
        setProgress((previous) => ({ ...previous, current: -1 }));
        break;
    }
  }, []);

  const pill = linerFailed ? { ...STATUS_PILL.error, label: "Liner 연결 실패" } : STATUS_PILL[phase];

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-ink-900 text-frost-50">
      <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(85%_65%_at_50%_0%,black,transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-aurora" />
      <div className="pointer-events-none absolute inset-0 bg-noise opacity-[0.035]" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-4 sm:px-6">
        <header className="flex items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-pulse-500 to-glow-500 text-ink-950 shadow-pulse">
              <PulseIcon className="size-5" />
            </span>
            <div>
              <p className="flex items-center gap-2 text-[17px] font-semibold leading-tight tracking-tight text-frost-50">
                DataPulse <span className="text-gradient">AI</span>
              </p>
              <p className="hidden text-[11px] text-frost-500 sm:block">
                Autonomous Visual Research Copilot
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <span
              className={`hidden items-center gap-1.5 rounded-full border border-edge bg-ink-850 px-3 py-1.5 text-[11px] font-medium sm:flex ${pill.text}`}
            >
              <span className={`size-1.5 rounded-full ${pill.dot}`} />
              {pill.label}
            </span>
            {evidenceSource !== null && (
              <output data-testid="evidence-source" aria-label="근거 출처" className={`rounded-full border px-3 py-1.5 font-mono text-[11px] ${evidenceSource === "mock" ? "border-amber-400/30 bg-amber-400/10 text-amber-400" : "border-mint-400/30 bg-mint-400/10 text-mint-400"}`}>
                {evidenceTrustLabel(evidenceSource)}
              </output>
            )}
            <div className="flex rounded-full border border-edge bg-ink-850 p-0.5" role="group" aria-label="데이터 연결 모드">
              <button
                type="button"
                aria-pressed={mode === "live"}
                disabled={phase === "running"}
                onClick={() => setMode("live")}
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-pulse-400 disabled:cursor-not-allowed ${mode === "live" ? "bg-mint-400/15 text-mint-400" : "text-frost-500 hover:text-frost-200"}`}
              >
                실시간
              </button>
              <button
                type="button"
                aria-pressed={mode === "mock"}
                disabled={phase === "running"}
                onClick={() => setMode("mock")}
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-pulse-400 disabled:cursor-not-allowed ${mode === "mock" ? "bg-amber-400/15 text-amber-400" : "text-frost-500 hover:text-frost-200"}`}
              >
                오프라인
              </button>
            </div>
            <span className="rounded-full border border-pulse-500/30 bg-pulse-500/10 px-3 py-1.5 font-mono text-[11px] text-pulse-300">
              AGENT:24
            </span>
          </div>
        </header>

        <main className="grid flex-1 grid-cols-1 gap-5 pb-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="lg:h-[calc(100svh-9.5rem)]">
            <ChatInterface suggestions={SUGGESTIONS} mode={mode} onAgentEvent={handleAgentEvent} />
          </div>

          <div className="flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start">
            <AgentProgress
              tasks={TASKS}
              completed={progress.completed}
              current={progress.current}
              phase={phase}
              visualizationBlocked={visualizationBlocked}
            />
            <CitationList references={references} chunks={chunks} />
          </div>
        </main>

        <footer className="border-t border-edge py-4 text-center text-[11px] text-frost-500/60">
          {mode === "mock" ? "오프라인 에이전트 연결" : "실시간 에이전트 연결"} · AGENT:24 해커톤 · 자율 검색 → 출처 → 시각화 파이프라인
        </footer>
      </div>
    </div>
  );
}
