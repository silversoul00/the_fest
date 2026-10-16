import Link from 'next/link';
import type { CSSProperties } from 'react';
import { dateRange, rupees, todayIST } from '@/lib/format';
import type { Fest } from '@/lib/types';

export function Stat({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string }) {
  return (
    <div className="stat" style={color ? ({ '--stat': color } as CSSProperties) : undefined}>
      <div className="label">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function Empty({ icon = '🫥', title, children }: { icon?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div className="h3" style={{ color: 'var(--white)' }}>{title}</div>
      {children && <div className="small mt8">{children}</div>}
    </div>
  );
}

const CAT_LABEL: Record<string, string> = { cultural: 'Cultural', tech: 'Tech', sports: 'Sports', management: 'Management', other: 'Other' };
export const catLabel = (c: string) => CAT_LABEL[c] ?? c;

export function FestStatus({ fest }: { fest: Pick<Fest, 'status' | 'starts_on' | 'ends_on'> }) {
  const today = todayIST();
  if (fest.status === 'draft') return <span className="badge gray">Draft</span>;
  if (fest.status === 'ended' || fest.ends_on < today) return <span className="badge gray">Ended</span>;
  if (fest.starts_on <= today) return <span className="badge green"><span className="dot live" />Live now</span>;
  return <span className="badge yellow">On sale</span>;
}

export function FestCard({ fest, minPrice, sold, quota }: { fest: Fest; minPrice?: number | null; sold?: number; quota?: number }) {
  const almost = quota && sold !== undefined && sold / quota > 0.8;
  return (
    <Link href={`/fests/${fest.slug}`} className="fest-card" style={{ '--fest': fest.accent } as CSSProperties}>
      <div className="fest-banner"><span className="emoji">{fest.emoji}</span></div>
      <div className="body">
        <div className="row between g8">
          <span className="label" style={{ color: 'var(--orange)' }}>{fest.college}</span>
          <FestStatus fest={fest} />
        </div>
        <div className="display mt8" style={{ fontSize: 28 }}>{fest.name}</div>
        <div className="row g12 small muted mt8 wrap-row">
          <span>📅 {dateRange(fest.starts_on, fest.ends_on)}</span>
          <span>📍 {fest.city}</span>
        </div>
        <div className="divider" style={{ margin: '12px 0' }} />
        <div className="row between">
          <span className="display" style={{ fontSize: 22, color: 'var(--yellow)' }}>
            {minPrice === null || minPrice === undefined ? '—' : minPrice === 0 ? 'FREE' : <>{rupees(minPrice)}<span className="xs muted" style={{ fontFamily: 'var(--f-body)' }}> onwards</span></>}
          </span>
          <span className={`badge ${almost ? 'orange' : 'gray'}`}>{almost ? 'Filling fast' : catLabel(fest.category)}</span>
        </div>
      </div>
    </Link>
  );
}
