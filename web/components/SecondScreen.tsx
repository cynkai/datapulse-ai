"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EventTimeline } from "@/components/EventTimeline";
import { ArrowUpIcon, PulseIcon, SpinnerIcon } from "@/components/icons";
import { streamAgentRun, type AgentEvent } from "@/lib/agent-events";
import { nextStateForEvent, type ConnectionState } from "@/lib/run-state";

const STATUS: Record<ConnectionState, { readonly label: string; readonly color: string }> = {
  idle: { label: "연결 대기", color: "bg-frost-500 text-frost-400" },
  connecting: { label: "에이전트 연결 중", color: "bg-pulse-400 text-pulse-300" },
  streaming: { label: "이벤트 수신 중", color: "bg-glow-400 text-glow-300" },
  complete: { label: "실행 완료", color: "bg-mint-400 text-mint-400" },
  error: { label: "실행 오류", color: "bg-coral-400 text-coral-400" },
  cancelled: { label: "실행 취소됨", color: "bg-amber-400 text-amber-400" },
};

export function SecondScreen() {
  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [state, setState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const questionRef = useRef("");
  const controllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const status = STATUS[state];

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    if (state === "complete" || state === "error" || state === "cancelled") inputRef.current?.focus();
  }, [state]);

  const submit = useCallback(async () => {
    const nextQuestion = questionRef.current;
    if (!nextQuestion.trim()) {
      setError("질문을 입력한 뒤 실행해 주세요.");
      inputRef.current?.focus();
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    controllerRef.current = controller;
    setEvents([]);
    setError(null);
    setSubmittedQuestion(nextQuestion);
    setState("connecting");
    let receivedCompletion = false;

    try {
      await streamAgentRun({
        question: nextQuestion,
        signal: controller.signal,
        onEvent: (event) => {
          if (runId !== runIdRef.current) return;
          setEvents((previous) => [...previous, event]);
          if (event.kind === "completion") {
            receivedCompletion = true;
          }
          if (event.kind === "error") {
            setError(event.message);
          }
          setState((previous) => nextStateForEvent(previous, event));
        },
      });
      if (runId === runIdRef.current && !receivedCompletion) {
        setError("완료 이벤트 없이 연결이 종료되었습니다.");
        setState("error");
      }
    } catch (cause) {
      if (runId !== runIdRef.current) return;
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setState("cancelled");
      } else {
        setError(cause instanceof Error ? cause.message : "에이전트에 연결할 수 없습니다.");
        setState("error");
      }
    } finally {
      if (runId === runIdRef.current && controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const cancel = (): void => {
    const controller = controllerRef.current;
    if (controller === null) return;
    controller.abort();
    controllerRef.current = null;
    runIdRef.current += 1;
    setState("cancelled");
  };
  const running = state === "connecting" || state === "streaming";

  return (
    <main className="min-h-svh bg-ink-900 text-frost-50">
      <div className="mx-auto flex min-h-svh w-full max-w-[1180px] flex-col px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-edge pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-pulse-500 to-glow-500 text-ink-950 shadow-pulse"><PulseIcon className="size-5" /></span>
            <div><p className="font-semibold tracking-tight">DataPulse <span className="text-gradient">AI</span></p><h1 className="text-[13px] text-frost-400">에이전트 원시 이벤트</h1></div>
          </div>
          <output role="status" aria-live="polite" className="flex items-center gap-2 text-[12px] font-medium">
            <span className={`size-2 rounded-full ${status.color.split(" ")[0]} ${running ? "animate-pulse-soft motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            <span className={status.color.split(" ")[1]}>{status.label}</span>
          </output>
        </header>

        <div className="grid min-w-0 min-h-0 flex-1 gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
          <section className="flex min-w-0 min-h-0 flex-col rounded-2xl border border-edge bg-ink-850/70 shadow-card backdrop-blur-sm">
            <div className="border-b border-edge px-4 py-4 sm:px-6"><h2 className="text-[16px] font-semibold">실행 타임라인</h2><p className="mt-1 text-[12px] text-frost-500">SDK가 보낸 원본 이벤트를 변경하지 않고 표시합니다.</p></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <output data-testid="event-count" className="mb-4 block font-mono text-[11px] text-frost-500">수신 이벤트 {events.length}개</output>
              {events.length === 0 && !running ? <div className="py-16 text-center"><p className="text-[14px] text-frost-400">질문을 실행하면 여기에 실제 스트림 이벤트가 쌓입니다.</p></div> : <EventTimeline events={events} />}
              {running && events.length === 0 && <div className="flex items-center gap-2 text-[13px] text-pulse-300"><SpinnerIcon className="size-4 animate-spin motion-reduce:animate-none" />스트림을 기다리는 중입니다.</div>}
            </div>
          </section>

          <aside className="min-w-0 rounded-2xl border border-edge bg-ink-850/70 p-4 shadow-card backdrop-blur-sm sm:p-5">
            <h2 className="text-[15px] font-semibold">질문 실행</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-frost-500">같은 출처 릴레이를 통해 구성된 에이전트에 POST합니다.</p>
            <form className="mt-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <label htmlFor="agent-question" className="text-[12px] font-medium text-frost-200">리서치 질문</label>
              <textarea id="agent-question" ref={inputRef} value={question} onChange={(event) => { questionRef.current = event.target.value; setQuestion(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} rows={5} disabled={running} placeholder="예: 2025년 AI 반도체 시장을 조사해줘" className="mt-2 w-full resize-y rounded-xl border border-edge-strong bg-ink-800/90 p-3 text-[14px] leading-relaxed text-frost-50 outline-none transition-colors placeholder:text-frost-500 focus:border-pulse-500 focus:ring-2 focus:ring-pulse-500/25 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none" />
              {error && <p className="mt-2 break-words text-[12px] leading-relaxed text-coral-400 [overflow-wrap:anywhere]">{error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" disabled={running} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-pulse-500 to-pulse-600 px-3 py-2 text-[13px] font-medium text-white shadow-pulse transition hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-300 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"><ArrowUpIcon className="size-4" />실행</button>
                {running && <button type="button" onClick={cancel} className="rounded-lg border border-edge-strong px-3 py-2 text-[13px] text-frost-200 transition hover:border-coral-400/60 hover:text-coral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-300 motion-reduce:transition-none">취소</button>}
              </div>
            </form>
            {submittedQuestion && <div className="mt-6 border-t border-edge pt-4"><p className="text-[11px] font-medium text-frost-500">현재 실행 질문</p><p className="mt-1 break-words text-[13px] leading-relaxed text-frost-200 [overflow-wrap:anywhere]">{submittedQuestion}</p></div>}
          </aside>
        </div>
      </div>
    </main>
  );
}
