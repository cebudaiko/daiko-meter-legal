import { getCompanyList, isDaytimeNow } from '../fare.js';

export function advanceCompany(state) {
  const list = getCompanyList();
  const index = list.findIndex((company) => company.id === state.companyId);
  const next = (index + 1) % list.length;
  state.companyId = list[next].id;
  autoDetectDaytimeState(state);
}

export function toggleDaytimeState(state) {
  state.isDaytime = !state.isDaytime;
}

export function toggleSpecialPeriodState(state) {
  state.isSpecialPeriod = !state.isSpecialPeriod;
}

export function autoDetectDaytimeState(state) {
  state.isDaytime = isDaytimeNow(state.companyId);
}
