"use client";

import type { ChartSpec } from "@/lib/sse";
import { PulseIcon } from "./icons";

export interface VisualArtifactProps {
  readonly chart: ChartSpec;
}

const SERIES_STYLES = [
  { stroke: "stroke-pulse-400", fill: "fill-pulse-500" },
  { stroke: "stroke-glow-400", fill: "fill-glow-500" },
  { stroke: "stroke-mint-400", fill: "fill-mint-400" },
  { stroke: "stroke-amber-400", fill: "fill-amber-400" },
] as const;

const WIDTH = 680;
const HEIGHT = 300;
const LEFT = 54;
const TOP = 20;
const PLOT_WIDTH = 600;
const PLOT_HEIGHT = 220;

function uniqueX(chart: ChartSpec): readonly (string | number)[] {
  const keys = new Map<string, string | number>();
  for (const series of chart.series) {
    for (const point of series.data) keys.set(String(point.x), point.x);
  }
  return [...keys.values()];
}

function chartScale(chart: ChartSpec) {
  const values = chart.series.flatMap((series) => series.data.map((point) => point.y));
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const span = maximum - minimum || 1;
  return {
    minimum,
    maximum,
    y: (value: number) => TOP + ((maximum - value) / span) * PLOT_HEIGHT,
  };
}

export default function VisualArtifact({ chart }: VisualArtifactProps) {
  const xs = uniqueX(chart);
  const scale = chartScale(chart);
  const xPosition = (x: string | number): number => {
    const index = xs.findIndex((item) => String(item) === String(x));
    return LEFT + ((index + 0.5) / Math.max(xs.length, 1)) * PLOT_WIDTH;
  };
  const baseline = scale.y(0);
  const labelStep = Math.max(1, Math.ceil(xs.length / 7));

  return (
    <figure className="my-4 overflow-hidden rounded-xl border border-edge-strong bg-ink-850 shadow-card">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-edge bg-ink-800/70 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-frost-200">
          <span className="grid size-5 shrink-0 place-items-center rounded-md bg-pulse-500/15 text-pulse-300">
            <PulseIcon className="size-3" />
          </span>
          <span className="break-keep">DataPulse 시각화 · {chart.title}</span>
        </span>
        <span className="rounded-full border border-edge bg-ink-850 px-2 py-0.5 font-mono text-[10px] uppercase text-frost-500">
          {chart.type}
        </span>
      </figcaption>

      <div className="p-3 sm:p-4">
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 pl-1">
          {chart.series.map((series, index) => {
            const style = SERIES_STYLES[index % SERIES_STYLES.length] ?? SERIES_STYLES[0];
            return (
              <span key={series.name} className="flex items-center gap-1.5 text-[10px] text-frost-400">
                <span className={`size-2 rounded-sm ${style.fill}`} />
                {series.name}
              </span>
            );
          })}
        </div>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${chart.title}. 가로축 ${chart.xAxis}, 세로축 ${chart.yAxis}`}
          className="h-auto w-full overflow-visible text-frost-500"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const value = scale.maximum - (scale.maximum - scale.minimum) * ratio;
            const y = TOP + PLOT_HEIGHT * ratio;
            return (
              <g key={ratio}>
                <line x1={LEFT} x2={LEFT + PLOT_WIDTH} y1={y} y2={y} className="stroke-edge" strokeWidth="1" />
                <text x={LEFT - 8} y={y + 4} textAnchor="end" className="fill-frost-500 text-[10px]">
                  {Number.isInteger(value) ? value : value.toFixed(1)}
                </text>
              </g>
            );
          })}
          <line x1={LEFT} x2={LEFT + PLOT_WIDTH} y1={baseline} y2={baseline} className="stroke-edge-strong" />

          {chart.type === "bar" && chart.series.flatMap((series, seriesIndex) => {
            const groupWidth = PLOT_WIDTH / Math.max(xs.length, 1);
            const barWidth = Math.min(32, (groupWidth * 0.72) / chart.series.length);
            const style = SERIES_STYLES[seriesIndex % SERIES_STYLES.length] ?? SERIES_STYLES[0];
            return series.data.map((point) => {
              const y = scale.y(point.y);
              return (
                <rect
                  key={`${series.name}-${String(point.x)}`}
                  x={xPosition(point.x) - (chart.series.length * barWidth) / 2 + seriesIndex * barWidth}
                  y={Math.min(y, baseline)}
                  width={Math.max(2, barWidth - 2)}
                  height={Math.max(1, Math.abs(baseline - y))}
                  rx="3"
                  className={`${style.fill} opacity-85`}
                />
              );
            });
          })}

          {chart.type !== "bar" && chart.series.map((series, index) => {
            const style = SERIES_STYLES[index % SERIES_STYLES.length] ?? SERIES_STYLES[0];
            const points = series.data.map((point) => `${xPosition(point.x)},${scale.y(point.y)}`).join(" ");
            return (
              <g key={series.name}>
                {chart.type === "line" && <polyline points={points} fill="none" className={style.stroke} strokeWidth="2.5" />}
                {series.data.map((point) => (
                  <circle key={`${series.name}-${String(point.x)}`} cx={xPosition(point.x)} cy={scale.y(point.y)} r="4" className={style.fill} />
                ))}
              </g>
            );
          })}

          {xs.map((x, index) => index % labelStep === 0 ? (
            <text key={String(x)} x={xPosition(x)} y={TOP + PLOT_HEIGHT + 22} textAnchor="middle" className="fill-frost-500 text-[10px]">
              {String(x)}
            </text>
          ) : null)}
          <text x={LEFT + PLOT_WIDTH / 2} y={HEIGHT - 8} textAnchor="middle" className="fill-frost-400 text-[10px]">
            {chart.xAxis}
          </text>
          <text transform={`translate(12 ${TOP + PLOT_HEIGHT / 2}) rotate(-90)`} textAnchor="middle" className="fill-frost-400 text-[10px]">
            {chart.yAxis}
          </text>
        </svg>
      </div>
    </figure>
  );
}
