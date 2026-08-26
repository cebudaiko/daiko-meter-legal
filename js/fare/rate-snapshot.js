import {
  getCompanies, getOptionConfig, getSpecialPeriodConfig, getWaitParams,
} from './config.js';
import { calcTotalFare } from './calculator.js';
import { normalizeDayPricing } from './day-pricing.js';
import { normalizeWinterPricing } from './winter-pricing.js';
import { validateWaitPricing } from './wait-pricing.js';
import { sanitizeConfig } from '../storage/local-config.js';
import {
  DEFAULT_LOW_SPEED_THRESHOLD_KMH,
  normalizeLowSpeedThresholdKmh,
} from './low-speed-threshold.js';

const DEFAULT_TIME_FARE = Object.freeze({
  enabled: false,
  speedThresholdKmh: DEFAULT_LOW_SPEED_THRESHOLD_KMH,
  intervalSec: 90,
  feePerInterval: 100,
});
const TRUSTED_SNAPSHOTS = new WeakSet();

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cloneTiers(tiers) {
  return (Array.isArray(tiers) ? tiers : []).map((tier) => {
    const copy = { upToKm: Number.isFinite(tier?.upToKm) ? Number(tier.upToKm) : null };
    if (tier?.flatFare !== undefined) copy.flatFare = finiteNumber(tier.flatFare);
    if (tier?.perKm !== undefined) copy.perKm = finiteNumber(tier.perKm);
    return copy;
  });
}

