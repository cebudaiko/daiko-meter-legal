import { sanitizeConfig } from '../storage/local-config.js';

const FIELD_NAMES = [
  'companyName', 'nightRows', 'dayRows', 'timeFare', 'waitFare', 'dayHours',
];

const SUPPORTED_VALUE_KEYS = new Set(FIELD_NAMES);
const ROOT_KEYS = new Set(['values', 'fields', 'issues']);
const TIME_FARE_KEYS = new Set(['enabled', 'speedThresholdKmh', 'intervalSec', 'feePerInterval']);
const WAIT_FARE_KEYS = new Set(['initialMinutes', 'initialFee', 'additionalInterval', 'additionalFee']);
const DAY_HOURS_KEYS = new Set(['start', 'end']);
const TIER_ROW_KEYS = new Set(['upToKm', 'kind', 'amount']);
const FIELD_METADATA_KEYS = new Set(['confidence', 'sourceText', 'selected']);
const ISSUE_KEYS = new Set(['code', 'message', 'field', 'sourceText', 'severity']);
const BLOCKING_PARSER_ISSUES = new Set([
  'AMBIGUOUS_COMPANY_NAME',
  'AMBIGUOUS_RATE_ROW',
  'UNASSIGNED_RATE_ROW',
  'UNRESOLVED_RATE_HEADING',
  'UNSUPPORTED_RATE_TEXT',
  'CONFLICTING_TIME_FARE',
  'CONFLICTING_WAIT_FARE',
  'CONFLICTING_DAY_HOURS',
]);

function emptyField() {
  return { confidence: 0, sourceText: '', selected: false };
}

export function emptyRateCandidate() {
  return {
    values: {
      companyName: '',
      nightRows: [],
      dayRows: [],
      timeFare: {
        enabled: false,
        speedThresholdKmh: '',
        intervalSec: '',
        feePerInterval: '',
      },
      waitFare: {
        initialMinutes: '',
        initialFee: '',
        additionalInterval: '',
        additionalFee: '',
      },
      dayHours: { start: '', end: '' },
    },
    fields: Object.fromEntries(FIELD_NAMES.map((name) => [name, emptyField()])),
    issues: [],
  };
}

export function isApplicableRateCandidateField(candidate, field) {
  if (!SUPPORTED_VALUE_KEYS.has(field)) return false;
  const value = candidate?.values?.[field];
  if (field === 'companyName') return typeof value === 'string' && value.trim() !== '';
  if (field === 'nightRows' || field === 'dayRows') return Array.isArray(value) && value.length > 0;
  if (field === 'timeFare') {
    return ['speedThresholdKmh', 'intervalSec', 'feePerInterval']
      .every((key) => value?.[key] !== '' && value?.[key] != null);
  }
  if (field === 'waitFare') {
    return [...WAIT_FARE_KEYS].every((key) => value?.[key] !== '' && value?.[key] != null);
  }
  return [...DAY_HOURS_KEYS].every((key) => value?.[key] !== '' && value?.[key] != null);
}

function issue(code, message, field, severity = 'error') {
  return { code, message, ...(field ? { field } : {}), severity };
}

function addIssue(issues, next) {
  const duplicate = issues.some((current) => (
    current.code === next.code
    && current.field === next.field
    && current.sourceText === next.sourceText
  ));
  if (!duplicate) issues.push(next);
}

function finiteNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function candidateRowsToTiers(rows) {
  return rows.map((row) => ({
    upToKm: row.upToKm === '' ? null : Number(row.upToKm),
    ...(row.kind === 'perKm'
      ? { perKm: Number(row.amount) }
      : { flatFare: Number(row.amount) }),
  }));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidSchema(issues, field) {
  addIssue(issues, issue(
    'INVALID_CANDIDATE_SCHEMA',
    '料金候補の形式または型が不正です。要確認です。',
    field,
  ));
}

function exactObject(value, allowed, issues, field) {
  if (!plainObject(value)) {
    invalidSchema(issues, field);
    return false;
  }
  let valid = true;
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!allowed.has(key)) {
      addIssue(issues, issue(
        'UNSUPPORTED_CANDIDATE_KEY',
        `「${key}」は写真取り込み対象外の料金項目です。`,
        field || key,
      ));
      valid = false;
    }
  }
  if (keys.length !== allowed.size || [...allowed].some((key) => !Object.hasOwn(value, key))) {
    valid = false;
  }
  if (!valid) invalidSchema(issues, field);
  return valid;
}

function issueShapeValid(entry) {
  if (!plainObject(entry)) return false;
  const keys = Object.keys(entry);
  if (keys.some((key) => !ISSUE_KEYS.has(key))) return false;
  if (typeof entry.code !== 'string' || typeof entry.message !== 'string') return false;
  if (!['error', 'warning'].includes(entry.severity)) return false;
  if (Object.hasOwn(entry, 'field') && typeof entry.field !== 'string') return false;
  if (Object.hasOwn(entry, 'sourceText') && typeof entry.sourceText !== 'string') return false;
  return ['code', 'message', 'severity'].every((key) => Object.hasOwn(entry, key));
}

