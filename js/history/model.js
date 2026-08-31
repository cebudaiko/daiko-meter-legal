import { operatingDayKey, normalizeOperatingDayCutoff } from './operating-day.js';
import { summarizeRecords } from './stats.js';

export { summarizeRecords } from './stats.js';

export const UNCLASSIFIED_OPERATING_DAY = '__unclassified__';

function isValidOperatingDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function recordTime(record) {
  for (const value of [record?.endedAt, record?.date, record?.startedAt]) {
    if (value == null || value === '') continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return time;
  }
  return Number.NEGATIVE_INFINITY;
}

export function migrateRecord(record, { fallbackCutoff = '14:00' } = {}) {
  const source = record && typeof record === 'object' ? record : { legacyValue: record };
  const migrated = { ...source };
  let changed = source !== record;
  // null survives JSON.stringify; undefined would disappear and retrigger the
  // one-time migration on every load for a malformed legacy entry.
  const legacyDate = source.date ?? null;

  // Completed trips only need the number of accepted GPS samples. Older
  // versions stored every point, which could make a few records consume MBs.
  if (Array.isArray(source.gpsPoints)) {
    migrated.gpsPoints = source.gpsPoints.length;
    changed = true;
  }
  if (!Object.hasOwn(source, 'startedAt')) {
    migrated.startedAt = legacyDate;
    changed = true;
  }
  if (!Object.hasOwn(source, 'endedAt')) {
    migrated.endedAt = legacyDate;
    changed = true;
  }
  if (!Object.hasOwn(source, 'operatingDay')) {
    migrated.operatingDay = (source.date == null ? '' : operatingDayKey(source.date, fallbackCutoff))
      || UNCLASSIFIED_OPERATING_DAY;
    changed = true;
  } else if (source.operatingDay !== UNCLASSIFIED_OPERATING_DAY
    && !isValidOperatingDay(source.operatingDay)) {
    migrated.operatingDay = UNCLASSIFIED_OPERATING_DAY;
    changed = true;
  }
  if (!Object.hasOwn(source, 'operatingDayCutoff')) {
    migrated.operatingDayCutoff = normalizeOperatingDayCutoff(fallbackCutoff);
    changed = true;
  }

  return { record: changed ? migrated : record, changed };
}

function normalizedRecords(records, cutoff) {
  return (Array.isArray(records) ? records : [])
    .map((record) => migrateRecord(record, { fallbackCutoff: cutoff }).record);
}

export function recordsForOperatingDay(records, day, cutoff = '14:00') {
  return normalizedRecords(records, cutoff)
    .filter((record) => record.operatingDay === day)
    .sort((a, b) => recordTime(b) - recordTime(a));
}

export function buildHistoryModel(records, {
  selectedDay,
  now = new Date(),
  cutoff = '14:00',
} = {}) {
  const normalizedCutoff = normalizeOperatingDayCutoff(cutoff);
  const todayOperatingDay = operatingDayKey(now, normalizedCutoff);
  const activeDay = selectedDay || todayOperatingDay;
  const list = normalizedRecords(records, normalizedCutoff);
  const dayRecords = recordsForOperatingDay(list, activeDay, normalizedCutoff);
  const monthKey = String(activeDay || todayOperatingDay).slice(0, 7);
  const monthRecords = list.filter((record) => (
    record.operatingDay !== UNCLASSIFIED_OPERATING_DAY
    && record.operatingDay?.slice(0, 7) === monthKey
  ));
  const days = new Map();
  for (const record of monthRecords) {
    const group = days.get(record.operatingDay) || [];
    group.push(record);
    days.set(record.operatingDay, group);
  }
  const monthDays = [...days.entries()]
    .map(([operatingDay, grouped]) => ({
      operatingDay,
      ...summarizeRecords(grouped),
    }))
    .sort((a, b) => b.operatingDay.localeCompare(a.operatingDay));
  const unclassifiedRecords = list
    .filter((record) => record.operatingDay === UNCLASSIFIED_OPERATING_DAY)
    .sort((a, b) => recordTime(b) - recordTime(a));

  return {
    selectedDay: activeDay,
    todayOperatingDay,
    isToday: activeDay === todayOperatingDay,
    dayRecords,
    daySummary: summarizeRecords(dayRecords),
    monthSummary: summarizeRecords(monthRecords),
    monthDays,
    unclassifiedRecords,
    unclassifiedSummary: summarizeRecords(unclassifiedRecords),
  };
}
