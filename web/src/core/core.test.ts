import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAbio, parseRssLinks, parseWarning } from '../data/jtwc';
import { buildAlert } from './alerts';
import { predictStormSwell, Shadow, young, type CycloneModel } from './cyclone';
import golden from './golden.json';
import { DEFAULT_PROFILE, PROFILES } from './profiles';
import { labelOf, scoreHour, windInfo } from './score';
import { breakingHeight, faceRange, surfAtBeach } from './surf';
import { Tides } from './tide';
import type { HourInput, HourScore } from './types';
import { sessionsForDay } from './windows';

const fixtures = join(__dirname, '..', 'data', '__fixtures__');
const fx = (n: string) => readFileSync(join(fixtures, n), 'utf8');

// a fixed morning in IST (07:30, 2026-03-10) so daylight is true
const T = Date.UTC(2026, 2, 10, 2, 0) / 1000;
const hour = (over: Partial<HourInput> = {}): HourInput => ({ t: T, hs: 1.2, tp: 11, dir: 120, ws: 5, wd: 270, ...over });

describe('surf transform (parity with Python)', () => {
  it('matches the golden breaking heights', () => {
    for (const c of golden.breaking) {
      const hb = breakingHeight(c.h, c.t, c.d);
      expect(hb).toBeCloseTo(c.hb, 5);
      const f = faceRange(hb);
      expect(f.lo).toBeCloseTo(c.faceLo, 4);
      expect(f.hi).toBeCloseTo(c.faceHi, 4);
    }
  });
  it('combines systems by energy', () => {
    const parts = golden.combine.parts.map(([h, p, d]) => ({ h, p, d, kind: 'swell' as const }));
    const s = surfAtBeach({ hs: null, tp: null, dir: null, parts });
    expect(s.hb).toBeCloseTo(golden.combine.hb, 5);
    expect(s.tdom).toBe(golden.combine.tdom);
  });
  it('blocks waves coming from the land side', () => {
    expect(breakingHeight(2, 12, 286)).toBe(0);
  });
});

describe('scoring', () => {
  it('rates clean 1.2 m @ 11 s SE with light offshore wind as Great or better', () => {
    const s = scoreHour(hour());
    expect(s.score).toBeGreaterThanOrEqual(6.5);
    expect(s.windType).toBe('offshore');
  });
  it('rates the same swell with 18 kt onshore as Poor', () => {
    const s = scoreHour(hour({ ws: 18, wd: 95 }));
    expect(s.label).toBe('Poor');
  });
  it('treats clean 3 ft as Good for the 6\'10 profile', () => {
    // find the swell giving ~3 ft faces, light offshore
    const s = scoreHour(hour({ hs: 0.75, tp: 10 }));
    expect(s.faceMid).toBeGreaterThan(2.6);
    expect(s.faceMid).toBeLessThan(3.6);
    expect(['Good', 'Great']).toContain(s.label);
  });
  it('classifies wind relative to the WNW offshore direction', () => {
    expect(windInfo(10, 286).type).toBe('offshore');
    expect(windInfo(10, 106).type).toBe('onshore');
    expect(windInfo(10, 16).type).toBe('cross-shore');
    expect(windInfo(2, 106).type).toBe('glassy');
  });
  it('maps scores to labels', () => {
    expect(labelOf(0.5)).toBe('Flat');
    expect(labelOf(5)).toBe('Good');
    expect(labelOf(9)).toBe('Epic');
  });
  it('profiles change the verdict on big days', () => {
    const big = hour({ hs: 3.2, tp: 13, dir: 105 });
    const beg = scoreHour(big, PROFILES.find((p) => p.id === 'beginner')!);
    const hunter = scoreHour(big, PROFILES.find((p) => p.id === 'cyclone-hunter')!);
    expect(hunter.score).toBeGreaterThan(beg.score + 4);
  });
  it('flags thunderstorms and runoff', () => {
    const s = scoreHour(hour({ wc: 95, rain48: 80 }));
    const codes = s.flags.map((f) => f.code);
    expect(codes).toContain('lightning');
    expect(codes).toContain('water-quality');
  });
});

describe('best-session finder', () => {
  it('picks the strongest 2-3 h daylight window', () => {
    const hs: HourScore[] = Array.from({ length: 24 }, (_, i) => scoreHour(hour({ t: Date.UTC(2026, 2, 10, 0, 0) / 1000 + i * 3600, ws: i >= 3 && i <= 5 ? 3 : 16, wd: i >= 3 && i <= 5 ? 280 : 100 })));
    const [best] = sessionsForDay(hs, 1);
    expect(best).toBeDefined();
    const startUtcHour = new Date(best.start * 1000).getUTCHours();
    expect(startUtcHour).toBeGreaterThanOrEqual(3);
    expect(startUtcHour).toBeLessThanOrEqual(4);
  });
});

describe('tides', () => {
  it('finds high and low water on a synthetic M2 tide', () => {
    const n = 24 * 4;
    const h_cm = Array.from({ length: n }, (_, i) => Math.round(50 * Math.cos((2 * Math.PI * i) / 12.42)));
    const t = new Tides({ t0: 0, dt: 3600, n, h_cm, mean_range_m: 1, spring_range_m: 1, neap_range_m: 1, lat_m: -0.5, hat_m: 0.5 });
    const ex = t.extremes(3600 * 2, 3600 * 30);
    const highs = ex.filter((e) => e.type === 'high');
    expect(highs.length).toBe(2);
    expect(highs[0].t / 3600).toBeCloseTo(12.42, 0);
    const st = t.stage(3600 * 3);
    expect(st?.rising).toBe(false);
  });
});

