import type { Label } from '../core/types';
import { useMode } from '../state/settings';
import { labelColor, scoreColor, TOKENS } from '../viz/theme';

export function ScoreDial({ score, label, size = 168 }: { score: number; label: Label; size?: number }) {
  const mode = useMode();
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / 10));
  const start = 135; // 270° gauge
  const sweep = 270;
  const arc = (c * sweep) / 360;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Surf score ${score.toFixed(1)} out of 10, ${label}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TOKENS[mode].grid}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`}
          transform={`rotate(${start} ${size / 2} ${size / 2})`}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreColor(Math.max(score, 2.5), mode)}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${arc * frac} ${c}`}
          transform={`rotate(${start} ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray .8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[52px] font-semibold leading-none text-ink">{score.toFixed(1)}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[14px] font-medium text-ink">
          <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: labelColor(label, mode) }} />
          {label}
        </div>
        <div className="text-[11px] text-muted mt-0.5">out of 10</div>
      </div>
    </div>
  );
}
