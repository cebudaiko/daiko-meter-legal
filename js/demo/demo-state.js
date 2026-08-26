import { calcTotalFare } from '../fare/calculator.js';
import { buildHistoryModel } from '../history/model.js';
import { operatingDayKey } from '../history/operating-day.js';
import { buildReceiptModel } from '../receipt/receipt-model.js';
import { buildChangeOptions } from '../settlement/change.js';

const OPTION_NAMES = new Set(['overtime', 'cancellation', 'insurance']);
const MAX_DISTANCE_KM = 10_000;
const MAX_LOW_SPEED_SEC = 7 * 24 * 60 * 60;
const MAX_WAIT_MINUTES = 7 * 24 * 60;
const MAX_RECORDS = 500;

function clampActionValue(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : null;
}

function pricedState(state, config) {
  const fare = calcTotalFare({
    distanceKm: state.distanceKm,
    waitMinutes: state.waitMinutes,
    lowSpeedSec: state.lowSpeedSec,
    companyId: state.companyId,
    isDaytime: state.isDaytime,
    options: state.options,
  }, config);
  return { ...state, ...fare, totalFare: fare.total };
}

function emptyHistory(config) {
  return buildHistoryModel([], {
    now: new Date('2026-01-01T18:00:00+09:00'),
    cutoff: config?.operatingDayCutoff,
  });
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finiteRange(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= minimum && value <= maximum;
}

function recordSequence(record) {
  if (typeof record?.id !== 'string') return null;
  const match = /^demo-([1-9][0-9]*)$/.exec(record.id);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function validatedLastRecordSequence(records) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) return null;
  let previous = null;
  for (const record of records) {
    const sequence = recordSequence(record);
    if (sequence === null || (previous !== null && sequence !== previous + 1)) return null;
    previous = sequence;
  }
  return previous === null ? 0 : previous;
}

function nextRecordSequence(records) {
  const previous = validatedLastRecordSequence(records);
  if (previous === null || previous === Number.MAX_SAFE_INTEGER) return null;
  return previous + 1;
}

function validatedOptions(options) {
  if (!plainObject(options)) return null;
  const keys = Object.keys(options);
  if (keys.some((key) => !OPTION_NAMES.has(key) || typeof options[key] !== 'boolean')) return null;
  return Object.fromEntries(keys.map((key) => [key, options[key]]));
}

function canonicalRecord(record, config) {
  if (!plainObject(record) || recordSequence(record) === null) return null;
  if (typeof record.companyId !== 'string'
    || !Object.hasOwn(config?.companies || {}, record.companyId)) return null;
  if (record.isDaytime !== undefined && typeof record.isDaytime !== 'boolean') return null;
  if (!finiteRange(record.distanceKm, 0, MAX_DISTANCE_KM)
    || !finiteRange(record.durationMs, 0, MAX_LOW_SPEED_SEC * 1000)
    || !finiteRange(record.waitMs, 0, MAX_WAIT_MINUTES * 60_000)) return null;
  const options = validatedOptions(record.options);
  if (!options) return null;
  const endedAtValue = record.endedAt ?? record.date;
  if (typeof endedAtValue !== 'string') return null;
  const endedAt = new Date(endedAtValue);
  if (!Number.isFinite(endedAt.getTime())) return null;
  const startedAtValue = record.startedAt ?? endedAtValue;
  if (typeof startedAtValue !== 'string') return null;
  const startedAt = new Date(startedAtValue);
  if (!Number.isFinite(startedAt.getTime())) return null;
  const isDaytime = record.isDaytime ?? false;
  const fare = calcTotalFare({
    distanceKm: record.distanceKm,
    waitMinutes: record.waitMs / 60_000,
    lowSpeedSec: record.durationMs / 1000,
    companyId: record.companyId,
    isDaytime,
    options,
  }, config);
  const endedAtIso = endedAt.toISOString();
  return {
    id: record.id,
    date: endedAtIso,
    startedAt: startedAt.toISOString(),
    endedAt: endedAtIso,
    operatingDay: operatingDayKey(endedAt, config?.operatingDayCutoff),
    operatingDayCutoff: config?.operatingDayCutoff || '14:00',
    companyId: record.companyId,
    companyName: fare.breakdown.companyName,
    isDaytime,
    totalFare: fare.total,
    baseFare: fare.baseFare,
    waitFee: fare.waitFee,
    timeFee: fare.timeFee,
    optionFee: fare.optionFee,
    distanceKm: record.distanceKm,
    durationMs: record.durationMs,
    waitMs: record.waitMs,
    options,
    fareSnapshot: { options: { ...(config?.options || {}) } },
  };
}

function canonicalRecords(records, config) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) return null;
  const canonical = records.map((record) => canonicalRecord(record, config));
  if (canonical.some((record) => !record)) return null;
  return validatedLastRecordSequence(canonical) === null ? null : canonical;
}

function historyForRecords(records, config) {
  if (!records.length) return emptyHistory(config);
  const last = records.at(-1);
  return buildHistoryModel(records, {
    selectedDay: last.operatingDay,
    now: new Date(last.endedAt),
    cutoff: config?.operatingDayCutoff,
  });
}

