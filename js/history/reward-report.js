import { summarizeRecords } from './stats.js';
import { calculateRewardBreakdown, taxExclusiveYen } from '../rewards/calculator.js';
import {
  normalizeReportTaxRatePercent,
  rewardProfileFingerprint,
  snapshotRewardProfile,
} from '../rewards/profile.js';

const EMPTY_SALES = Object.freeze({
  count: 0,
  totalFare: 0,
  totalDistance: 0,
  totalDuration: 0,
  totalWait: 0,
});

function exactOperatingDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day ? value : null;
}

function finiteNumber(value) {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  } catch {
    return 0;
  }
}

function finiteNonNegative(value) {
  return Math.max(0, finiteNumber(value));
}

function stableString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeTimestamp(value) {
  try {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

function resolveNow(value) {
  try {
    const timestamp = new Date(value ?? Date.now()).getTime();
    return Number.isFinite(timestamp) ? timestamp : Date.now();
  } catch {
    return Date.now();
  }
}

function snapshotGroup(row) {
  try {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const profileId = stableString(row.profileId);
    if (!profileId || !row.profileSnapshot || typeof row.profileSnapshot !== 'object'
      || Array.isArray(row.profileSnapshot)) return null;
    const profileSnapshot = snapshotRewardProfile({ ...row.profileSnapshot, id: profileId });
    const fingerprint = rewardProfileFingerprint(profileSnapshot);
    return { profileId, profileSnapshot, fingerprint, key: `${profileId}\u0000${fingerprint}` };
  } catch {
    return null;
  }
}

function emptyReport(displayTaxRatePercent) {
  return {
    range: { startDay: null, endDay: null },
    displayTaxRatePercent,
    sales: { ...EMPTY_SALES },
    displayNetSalesYen: 0,
    profiles: [],
    rewardTotalYen: 0,
    unassignedTripCount: 0,
    hasProvisionalAttendance: false,
  };
}

function inRange(row, startDay, endDay) {
  const day = exactOperatingDay(row?.operatingDay);
  return day !== null && day >= startDay && day <= endDay;
}

function uniqueRecords(records, startDay, endDay) {
  const seenIds = new Set();
  const filtered = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || !inRange(record, startDay, endDay)) continue;
    const id = stableString(record.id);
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    filtered.push({
      ...record,
      totalFare: finiteNumber(record.totalFare),
      distanceKm: finiteNumber(record.distanceKm),
      durationMs: finiteNumber(record.durationMs),
      waitMs: finiteNumber(record.waitMs),
    });
  }
  return filtered;
}

function addGroup(groups, group) {
  let target = groups.get(group.key);
  if (!target) {
    target = {
      profileId: group.profileId,
      profileSnapshot: group.profileSnapshot,
      fingerprint: group.fingerprint,
      grossSalesYen: 0,
      tripCount: 0,
      workedMinutes: 0,
      breakMinutes: 0,
      paidMinutes: 0,
      completedShiftCount: 0,
      provisional: false,
    };
    groups.set(group.key, target);
  }
  return target;
}

function addCompletedAttendance(target, row, now) {
  const start = safeTimestamp(row.clockInAt);
  const end = safeTimestamp(row.clockOutAt);
  if (start === null || end === null || end < start || start > now || end > now) return;
  const workedMinutes = (end - start) / 60_000;
  const breakMinutes = Math.min(workedMinutes, finiteNonNegative(row.breakMinutes));
  target.workedMinutes += workedMinutes;
  target.breakMinutes += breakMinutes;
  target.paidMinutes += workedMinutes - breakMinutes;
  target.completedShiftCount += 1;
}

function addActiveAttendance(target, row, now) {
  const start = safeTimestamp(row.clockInAt);
  target.provisional = true;
  if (start === null || start > now) return;
  const workedMinutes = (now - start) / 60_000;
  const breakMinutes = Math.min(workedMinutes, finiteNonNegative(row.breakMinutes));
  target.workedMinutes += workedMinutes;
  target.breakMinutes += breakMinutes;
  target.paidMinutes += workedMinutes - breakMinutes;
}

export function buildRewardReport(input = {}) {
  const displayTaxRatePercent = normalizeReportTaxRatePercent(input?.displayTaxRatePercent);
  const startDay = exactOperatingDay(input?.startDay);
  const endDay = exactOperatingDay(input?.endDay);
  if (!startDay || !endDay || startDay > endDay) return emptyReport(displayTaxRatePercent);

  const records = uniqueRecords(input?.records, startDay, endDay);
  const sales = summarizeRecords(records);
  const groups = new Map();
  let unassignedTripCount = 0;

  for (const record of records) {
    const seenProfileIds = new Set();
    let assigned = false;
    for (const assignment of Array.isArray(record.rewardAssignments) ? record.rewardAssignments : []) {
      const group = snapshotGroup(assignment);
      if (!group || seenProfileIds.has(group.profileId)) continue;
      seenProfileIds.add(group.profileId);
      const target = addGroup(groups, group);
      target.grossSalesYen += finiteNonNegative(record.totalFare);
      target.tripCount += 1;
      assigned = true;
    }
    if (!assigned) unassignedTripCount += 1;
  }

  const now = resolveNow(input?.now);
  const completedAttendanceIds = new Set();
  for (const row of Array.isArray(input?.attendanceRecords) ? input.attendanceRecords : []) {
    if (!inRange(row, startDay, endDay)) continue;
    const attendanceId = stableString(row?.id);
    if (attendanceId && completedAttendanceIds.has(attendanceId)) continue;
    if (attendanceId) completedAttendanceIds.add(attendanceId);
    const group = snapshotGroup(row);
    if (group) addCompletedAttendance(addGroup(groups, group), row, now);
  }
  const activeAttendanceIds = new Set();
  for (const row of Array.isArray(input?.activeAttendances) ? input.activeAttendances : []) {
    if (!inRange(row, startDay, endDay)) continue;
    const attendanceId = stableString(row?.id);
    if (attendanceId && (completedAttendanceIds.has(attendanceId)
      || activeAttendanceIds.has(attendanceId))) continue;
    if (attendanceId) activeAttendanceIds.add(attendanceId);
    const group = snapshotGroup(row);
    if (group) addActiveAttendance(addGroup(groups, group), row, now);
  }

  const selectedProfileId = stableString(input?.profileId);
  const profiles = [...groups.values()]
    .filter((group) => !selectedProfileId || group.profileId === selectedProfileId)
    .map((group) => ({
      profileId: group.profileId,
      profileSnapshot: group.profileSnapshot,
      profileFingerprint: group.fingerprint,
      tripCount: group.tripCount,
      workedMinutes: group.workedMinutes,
      breakMinutes: group.breakMinutes,
      paidMinutes: group.paidMinutes,
      completedShiftCount: group.completedShiftCount,
      provisional: group.provisional,
      ...calculateRewardBreakdown({
        profile: group.profileSnapshot,
        grossSalesYen: group.grossSalesYen,
        tripCount: group.tripCount,
        paidMinutes: group.paidMinutes,
        completedShiftCount: group.completedShiftCount,
      }),
    }));

  return {
    range: { startDay, endDay },
    displayTaxRatePercent,
    sales,
    displayNetSalesYen: taxExclusiveYen(sales.totalFare, displayTaxRatePercent, {
      roundingMode: 'floor', roundingUnitYen: 1,
    }),
    profiles,
    rewardTotalYen: profiles.reduce((total, row) => total + row.totalRewardYen, 0),
    unassignedTripCount,
    hasProvisionalAttendance: [...groups.values()].some((group) => group.provisional),
  };
}
