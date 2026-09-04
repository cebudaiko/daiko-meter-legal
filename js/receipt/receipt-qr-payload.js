const PREFIX = 'r1.';
const MAX_COMPRESSED_BYTES = 4_096;
const MAX_BASE64URL_CHARS = Math.ceil((MAX_COMPRESSED_BYTES * 8) / 6);
export const MAX_RECEIPT_QR_DECOMPRESSED_BYTES = 16_384;
const MAX_OPTIONS = 20;
const FNV64_OFFSET = 14695981039346656037n;
const FNV64_PRIME = 1099511628211n;
const FNV64_MASK = (1n << 64n) - 1n;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

const PUBLIC_KEYS = ['v', 'n', 'at', 'total', 'fees', 'options', 'note', 'issuer'];
const FEE_KEYS = ['base', 'day', 'winter', 'time', 'wait', 'option'];
const ISSUER_KEYS = ['name', 'registrationNumber', 'address', 'phone'];
const OPTION_KEYS = ['label', 'amount'];

export class ReceiptQrPayloadError extends Error {
  constructor(message = '領収証QRデータが不正です') {
    super(message);
    this.name = 'ReceiptQrPayloadError';
  }
}

function payloadError(message) {
  return new ReceiptQrPayloadError(message);
}

function hasOnlyKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).every((key) => keys.includes(key))
    && keys.every((key) => Object.hasOwn(value, key));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function requiredString(value, maxCodePoints, name) {
  if (typeof value !== 'string') throw payloadError(`${name} must be text`);
  if ([...value].length > maxCodePoints) throw payloadError(`${name} is too long`);
  return value;
}

function sourceString(value, maxCodePoints, name) {
  return requiredString(value ?? '', maxCodePoints, name);
}

function yen(value, { allowNegative = false, defaultValue = 0, name = 'amount' } = {}) {
  const candidate = value ?? defaultValue;
  if (!Number.isSafeInteger(candidate) || (!allowNegative && candidate < 0)) {
    throw payloadError(`${name} must be a valid yen amount`);
  }
  return candidate;
}

function publicOptions(value) {
  const source = value ?? [];
  if (!Array.isArray(source)) throw payloadError('options must be an array');
  if (source.length > MAX_OPTIONS) throw payloadError('too many options');
  return source.map((option, index) => {
    if (!isPlainObject(option)) throw payloadError(`option ${index} must be an object`);
    return {
      label: sourceString(option.label, 160, `option ${index} label`),
      amount: yen(option.amount, { allowNegative: true, name: `option ${index} amount` }),
    };
  });
}

function publicIssuer(value) {
  const source = value ?? {};
  if (!isPlainObject(source)) throw payloadError('issuer must be an object');
  return {
    name: sourceString(source.name, 160, 'issuer name'),
    registrationNumber: sourceString(source.registrationNumber, 64, 'issuer registration number'),
    address: sourceString(source.address, 512, 'issuer address'),
    phone: sourceString(source.phone, 64, 'issuer phone'),
  };
}

function validatedPublicReceipt(value) {
  if (!hasOnlyKeys(value, PUBLIC_KEYS)) throw payloadError('unknown public receipt fields');
  if (value.v !== 1) throw payloadError('unsupported receipt version');
  if (!hasOnlyKeys(value.fees, FEE_KEYS)) throw payloadError('unknown fee fields');
  if (!hasOnlyKeys(value.issuer, ISSUER_KEYS)) throw payloadError('unknown issuer fields');
  if (!Array.isArray(value.options) || value.options.length > MAX_OPTIONS) throw payloadError('invalid options');

  return {
    v: 1,
    n: requiredString(value.n, 64, 'receipt number'),
    at: requiredString(value.at, 64, 'issued datetime'),
    total: yen(value.total, { name: 'total' }),
    fees: {
      base: yen(value.fees.base, { name: 'base fee' }),
      day: yen(value.fees.day, { name: 'day fee' }),
      winter: yen(value.fees.winter, { name: 'winter fee' }),
      time: yen(value.fees.time, { name: 'time fee' }),
      wait: yen(value.fees.wait, { name: 'wait fee' }),
      option: yen(value.fees.option, { allowNegative: true, name: 'option fee' }),
    },
    options: value.options.map((option, index) => {
      if (!hasOnlyKeys(option, OPTION_KEYS)) throw payloadError(`unknown option ${index} fields`);
      return {
        label: requiredString(option.label, 160, `option ${index} label`),
        amount: yen(option.amount, { allowNegative: true, name: `option ${index} amount` }),
      };
    }),
    note: requiredString(value.note, 512, 'note'),
    issuer: {
      name: requiredString(value.issuer.name, 160, 'issuer name'),
      registrationNumber: requiredString(value.issuer.registrationNumber, 64, 'issuer registration number'),
      address: requiredString(value.issuer.address, 512, 'issuer address'),
      phone: requiredString(value.issuer.phone, 64, 'issuer phone'),
    },
  };
}

