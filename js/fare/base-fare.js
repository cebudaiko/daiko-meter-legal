import { getCompanies, getSpecialPeriodConfig } from './config.js';
import { calculateDaySurcharge, normalizeDayPricing } from './day-pricing.js';
import { calculateWinterSurcharge, normalizeWinterPricing } from './winter-pricing.js';
import { calcFromTiers } from './tier-calculator.js';

export function calcDistanceFare(
  distanceKm,
  companyId = 'company_a',
  isDaytime = false,
  isSpecialPeriod = false,
  config,
  isWinter = false,
) {
  const km = Math.max(0, distanceKm);
  const companies = config?.companies || getCompanies();
  const company = companies[companyId] || Object.values(companies)[0] || {};
  const policy = normalizeDayPricing(company.dayPricing);
  const appliesDaySurcharge = isDaytime
    && !isSpecialPeriod
    && policy.mode === 'nightSurcharge';

  let rateTable;
  if (isSpecialPeriod) {
    const special = config?.specialPeriod || getSpecialPeriodConfig();
    rateTable = special || { tiers: [] };
  } else if (appliesDaySurcharge) {
    rateTable = company.night || company.day || { tiers: [] };
  } else {
    rateTable = (isDaytime ? company.day : company.night)
      || company.night
      || company.day
      || { tiers: [] };
  }

  const baseFare = calcFromTiers(km, rateTable.tiers || [], rateTable.longDistanceBase);
  const surcharge = appliesDaySurcharge
    ? calculateDaySurcharge(baseFare, policy)
    : { percentFee: 0, fixedFee: 0, total: 0 };
  // The winter (snow-road) surcharge follows the driver's per-trip flag, not the
  // calendar or the selected band, so it also applies during the special period.
  const winterSurcharge = isWinter
    ? calculateWinterSurcharge(baseFare, normalizeWinterPricing(company.winterPricing))
    : { percentFee: 0, fixedFee: 0, total: 0 };
  return {
    baseFare,
    daySurchargePercentFee: surcharge.percentFee,
    daySurchargeFixedFee: surcharge.fixedFee,
    daySurchargeFee: surcharge.total,
    winterSurchargePercentFee: winterSurcharge.percentFee,
    winterSurchargeFixedFee: winterSurcharge.fixedFee,
    winterSurchargeFee: winterSurcharge.total,
  };
}

export function calcBaseFare(
  distanceKm,
  companyId = 'company_a',
  isDaytime = false,
  isSpecialPeriod = false,
  config,
  isWinter = false,
) {
  const distance = calcDistanceFare(
    distanceKm, companyId, isDaytime, isSpecialPeriod, config, isWinter,
  );
  return distance.baseFare + distance.daySurchargeFee + distance.winterSurchargeFee;
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