function copyValidIssues(candidate) {
  if (!Array.isArray(candidate?.issues)) return [];
  return candidate.issues.filter(issueShapeValid).map((entry) => ({ ...entry }));
}

function validateCandidateSchema(candidate, issues) {
  let valid = exactObject(candidate, ROOT_KEYS, issues, 'candidate');
  if (!plainObject(candidate)) return false;

  const valuesValid = exactObject(candidate.values, SUPPORTED_VALUE_KEYS, issues, 'values');
  if (plainObject(candidate.values)) {
    const values = candidate.values;
    if (typeof values.companyName !== 'string') {
      invalidSchema(issues, 'companyName');
      valid = false;
    }
    for (const name of ['nightRows', 'dayRows']) {
      if (!Array.isArray(values[name])) {
        invalidSchema(issues, name);
        valid = false;
        continue;
      }
      for (const row of values[name]) {
        const rowValid = exactObject(row, TIER_ROW_KEYS, issues, name);
        if (
          !rowValid
          || typeof row.upToKm !== 'string'
          || typeof row.amount !== 'string'
          || !['flat', 'perKm'].includes(row.kind)
        ) {
          invalidSchema(issues, name);
          valid = false;
        }
      }
    }

    const timeValid = exactObject(values.timeFare, TIME_FARE_KEYS, issues, 'timeFare');
    if (
      !timeValid
      || typeof values.timeFare.enabled !== 'boolean'
      || ['speedThresholdKmh', 'intervalSec', 'feePerInterval']
        .some((key) => typeof values.timeFare[key] !== 'string')
    ) {
      invalidSchema(issues, 'timeFare');
      valid = false;
    }

    const waitValid = exactObject(values.waitFare, WAIT_FARE_KEYS, issues, 'waitFare');
    if (
      !waitValid
      || [...WAIT_FARE_KEYS].some((key) => typeof values.waitFare[key] !== 'string')
    ) {
      invalidSchema(issues, 'waitFare');
      valid = false;
    }

    const hoursValid = exactObject(values.dayHours, DAY_HOURS_KEYS, issues, 'dayHours');
    if (
      !hoursValid
      || [...DAY_HOURS_KEYS].some((key) => typeof values.dayHours[key] !== 'string')
    ) {
      invalidSchema(issues, 'dayHours');
      valid = false;
    }
  }
  if (!valuesValid) valid = false;

  const fieldsValid = exactObject(candidate.fields, new Set(FIELD_NAMES), issues, 'fields');
  if (plainObject(candidate.fields)) {
    for (const name of FIELD_NAMES) {
      const metadata = candidate.fields[name];
      const metadataValid = exactObject(metadata, FIELD_METADATA_KEYS, issues, name);
      if (
        !metadataValid
        || typeof metadata.confidence !== 'number'
        || !Number.isFinite(metadata.confidence)
        || metadata.confidence < 0
        || metadata.confidence > 100
        || typeof metadata.sourceText !== 'string'
        || typeof metadata.selected !== 'boolean'
      ) {
        invalidSchema(issues, name);
        valid = false;
      }
    }
  }
  if (!fieldsValid) valid = false;

  if (!Array.isArray(candidate.issues)) {
    invalidSchema(issues, 'issues');
    valid = false;
  } else if (candidate.issues.some((entry) => !issueShapeValid(entry))) {
    invalidSchema(issues, 'issues');
    valid = false;
  }

  return valid;
}

function sanitizedCompany({ tiers, timeFare, dayHours }) {
  const safeTiers = tiers ?? [{ upToKm: null, perKm: 1 }];
  const config = sanitizeConfig({
    companies: {
      candidate: {
        name: 'candidate',
        night: { tiers: safeTiers, ...(timeFare ? { timeFare } : {}) },
        day: { tiers: safeTiers },
        dayStart: dayHours?.start ?? 7,
        dayEnd: dayHours?.end ?? 18,
      },
    },
  });
  return config.companies.candidate;
}

function validateRows(name, rows, issues) {
  if (!Array.isArray(rows)) {
    addIssue(issues, issue('INVALID_TIER_TABLE', '料金段階が配列ではありません。要確認です。', name));
    return;
  }
  if (rows.length === 0) return;

  let previousBoundary = 0;
  let terminalCount = 0;
  let terminalSeen = false;
  let shapeValid = true;

  for (const row of rows) {
    if (!row || typeof row !== 'object' || !['flat', 'perKm'].includes(row.kind)) {
      addIssue(issues, issue('INVALID_TIER_ROW', '料金段階の形式が不正です。要確認です。', name));
      shapeValid = false;
      continue;
    }

    const amount = finiteNumber(row.amount);
    if (amount === null || amount <= 0) {
      addIssue(issues, issue('INVALID_NUMBER', '料金は有限かつ0円より大きい値にしてください。', name));
      shapeValid = false;
    }

    if (row.upToKm === '') {
      terminalCount += 1;
      terminalSeen = true;
      continue;
    }

    const boundary = finiteNumber(row.upToKm);
    if (boundary === null || boundary <= 0) {
      addIssue(issues, issue('INVALID_NUMBER', '距離境界は有限かつ0kmより大きい値にしてください。', name));
      shapeValid = false;
    } else if (terminalSeen || boundary <= previousBoundary) {
      addIssue(issues, issue('INVALID_TIER_ORDER', '距離境界は上限なしの段より前に昇順で並べてください。', name));
      shapeValid = false;
    } else {
      previousBoundary = boundary;
    }
  }

  if (terminalCount > 1) {
    addIssue(issues, issue('MULTIPLE_TERMINAL_TIERS', '上限なしの料金段階は1つだけにしてください。', name));
    shapeValid = false;
  }

  if (!shapeValid) return;
  const tiers = candidateRowsToTiers(rows);
  const productionTiers = sanitizedCompany({ tiers }).night.tiers;
  if (!sameJson(productionTiers, tiers)) {
    addIssue(issues, issue(
      'PRODUCTION_RATE_RULE_MISMATCH',
      '料金段階がメーター本体の検証規則に適合しません。要確認です。',
      name,
    ));
  }
}

