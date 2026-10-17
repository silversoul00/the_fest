'use client';
import { useId, useRef, useState } from 'react';

/*
 * Small, dependency-free charts for THE FEST dashboards.
 * One series per chart (one colour: --viz-1), hairline grid, thin marks with 4px rounded
 * data-ends, a hover/focus tooltip on every chart, and a table view under each (see ChartCard).
 */

export type Point = { key: string; label: string; value: number; tip?: string };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const compact = (n: number) => (n >= 1e5 ? `${+(n / 1e5).toFixed(1)}L` : n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : `${n}`);

function Tooltip({ x, value, label, align }: { x: number; value: string; label: string; align: 'left' | 'right' | 'center' }) {
  const t = align === 'left' ? 'translateX(0)' : align === 'right' ? 'translateX(-100%)' : 'translateX(-50%)';
  return (
    <div className="viz-tip" style={{ left: `${x}%`, transform: t }} role="status">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/** Vertical columns: one per category or time bucket. */
export function ColumnChart({ data, unit, labelEvery = 1, height = 160, format = compact }: {
  data: Point[]; unit: string; labelEvery?: number; height?: number; format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const ticks = [max, max / 2, 0];
  const pos = (i: number) => ((i + 0.5) / data.length) * 100;
  return (
    <div className="viz" onPointerLeave={() => setHover(null)}>
      <div className="viz-plot" style={{ height }}>
        <div className="viz-yaxis" aria-hidden>
          {ticks.map((t) => <span key={t} style={{ top: `${100 - (t / max) * 100}%` }}>{format(t)}</span>)}
        </div>
        <div className="viz-area">
          {ticks.map((t) => <div key={t} className="viz-grid" style={{ top: `${100 - (t / max) * 100}%` }} aria-hidden />)}
          <div className="viz-cols">
            {data.map((d, i) => (
              <div
                key={d.key} className={`viz-col ${hover === i ? 'on' : ''}`} tabIndex={0}
                aria-label={`${d.label}: ${d.value} ${unit}`}
                onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              >
                <div className="viz-bar" style={{ height: `${(d.value / max) * 100}%` }} />
              </div>
            ))}
          </div>
          {hover !== null && (
            <Tooltip
              x={pos(hover)} value={`${data[hover].value.toLocaleString('en-IN')} ${unit}`}
              label={data[hover].tip ?? data[hover].label}
              align={pos(hover) < 20 ? 'left' : pos(hover) > 80 ? 'right' : 'center'}
            />
          )}
        </div>
      </div>
      <div className="viz-xaxis" aria-hidden>
        {data.map((d, i) => <span key={d.key}>{i % labelEvery === 0 ? d.label : ''}</span>)}
      </div>
    </div>
  );
}

/** A single cumulative line with a light wash under it, a crosshair and an end label. */
export function LineChart({ data, unit, height = 180 }: { data: Point[]; unit: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const gid = useId().replace(/:/g, '');
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const n = data.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / max) * 100;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ');
  const area = `${line} L${x(n - 1)},100 L${x(0)},100 Z`;
  const ticks = [max, max / 2, 0];
  const last = data[n - 1];

  const move = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !n) return;
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHover(Math.round(f * (n - 1)));
  };
  const h = hover ?? null;
  return (
    <div className="viz">
      <div className="viz-plot" style={{ height }}>
        <div className="viz-yaxis" aria-hidden>
          {ticks.map((t) => <span key={t} style={{ top: `${y(t)}%` }}>{compact(t)}</span>)}
        </div>
        <div
          className="viz-area" ref={ref} tabIndex={0}
          aria-label={`${unit}: ${last?.value ?? 0} by ${last?.label ?? ''}. Use arrow keys to step through days.`}
          onPointerMove={move} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setHover((v) => Math.min(n - 1, (v ?? -1) + 1));
            if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? n) - 1));
          }}
        >
          {ticks.map((t) => <div key={t} className="viz-grid" style={{ top: `${y(t)}%` }} aria-hidden />)}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="viz-svg" aria-hidden>
            <defs>
              <clipPath id={`c${gid}`}><rect x="0" y="-2" width="100" height="104" /></clipPath>
            </defs>
            <path d={area} className="viz-wash" clipPath={`url(#c${gid})`} />
            <path d={line} className="viz-line" />
          </svg>
          {last && <span className="viz-dot" style={{ left: `${x(n - 1)}%`, top: `${y(last.value)}%` }} aria-hidden />}
          {last && h === null && (
            <span className="viz-endlabel" style={{ top: `${y(last.value)}%` }} aria-hidden>{last.value.toLocaleString('en-IN')}</span>
          )}
          {h !== null && data[h] && (
            <>
              <div className="viz-cross" style={{ left: `${x(h)}%` }} aria-hidden />
              <span className="viz-dot" style={{ left: `${x(h)}%`, top: `${y(data[h].value)}%` }} aria-hidden />
              <Tooltip
                x={x(h)} value={`${data[h].value.toLocaleString('en-IN')} ${unit}`} label={data[h].tip ?? data[h].label}
                align={x(h) < 20 ? 'left' : x(h) > 80 ? 'right' : 'center'}
              />
            </>
          )}
        </div>
      </div>
      <div className="viz-xaxis ends" aria-hidden>
        <span>{data[0]?.label}</span><span>{last?.label}</span>
      </div>
    </div>
  );
}

/** Horizontal bars with the value at the tip. `of` turns a row into a meter (e.g. sold of quota). */
export function BarList({ rows, unit }: { rows: { key: string; label: string; value: number; of?: number; note?: string }[]; unit: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.of ?? r.value));
  return (
    <div className="viz-bars" onPointerLeave={() => setHover(null)}>
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        return (
          <div
            key={r.key} className={`viz-barrow ${hover === r.key ? 'on' : ''}`} tabIndex={0}
            aria-label={`${r.label}: ${r.value} ${unit}${r.of ? ` of ${r.of}` : ''}`}
            onPointerEnter={() => setHover(r.key)} onFocus={() => setHover(r.key)} onBlur={() => setHover(null)}
          >
            <div className="viz-barlabel">
              <span className="truncate">{r.label}</span>
              <span className="viz-barval">
                {r.value.toLocaleString('en-IN')}{r.of ? <span className="muted"> / {r.of.toLocaleString('en-IN')}</span> : null}
              </span>
            </div>
            <div className="viz-track" style={r.of ? { width: `${(r.of / max) * 100}%` } : undefined} data-meter={r.of ? '1' : undefined}>
              <div className="viz-fill" style={{ width: r.of ? `${(r.value / r.of) * 100}%` : `${pct}%` }} />
            </div>
            {hover === r.key && r.note && <div className="xs soft" style={{ marginTop: 4 }}>{r.note}</div>}
          </div>
        );
      })}
    </div>
  );
}
