import { operatingDayKey, normalizeOperatingDayCutoff } from '../history/operating-day.js';

function nonNegativeIntegerYen(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

export function buildTripRecord(state, { companies, gpsResult, tenantCode, now = new Date() } = {}) {
  // Record the rate context actually charged (locked at trip start), not the live one.
  const usingLocked = state.lockedCompanyId != null;
  const companyId = usingLocked ? state.lockedCompanyId : state.companyId;
  const isDaytime = usingLocked ? state.lockedIsDaytime : state.isDaytime;
  // B2-8: record the special-period flag actually charged so a 特別期間 trip stays
  // distinguishable in history/CSV (FC-3 gap).
  const isSpecialPeriod = usingLocked ? !!state.lockedIsSpecialPeriod : !!state.isSpecialPeriod;
  const isWinter = usingLocked ? !!state.lockedIsWinter : !!state.isWinter;
  const company = companies?.find((item) => item.id === companyId) || companies?.[0];
  const snapshotCompany = state.lockedFareSnapshot?.company;
  const startedAt = state.startedAt || new Date(state.startTime ?? now).toISOString();
  const endedAt = state.endedAt || new Date(now).toISOString();
  state.endedAt = endedAt;
  const operatingDayCutoff = normalizeOperatingDayCutoff(state.lockedOperatingDayCutoff);

  return {
    id: Date.now().toString(36),
    date: endedAt,
    startedAt,
    endedAt,
    operatingDay: operatingDayKey(startedAt, operatingDayCutoff),
    operatingDayCutoff,
    fareConfigVersion: 1,
    fareSnapshot: state.lockedFareSnapshot,
    companyId,
    companyName: snapshotCompany?.shortName || company?.shortName || companyId,
    isDaytime,
    isSpecialPeriod,
    isWinter,
    carNumber: state.carNumber,
    distanceKm: state.distanceKm,
    durationMs: state.elapsedMs,
    waitMs: state.totalWaitMs,
    baseFare: state.baseFare,
    daySurchargePercentFee: nonNegativeIntegerYen(state.daySurchargePercentFee),
    daySurchargeFixedFee: nonNegativeIntegerYen(state.daySurchargeFixedFee),
    daySurchargeFee: nonNegativeIntegerYen(state.daySurchargeFee),
    winterSurchargePercentFee: nonNegativeIntegerYen(state.winterSurchargePercentFee),
    winterSurchargeFixedFee: nonNegativeIntegerYen(state.winterSurchargeFixedFee),
    winterSurchargeFee: nonNegativeIntegerYen(state.winterSurchargeFee),
    waitFee: state.waitFee,
    timeFee: state.timeFee,
    optionFee: state.optionFee,
    totalFare: state.currentFare,
    options: { ...state.options },
    gpsPoints: gpsResult?.pointCount ?? gpsResult?.points?.length ?? 0,
    companyCode: tenantCode,
  };
}