function validateTimeFare(timeFare, issues) {
  const hasValue = timeFare?.enabled
    || ['speedThresholdKmh', 'intervalSec', 'feePerInterval']
      .some((key) => timeFare?.[key] !== '' && timeFare?.[key] != null);
  if (!hasValue) return;

  const speedThresholdKmh = finiteNumber(timeFare?.speedThresholdKmh);
  const intervalSec = finiteNumber(timeFare?.intervalSec);
  const feePerInterval = finiteNumber(timeFare?.feePerInterval);
  if (
    speedThresholdKmh === null || speedThresholdKmh < 0 || speedThresholdKmh > 20
    || intervalSec === null || intervalSec <= 0
    || feePerInterval === null || feePerInterval < 0
  ) {
    addIssue(issues, issue(
      'INVALID_TIME_FARE',
      '低速時間料金は速度0〜20km/h、正の秒間隔、0円以上の料金にしてください。',
      'timeFare',
    ));
    return;
  }

  const normalized = {
    enabled: !!timeFare.enabled,
    speedThresholdKmh,
    intervalSec,
    feePerInterval,
  };
  const production = sanitizedCompany({ timeFare: normalized }).night.timeFare;
  if (!sameJson(production, normalized)) {
    addIssue(issues, issue(
      'PRODUCTION_RATE_RULE_MISMATCH',
      '低速時間料金がメーター本体の検証規則に適合しません。要確認です。',
      'timeFare',
    ));
  }
}

function validateWaitFare(waitFare, issues) {
  const keys = ['initialMinutes', 'initialFee', 'additionalInterval', 'additionalFee'];
  if (!keys.some((key) => waitFare?.[key] !== '' && waitFare?.[key] != null)) return;
  const numbers = Object.fromEntries(keys.map((key) => [key, finiteNumber(waitFare?.[key])]));
  if (
    numbers.initialMinutes === null || numbers.initialMinutes < 0
    || numbers.initialFee === null || numbers.initialFee < 0
    || numbers.additionalInterval === null || numbers.additionalInterval <= 0
    || numbers.additionalFee === null || numbers.additionalFee < 0
  ) {
    addIssue(issues, issue(
      'INVALID_NUMBER',
      '待機料金は有限の0以上、追加間隔は0分より大きい値にしてください。',
      'waitFare',
    ));
    return;
  }

  const production = sanitizeConfig({ waitParams: numbers }).waitParams;
  if (!sameJson(production, numbers)) {
    addIssue(issues, issue(
      'PRODUCTION_RATE_RULE_MISMATCH',
      '待機料金がメーター本体の検証規則に適合しません。要確認です。',
      'waitFare',
    ));
  }
}

function validateDayHours(dayHours, issues) {
  if (!dayHours || (dayHours.start === '' && dayHours.end === '')) return;
  const start = finiteNumber(dayHours.start);
  const end = finiteNumber(dayHours.end);
  if (start === null || end === null || start < 0 || start >= 24 || end <= 0 || end > 24) {
    addIssue(issues, issue(
      'INVALID_DAY_HOURS',
      '日中時間は0時以上24時以下の有限値で指定してください。',
      'dayHours',
    ));
    return;
  }
  const production = sanitizedCompany({ dayHours: { start, end } });
  if (production.dayStart !== start || production.dayEnd !== end) {
    addIssue(issues, issue(
      'PRODUCTION_RATE_RULE_MISMATCH',
      '日中時間がメーター本体の検証規則に適合しません。要確認です。',
      'dayHours',
    ));
  }
}

export function validateRateCandidate(candidate) {
  const issues = copyValidIssues(candidate);
  if (!validateCandidateSchema(candidate, issues)) {
    return { valid: false, issues };
  }
  const { values } = candidate;

  validateRows('nightRows', values.nightRows, issues);
  validateRows('dayRows', values.dayRows, issues);
  validateTimeFare(values.timeFare, issues);
  validateWaitFare(values.waitFare, issues);
  validateDayHours(values.dayHours, issues);

  return {
    valid: !issues.some((entry) => (
      entry.severity !== 'warning' || BLOCKING_PARSER_ISSUES.has(entry.code)
    )),
    issues,
  };
}
