import { useState, type ReactNode } from 'react';
import type { Flag, Label } from '../core/types';
import { useMode } from '../state/settings';
import { labelColor, STATUS } from '../viz/theme';
import { Icon } from './Icon';

export function Card({ title, subtitle, right, children, className = '', pad = true }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink leading-tight">{title}</h2>}
            {subtitle && <p className="text-[12.5px] text-ink2 mt-0.5 leading-snug">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function SectionTitle({ children, kicker }: { children: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="mt-8 mb-3">
      {kicker && <div className="text-[11px] uppercase tracking-[0.12em] text-muted font-semibold">{kicker}</div>}
      <h2 className="text-xl font-semibold text-ink">{children}</h2>
    </div>
  );
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[12px] text-ink2">
        {icon && <Icon name={icon} size={14} />}
        <span>{label}</span>
      </div>
      <div className="text-[19px] font-semibold text-ink mt-0.5 leading-tight">{value}</div>
      {sub && <div className="text-[12px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export function LabelChip({ label, score, size = 'md' }: { label: Label; score?: number; size?: 'sm' | 'md' }) {
  const mode = useMode();
  return (
    <span className={`chip ${size === 'sm' ? 'text-[11.5px] py-0.5 px-2' : ''}`}>
      <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: labelColor(label, mode) }} />
      <span className="font-medium">{label}</span>
      {score != null && <span className="text-ink2 tabular-nums">{score.toFixed(1)}</span>}
    </span>
  );
}

const FLAG_ICON: Record<string, string> = { 'cyclone-swell': 'cyclone', lightning: 'bolt', 'water-quality': 'drop', surge: 'tide', dangerous: 'alert', 'big-surf': 'wave' };
export function FlagChips({ flags }: { flags: Flag[] }) {
  const uniq = [...new Map(flags.map((f) => [f.code, f])).values()];
  if (!uniq.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {uniq.map((f) => (
        <span key={f.code} className="chip text-[12px]" title={f.text}>
          <span style={{ color: f.level === 'info' ? 'var(--accent)' : STATUS[f.level === 'warning' ? 'warning' : f.level === 'serious' ? 'serious' : 'critical'] }}>
            <Icon name={FLAG_ICON[f.code] ?? 'alert'} size={13} />
          </span>
          <span>{f.text}</span>
        </span>
      ))}
    </div>
  );
}

export function Arrow({ deg, size = 16, title, color = 'currentColor', from = true }: { deg: number | null; size?: number; title?: string; color?: string; from?: boolean }) {
  if (deg == null) return null;
  // meteorological 'from' direction: arrow points where the wind/swell is heading
  const rot = from ? deg + 180 : deg;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${rot}deg)` }} aria-label={title} role="img">
      <path d="M12 3l5 9h-3.5v9h-3v-9H7z" fill={color} />
    </svg>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={`${size === 'sm' ? 'text-[12px] px-2.5 py-1' : ''} ${o.value === value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Loading({ text = 'Loading…', progress }: { text?: string; progress?: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-ink2 text-sm gap-3">
      <div className="spinner" />
      <div>{text}</div>
      {progress != null && (
        <div className="w-40 h-1.5 rounded-full bg-[var(--grid)] overflow-hidden">
          <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4 text-sm flex items-start gap-3">
      <span style={{ color: STATUS.critical }}>
        <Icon name="alert" />
      </span>
      <div className="flex-1">
        <div className="font-medium text-ink">Couldn't load this data</div>
        <div className="text-ink2 mt-0.5">{String((error as Error)?.message ?? error)}</div>
      </div>
      {retry && (
        <button className="btn" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export function DataTable<T>({ rows, columns, maxHeight = 360, onRow }: { rows: T[]; columns: Column<T>[]; maxHeight?: number; onRow?: (r: T) => void }) {
  return (
    <div className="overflow-auto rounded-lg border border-[var(--border)]" style={{ maxHeight }}>
      <table className="w-full text-[12.5px] tabular-nums">
        <thead className="sticky top-0 bg-[var(--surface)]">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-3 py-2 font-medium text-ink2 border-b border-[var(--border)] whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-b border-[var(--grid)] last:border-0 ${onRow ? 'cursor-pointer hover:bg-[var(--hover)]' : ''}`} onClick={onRow ? () => onRow(r) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-1.5 text-ink whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A chart card with a chart/table toggle (every chart gets a table twin). */
export function ChartCard({ title, subtitle, right, chart, table, footer, className = '' }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; chart: ReactNode; table?: ReactNode; footer?: ReactNode; className?: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Card
      className={className}
      title={title}
      subtitle={subtitle}
      right={
        <>
          {right}
          {table && (
            <button className="icon-btn" aria-label={view === 'chart' ? 'Show table' : 'Show chart'} title={view === 'chart' ? 'Show as table' : 'Show as chart'} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
              <Icon name={view === 'chart' ? 'table' : 'chart'} size={16} />
            </button>
          )}
        </>
      }
    >
      {view === 'chart' ? chart : table}
      {footer && <div className="mt-2 text-[12px] text-muted">{footer}</div>}
    </Card>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'line' | 'swatch' | 'dot' }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.kind === 'line' ? (
            <span style={{ width: 14, height: 2, background: i.color, borderRadius: 2 }} />
          ) : i.kind === 'dot' ? (
            <span style={{ width: 8, height: 8, background: i.color, borderRadius: 99 }} />
          ) : (
            <span style={{ width: 10, height: 10, background: i.color, borderRadius: 3 }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warning' | 'serious' | 'critical' | 'accent' }) {
  const color = tone === 'neutral' ? 'var(--muted)' : tone === 'accent' ? 'var(--accent)' : STATUS[tone];
  return (
    <span className="chip text-[12px]">
      <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: color }} />
      {children}
    </span>
  );
}
