"use client";

import { CheckIcon, PulseIcon, SearchIcon, SpinnerIcon } from "./icons";

export type AgentPhase = "idle" | "running" | "done" | "error" | "cancelled";

export interface AgentProgressProps {
  tasks: string[];
  completed: number;
  current: number;
  phase: AgentPhase;
  visualizationBlocked?: string | null;
}

const PHASE_LABEL: Record<AgentPhase, { label: string; dot: string; text: string }> = {
  idle: { label: "대기 중", dot: "bg-frost-500", text: "text-frost-500" },
  running: { label: "에이전트 작업 중", dot: "bg-pulse-400 animate-pulse-soft", text: "text-pulse-300" },
  done: { label: "작업 완료", dot: "bg-mint-400", text: "text-mint-400" },
  error: { label: "오류 발생", dot: "bg-coral-400", text: "text-coral-400" },
  cancelled: { label: "요청 취소", dot: "bg-amber-400", text: "text-amber-400" },
};

function TaskRow({
  label,
  state,
  index,
}: {
  label: string;
  state: "completed" | "in_progress" | "pending" | "skipped";
  index: number;
}) {
  if (state === "completed") {
    return (
      <li className="flex animate-fade-up items-center gap-3">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-mint-400/15 text-mint-400">
          <CheckIcon className="size-3" />
        </span>
        <span className="text-[13px] text-frost-400">{label}</span>
      </li>
    );
  }
  if (state === "in_progress") {
    return (
      <li className="rounded-lg border border-pulse-500/25 bg-pulse-500/[0.07] px-3 py-2.5">
        <div className="flex items-center gap-3">
          <span className="grid size-5 shrink-0 place-items-center text-pulse-300">
            <SpinnerIcon className="size-4 animate-spin" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-frost-50">{label}</span>
              <span className="font-mono text-[11px] text-pulse-300">진행 중</span>
            </div>
            <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-ink-700">
              <div className="h-full w-1/2 animate-slide-bar rounded-full bg-gradient-to-r from-pulse-500 to-glow-400" />
            </div>
          </div>
        </div>
      </li>
    );
  }
  if (state === "skipped") {
    return (
      <li className="flex items-center gap-3">
        <span className="grid size-5 shrink-0 place-items-center rounded-full border border-amber-400/40 text-amber-400">
          <span className="h-px w-2 bg-current" />
        </span>
        <span className="text-[13px] text-frost-500">{label}</span>
      </li>
    );
  }
  return (
    <li className="flex animate-fade-up items-center gap-3 opacity-60" style={{ animationDelay: `${index * 60}ms` }}>
      <span className="grid size-5 shrink-0 place-items-center rounded-full border border-ink-600">
        <span className="size-1.5 rounded-full bg-ink-600" />
      </span>
      <span className="text-[13px] text-frost-500">{label}</span>
    </li>
  );
}

export default function AgentProgress({ tasks, completed, current, phase, visualizationBlocked }: AgentProgressProps) {
  const meta = PHASE_LABEL[phase];
  const idle = phase === "idle" && current < 0 && completed === 0;

  return (
    <section className="flex flex-col rounded-2xl border border-edge bg-ink-850/70 shadow-card backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-lg bg-pulse-500/15 text-pulse-300">
            <PulseIcon className="size-3.5" />
          </span>
          <h2 className="text-[13px] font-semibold tracking-wide text-frost-200">에이전트 코크핏</h2>
        </div>
        <span className={`flex items-center gap-1.5 text-[11px] font-medium ${meta.text}`}>
          <span className={`size-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </header>

      <div className="p-4">
        {idle ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="relative grid size-14 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-pulse-500/10 [animation-duration:2.2s]" />
              <span className="absolute inset-2 animate-ping rounded-full bg-glow-400/10 [animation-duration:2.2s] [animation-delay:0.6s]" />
              <span className="relative grid size-7 place-items-center rounded-full bg-ink-700 text-pulse-300">
                <SearchIcon className="size-3.5" />
              </span>
            </div>
            <p className="text-[13px] text-frost-500">에이전트가 작업을 준비 중...</p>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-frost-500/60">
              질문을 입력하면 검색 → 출처 수집 → 데이터 시각화를 자동으로 수행합니다.
            </p>
          </div>
        ) : phase === "error" ? (
          <div className="rounded-xl border border-coral-400/25 bg-coral-400/10 px-3 py-4 text-center">
            <p className="text-[13px] font-medium text-coral-400">에이전트 실행 중 오류가 발생했습니다.</p>
            <p className="mt-1 text-[11px] text-frost-500">새 질문으로 다시 시도해 주세요.</p>
          </div>
        ) : phase === "cancelled" ? (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-4 text-center">
            <p className="text-[13px] font-medium text-amber-400">요청을 취소했습니다.</p>
            <p className="mt-1 text-[11px] text-frost-500">새 질문을 바로 실행할 수 있습니다.</p>
          </div>
        ) : (
          <ol className="space-y-3">
            {tasks.map((task, index) => {
              const state =
                index === tasks.length - 1 && visualizationBlocked
                  ? "skipped"
                  : index < completed ? "completed" : index === current ? "in_progress" : "pending";
              return <TaskRow key={task} label={task} state={state} index={index} />;
            })}
            {visualizationBlocked && (
              <li className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-400">
                {visualizationBlocked}
              </li>
            )}
          </ol>
        )}
      </div>
    </section>
  );
}