describe('JTWC parsing', () => {
  it('parses a typhoon warning with forecast fixes and wind radii', () => {
    const s = parseWarning(fx('jtwc_ty.txt'), 'https://www.metoc.navy.mil/jtwc/products/wp2726web.txt', new Date(Date.UTC(2026, 9, 13)))!;
    expect(s.name).toBe('KOGUMA');
    expect(s.basin).toBe('WP');
    expect(s.fixes[0].windKt).toBe(70);
    expect(s.fixes[0].lat).toBeCloseTo(33.9, 1);
    expect(s.fixes[0].r34Km).toBeGreaterThan(150);
    expect(s.fixes.length).toBeGreaterThanOrEqual(3);
    expect(s.fixes[1].t - s.fixes[0].t).toBe(12 * 3600);
  });
  it('parses a depression warning', () => {
    const s = parseWarning(fx('jtwc_td.txt'), 'https://www.metoc.navy.mil/jtwc/products/wp2826web.txt', new Date(Date.UTC(2026, 9, 13)))!;
    expect(s.kind).toBe('TROPICAL DEPRESSION');
    expect(s.fixes[0].windKt).toBe(25);
    expect(s.pressureMb).toBe(1010);
  });
  it('finds warning links in the RSS feed', () => {
    const links = parseRssLinks(fx('jtwc.rss'));
    expect(links.some((l) => l.endsWith('wp2726web.txt'))).toBe(true);
    expect(links.some((l) => l.includes('/ep'))).toBe(false);
  });
  it('parses the Indian Ocean advisory', () => {
    const a = parseAbio(fx('abio.txt'));
    expect(a.invests).toEqual([]);
    expect(a.north).toContain('TROPICAL CYCLONE SUMMARY');
    const synthetic = parseAbio(
      'SUBJ/SIGNIFICANT TROPICAL WEATHER ADVISORY FOR THE INDIAN OCEAN/121800Z-//\n1. NORTH INDIAN OCEAN AREA:\n   B. TROPICAL DISTURBANCE SUMMARY:\n      (1) THE AREA OF CONVECTION (INVEST 92B) PREVIOUSLY LOCATED NEAR 10.1N 88.2E IS NOW LOCATED NEAR 11.0N 87.5E. THE POTENTIAL FOR DEVELOPMENT ... IS MEDIUM.\n2. SOUTH INDIAN OCEAN AREA:\n NONE',
    );
    expect(synthetic.invests[0]).toMatchObject({ id: '92B', lat: 11, lon: 87.5, chance: 'MEDIUM' });
  });
});

const MODEL_FILE = join(__dirname, '..', '..', 'public', 'data', 'cyclone-model.json');
// needs the pipeline output (python -m pipeline.build); skipped on a fresh checkout
describe.skipIf(!existsSync(MODEL_FILE))('cyclone swell model', () => {
  const model = (existsSync(MODEL_FILE) ? JSON.parse(readFileSync(MODEL_FILE, 'utf8')) : null) as CycloneModel;
  const shadow = model ? new Shadow(model.shadow) : (null as unknown as Shadow);
  it('Young (1988) gives sensible hurricane seas', () => {
    const { hs, tp } = young(model, 40, 5, 30);
    expect(hs).toBeGreaterThan(9);
    expect(hs).toBeLessThan(13);
    expect(tp).toBeGreaterThan(12);
  });
  it('knows Sri Lanka blocks due-south swell and the open Bay does not', () => {
    expect(shadow.blocked(5.5, 81.0)).toBe(true);
    expect(shadow.blocked(14, 87)).toBe(false);
    expect(shadow.blocked(12, 70)).toBe(true); // Arabian Sea
  });
  it('a severe storm in the Bay heading for Pondicherry sends big swell; an Arabian Sea storm sends none', () => {
    const t0 = 1_800_000_000;
    const bay = predictStormSwell(
      [0, 1, 2, 3].map((k) => ({ t: t0 + k * 12 * 3600, lat: 13.5 - k * 0.4, lon: 86.5 - k * 1.2, windKt: 90 })),
      model,
      shadow,
      0.8,
    );
    expect(bay.peak!.p50).toBeGreaterThan(2);
    expect(bay.firstArrival).not.toBeNull();
    const arabian = predictStormSwell([{ t: t0, lat: 15, lon: 68, windKt: 100 }, { t: t0 + 43200, lat: 16, lon: 67, windKt: 100 }], model, shadow, 0.8);
    expect(arabian.peak!.swellHs).toBeLessThan(0.3);
  });
});

describe('phone alert', () => {
  it('notifies for a Good session and stays quiet when flat', () => {
    const now = T - 3600;
    const mk = (good: boolean) =>
      Array.from({ length: 30 }, (_, i) => scoreHour(hour({ t: now + i * 3600, hs: good ? 1.0 : 0.15, tp: good ? 11 : 5, ws: 4, wd: 280 }), DEFAULT_PROFILE));
    const args = { storms: [], now, profile: 'test', url: 'x', windKt: () => 4, tideAt: () => ({ norm: 0.5, rising: true }) };
    const a = buildAlert({ ...args, hours: mk(true) });
    expect(a.notify).toBe(true);
    expect(a.today?.score).toBeGreaterThanOrEqual(4.5);
    const b = buildAlert({ ...args, hours: mk(false) });
    expect(b.notify).toBe(false);
    expect(b.level).toBe('none');
  });
});
