let fallbackIdCounter = 0;

export function cloneJsonData(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('json_clone_failed');
  return JSON.parse(serialized);
}

function formatUuid(bytes) {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createRuntimeId(prefix = 'id') {
  const cryptoApi = globalThis.crypto;
  try {
    const value = cryptoApi?.randomUUID?.();
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    // Older WebViews can expose crypto without a working randomUUID.
  }
  try {
    if (typeof cryptoApi?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return formatUuid(bytes);
    }
  } catch {
    // Continue to the non-cryptographic uniqueness fallback below.
  }
  fallbackIdCounter += 1;
  const clock = Date.now().toString(36);
  const sequence = fallbackIdCounter.toString(36);
  const random = Math.random().toString(36).slice(2, 12) || '0';
  return `${prefix}-${clock}-${sequence}-${random}`;
}
