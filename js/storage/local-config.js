import { DEFAULT_OPTIONS, DEFAULT_SPECIAL, DEFAULT_WAIT } from '../fare/config-defaults.js';
import { DEFAULT_DAY_PRICING, normalizeDayPricing } from '../fare/day-pricing.js';
import { DEFAULT_WINTER_PRICING, normalizeWinterPricing } from '../fare/winter-pricing.js';
import {
  DEFAULT_LOW_SPEED_THRESHOLD_KMH,
  normalizeLowSpeedThresholdKmh,
} from '../fare/low-speed-threshold.js';
import { normalizeOperatingDayCutoff } from '../history/operating-day.js';

const KEY = 'meter_local_config';
const LEGACY_APP_NAME = ['DAIKO', 'METER'].join(' ');

// Generic sample for a fresh install (the buyer renames + edits it in Settings).
// NOT the seller's real businesses.
export function defaultConfig() {
  return {
    companies: {
      my_company: {
        name: 'サンプル代行',
        shortName: 'SAMPLE',
        night: {
          tiers: [
            { upToKm: 2, flatFare: 2000 },
            { upToKm: null, perKm: 350 },
          ],
          timeFare: {
            enabled: false,
            speedThresholdKmh: DEFAULT_LOW_SPEED_THRESHOLD_KMH,
            intervalSec: 90,
            feePerInterval: 100,
          },
        },
        day: {
          tiers: [
            { upToKm: 2, flatFare: 2000 },
            { upToKm: null, perKm: 350 },
          ],
        },
        dayStart: 7,
        dayEnd: 18,
        dayPricing: DEFAULT_DAY_PRICING,
        winterPricing: DEFAULT_WINTER_PRICING,
      },
    },
    options: DEFAULT_OPTIONS,
    waitParams: DEFAULT_WAIT,
    specialPeriod: DEFAULT_SPECIAL,
    cars: ['1号車', '2号車', '3号車'],
    appName: 'じろちゃんず',
    operatingDayCutoff: '14:00',
  };
}