function fnv1a64(bytes) {
  let hash = FNV64_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value) {
  if (typeof value !== 'string' || value.length > MAX_BASE64URL_CHARS || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw payloadError('invalid base64url payload');
  }
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw payloadError('invalid base64url payload');
  }
}

function bytesFrom(value, name) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw payloadError(`${name} did not return bytes`);
}

function encodeJson(value) {
  return textEncoder.encode(JSON.stringify(value));
}

export function publicReceiptFromModel(model = {}) {
  if (!isPlainObject(model)) throw payloadError('receipt model must be an object');
  return {
    v: 1,
    n: sourceString(model.receiptNumber, 64, 'receipt number'),
    at: sourceString(model.issuedDateTime, 64, 'issued datetime'),
    total: yen(model.totalFare, { name: 'total' }),
    fees: {
      base: yen(model.baseFare, { name: 'base fee' }),
      day: yen(model.daySurchargeFee, { name: 'day fee' }),
      winter: yen(model.winterSurchargeFee, { name: 'winter fee' }),
      time: yen(model.timeFee, { name: 'time fee' }),
      wait: yen(model.waitFee, { name: 'wait fee' }),
      option: yen(model.optionFee, { allowNegative: true, name: 'option fee' }),
    },
    options: publicOptions(model.optionDetails),
    note: sourceString(model.note, 512, 'note'),
    issuer: publicIssuer(model.issuer),
  };
}

export function encodeReceiptQrFragment(model, { compress } = {}) {
  if (typeof compress !== 'function') throw payloadError('compression is unavailable');
  const data = publicReceiptFromModel(model);
  const dataBytes = encodeJson(data);
  const envelopeBytes = encodeJson({ data, check: fnv1a64(dataBytes) });
  if (envelopeBytes.byteLength > MAX_RECEIPT_QR_DECOMPRESSED_BYTES) throw payloadError('receipt payload is too large');
  let compressed;
  try {
    compressed = bytesFrom(compress(envelopeBytes), 'compression');
  } catch (error) {
    if (error instanceof ReceiptQrPayloadError) throw error;
    throw payloadError('receipt payload compression failed');
  }
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw payloadError('receipt QR payload is too large');
  return `${PREFIX}${toBase64Url(compressed)}`;
}

export function decodeReceiptQrFragment(fragment, { decompress } = {}) {
  if (typeof decompress !== 'function') throw payloadError('decompression is unavailable');
  if (typeof fragment !== 'string' || !fragment.startsWith(PREFIX)) throw payloadError('unsupported receipt payload version');
  const compressed = fromBase64Url(fragment.slice(PREFIX.length));
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw payloadError('receipt QR payload is too large');
  let inflated;
  try {
    inflated = bytesFrom(decompress(compressed), 'decompression');
  } catch (error) {
    if (error instanceof ReceiptQrPayloadError) throw error;
    throw payloadError('receipt payload decompression failed');
  }
  if (inflated.byteLength > MAX_RECEIPT_QR_DECOMPRESSED_BYTES) throw payloadError('receipt payload is too large');

  let envelope;
  try {
    envelope = JSON.parse(textDecoder.decode(inflated));
  } catch {
    throw payloadError('receipt payload is not valid JSON');
  }
  if (!hasOnlyKeys(envelope, ['data', 'check']) || typeof envelope.check !== 'string' || !/^[0-9a-f]{16}$/.test(envelope.check)) {
    throw payloadError('receipt payload envelope is invalid');
  }
  const data = validatedPublicReceipt(envelope.data);
  if (fnv1a64(encodeJson(data)) !== envelope.check) throw payloadError('receipt payload checksum does not match');
  return data;
}
