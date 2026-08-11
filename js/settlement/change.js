const CANDIDATE_BILLS = [1000, 2000, 3000, 5000, 10000];
const MAX_YEN = Number.MAX_SAFE_INTEGER;

function normalizeYen(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_YEN) return null;
  return Math.floor(number);
}

export function calculateChange(fareYen, tenderedYen) {
  const fare = normalizeYen(fareYen);
  const tendered = normalizeYen(tenderedYen);
  if (fare === null || tendered === null || tendered < fare) {
    return { ok: false, changeYen: 0 };
  }
  return { ok: true, changeYen: tendered - fare };
}

export function buildChangeOptions(fareYen) {
  const fare = normalizeYen(fareYen);
  if (fare === null) return [];
  return [...new Set(CANDIDATE_BILLS)]
    .filter((tenderedYen) => tenderedYen > fare)
    .sort((a, b) => a - b)
    .map((tenderedYen) => ({ tenderedYen, changeYen: tenderedYen - fare }));
}
