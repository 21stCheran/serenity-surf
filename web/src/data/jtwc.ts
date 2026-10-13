/** JTWC (US Joint Typhoon Warning Center) live products. All CORS-enabled.
 * - RSS lists current warnings and formation alerts (TCFA) with links.
 * - Warning text gives the current fix and forecast positions/intensity/wind radii.
 * - ABIO is the daily Indian Ocean significant tropical weather advisory (invests). */

export const JTWC_RSS = 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss';
export const JTWC_ABIO = 'https://www.metoc.navy.mil/jtwc/products/abioweb.txt';

export interface Fix {
  tau: number; // hours from the warning time
  t: number; // epoch s
  lat: number;
  lon: number;
  windKt: number | null;
  gustKt: number | null;
  r34Km: number | null; // mean radius of 34 kt winds
}

export interface JtwcStorm {
  id: string; // e.g. IO01 / WP28
  basin: 'IO' | 'WP' | 'SH' | 'EP' | 'CP' | string;
  number: string;
  name: string;
  kind: string; // TROPICAL DEPRESSION / TROPICAL CYCLONE / TYPHOON ...
  warningNo: number | null;
  issued: number | null;
  movement: { dir: number; kt: number } | null;
  pressureMb: number | null;
  maxWaveFt: number | null;
  fixes: Fix[];
  url: string;
  isFormationAlert: boolean;
}

export interface Invest {
  id: string | null; // e.g. 92B
  lat: number;
  lon: number;
  chance: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  text: string;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function parseLat(s: string): number {
  const v = parseFloat(s);
  return s.endsWith('S') ? -v : v;
}
function parseLon(s: string): number {
  const v = parseFloat(s);
  return s.endsWith('W') ? -v : v;
}

/** DDHHMMZ relative to a reference month (handles month roll-over). */
export function dtgToEpoch(dtg: string, ref: Date): number {
  const d = parseInt(dtg.slice(0, 2), 10);
  const h = parseInt(dtg.slice(2, 4), 10);
  const m = parseInt(dtg.slice(4, 6), 10);
  let y = ref.getUTCFullYear();
  let mo = ref.getUTCMonth();
  const refDay = ref.getUTCDate();
  if (d - refDay > 15) {
    mo -= 1;
    if (mo < 0) {
      mo = 11;
      y -= 1;
    }
  } else if (refDay - d > 15) {
    mo += 1;
    if (mo > 11) {
      mo = 0;
      y += 1;
    }
  }
  return Date.UTC(y, mo, d, h, m) / 1000;
}

function refDateFrom(txt: string, fallback: Date): Date {
  // REMARKS line like "13OCT26." gives day, month and year
  const m = txt.match(/\b(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})\b/);
  if (m) return new Date(Date.UTC(2000 + parseInt(m[3], 10), MONTHS.indexOf(m[2]), parseInt(m[1], 10)));
  return fallback;
}

export function parseWarning(txt: string, url = '', now = new Date()): JtwcStorm | null {
  const subj = txt.match(/SUBJ\/(.+?) WARNING NR (\d+)/) || txt.match(/SUBJ\/(.+?)\/\//);
  const title = subj ? subj[1].trim() : '';
  const idm = title.match(/(\d{2}[A-Z])\s*\(([^)]+)\)/);
  const kind = title.replace(/\s*\d{2}[A-Z].*$/, '').trim();
  const fname = url.match(/\/(io|wp|sh|ep|cp)(\d{2})(\d{2})web\.txt/i);
  const basin = fname ? fname[1].toUpperCase() : idm ? ({ A: 'IO', B: 'IO', W: 'WP', S: 'SH', P: 'SH', E: 'EP', C: 'CP' } as Record<string, string>)[idm[1].slice(-1)] ?? '' : '';
  const ref = refDateFrom(txt, now);
  const header = txt.match(/^\w+ \w+ (\d{6})/m);
  const issued = header ? dtgToEpoch(header[1], ref) : null;

  const fixes: Fix[] = [];
  // current position block
  const cur = txt.match(/WARNING POSITION:\s*\n\s*(\d{6})Z --- NEAR ([\d.]+[NS]) ([\d.]+[EW])([\s\S]*?)(?:---|FORECASTS:)/);
  const blocks: { tau: number; dtg: string; lat: string; lon: string; body: string }[] = [];
  if (cur) blocks.push({ tau: 0, dtg: cur[1], lat: cur[2], lon: cur[3], body: cur[4] });
  const fre = /(\d+) HRS, VALID AT:\s*\n\s*(\d{6})Z --- ([\d.]+[NS]) ([\d.]+[EW])([\s\S]*?)(?=\n\s*---|\n\s*\d+ HRS, VALID AT:|REMARKS:|$)/g;
  let m: RegExpExecArray | null;
  while ((m = fre.exec(txt))) blocks.push({ tau: parseInt(m[1], 10), dtg: m[2], lat: m[3], lon: m[4], body: m[5] });
  for (const b of blocks) {
    const w = b.body.match(/MAX SUSTAINED WINDS - (\d+) KT, GUSTS (\d+) KT/);
    const r34 = b.body.match(/RADIUS OF 034 KT WINDS - ([\s\S]*?)(?:RADIUS OF|REPEAT|VECTOR|$)/);
    let r34Km: number | null = null;
    if (r34) {
      const nm = [...r34[1].matchAll(/(\d+) NM/g)].map((x) => parseInt(x[1], 10));
      if (nm.length) r34Km = (nm.reduce((a, v) => a + v, 0) / nm.length) * 1.852;
    }
    fixes.push({
      tau: b.tau,
      t: dtgToEpoch(b.dtg, ref),
      lat: parseLat(b.lat),
      lon: parseLon(b.lon),
      windKt: w ? parseInt(w[1], 10) : null,
      gustKt: w ? parseInt(w[2], 10) : null,
      r34Km,
    });
  }
  if (!fixes.length) return null;
  const mv = txt.match(/MOVEMENT PAST SIX HOURS - (\d+) DEGREES AT (\d+) KTS/);
  const pr = txt.match(/MINIMUM CENTRAL\s+PRESSURE AT \d+Z IS (\d+) MB/);
  const wave = txt.match(/MAXIMUM SIGNIFICANT WAVE HEIGHT AT\s+\d+Z IS (\d+) FEET/);
  const num = idm ? idm[1] : fname ? fname[2] : '';
  return {
    id: `${basin}${num.replace(/\D/g, '')}`,
    basin,
    number: num,
    name: idm ? idm[2].trim() : title,
    kind,
    warningNo: subj && subj[2] ? parseInt(subj[2], 10) : null,
    issued,
    movement: mv ? { dir: parseInt(mv[1], 10), kt: parseInt(mv[2], 10) } : null,
    pressureMb: pr ? parseInt(pr[1], 10) : null,
    maxWaveFt: wave ? parseInt(wave[1], 10) : null,
    fixes: fixes.sort((a, b) => a.tau - b.tau),
    url,
    isFormationAlert: /FORMATION ALERT/.test(txt),
  };
}

