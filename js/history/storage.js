import { migrateRecord, UNCLASSIFIED_OPERATING_DAY } from './model.js';

const STORAGE_KEY = 'daiko-meter-records';
// B2-2: 100 records silently deleted a driver's earnings after ~2-3 weeks of nightly
// use. 3000 (~300 bytes/record ≈ 1MB) keeps years of history. New starts stop at
// the cap; completed trips and existing earnings are never silently discarded.
export const MAX_RECORDS = 3000;
export const HISTORY_WARNING_AT = 2900;
let lastLoadStatus = { migrationFailed: false };

export function getHistoryStorageStatus() {
  return { ...lastLoadStatus };
}

function currentMigrationCutoff() {
  try {
    const config = JSON.parse(localStorage.getItem('meter_local_config') || '{}');
    return config?.operatingDayCutoff || '14:00';
  } catch {
    return '14:00';
  }
}

export function storageKey() {
  const code = localStorage.getItem('daiko-meter-company-code') || 'legacy';
  return `${STORAGE_KEY}:${code}`;
}

export function loadRawRecords() {
  try {
    const data = localStorage.getItem(storageKey());
    const parsed = data ? JSON.parse(data) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readRawRecordsText() {
  return localStorage.getItem(storageKey());
}

export function loadRawRecordsForBackup() {
  const raw = readRawRecordsText();
  return raw === null ? [] : JSON.parse(raw);
}

export function restoreRawRecords(raw) {
  if (raw === null) localStorage.removeItem(storageKey());
  else localStorage.setItem(storageKey(), raw);
}

export function loadRecords({ fallbackCutoff = currentMigrationCutoff() } = {}) {
  const parsed = loadRawRecords();

  // Lazy import is unnecessary here: model depends only on operating-day/stats and
  // storage owns the one-time persistence boundary for legacy classification.
  return migrateAndPersist(parsed, fallbackCutoff);
}

function migrateAndPersist(records, fallbackCutoff) {
  let changed = false;
  const migrated = records.map((source) => {
    const result = migrateRecord(source, { fallbackCutoff });
    changed ||= result.changed;
    return result.record;
  });
  if (changed) {
    try {
      writeRecords(migrated);
    } catch (error) {
      console.error('[history] 旧履歴の移行保存に失敗しました:', error);
      lastLoadStatus = { migrationFailed: true };
      return records.map((source, index) => {
        const migratedDay = migrated[index]?.operatingDay;
        const durableDay = source && typeof source === 'object' ? source.operatingDay : undefined;
        if (durableDay === migratedDay) return source;
        const record = source && typeof source === 'object' ? source : { legacyValue: source };
        return { ...record, operatingDay: UNCLASSIFIED_OPERATING_DAY };
      });
    }
  }
  lastLoadStatus = { migrationFailed: false };
  return migrated;
}

export function writeRecords(records) {
  localStorage.setItem(storageKey(), JSON.stringify(records));
}

export function removeRecords() {
  localStorage.removeItem(storageKey());
}
