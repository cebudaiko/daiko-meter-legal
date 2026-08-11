import { getCompanies } from './config.js';

export function calcTimeFare(lowSpeedSec, companyId = 'company_a', isDaytime = false, config) {
  if (lowSpeedSec <= 0) return 0;

  const timeFare = getTimeFareConfig(companyId, isDaytime, config);
  if (!timeFare?.enabled) return 0;

  const intervals = Math.floor(lowSpeedSec / timeFare.intervalSec);
  return intervals * timeFare.feePerInterval;
}

export function getTimeFareConfig(companyId = 'company_a', isDaytime = false, config) {
  const companies = config?.companies || getCompanies();
  const table = companies[companyId] || Object.values(companies)[0];
  const period = isDaytime ? 'day' : 'night';
  return table?.[period]?.timeFare || table?.night?.timeFare || {
    enabled: false,
    speedThresholdKmh: 10,
    intervalSec: 90,
    feePerInterval: 100,
  };
}
