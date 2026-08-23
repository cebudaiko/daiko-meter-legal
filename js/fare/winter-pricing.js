export const DEFAULT_WINTER_PRICING = Object.freeze({
  surchargePercent: 0,
  fixedSurchargeYen: 0,
});

export function normalizeWinterPricing(value) {
  const source = value && typeof value === 'object' ? value : {};
  const percent = Number(source.surchargePercent);
  const fixed = Number(source.fixedSurchargeYen);
  return {
    surchargePercent: Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : 0,
    fixedSurchargeYen: Number.isFinite(fixed) && fixed >= 0
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(fixed))
      : 0,
  };
}

export function calculateWinterSurcharge(baseFare, policy) {
  const safe = normalizeWinterPricing(policy);
  const fare = Number.isFinite(Number(baseFare)) && Number(baseFare) > 0 ? Number(baseFare) : 0;
  const percentFee = Math.round(fare * safe.surchargePercent / 100);
  const fixedFee = fare > 0 ? safe.fixedSurchargeYen : 0;
  return { percentFee, fixedFee, total: percentFee + fixedFee };
}
