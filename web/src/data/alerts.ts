/** GDACS tropical-cyclone events and IMD official alerts (both CORS-enabled). */

export interface GdacsEvent {
  id: number;
  episode: number;
  name: string;
  alert: string;
  country: string;
  from: string;
  to: string;
  lat: number;
  lon: number;
  severity: string;
  current: boolean;
  report: string;
}

export async function fetchGdacs(signal?: AbortSignal): Promise<GdacsEvent[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 20 * 86400000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromDate=${d(from)}&toDate=${d(to)}&alertlevel=Green;Orange;Red`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`GDACS ${r.status}`);
  const j = await r.json();
  return (j.features ?? [])
    .map((f: any) => ({
      id: f.properties.eventid,
      episode: f.properties.episodeid,
      name: f.properties.eventname ?? f.properties.name,
      alert: f.properties.alertlevel,
      country: f.properties.country ?? '',
      from: f.properties.fromdate,
      to: f.properties.todate,
      lon: f.geometry?.coordinates?.[0],
      lat: f.geometry?.coordinates?.[1],
      severity: f.properties.severitydata?.severitytext ?? '',
      current: f.properties.iscurrent === 'true' || f.properties.iscurrent === true,
      report: f.properties.url?.report ?? '',
    }))
    .filter((e: GdacsEvent) => e.lon >= 40 && e.lon <= 130 && e.lat >= -25 && e.lat <= 35);
}

export interface ImdAlert {
  title: string;
  link: string;
  published: number;
  relevant: boolean;
}

const RELEVANT = /(puducherry|pondicherry|villupuram|cuddalore|chennai|tamil\s*nadu|cyclon|depression|bay of bengal|fishermen|sea condition|high wave|swell)/i;

export async function fetchImd(signal?: AbortSignal): Promise<ImdAlert[]> {
  const r = await fetch('https://cap-sources.s3.amazonaws.com/in-imd-en/rss.xml', { signal, cache: 'no-store' });
  if (!r.ok) throw new Error(`IMD ${r.status}`);
  const x = await r.text();
  const items = [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.map((it) => {
    const g = (tag: string) => (it.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() ?? '';
    const title = g('title');
    return { title, link: g('link'), published: Math.floor(Date.parse(g('pubDate')) / 1000) || 0, relevant: RELEVANT.test(title + ' ' + g('description')) };
  });
}
