export const LOW_SPEED_THRESHOLD_MIN_KMH = 0;
export const LOW_SPEED_THRESHOLD_MAX_KMH = 20;
export const DEFAULT_LOW_SPEED_THRESHOLD_KMH = 5;

function parseThreshold(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

export function normalizeLowSpeedThresholdKmh(
  value,
  fallback = DEFAULT_LOW_SPEED_THRESHOLD_KMH,
) {
  const number = parseThreshold(value);
  if (Number.isFinite(number)
      && number >= LOW_SPEED_THRESHOLD_MIN_KMH
      && number <= LOW_SPEED_THRESHOLD_MAX_KMH) {
    return number;
  }
  const safeFallback = parseThreshold(fallback);
  return Number.isFinite(safeFallback)
      && safeFallback >= LOW_SPEED_THRESHOLD_MIN_KMH
      && safeFallback <= LOW_SPEED_THRESHOLD_MAX_KMH
    ? safeFallback
    : DEFAULT_LOW_SPEED_THRESHOLD_KMH;
}
