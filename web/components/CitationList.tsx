"use client";

import { useEffect, useState } from "react";
import type { Reference, ReferenceChunk } from "@/lib/sse";
import { CloseIcon, ExternalLinkIcon, GlobeIcon, SearchIcon } from "./icons";

export interface CitationListProps {
  references: Reference[];
  chunks: ReferenceChunk[];
}

function Favicon({ reference }: { reference: Reference }) {
  const [errored, setErrored] = useState(false);
  const src =
    reference.faviconUrl && reference.faviconUrl.length > 0
      ? reference.faviconUrl
      : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(reference.hostname)}&sz=64`;

  if (errored || !src) {
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-ink-700 text-frost-500">
        <GlobeIcon className="size-3" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      className="size-4 shrink-0 rounded-full object-contain"
    />
  );
}

export default function CitationList({ references, chunks }: CitationListProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const empty = references.length === 0 && chunks.length === 0;

  return (
    <section className="flex flex-col rounded-2xl border border-edge bg-ink-850/70 shadow-card backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-frost-200">
          <span className="grid size-6 place-items-center rounded-lg bg-glow-400/15 text-glow-300">
            <SearchIcon className="size-3.5" />
          </span>
          출처 수집
        </h2>
        {references.length > 0 && (
          <span className="rounded-full border border-edge-strong bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-frost-400">
            {references.length}건
          </span>
        )}
      </header>

      <div className="p-4">
        {empty ? (
          <p className="py-4 text-center text-[12px] text-frost-500/70">
            수집된 출처가 아직 없습니다.
            <br />
            <span className="text-frost-500/50">에이전트가 검색하면 여기에 표시됩니다.</span>
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {references.map((reference) => (
              <button
                key={reference.url}
                type="button"
                onClick={() => setOpen(true)}
                className="group flex max-w-[190px] shrink-0 items-center gap-2 rounded-xl border border-edge bg-ink-800/80 px-2.5 py-2 text-left transition-colors hover:border-pulse-500/40 hover:bg-ink-750"
              >
                <Favicon reference={reference} />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-frost-200 group-hover:text-frost-50">
                    {reference.title}
                  </span>
                  <span className="block truncate text-[10px] text-frost-500">{reference.hostname}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="출처 상세">
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink-950/70 backdrop-blur-sm"
          />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-md animate-slide-in flex-col border-l border-edge bg-ink-850 shadow-pulse">
            <header className="flex items-center justify-between border-b border-edge px-5 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-frost-50">출처 상세</h3>
                <p className="mt-0.5 text-[11px] text-frost-500">
                  {references.length}개 출처 · {chunks.length}개 인용 조각
                </p>
              </div>
              <button
                type="button"
                aria-label="출처 패널 닫기"
                onClick={() => setOpen(false)}
                className="grid size-8 place-items-center rounded-lg border border-edge bg-ink-800 text-frost-400 transition-colors hover:border-edge-strong hover:text-frost-50"
              >
                <CloseIcon className="size-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {references.map((reference) => (
                <article key={reference.url} className="mb-4 rounded-xl border border-edge bg-ink-800/60 p-3">
                  <div className="flex items-start gap-2">
                    <Favicon reference={reference} />
                    <a
                      href={reference.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 text-[13px] font-medium leading-snug text-frost-200 hover:text-pulse-300"
                    >
                      {reference.title}
                    </a>
                  </div>
                  {reference.description && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-frost-500">{reference.description}</p>
                  )}
                  <p className="mt-1.5 font-mono text-[10px] text-frost-500/70">{reference.hostname}</p>
                </article>
              ))}

              <h4 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-frost-500">
                인용 조각
              </h4>
              {chunks.length === 0 ? (
                <p className="text-[12px] text-frost-500/70">인용 조각이 없습니다.</p>
              ) : (
                <ol className="space-y-2">
                  {chunks.map((chunk) => (
                    <li key={chunk.num} className="rounded-xl border border-edge bg-ink-800/60 p-3">
                      <div className="flex items-center gap-2">
                        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-pulse-500/15 font-mono text-[10px] font-semibold text-pulse-300">
                          {chunk.num}
                        </span>
                        <span className="truncate text-[12px] font-medium text-frost-200">{chunk.sourceTitle}</span>
                      </div>
                      <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-frost-400">{chunk.content}</p>
                      <a
                        href={chunk.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-glow-300 hover:text-glow-400"
                      >
                        원문 보기
                        <ExternalLinkIcon className="size-3" />
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
