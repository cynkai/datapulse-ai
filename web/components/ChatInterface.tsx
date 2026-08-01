"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent, ChartSpec, ChatMessage, StreamMode } from "@/lib/sse";
import { streamChat } from "@/lib/sse";
import VisualArtifact from "./VisualArtifact";
import { ArrowUpIcon, PulseIcon } from "./icons";

interface UiMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly chart?: ChartSpec;
  readonly error?: string;
}

export interface ChatInterfaceProps {
  readonly suggestions: readonly string[];
  readonly mode: StreamMode;
  readonly onAgentEvent?: (event: AgentEvent) => void;
}

function renderRich(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return <strong key={index} className="font-semibold text-frost-50">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return <code key={index} className="rounded-md bg-ink-750 px-1.5 py-0.5 font-mono text-[12.5px] text-glow-300">{token.slice(1, -1)}</code>;
    }
    return <span key={index}>{token}</span>;
  });
}

function AssistantSkeleton() {
  return (
    <div className="space-y-2.5 py-1" aria-hidden="true">
      <div className="h-3 w-4/5 rounded-full bg-ink-700" />
      <div className="h-3 w-3/5 rounded-full bg-ink-700" />
      <div className="h-3 w-2/3 rounded-full bg-ink-700" />
    </div>
  );
}

export default function ChatInterface({ suggestions, mode, onAgentEvent }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isStreaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateAssistant = (id: string, update: (message: UiMessage) => UiMessage): void => {
    setMessages((current) => current.map((message) => message.id === id ? update(message) : message));
  };

  const submit = (raw: string): void => {
    const content = raw.trim();
    if (content.length === 0 || isStreaming) return;

    const history: ChatMessage[] = messages.map((message) => ({ role: message.role, content: message.content }));
    const userMessage: UiMessage = { id: `user-${idRef.current}`, role: "user", content };
    const assistantId = `assistant-${idRef.current + 1}`;
    idRef.current += 2;
    setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    void streamChat([...history, { role: "user", content }], {
      onStart: () => onAgentEvent?.({ type: "start" }),
      onTool: (name, status) => onAgentEvent?.({ type: "tool", name, status }),
      onReferences: (references) => onAgentEvent?.({ type: "references", references }),
      onChunks: (chunks) => onAgentEvent?.({ type: "chunks", chunks }),
      onVerdicts: (verdicts) => onAgentEvent?.({ type: "verdicts", verdicts }),
      onTextDelta: (delta) => updateAssistant(assistantId, (message) => ({ ...message, content: message.content + delta })),
      onChart: (chart) => {
        updateAssistant(assistantId, (message) => ({ ...message, chart }));
        onAgentEvent?.({ type: "chart", chart });
      },
      onFinish: () => onAgentEvent?.({ type: "finish" }),
      onError: (error) => {
        onAgentEvent?.({ type: "error", error });
        updateAssistant(assistantId, (message) => ({ ...message, error: error.message }));
      },
      onDone: () => {
        if (abortRef.current !== controller) return;
        abortRef.current = null;
        setIsStreaming(false);
      },
    }, { mode, signal: controller.signal });
  };

  const cancel = (): void => {
    const controller = abortRef.current;
    if (controller === null) return;
    controller.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setMessages((current) => current.map((message, index) =>
      index === current.length - 1 && message.role === "assistant"
        ? { ...message, error: "요청을 취소했습니다." }
        : message,
    ));
    onAgentEvent?.({ type: "cancel" });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(input);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-edge bg-ink-850/70 shadow-card backdrop-blur-sm">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite" aria-busy={isStreaming}>
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-2xl border border-pulse-500/25 bg-pulse-500/10 text-pulse-300 shadow-pulse">
              <PulseIcon className="size-6" />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold text-frost-50">무엇을 리서치할까요?</h2>
              <p className="mt-1 break-keep text-[13px] text-frost-500">질문을 입력하면 에이전트가 출처를 수집하고 데이터를 시각화해 답변합니다.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((message, index) => message.role === "user" ? (
              <div key={message.id} className="flex animate-fade-up justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-pulse-500/25 bg-pulse-600/15 px-4 py-2.5 text-[14px] leading-relaxed text-frost-200">
                  {renderRich(message.content)}
                </div>
              </div>
            ) : (
              <div key={message.id} className="flex animate-fade-up gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-ink-700 text-pulse-300"><PulseIcon className="size-3.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-frost-200">
                    {message.content.length > 0 ? renderRich(message.content) : isStreaming && index === messages.length - 1 ? <AssistantSkeleton /> : <span className="text-frost-500/70">답변이 생성되지 않았습니다.</span>}
                    {isStreaming && index === messages.length - 1 && message.content.length > 0 && <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] animate-caret rounded-full bg-pulse-400" />}
                  </div>
                  {message.chart && <VisualArtifact chart={message.chart} />}
                  {message.error && <div role="alert" className="mt-2 animate-fade-up rounded-xl border border-coral-400/25 bg-coral-400/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-coral-400">{message.error}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
        <div ref={scrollAnchorRef} />
      </div>

      <div className="border-t border-edge p-3 sm:p-4">
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="데모 질문">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => submit(suggestion)} disabled={isStreaming} className="shrink-0 rounded-full border border-edge bg-ink-800/80 px-3 py-1.5 text-[12px] text-frost-400 transition-colors hover:border-pulse-500/40 hover:text-frost-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse-400 disabled:cursor-not-allowed disabled:opacity-50">
              {suggestion}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-edge-strong bg-ink-800/90 p-2 transition-colors focus-within:border-pulse-500/50">
          <label htmlFor="research-question" className="sr-only">리서치 질문</label>
          <textarea id="research-question" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown} rows={1} placeholder={isStreaming ? "에이전트가 답변을 생성하는 중..." : "리서치할 주제를 입력하세요 (Enter 전송)"} disabled={isStreaming} className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] text-frost-50 outline-none placeholder:text-frost-500/60 disabled:cursor-not-allowed" />
          {isStreaming ? (
            <button type="button" onClick={cancel} className="h-9 shrink-0 rounded-lg border border-coral-400/35 bg-coral-400/10 px-3 text-[12px] font-medium text-coral-400 transition-colors hover:bg-coral-400/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-400">중단</button>
          ) : (
            <button type="button" aria-label="전송" onClick={() => submit(input)} disabled={input.trim().length === 0} className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-pulse-500 to-pulse-600 text-white shadow-pulse transition-[filter,opacity] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pulse-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"><ArrowUpIcon className="size-4" /></button>
          )}
        </div>
      </div>
    </section>
  );
}
