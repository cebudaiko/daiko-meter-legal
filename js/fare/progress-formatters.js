export function formatMeters(meters) {
  if (meters <= 0) return 'まもなく';
  if (meters < 1000) return `あと ${Math.ceil(meters / 10) * 10}m`;
  return `あと ${(meters / 1000).toFixed(1)}km`;
}

export function formatSeconds(totalSec) {
  const sec = Math.max(0, Math.ceil(totalSec));
  if (sec <= 1) return 'まもなく';
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  if (min <= 0) return `あと ${rest}秒`;
  if (rest === 0) return `あと ${min}分`;
  return `あと ${min}分${rest.toString().padStart(2, '0')}秒`;
}
