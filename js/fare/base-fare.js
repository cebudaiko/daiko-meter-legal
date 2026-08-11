import { getCompanies, getSpecialPeriodConfig } from './config.js';
import { calcFromTiers } from './tier-calculator.js';

export function calcBaseFare(distanceKm, companyId = 'company_a', isDaytime = false, isSpecialPeriod = false, config) {
  const km = Math.max(0, distanceKm);

  if (isSpecialPeriod) {
    const special = config?.specialPeriod || getSpecialPeriodConfig();
    return calcFromTiers(km, (special && special.tiers) || []);
  }

  const companies = config?.companies || getCompanies();
  const table = companies[companyId] || Object.values(companies)[0] || {};
  const rateTable = (isDaytime ? table.day : table.night) || table.night || table.day || { tiers: [] };
  return calcFromTiers(km, rateTable.tiers || [], rateTable.longDistanceBase);
}

export function isDaytimeNow(companyId = 'company_a', date = new Date()) {
  const companies = getCompanies();
  const table = companies[companyId] || Object.values(companies)[0];
  const hour = date.getHours();
  return hour >= table.dayStart && hour < table.dayEnd;
}

export function getFareTableInfo(companyId = 'company_a', isDaytime = false) {
  const companies = getCompanies();
  const table = companies[companyId] || Object.values(companies)[0];
  const rateTable = isDaytime ? table.day : table.night;
  return {
    companyId,
    companyName: table.name,
    shortName: table.shortName,
    isDaytime,
    timeLabel: isDaytime ? '日中' : '夜間',
    tiers: rateTable.tiers,
    dayStart: table.dayStart,
    dayEnd: table.dayEnd,
  };
}