export function createDemoState(config) {
  const companyId = Object.keys(config?.companies || {})[0] || 'my_company';
  return {
    status: 'ready',
    companyId,
    isDaytime: false,
    distanceKm: 0,
    lowSpeedSec: 0,
    waitMinutes: 0,
    options: {},
    records: [],
    changeOptions: [],
    receipt: null,
    history: emptyHistory(config),
    totalFare: 0,
    baseFare: 0,
    waitFee: 0,
    timeFee: 0,
    optionFee: 0,
    breakdown: null,
  };
}

function startDemo(state, config) {
  return pricedState({
    ...state,
    status: 'running',
    distanceKm: 0,
    lowSpeedSec: 0,
    waitMinutes: 0,
    options: {},
    changeOptions: [],
    receipt: null,
  }, config);
}

function settleDemo(state, action, config) {
  if (state.status !== 'running') return state;
  const now = new Date(action.now);
  if (!Number.isFinite(now.getTime())) return state;
  const sequence = nextRecordSequence(state.records);
  if (sequence === null) return state;
  const endedAt = now.toISOString();
  const operatingDay = operatingDayKey(now, config?.operatingDayCutoff);
  const record = {
    id: `demo-${sequence}`,
    date: endedAt,
    startedAt: endedAt,
    endedAt,
    operatingDay,
    operatingDayCutoff: config?.operatingDayCutoff || '14:00',
    companyId: state.companyId,
    companyName: state.breakdown?.companyName || state.companyId,
    isDaytime: state.isDaytime,
    totalFare: state.totalFare,
    baseFare: state.baseFare,
    waitFee: state.waitFee,
    timeFee: state.timeFee,
    optionFee: state.optionFee,
    distanceKm: state.distanceKm,
    durationMs: state.lowSpeedSec * 1000,
    waitMs: state.waitMinutes * 60_000,
    options: { ...state.options },
    fareSnapshot: { options: { ...(config?.options || {}) } },
  };
  const records = [...state.records, record].slice(-MAX_RECORDS);
  return {
    ...state,
    status: 'settled',
    records,
    changeOptions: buildChangeOptions(state.totalFare),
    receipt: buildReceiptModel(record, {
      issuer: { name: 'じろちゃん Web体験版' },
      issuedAt: now,
    }),
    history: buildHistoryModel(records, {
      selectedDay: operatingDay,
      now,
      cutoff: config?.operatingDayCutoff,
    }),
  };
}

export function restoreDemoState(stored, config) {
  const initial = createDemoState(config);
  if (!plainObject(stored) || !['ready', 'running', 'settled'].includes(stored.status)) return initial;
  if (stored.status === 'ready') return initial;
  if (!Object.hasOwn(config?.companies || {}, stored.companyId)
    || typeof stored.isDaytime !== 'boolean'
    || !finiteRange(stored.distanceKm, 0, MAX_DISTANCE_KM)
    || !finiteRange(stored.lowSpeedSec, 0, MAX_LOW_SPEED_SEC)
    || !finiteRange(stored.waitMinutes, 0, MAX_WAIT_MINUTES)) return initial;
  const options = validatedOptions(stored.options);
  const records = canonicalRecords(stored.records, config);
  if (!options || !records) return initial;

  if (stored.status === 'running') {
    return pricedState({
      ...initial,
      status: 'running',
      companyId: stored.companyId,
      isDaytime: stored.isDaytime,
      distanceKm: stored.distanceKm,
      lowSpeedSec: stored.lowSpeedSec,
      waitMinutes: stored.waitMinutes,
      options,
      records,
      history: historyForRecords(records, config),
    }, config);
  }

  if (!records.length) return initial;
  const record = records.at(-1);
  const restored = pricedState({
    ...initial,
    status: 'settled',
    companyId: record.companyId,
    isDaytime: record.isDaytime,
    distanceKm: record.distanceKm,
    lowSpeedSec: record.durationMs / 1000,
    waitMinutes: record.waitMs / 60_000,
    options: record.options,
    records,
  }, config);
  return {
    ...restored,
    changeOptions: buildChangeOptions(restored.totalFare),
    receipt: buildReceiptModel(record, {
      issuer: { name: 'じろちゃん Web体験版' },
      issuedAt: new Date(record.endedAt),
    }),
    history: historyForRecords(records, config),
  };
}

export function advanceDemo(state, action, config) {
  switch (action?.type) {
    case 'start':
      return (state.status === 'ready' || state.status === 'settled')
        && nextRecordSequence(state.records) !== null
        ? startDemo(state, config)
        : state;
    case 'distance': {
      if (state.status !== 'running') return state;
      const km = clampActionValue(action.km, 0.1, 5);
      return km === null ? state : pricedState({ ...state, distanceKm: state.distanceKm + km }, config);
    }
    case 'low-speed': {
      if (state.status !== 'running') return state;
      const seconds = clampActionValue(action.seconds, 1, 600);
      return seconds === null ? state : pricedState({ ...state, lowSpeedSec: state.lowSpeedSec + seconds }, config);
    }
    case 'wait': {
      if (state.status !== 'running') return state;
      const seconds = clampActionValue(action.seconds, 1, 600);
      return seconds === null ? state : pricedState({ ...state, waitMinutes: state.waitMinutes + seconds / 60 }, config);
    }
    case 'option': {
      if (state.status !== 'running' || !OPTION_NAMES.has(action.name)) return state;
      return pricedState({
        ...state,
        options: { ...state.options, [action.name]: !state.options[action.name] },
      }, config);
    }
    case 'settle':
      return settleDemo(state, action, config);
    case 'reset':
      return createDemoState(config);
    default:
      return state;
  }
}