function cloneTimeFare(value) {
  const rule = value || DEFAULT_TIME_FARE;
  return {
    enabled: !!rule.enabled,
    speedThresholdKmh: normalizeLowSpeedThresholdKmh(
      rule.speedThresholdKmh,
      DEFAULT_LOW_SPEED_THRESHOLD_KMH,
    ),
    intervalSec: Math.max(1, finiteNumber(rule.intervalSec, 90)),
    feePerInterval: Math.max(0, finiteNumber(rule.feePerInterval)),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function trustSnapshot(snapshot) {
  TRUSTED_SNAPSHOTS.add(snapshot);
  return snapshot;
}

export function freezeFareSnapshot(snapshot) {
  if (TRUSTED_SNAPSHOTS.has(snapshot)) return snapshot;
  return sanitizeFareSnapshot(snapshot);
}

export function createFareSnapshot(config, rateContext = {}) {
  const input = config && typeof config === 'object' ? config : {};
  const safeConfig = sanitizeConfig({
    ...input,
    companies: input.companies || getCompanies(),
    waitParams: input.waitParams || getWaitParams(),
    options: input.options || getOptionConfig(),
    specialPeriod: input.specialPeriod || getSpecialPeriodConfig(),
  });
  const companies = safeConfig.companies;
  const companyId = rateContext.companyId || Object.keys(companies)[0] || 'company_a';
  const company = companies[companyId] || Object.values(companies)[0] || {};
  const isDaytime = !!rateContext.isDaytime;
  const isSpecialPeriod = !!rateContext.isSpecialPeriod;
  const isWinter = !!rateContext.isWinter;
  const policy = normalizeDayPricing(company.dayPricing);
  const dayPricing = {
    applied: isDaytime && !isSpecialPeriod && policy.mode === 'nightSurcharge',
    surchargePercent: policy.surchargePercent,
    fixedSurchargeYen: policy.fixedSurchargeYen,
  };
  const winterPolicy = normalizeWinterPricing(company.winterPricing);
  const winterPricing = {
    applied: isWinter,
    surchargePercent: winterPolicy.surchargePercent,
    fixedSurchargeYen: winterPolicy.fixedSurchargeYen,
  };
  const selectedBand = isSpecialPeriod
    ? safeConfig.specialPeriod
    : ((dayPricing.applied ? company.night : (isDaytime ? company.day : company.night))
      || company.night
      || company.day
      || {});
  const timeFare = (isDaytime ? company.day?.timeFare : company.night?.timeFare)
    || company.night?.timeFare
    || DEFAULT_TIME_FARE;
  const wait = safeConfig.waitParams;
  const options = safeConfig.options;
  const waitPricingResult = validateWaitPricing(safeConfig.waitPricing);

  const snapshot = {
    version: 1,
    company: {
      id: companyId,
      name: String(company.name || companyId),
      shortName: String(company.shortName || company.name || companyId),
    },
    rateContext: {
      companyId, isDaytime, isSpecialPeriod, isWinter,
    },
    distanceFare: {
      tiers: cloneTiers(selectedBand?.tiers),
      longDistanceBase: selectedBand?.longDistanceBase === undefined
        ? null
        : finiteNumber(selectedBand.longDistanceBase),
    },
    dayPricing,
    winterPricing,
    timeFare: cloneTimeFare(timeFare),
    waitParams: {
      initialMinutes: finiteNumber(wait?.initialMinutes),
      initialFee: finiteNumber(wait?.initialFee),
      additionalInterval: Math.max(1, finiteNumber(wait?.additionalInterval, 1)),
      additionalFee: finiteNumber(wait?.additionalFee),
    },
    options: {
      overtimeFee: finiteNumber(options?.overtimeFee),
      cancellationFee: finiteNumber(options?.cancellationFee),
      insuranceFee: finiteNumber(options?.insuranceFee),
      snowRemovalFee: finiteNumber(options?.snowRemovalFee),
      chainServiceFee: finiteNumber(options?.chainServiceFee),
    },
    specialPeriod: { selected: isSpecialPeriod },
    rounding: {
      distanceKmDecimals: 1,
      waitMinutesDecimals: 0,
      lowSpeedSecDecimals: 0,
      minimumTotal: 0,
    },
  };
  if (waitPricingResult.ok) snapshot.waitPricing = waitPricingResult.pricing;
  return trustSnapshot(deepFreeze(snapshot));
}

// Persisted snapshots are data, not trusted executable configuration. Rebuild the
// complete pricing surface through the same sanitizer used for a new trip while
// preserving the locked company/rate identity that history and receipts rely on.
export function sanitizeFareSnapshot(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const company = source.company && typeof source.company === 'object' ? source.company : {};
  const context = source.rateContext && typeof source.rateContext === 'object'
    ? source.rateContext
    : {};
  const companyId = String(context.companyId ?? company.id ?? 'company_a');
  const companyIdentity = {
    id: String(company.id ?? companyId),
    name: String(company.name ?? company.id ?? companyId),
    shortName: String(company.shortName ?? company.name ?? company.id ?? companyId),
  };
  const distanceFare = source.distanceFare && typeof source.distanceFare === 'object'
    ? source.distanceFare
    : {};
  const lockedBand = {
    tiers: distanceFare.tiers,
    timeFare: source.timeFare,
  };
  if (distanceFare.longDistanceBase !== null
      && distanceFare.longDistanceBase !== undefined) {
    lockedBand.longDistanceBase = distanceFare.longDistanceBase;
  }
  const rateContext = {
    companyId,
    isDaytime: !!context.isDaytime,
    isSpecialPeriod: !!context.isSpecialPeriod,
    isWinter: !!context.isWinter,
  };
  const sourceDayPricing = source.dayPricing
    && typeof source.dayPricing === 'object'
    && !Array.isArray(source.dayPricing)
    ? source.dayPricing
    : null;
  const normalizedDayPricing = sourceDayPricing
    ? normalizeDayPricing({
      mode: 'nightSurcharge',
      surchargePercent: sourceDayPricing.surchargePercent,
      fixedSurchargeYen: sourceDayPricing.fixedSurchargeYen,
    })
    : normalizeDayPricing();
  const dayPricing = {
    applied: sourceDayPricing?.applied === true
      && rateContext.isDaytime
      && !rateContext.isSpecialPeriod,
    surchargePercent: normalizedDayPricing.surchargePercent,
    fixedSurchargeYen: normalizedDayPricing.fixedSurchargeYen,
  };
  const sourceWinterPricing = source.winterPricing
    && typeof source.winterPricing === 'object'
    && !Array.isArray(source.winterPricing)
    ? source.winterPricing
    : null;
  const normalizedWinterPricing = normalizeWinterPricing(sourceWinterPricing || undefined);
  const winterPricing = {
    applied: sourceWinterPricing?.applied === true && rateContext.isWinter,
    surchargePercent: normalizedWinterPricing.surchargePercent,
    fixedSurchargeYen: normalizedWinterPricing.fixedSurchargeYen,
  };
  const internalCompanyId = 'persisted_snapshot';
  const snapshotConfig = {
    companies: {
      [internalCompanyId]: {
        name: companyIdentity.name,
        shortName: companyIdentity.shortName,
        night: lockedBand,
        day: lockedBand,
      },
    },
    waitParams: source.waitParams || source.wait || {},
    options: source.options || {},
    specialPeriod: lockedBand,
  };
  if (Object.hasOwn(source, 'waitPricing')) snapshotConfig.waitPricing = source.waitPricing;
  const safe = createFareSnapshot(snapshotConfig, {
    companyId: internalCompanyId,
    isDaytime: rateContext.isDaytime,
    isSpecialPeriod: rateContext.isSpecialPeriod,
  });

  return trustSnapshot(deepFreeze({
    ...safe,
    company: companyIdentity,
    rateContext,
    dayPricing,
    winterPricing,
    specialPeriod: { selected: rateContext.isSpecialPeriod },
  }));
}

export function calcTotalFareFromSnapshot(input = {}, snapshot) {
  if (!snapshot || snapshot.version !== 1) {
    throw new TypeError('FareSnapshotV1 is required');
  }
  const safeSnapshot = TRUSTED_SNAPSHOTS.has(snapshot)
    ? snapshot
    : sanitizeFareSnapshot(snapshot);
  const context = safeSnapshot.rateContext || {};
  const company = safeSnapshot.company || {};
  const companyId = context.companyId || company.id || 'company_a';
  const selectedBand = {
    tiers: cloneTiers(safeSnapshot.distanceFare?.tiers),
  };
  if (Number.isFinite(safeSnapshot.distanceFare?.longDistanceBase)) {
    selectedBand.longDistanceBase = safeSnapshot.distanceFare.longDistanceBase;
  }
  const snapshotConfig = {
    companies: {
      [companyId]: {
        name: company.name || companyId,
        shortName: company.shortName || company.name || companyId,
        night: { ...selectedBand, timeFare: cloneTimeFare(safeSnapshot.timeFare) },
        day: { ...selectedBand, timeFare: cloneTimeFare(safeSnapshot.timeFare) },
        dayPricing: {
          mode: safeSnapshot.dayPricing?.applied ? 'nightSurcharge' : 'table',
          surchargePercent: safeSnapshot.dayPricing?.surchargePercent,
          fixedSurchargeYen: safeSnapshot.dayPricing?.fixedSurchargeYen,
        },
        winterPricing: {
          surchargePercent: safeSnapshot.winterPricing?.surchargePercent,
          fixedSurchargeYen: safeSnapshot.winterPricing?.fixedSurchargeYen,
        },
      },
    },
    waitParams: { ...(safeSnapshot.waitParams || safeSnapshot.wait) },
    ...(safeSnapshot.waitPricing ? { waitPricing: safeSnapshot.waitPricing } : {}),
    options: { ...safeSnapshot.options },
    specialPeriod: { tiers: cloneTiers(safeSnapshot.distanceFare?.tiers) },
  };
  const result = calcTotalFare({
    ...input,
    companyId,
    isDaytime: !!context.isDaytime,
    // The selected distance table is already locked, including special period.
    isSpecialPeriod: false,
    isWinter: safeSnapshot.winterPricing?.applied === true,
  }, snapshotConfig);
  result.breakdown.isSpecialPeriod = !!context.isSpecialPeriod;
  result.breakdown.isWinter = !!context.isWinter;
  return result;
}
