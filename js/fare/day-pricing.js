export const DEFAULT_DAY_PRICING = Object.freeze({
  mode: 'table',
  surchargePercent: 0,
  fixedSurchargeYen: 0,
});

export function normalizeDayPricing(value) {
  const source = value && typeof value === 'object' ? value : {};
  const percent = Number(source.surchargePercent);
  const fixed = Number(source.fixedSurchargeYen);
  return {
    mode: source.mode === 'nightSurcharge' ? 'nightSurcharge' : 'table',
    surchargePercent: Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : 0,
    fixedSurchargeYen: Number.isFinite(fixed) && fixed >= 0
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(fixed))
      : 0,
  };
}

export function calculateDaySurcharge(baseFare, policy) {
  const safe = normalizeDayPricing(policy);
  if (safe.mode !== 'nightSurcharge') return { percentFee: 0, fixedFee: 0, total: 0 };
  const fare = Number.isFinite(Number(baseFare)) && Number(baseFare) > 0 ? Number(baseFare) : 0;
  const percentFee = Math.round(fare * safe.surchargePercent / 100);
  const fixedFee = fare > 0 ? safe.fixedSurchargeYen : 0;
  return { percentFee, fixedFee, total: percentFee + fixedFee };
}
