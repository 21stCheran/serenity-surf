import type { EChartsOption } from 'echarts';
import { BarChart, BoxplotChart, CustomChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  CalendarComponent,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  PolarComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

// only what the dashboard draws (keeps the phone bundle small)
echarts.use([
  BarChart, BoxplotChart, CustomChart, LineChart, ScatterChart,
  CalendarComponent, DataZoomComponent, GraphicComponent, GridComponent, LegendComponent,
  MarkAreaComponent, MarkLineComponent, MarkPointComponent, PolarComponent, TooltipComponent,
  CanvasRenderer,
]);
import { useEffect, useRef, useState } from 'react';
import { useMode } from '../state/settings';
import { FONT, SERIES, TOKENS, type Mode } from './theme';

export type EOption = EChartsOption;

/** Base option: chart chrome per mode (hairline solid grid, muted axes, system font). */
export function baseOption(mode: Mode): EOption {
  const t = TOKENS[mode];
  const axis = {
    axisLine: { lineStyle: { color: t.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, fontFamily: FONT },
    splitLine: { lineStyle: { color: t.grid, width: 1, type: 'solid' as const } },
    nameTextStyle: { color: t.muted, fontSize: 11 },
  };
  return {
    color: [...SERIES[mode]],
    backgroundColor: 'transparent',
    textStyle: { fontFamily: FONT, color: t.ink2 },
    animationDuration: 500,
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.ink, fontSize: 12, fontFamily: FONT },
      extraCssText: 'box-shadow:0 6px 24px rgba(0,0,0,.18);border-radius:10px;',
    },
    legend: { textStyle: { color: t.ink2, fontSize: 12 }, icon: 'roundRect', itemWidth: 12, itemHeight: 4, top: 0 },
    xAxis: axis as any,
    yAxis: axis as any,
  };
}

function merge<T extends Record<string, any>>(a: T, b: T): T {
  const out: any = { ...a };
  for (const k of Object.keys(b)) {
    const av = (a as any)[k];
    const bv = (b as any)[k];
    if (av && bv && typeof av === 'object' && typeof bv === 'object' && !Array.isArray(av) && !Array.isArray(bv)) out[k] = merge(av, bv);
    else out[k] = bv;
  }
  return out;
}

/** Apply mode chrome to axes given as arrays or objects. */
export function themed(opt: EOption, mode: Mode): EOption {
  const b = baseOption(mode);
  const fixAxes = (ax: any, base: any) => (Array.isArray(ax) ? ax.map((a) => merge(base, a)) : ax ? merge(base, ax) : ax);
  const o: any = { ...b, ...opt };
  o.tooltip = opt.tooltip ? merge(b.tooltip as any, opt.tooltip as any) : b.tooltip;
  o.legend = opt.legend ? (Array.isArray(opt.legend) ? opt.legend : merge(b.legend as any, opt.legend as any)) : undefined;
  o.xAxis = fixAxes(opt.xAxis, b.xAxis);
  o.yAxis = fixAxes(opt.yAxis, b.yAxis);
  if ((opt as any).radiusAxis) o.radiusAxis = fixAxes((opt as any).radiusAxis, b.xAxis);
  if ((opt as any).angleAxis) o.angleAxis = fixAxes((opt as any).angleAxis, b.xAxis);
  return o;
}

export function EChart({
  option,
  height = 260,
  group,
  onClick,
  className,
  notMerge = true,
}: {
  option: (mode: Mode) => EOption;
  height?: number | string;
  group?: string;
  onClick?: (p: any) => void;
  className?: string;
  notMerge?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const mode = useMode();
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (p) => clickRef.current?.(p));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    try {
      c.setOption(themed(option(mode), mode), { notMerge });
      if (group) {
        c.group = group;
        echarts.connect(group);
      }
      setFailed(null);
    } catch (e) {
      // a broken chart must never take the page down with it
      console.error('chart failed', e);
      setFailed(String((e as Error)?.message ?? e));
    }
  }, [option, mode, group, notMerge]);

  return (
    <div style={{ position: 'relative' }}>
      <div ref={ref} className={className} style={{ width: '100%', height }} />
      {failed && <div className="absolute inset-0 grid place-items-center text-[12px] text-muted">Chart unavailable ({failed})</div>}
    </div>
  );
}