// ---- sanitizer: a hand-edited / partial / corrupt config must never crash the
// meter or produce NaN / silently-¥0 fares. Every loaded config passes through this.
function nonNegative(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function positive(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function cloneFallbackTiers(tiers) {
  return tiers.map((tier) => ({
    upToKm: Number.isFinite(tier.upToKm) ? Number(tier.upToKm) : null,
    ...(tier.flatFare !== undefined ? { flatFare: Number(tier.flatFare) } : {}),
    ...(tier.perKm !== undefined ? { perKm: Number(tier.perKm) } : {}),
  }));
}

function sanitizeTiers(tiers, fallbackTiers) {
  const fallback = cloneFallbackTiers(fallbackTiers);
  const clean = (Array.isArray(tiers) ? tiers : [])
    .map((t) => {
      if (!t || typeof t !== 'object') return null;
      const rawBoundary = t.upToKm;
      const boundaryNumber = Number(rawBoundary);
      const upToKm = rawBoundary === null || rawBoundary === undefined
        || boundaryNumber === Number.POSITIVE_INFINITY
        ? null
        : positive(rawBoundary, Number.NaN);
      if (Number.isNaN(upToKm)) return { invalidBoundary: true };
      const flatFare = positive(t.flatFare, Number.NaN);
      if (!Number.isNaN(flatFare)) return { upToKm, flatFare };
      const perKm = positive(t.perKm, Number.NaN);
      if (!Number.isNaN(perKm)) return { upToKm, perKm };
      return null; // a tier with neither a valid flatFare nor perKm is dropped
    })
    .filter(Boolean);
  if (!clean.length || clean.some((tier) => tier.invalidBoundary)) return fallback;
  let previousBoundary = 0;
  let terminalSeen = false;
  for (const tier of clean) {
    if (terminalSeen) return fallback;
    if (tier.upToKm === null) {
      terminalSeen = true;
    } else {
      if (tier.upToKm <= previousBoundary) return fallback;
      previousBoundary = tier.upToKm;
    }
  }
  // B1-2: guarantee a terminal open-ended tier. A table ending on a bounded
  // tier (e.g. its last tier was dropped above for a typo like "perkm") would
  // otherwise price every distance past that bound at ¥0 — same silent-¥0
  // class as DI-02. Reuse the last seen perKm; else the fallback terminal's.
  if (clean[clean.length - 1].upToKm !== null) {
    const lastPerKm = [...clean].reverse().find((t) => t.perKm !== undefined);
    const fbTerminal = fallback[fallback.length - 1];
    clean.push({
      upToKm: null,
      perKm: lastPerKm !== undefined ? lastPerKm.perKm : positive(fbTerminal?.perKm, 1),
    });
  }
  return clean;
}

function sanitizeBand(band, fallbackBand) {
  const b = band && typeof band === 'object' ? band : {};
  const out = { tiers: sanitizeTiers(b.tiers, fallbackBand.tiers) };
  if (b.longDistanceBase !== undefined) {
    const fallbackBase = fallbackBand.longDistanceBase;
    const longDistanceBase = nonNegative(b.longDistanceBase, fallbackBase);
    if (longDistanceBase !== undefined) out.longDistanceBase = longDistanceBase;
  }
  if (b.timeFare && typeof b.timeFare === 'object') {
    const fallbackTimeFare = fallbackBand.timeFare || {
      speedThresholdKmh: DEFAULT_LOW_SPEED_THRESHOLD_KMH,
      intervalSec: 90,
      feePerInterval: 100,
    };
    out.timeFare = {
      enabled: !!b.timeFare.enabled,
      speedThresholdKmh: normalizeLowSpeedThresholdKmh(
        b.timeFare.speedThresholdKmh,
        fallbackTimeFare.speedThresholdKmh,
      ),
      intervalSec: positive(b.timeFare.intervalSec, fallbackTimeFare.intervalSec),
      feePerInterval: nonNegative(b.timeFare.feePerInterval, fallbackTimeFare.feePerInterval),
    };
  }
  return out;
}

export function sanitizeConfig(config) {
  const def = defaultConfig();
  const defCompany = Object.values(def.companies)[0];
  const c = config && typeof config === 'object' ? config : {};

  const companiesIn = c.companies && typeof c.companies === 'object' ? c.companies : {};
  const companies = {};
  for (const [id, comp0] of Object.entries(companiesIn)) {
    const comp = comp0 && typeof comp0 === 'object' ? comp0 : {};
    companies[id] = {
      name: comp.name || id,
      shortName: comp.shortName || comp.name || id,
      night: sanitizeBand(comp.night, defCompany.night),
      day: sanitizeBand(comp.day, defCompany.day),
      dayStart: nonNegative(comp.dayStart, 7),
      dayEnd: nonNegative(comp.dayEnd, 18),
      dayPricing: normalizeDayPricing(comp.dayPricing),
      winterPricing: normalizeWinterPricing(comp.winterPricing),
    };
  }
  if (!Object.keys(companies).length) {
    companies.my_company = {
      ...defCompany,
      dayPricing: normalizeDayPricing(defCompany.dayPricing),
      winterPricing: normalizeWinterPricing(defCompany.winterPricing),
    };
  }

  const w = c.waitParams && typeof c.waitParams === 'object' ? c.waitParams : {};
  const o = c.options && typeof c.options === 'object' ? c.options : {};
  return {
    companies,
    specialPeriod: sanitizeBand(c.specialPeriod, def.specialPeriod),
    options: {
      overtimeFee: nonNegative(o.overtimeFee, def.options.overtimeFee),
      cancellationFee: nonNegative(o.cancellationFee, def.options.cancellationFee),
      insuranceFee: nonNegative(o.insuranceFee, def.options.insuranceFee),
    },
    waitParams: {
      initialMinutes: nonNegative(w.initialMinutes, def.waitParams.initialMinutes),
      initialFee: nonNegative(w.initialFee, def.waitParams.initialFee),
      additionalInterval: positive(w.additionalInterval, def.waitParams.additionalInterval),
      additionalFee: nonNegative(w.additionalFee, def.waitParams.additionalFee),
    },
    cars: Array.isArray(c.cars) && c.cars.length ? c.cars.map(String) : def.cars,
    appName: c.appName === LEGACY_APP_NAME
      ? 'じろちゃんず'
      : (typeof c.appName === 'string' && c.appName.trim() ? c.appName : def.appName),
    operatingDayCutoff: normalizeOperatingDayCutoff(c.operatingDayCutoff, def.operatingDayCutoff),
  };
}

export function loadLocalConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizeConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultConfig();
  }
}

// Backup uses the durable JSON exactly as stored. It must not export the
// sanitizer's display/runtime fallbacks as though the user had saved them.
export function readRawLocalConfig() {
  return localStorage.getItem(KEY);
}

export function loadLocalConfigForBackup() {
  const raw = readRawLocalConfig();
  return raw === null ? null : JSON.parse(raw);
}

export function restoreRawLocalConfig(raw) {
  if (raw === null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, raw);
}

export function saveLocalConfig(config) {
  localStorage.setItem(KEY, JSON.stringify(config));
}
