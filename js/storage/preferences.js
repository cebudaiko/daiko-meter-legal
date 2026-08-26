const SETTINGS_KEY = 'daiko-meter-settings';

export function normalizeKeepScreenAwakeDuringTrip(value) {
  return value !== false;
}

export function normalizeReceiptIssuer(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    name: String(source.name ?? '').trim(),
    registrationNumber: String(source.registrationNumber ?? '').trim(),
    address: String(source.address ?? '').trim(),
    phone: String(source.phone ?? '').trim(),
    defaultNote: String(source.defaultNote ?? '').trim(),
  };
}

export function loadSettingsData() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function readRawSettings() {
  return localStorage.getItem(SETTINGS_KEY);
}

export function loadSettingsForBackup() {
  const raw = readRawSettings();
  return raw === null ? {} : JSON.parse(raw);
}

export function restoreRawSettings(raw) {
  if (raw === null) localStorage.removeItem(SETTINGS_KEY);
  else localStorage.setItem(SETTINGS_KEY, raw);
}

export function saveSettingsData(data) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data || {}));
}
