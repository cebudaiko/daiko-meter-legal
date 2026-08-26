import { APP_DISPLAY_NAME, loadLocalConfig } from '../storage/local-config.js';
export { DEFAULT_OPTIONS, DEFAULT_SPECIAL, DEFAULT_TABLES, DEFAULT_WAIT } from './config-defaults.js';
import { DEFAULT_OPTIONS, DEFAULT_SPECIAL, DEFAULT_TABLES, DEFAULT_WAIT } from './config-defaults.js';
import { normalizeTiers } from './config-normalizer.js';

let config = null;

export async function loadConfig() {
  config = loadLocalConfig();
  normalizeTiers(config);
  return config;
}

export function getConfig() {
  return config;
}

export function getCompanies() {
  return config?.companies || DEFAULT_TABLES;
}

export function getWaitParams() {
  return config?.waitParams || DEFAULT_WAIT;
}

export function getWaitPricing() {
  return config?.waitPricing || null;
}

export function getSpecialPeriodConfig() {
  return config?.specialPeriod || DEFAULT_SPECIAL;
}

export function getCompanyList() {
  return Object.entries(getCompanies()).map(([id, company]) => ({
    id,
    name: company.name,
    shortName: company.shortName,
  }));
}

export function getCarList() {
  return config?.cars || ['1号車', '2号車', '3号車', '4号車', '5号車'];
}

export function getAppName() {
  return APP_DISPLAY_NAME;
}

export function getOptionConfig() {
  return config?.options || DEFAULT_OPTIONS;
}
