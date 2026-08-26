const RECEIPT_ID_MAX = 12;
const MAX_YEN = Number.MAX_SAFE_INTEGER;
const FNV64_OFFSET = 14695981039346656037n;
const FNV64_PRIME = 1099511628211n;
const FNV64_MASK = (1n << 64n) - 1n;

function fnv1a64(value) {
  let hash = FNV64_OFFSET;
  for (const char of String(value ?? '')) {
    hash ^= BigInt(char.codePointAt(0));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).toUpperCase().padStart(16, '0').slice(0, RECEIPT_ID_MAX);
}

function validOperatingDay(operatingDay) {
  const value = String(operatingDay ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

function receiptDay(operatingDay) {
  const value = validOperatingDay(operatingDay);
  return value ? value.replaceAll('-', '') : '00000000';
}

export function receiptNumber(recordId, operatingDay) {
  const source = String(recordId ?? '');
  const ascii = source.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, RECEIPT_ID_MAX);
  const suffix = ascii || fnv1a64(source || 'legacy');
  return `JR-${receiptDay(operatingDay)}-${suffix}`;
}

function integerYen(value, { allowNegative = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const integer = Math.trunc(number);
  const minimum = allowNegative ? -MAX_YEN : 0;
  return Math.min(MAX_YEN, Math.max(minimum, integer));
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalize(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(value[key])]));
  }
  return null;
}

function legacyRecordKey(record) {
  const source = record && typeof record === 'object' ? record : {};
  const immutableContent = {
    date: source.date,
    companyId: source.companyId,
    companyName: source.companyName,
    company: source.company,
    carNumber: source.carNumber,
    isDaytime: source.isDaytime,
    isSpecialPeriod: source.isSpecialPeriod,
    totalFare: source.totalFare,
    baseFare: source.baseFare,
    daySurchargePercentFee: source.daySurchargePercentFee,
    daySurchargeFixedFee: source.daySurchargeFixedFee,
    daySurchargeFee: source.daySurchargeFee,
    winterSurchargePercentFee: source.winterSurchargePercentFee,
    winterSurchargeFixedFee: source.winterSurchargeFixedFee,
    winterSurchargeFee: source.winterSurchargeFee,
    isWinter: source.isWinter,
    waitFee: source.waitFee,
    timeFee: source.timeFee,
    optionFee: source.optionFee,
    distanceKm: source.distanceKm,
    durationMs: source.durationMs,
    waitMs: source.waitMs,
    options: source.options,
    fareConfigVersion: source.fareConfigVersion,
    fareSnapshot: source.fareSnapshot,
    gpsPoints: source.gpsPoints,
    companyCode: source.companyCode,
  };
  return fnv1a64(JSON.stringify(canonicalize(immutableContent)));
}

export function receiptRecordId(record = {}) {
  return text(record.id) || legacyRecordKey(record);
}

function issuedParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const values = Object.fromEntries(new Intl.DateTimeFormat('ja-JP-u-ca-gregory', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return values;
}

function formatIssuedDate(value) {
  const parts = issuedParts(value);
  return parts ? `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日` : '';
}

function formatIssuedDateTime(value) {
  const parts = issuedParts(value);
  return parts
    ? `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日 ${parts.hour}:${parts.minute}`
    : '';
}

function nonNegativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, number);
}

function formatDistance(value) {
  const rounded = Math.round(nonNegativeNumber(value) * 10) / 10;
  return `${rounded.toFixed(1)} km`;
}

function formatDuration(value) {
  const totalSeconds = Math.floor(nonNegativeNumber(value) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function legacyReceiptDay(record) {
  const match = String(record?.date ?? '').match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  return match ? validOperatingDay(match[1]) : '';
}

function copyIssuer(issuer) {
  const source = issuer && typeof issuer === 'object' ? issuer : {};
  return Object.fromEntries([
    ['name', text(source.name)],
    ['registrationNumber', text(source.registrationNumber)],
    ['address', text(source.address)],
    ['phone', text(source.phone)],
  ].filter(([, value]) => value));
}

export function buildOptionDetails(record) {
  const selected = record?.options && typeof record.options === 'object' ? record.options : {};
  const stored = record?.fareSnapshot?.options && typeof record.fareSnapshot.options === 'object'
    ? record.fareSnapshot.options
    : {};
  const details = [];
  const booleanOptions = [
    ['overtime', 'overtimeFee', '時間外'],
    ['cancellation', 'cancellationFee', 'キャンセル'],
    ['insurance', 'insuranceFee', '保険'],
    ['snowRemoval', 'snowRemovalFee', '雪かき'],
    ['chainService', 'chainServiceFee', 'チェーン脱着'],
  ];
  for (const [selectedKey, amountKey, label] of booleanOptions) {
    if (selected[selectedKey]) details.push({ label, amount: integerYen(stored[amountKey]) });
  }
  if (integerYen(selected.surcharge) > 0) {
    details.push({ label: 'サーチャージ', amount: integerYen(selected.surcharge) });
  }
  if (integerYen(selected.discount) > 0) {
    details.push({ label: '割引・クーポン', amount: -integerYen(selected.discount) });
  }
  return details;
}

export function buildReceiptModel(record = {}, { issuer = {}, addressee, issuedAt } = {}) {
  const recordId = receiptRecordId(record);
  const numberDay = text(record.id) ? record.operatingDay : legacyReceiptDay(record);
  const resolvedAddressee = addressee === undefined ? record.receiptAddressee : addressee;
  const issueSource = issuedAt === undefined ? (record.endedAt || record.date) : issuedAt;
  return {
    recordId,
    receiptNumber: receiptNumber(recordId, numberDay),
    operatingDay: validOperatingDay(record.operatingDay),
    issuedDate: formatIssuedDate(issueSource),
    issuedDateTime: formatIssuedDateTime(issueSource),
    distanceText: formatDistance(record.distanceKm),
    serviceDurationText: formatDuration(record.durationMs),
    waitDurationText: formatDuration(record.waitMs),
    addressee: text(resolvedAddressee),
    issuer: copyIssuer(issuer),
    note: text(issuer?.defaultNote),
    companyName: text(record.companyName || record.company),
    carNumber: text(record.carNumber),
    totalFare: integerYen(record.totalFare),
    baseFare: integerYen(record.baseFare),
    daySurchargePercentFee: integerYen(record.daySurchargePercentFee),
    daySurchargeFixedFee: integerYen(record.daySurchargeFixedFee),
    daySurchargeFee: integerYen(record.daySurchargeFee),
    winterSurchargePercentFee: integerYen(record.winterSurchargePercentFee),
    winterSurchargeFixedFee: integerYen(record.winterSurchargeFixedFee),
    winterSurchargeFee: integerYen(record.winterSurchargeFee),
    timeFee: integerYen(record.timeFee),
    waitFee: integerYen(record.waitFee),
    optionFee: integerYen(record.optionFee, { allowNegative: true }),
    optionDetails: buildOptionDetails(record),
  };
}
