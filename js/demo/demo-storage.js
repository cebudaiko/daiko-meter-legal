export const DEMO_STORAGE_KEY = 'jirochanzu-demo-state-v1';

export function loadDemoState(storage) {
  try {
    const raw = storage?.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDemoState(storage, state) {
  try {
    storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Demo state is disposable; native/app storage is intentionally never used as a fallback.
  }
}

export function clearDemoState(storage) {
  try {
    storage?.removeItem(DEMO_STORAGE_KEY);
  } catch {
    // A blocked storage API still leaves the in-memory reset usable.
  }
}