/** Warning/TCFA text links in the RSS feed, for the basins that matter here. */
export function parseRssLinks(xml: string, basins = ['io', 'wp', 'sh']): string[] {
  const out = new Set<string>();
  for (const m of xml.matchAll(/https:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/([a-z]{2})(\d{4})web\.txt/g)) {
    if (basins.includes(m[1])) out.add(m[0]);
  }
  return [...out];
}

export function parseAbio(txt: string): { issued: string | null; invests: Invest[]; north: string; south: string } {
  const flat = txt.replace(/\r/g, '');
  const north = (flat.match(/1\. NORTH INDIAN OCEAN([\s\S]*?)2\. SOUTH INDIAN OCEAN/) || [])[1] ?? '';
  const south = (flat.match(/2\. SOUTH INDIAN OCEAN([\s\S]*)$/) || [])[1] ?? '';
  const invests: Invest[] = [];
  for (const sect of [north, south]) {
    const paras = sect.split(/\n\s*\(\d+\)\s+/).slice(1);
    for (const p of paras) {
      const t = p.replace(/\s+/g, ' ');
      const pos = [...t.matchAll(/NEAR (\d+\.\d)([NS]) (\d+\.\d)([EW])/g)];
      if (!pos.length) continue;
      const last = pos[pos.length - 1];
      const id = (t.match(/INVEST (\d{2}[A-Z])/) || [])[1] ?? null;
      const ch = t.match(/IS (LOW|MEDIUM|HIGH)\b/g);
      const chance = ch ? (ch[ch.length - 1].split(' ')[1] as Invest['chance']) : null;
      invests.push({
        id,
        lat: parseLat(last[1] + last[2]),
        lon: parseLon(last[3] + last[4]),
        chance,
        text: t.slice(0, 600),
      });
    }
  }
  const issued = (flat.match(/SUBJ\/.*?\/(\d{6}Z-)/) || [])[1] ?? null;
  return { issued, invests, north: north.trim(), south: south.trim() };
}

async function getText(url: string, signal?: AbortSignal): Promise<string> {
  const r = await fetch(url, { signal, cache: 'no-store' });
  if (!r.ok) throw new Error(`JTWC ${r.status} ${url}`);
  return r.text();
}

export interface JtwcSnapshot {
  storms: JtwcStorm[];
  invests: Invest[];
  abioNorth: string;
  fetchedAt: number;
}

export async function fetchJtwc(signal?: AbortSignal): Promise<JtwcSnapshot> {
  const [rss, abio] = await Promise.all([getText(JTWC_RSS, signal), getText(JTWC_ABIO, signal).catch(() => '')]);
  const links = parseRssLinks(rss);
  const storms = (
    await Promise.all(
      links.map((u) =>
        getText(u, signal)
          .then((t) => parseWarning(t, u))
          .catch(() => null),
      ),
    )
  ).filter((s): s is JtwcStorm => !!s);
  const a = abio ? parseAbio(abio) : { invests: [], north: '' };
  return { storms, invests: a.invests, abioNorth: a.north, fetchedAt: Math.floor(Date.now() / 1000) };
}
