import { dateRange, num, rupees } from '@/lib/format';
import { pct, perHead, type SponsorReport } from '@/lib/sponsor-report';
import { PrintButton } from '@/app/booth/[code]/print/PrintButton';

const money = (p: number | null) => (p === null ? '—' : rupees(p));
const percent = (p: number | null) => (p === null ? '—' : `${p}%`);
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? ' AM' : ' PM'}`;
const dayLabel = (d: string) => dateRange(d, d);

function Bars({ rows }: { rows: { label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="stack g8">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="row between small"><span className="truncate">{r.label}</span><span className="mono">{num(r.n)}</span></div>
          <div className="bar mt8"><i style={{ width: `${(r.n / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat rp-fig">
      <div className="label">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

/** The sponsor ROI report. Same view for the sponsor and the fest's organizer. Aggregates only. */
export function SponsorReportView({ r, generatedAt }: { r: SponsorReport; generatedAt: Date }) {
  const peak = r.entryHours.reduce<{ h: number; n: number } | null>((a, x) => (!a || x.n > a.n ? x : a), null);
  const gen = generatedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <article className="report stack g16">
      <style>{`
        .report .rp-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); }
        .report h2 { font-family: var(--f-display, inherit); font-size: 22px; margin: 0 0 8px; }
        .report .rp-sec { break-inside: avoid; }
        @media print {
          @page { size: A4; margin: 14mm; }
          html, body { background: #fff !important; color: #000 !important; }
          .side, .topbar, .tabstrip, .no-print { display: none !important; }
          .shell { display: block !important; }
          .main > .wrap, main.wrap { padding: 0 !important; max-width: none !important; }
          .report, .report * { color: #000 !important; background: transparent !important; box-shadow: none !important; text-shadow: none !important; }
          .report .card, .report .stat { border: 1px solid #bbb !important; }
          .report .bar { background: #eee !important; }
          .report .bar i { background: #555 !important; }
          .report .badge { border: 1px solid #000 !important; }
        }
      `}</style>
      <header className="stack g8">
        <div className="row g8 wrap-row">
          {r.sample && <span className="badge orange">SAMPLE — demo data</span>}
          {r.inProgress && <span className="badge green">Fest in progress: numbers will change</span>}
        </div>
        <span className="label">Sponsor report</span>
        <h1 className="h2">{r.brand} × {r.fest_name}</h1>
        <div className="small muted">{r.college}, {r.city} · {dateRange(r.starts_on, r.ends_on)} · {r.tier}</div>
        <div className="xs muted">Generated {gen} IST</div>
        <div className="no-print"><PrintButton label="🖨 Print / Save as PDF" /></div>
      </header>

      <section className="rp-sec card" aria-label="Summary">
        <h2>Summary</h2>
        <div className="rp-grid">
          <Fig label="Ticket holders" value={num(r.attendees)} />
          <Fig label="Verified footfall" value={num(r.footfall)} sub="scanned in at the gates" />
          <Fig label="Booth visits (verified)" value={num(r.visits)} sub={`${num(r.visitsAll)} in total (${num(r.visitsAll - r.visits)} unverified)`} />
          <Fig label="Leads" value={r.leads === null ? '—' : num(r.leads)} sub="students who chose to share" />
          <Fig label="Deal" value={rupees(r.amount_paise)} />
          <Fig label="Cost per verified attendee" value={money(perHead(r.amount_paise, r.footfall))} />
          <Fig label="Cost per booth visit" value={money(perHead(r.amount_paise, r.visits))} />
          <Fig label="Cost per lead" value={money(perHead(r.amount_paise, r.leads))} />
        </div>
      </section>

      <section className="rp-sec card" aria-label="Footfall">
        <h2>Footfall</h2>
        {r.byDay.length === 0 ? <p className="small muted">No gate entries yet.</p> : (
          <>
            <Bars rows={r.byDay.map((d) => ({ label: dayLabel(d.day), n: d.n }))} />
            <p className="small mt12">Peak entry hour: <b>{peak ? `${hourLabel(peak.h)}–${hourLabel((peak.h + 1) % 24)}` : '—'}</b>{peak && ` (${num(peak.n)} entries)`}</p>
          </>
        )}
      </section>

      <section className="rp-sec card" aria-label="Booth">
        <h2>Booth</h2>
        <div className="rp-grid mb16">
          <Fig label="Visit rate" value={percent(pct(r.visits, r.footfall))} sub="verified visits ÷ footfall" />
          <Fig label="Lead rate" value={r.leads === null ? '—' : percent(pct(r.leads, r.visitsAll))} sub="leads ÷ all booth visits" />
        </div>
        {r.visitHours.length === 0 ? <p className="small muted">No verified booth visits yet.</p> : (
          <Bars rows={r.visitHours.map((x) => ({ label: hourLabel(x.h), n: x.n }))} />
        )}
      </section>

      <section className="rp-sec card" aria-label="Audience">
        <h2>Audience</h2>
        <p className="xs muted mb8">Colleges of people who checked in. Groups smaller than 5 are counted under &ldquo;Other&rdquo;.</p>
        {r.colleges.length === 0 ? <p className="small muted">Appears once attendees check in.</p> : <Bars rows={r.colleges.map((c) => ({ label: c.college, n: c.n }))} />}
      </section>

      <section className="rp-sec card" aria-label="How we counted">
        <h2>How we counted</h2>
        <ul className="small stack g8" style={{ paddingLeft: 18 }}>
          <li><b>Ticket holders:</b> tickets issued for the fest and not cancelled.</li>
          <li><b>Verified footfall:</b> tickets scanned in at the gate by fest volunteers. Each ticket counts once.</li>
          <li><b>Booth visits (verified):</b> students who scanned the booth QR and also hold a gate-scanned ticket for this fest. Each student counts once.</li>
          <li><b>Booth visits (total):</b> everyone who scanned the booth QR, including students whose ticket wasn&apos;t scanned at the gate.</li>
          <li><b>Leads:</b> students who ticked &ldquo;I am 18 or older&rdquo; and chose to share their contact at the booth, minus anyone who later stopped sharing.</li>
          <li><b>Visit rate:</b> verified booth visits ÷ verified footfall. <b>Lead rate:</b> leads ÷ all booth visits (every lead visited the booth, so it can&apos;t pass 100%).</li>
          <li><b>Costs:</b> the deal amount divided by each count. &ldquo;—&rdquo; means nothing to divide by yet.</li>
          <li>All times are India time (IST). Nothing here is an estimate.</li>
        </ul>
      </section>
      <p className="xs muted">Made with THE FEST · thefest.in</p>
    </article>
  );
}
