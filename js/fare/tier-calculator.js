// B1-1: cumulative tier pricing. When a perKm tier follows another perKm tier,
// the fare accrued at the previous boundary carries over (computed recursively),
// so the meter can never drop when crossing a tier boundary mid-trip.
// B1-2: distance past a bounded last tier prices that tier as if open-ended
// instead of returning ¥0 (defense in depth behind sanitizeTiers' terminal-tier
// guarantee in js/storage/local-config.js).
export function calcFromTiers(km, tiers, longDistanceBase) {
  if (!Array.isArray(tiers) || tiers.length === 0) return 0;

  const dist10 = Math.round(km * 10);

  // B1-2: default to the last tier, treated as open-ended, when no tier matches.
  let index = tiers.length - 1;
  for (let i = 0; i < tiers.length; i++) {
    const upper10 = tiers[i].upToKm == null ? Infinity : Math.round(tiers[i].upToKm * 10);
    if (dist10 <= upper10) {
      index = i;
      break;
    }
  }

  const tier = tiers[index];
  if (tier.flatFare !== undefined) return tier.flatFare;

  const prevLimit10 = index > 0 ? Math.round(tiers[index - 1].upToKm * 10) : 0;
  const extraKm = Math.ceil(Math.max(0, dist10 - prevLimit10) / 10);
  return fareAtPreviousBoundary(tiers, index, longDistanceBase) + extraKm * (tier.perKm || 0);
}

// Fare already accrued when entering tiers[index] (B1-1).
function fareAtPreviousBoundary(tiers, index, longDistanceBase) {
  if (index === 0) return 0;
  const prev = tiers[index - 1];
  if (prev.flatFare !== undefined) return prev.flatFare;
  // B1-1: longDistanceBase stays an explicit override at perKm -> perKm
  // boundaries only — it preserves the bundled company_a night table's
  // hand-precomputed boundary fare (¥8910 at 25.9km).
  if (longDistanceBase) return longDistanceBase;
  // B1-1: otherwise accumulate by pricing the previous tier at its own upper
  // limit. The recursion matches a strictly lower tier index, so it terminates.
  return calcFromTiers(prev.upToKm, tiers, longDistanceBase);
}
