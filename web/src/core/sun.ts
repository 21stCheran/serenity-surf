/** Sunrise / sunset (NOAA solar calculator equations). Accurate to ~1 minute. */
import { SPOT } from './spot';
import { istDayStart } from './units';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

function solar(jd: number) {
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) +
    Math.sin(rad(3 * M)) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const eqTime =
    4 *
    deg(
      y * Math.sin(2 * rad(L0)) -
        2 * e * Math.sin(rad(M)) +
        4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) -
        0.5 * y * y * Math.sin(4 * rad(L0)) -
        1.25 * e * e * Math.sin(2 * rad(M)),
    );
  return { decl, eqTime };
}

/** Sunrise and sunset (epoch seconds) for the IST day containing t. */
export function sunTimes(t: number, lat = SPOT.lat, lon = SPOT.lon): { sunrise: number; sunset: number; noon: number } {
  const day0 = istDayStart(t);
  const utcMidnight = Math.floor((day0 + 43200) / 86400) * 86400; // UTC date of local noon
  const jdNoon = utcMidnight / 86400 + 2440587.5 + (12 - lon / 15) / 24;
  const { decl, eqTime } = solar(jdNoon);
  const cosH = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
  const H = deg(Math.acos(Math.max(-1, Math.min(1, cosH))));
  const noonMin = 720 - 4 * lon - eqTime;
  return {
    sunrise: Math.round(utcMidnight + (noonMin - 4 * H) * 60),
    sunset: Math.round(utcMidnight + (noonMin + 4 * H) * 60),
    noon: Math.round(utcMidnight + noonMin * 60),
  };
}

const cache = new Map<number, { sunrise: number; sunset: number; noon: number }>();

/** Surfable light: from 20 min before sunrise to 10 min after sunset. */
export function isDaylight(t: number): boolean {
  const k = istDayStart(t);
  let s = cache.get(k);
  if (!s) {
    s = sunTimes(t);
    cache.set(k, s);
  }
  return t >= s.sunrise - 1200 && t <= s.sunset + 600;
}
