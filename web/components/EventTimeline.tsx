import type { AgentEvent, ToolEvent } from "@/lib/agent-events";

interface TimelineRow {
  readonly event: AgentEvent;
  readonly results: readonly AgentEvent[];
}

interface EventTimelineProps {
  readonly events: readonly AgentEvent[];
}

function toolEvent(event: AgentEvent): ToolEvent | null {
  return event.kind === "event" ? event.tool : null;
}

function timelineRows(events: readonly AgentEvent[]): readonly TimelineRow[] {
  const callIds = new Set<string>();
  const results = new Map<string, AgentEvent[]>();

  for (const event of events) {
    const tool = toolEvent(event);
    if (tool?.kind === "tool_call") callIds.add(tool.callId);
    if (tool?.kind === "tool_result") {
      const paired = results.get(tool.callId) ?? [];
      paired.push(event);
      results.set(tool.callId, paired);
    }
  }

  return events.flatMap((event) => {
    const tool = toolEvent(event);
    if (tool?.kind === "tool_result" && callIds.has(tool.callId)) return [];
    return [{ event, results: tool?.kind === "tool_call" ? results.get(tool.callId) ?? [] : [] }];
  });
}

function EventDetails({ event, label }: { readonly event: AgentEvent; readonly label: string }) {
  const raw = event.kind === "malformed" ? event.raw : event.rawJson;
  return (
    <details className="mt-3 min-w-0 rounded-lg border border-edge bg-ink-950/50 px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-medium text-frost-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulse-400">
        원본 JSON · {label}
      </summary>
      <pre className="mt-2 min-w-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-frost-400 [overflow-wrap:anywhere]">
        {raw}
      </pre>
    </details>
  );
}

function EventRow({ row, index }: { readonly row: TimelineRow; readonly index: number }) {
  const { event, results } = row;
  const tool = toolEvent(event);
  const label =
    event.kind === "completion"
      ? event.ok
        ? "완료"
        : "실패 완료"
      : event.kind === "error"
        ? "오류"
        : event.kind === "malformed"
          ? "해석 불가 이벤트"
          : tool?.kind === "tool_call"
            ? "도구 호출"
            : "원시 이벤트";
  const accent = event.kind === "error" || (event.kind === "completion" && !event.ok) ? "bg-coral-400" : "bg-pulse-400";

  return (
    <li className="relative min-w-0 pb-5 pl-8 last:pb-0">
      <span className={`absolute left-0 top-1.5 size-2.5 rounded-full ring-4 ring-ink-850 ${accent}`} aria-hidden="true" />
      {index > 0 && <span className="absolute bottom-0 left-[5px] top-0 w-px bg-edge" aria-hidden="true" />}
      <article className="min-w-0 rounded-xl border border-edge bg-ink-800/60 p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[11px] font-semibold text-frost-200">{label}</p>
          {tool && <span className="rounded-full bg-pulse-500/10 px-2 py-0.5 font-mono text-[10px] text-pulse-300">{tool.callId}</span>}
        </div>
        {tool?.kind === "tool_call" && (
          <p className="mt-2 break-words text-[13px] text-frost-200 [overflow-wrap:anywhere]">
            {tool.name ?? "이름 없는 함수"} 호출을 수신했습니다.
          </p>
        )}
        {event.kind === "error" && <p className="mt-2 break-words text-[13px] text-coral-400 [overflow-wrap:anywhere]">{event.message}</p>}
        {event.kind === "malformed" && <p className="mt-2 text-[13px] text-amber-400">안전하게 기록했으며 스트림은 계속 읽습니다.</p>}
        {results.map((result, resultIndex) => (
          <div key={`${tool?.callId}-${resultIndex}`} className="mt-3 rounded-lg border border-mint-400/20 bg-mint-400/10 px-3 py-2">
            <p className="font-mono text-[11px] text-mint-400">결과 수신 · {tool?.callId}</p>
            <EventDetails event={result} label="도구 결과" />
          </div>
        ))}
        <EventDetails event={event} label={label} />
      </article>
    </li>
  );
}

export function EventTimeline({ events }: EventTimelineProps) {
  const rows = timelineRows(events);
  if (rows.length === 0) {
    return <p className="py-10 text-center text-[13px] text-frost-500">아직 수신한 이벤트가 없습니다.</p>;
  }
  return (
    <ol className="min-w-0" aria-label="에이전트 원시 이벤트 타임라인">
      {rows.map((row, index) => <EventRow key={index} row={row} index={index} />)}
    </ol>
  );
}
