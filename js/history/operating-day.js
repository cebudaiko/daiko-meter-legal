export function normalizeOperatingDayCutoff(value, fallback = '14:00') {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ''));
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? `${match[1]}:${match[2]}` : fallback;
}

export function operatingDayKey(value, cutoff = '14:00') {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const [hour, minute] = normalizeOperatingDayCutoff(cutoff).split(':').map(Number);
  const shifted = new Date(date.getTime() - (hour * 60 + minute) * 60_000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function operatingMonthKey(value, cutoff = '14:00') {
  return operatingDayKey(value, cutoff).slice(0, 7);
}
