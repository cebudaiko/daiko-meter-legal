import { getCompanyList, getConfig, isDaytimeNow } from '../fare.js';
import { createFareSnapshot } from '../fare/rate-snapshot.js';

export function selectCompanyState(state, companyId, config = getConfig()) {
  const list = getCompanyList();
  if (!state || !list.some((company) => company.id === companyId)) return false;
  if (
    state.companyId === companyId
    && (state.mode === 'idle' || state.lockedCompanyId === companyId)
  ) return false;

  state.companyId = companyId;
  autoDetectDaytimeState(state);

  if (state.mode !== 'idle') {
    const isSpecialPeriod = state.lockedCompanyId == null
      ? !!state.isSpecialPeriod
      : !!state.lockedIsSpecialPeriod;
    const isWinter = state.lockedCompanyId == null
      ? !!state.isWinter
      : !!state.lockedIsWinter;
    state.lockedCompanyId = companyId;
    state.lockedIsDaytime = state.isDaytime;
    state.lockedIsSpecialPeriod = isSpecialPeriod;
    state.lockedIsWinter = isWinter;
    state.lockedFareSnapshot = createFareSnapshot(config, {
      companyId,
      isDaytime: state.lockedIsDaytime,
      isSpecialPeriod,
      isWinter,
    });
  }
  return true;
}

export function advanceCompany(state) {
  const list = getCompanyList();
  if (!list.length) return false;
  const index = list.findIndex((company) => company.id === state.companyId);
  const next = (index + 1) % list.length;
  return selectCompanyState(state, list[next].id);
}

export function toggleDaytimeState(state) {
  state.isDaytime = !state.isDaytime;
}

export function toggleSpecialPeriodState(state) {
  state.isSpecialPeriod = !state.isSpecialPeriod;
}

export function toggleWinterState(state) {
  state.isWinter = !state.isWinter;
}

export function autoDetectDaytimeState(state) {
  state.isDaytime = isDaytimeNow(state.companyId);
}
