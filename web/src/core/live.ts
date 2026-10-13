/** Live cyclone assessment: JTWC storms -> predicted swell at Serenity. */
import type { JtwcStorm } from '../data/jtwc';
import type { CycloneModel, StormSwell, TrackPoint } from './cyclone';
import { findAnalogs, haversineKm, imdCategory, predictStormSwell, Shadow } from './cyclone';
import type { ScoreContext } from './score';
import { SPOT } from './spot';
import type { HourInput } from './types';
import { ist } from './units';

export interface StormAssessment {
  id: string;
  name: string;
  basin: string;
  kind: string;
  category: { code: string; name: string };
  windKt: number | null;
  lat: number;
  lon: number;
  distanceKm: number;
  closestKm: number;
  swell: StormSwell;
  peakFaceLo: number;
  peakFaceHi: number;
  peakTime: number | null;
  firstArrival: number | null;
  relevant: boolean; // could send noticeable swell (>= 0.3 m) to Serenity
  analogs: ReturnType<typeof findAnalogs>;
  storm: JtwcStorm;
}

export function inRegion(lat: number, lon: number): boolean {
  return lon >= 40 && lon <= 125 && lat >= -20 && lat <= 32;
}

export function assessStorms(storms: JtwcStorm[], model: CycloneModel, baseHs = 0.8): StormAssessment[] {
  const shadow = new Shadow(model.shadow);
  return storms
    .filter((s) => s.fixes.length && inRegion(s.fixes[0].lat, s.fixes[0].lon))
    .map((s) => {
      const track: TrackPoint[] = s.fixes.map((f) => ({ t: f.t, lat: f.lat, lon: f.lon, windKt: f.windKt, rmwKm: null }));
      const sw = predictStormSwell(track, model, shadow, baseHs);
      const now = s.fixes[0];
      const peak = sw.peak;
      const best = sw.contributions.reduce((a, b) => (b.swellHs > a.swellHs ? b : a), sw.contributions[0]);
      return {
        id: s.id,
        name: s.name,
        basin: s.basin,
        kind: s.kind,
        category: imdCategory(now.windKt),
        windKt: now.windKt,
        lat: now.lat,
        lon: now.lon,
        distanceKm: haversineKm(SPOT.lat, SPOT.lon, now.lat, now.lon),
        closestKm: sw.closestKm,
        swell: sw,
        peakFaceLo: peak?.faceLo ?? 0,
        peakFaceHi: peak?.faceHi ?? 0,
        peakTime: peak?.t ?? null,
        firstArrival: sw.firstArrival,
        relevant: (peak?.swellHs ?? 0) >= 0.3,
        analogs: best
          ? findAnalogs(model, { lat: best.lat, lon: best.lon, windKt: best.windKt, heading: s.movement?.dir ?? null, month: ist(best.t).month })
          : [],
        storm: s,
      };
    })
    .sort((a, b) => b.peakFaceHi - a.peakFaceHi);
}

/** Per-hour cyclone context for the scorer (cyclone-swell badge, danger flag). */
export function cycloneContext(assessments: StormAssessment[]): (h: HourInput) => ScoreContext {
  return (h) => {
    let cyc: ScoreContext['cycloneSwell'] = null;
    let dmin: number | null = null;
    for (const a of assessments) {
      const pt = a.swell.timeline.find((p) => Math.abs(p.t - h.t) < 1800);
      if (pt && pt.swellHs >= 0.4) cyc = { name: a.name };
      // storm position at h.t (linear between fixes)
      const f = a.storm.fixes;
      for (let i = 0; i < f.length - 1; i++) {
        if (h.t >= f[i].t && h.t <= f[i + 1].t) {
          const x = (h.t - f[i].t) / (f[i + 1].t - f[i].t);
          const d = haversineKm(SPOT.lat, SPOT.lon, f[i].lat + (f[i + 1].lat - f[i].lat) * x, f[i].lon + (f[i + 1].lon - f[i].lon) * x);
          dmin = dmin == null ? d : Math.min(dmin, d);
        }
      }
    }
    return { cycloneSwell: cyc, stormDistanceKm: dmin };
  };
}
