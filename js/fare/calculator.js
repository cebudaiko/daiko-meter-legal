import { getCompanies, getConfig } from './config.js';
import {
  calcBaseFare, calcDistanceFare, getFareTableInfo, isDaytimeNow,
} from './base-fare.js';
import { calcDriverReward } from './driver-reward.js';
import { calcOptionFees } from './option-fare.js';
import { calcTimeFare, getTimeFareConfig } from './time-fare.js';
import { calcWaitFee } from './wait-fare.js';

export {
  calcBaseFare,
  calcDistanceFare,
  calcDriverReward,
  calcOptionFees,
  calcTimeFare,
  calcWaitFee,
  getFareTableInfo,
  getTimeFareConfig,
  isDaytimeNow,
};

export function calcTotalFare(input = {}, config = getConfig()) {
  const {
    distanceKm = 0,
    waitMinutes = 0,
    lowSpeedSec = 0,
    companyId = 'company_a',
    isDaytime = false,
    isSpecialPeriod = false,
    options = {},
  } = input;
  const distance = calcDistanceFare(
    distanceKm, companyId, isDaytime, isSpecialPeriod, config,
  );
  const waitFee = calcWaitFee(waitMinutes, config);
  const timeFee = calcTimeFare(lowSpeedSec, companyId, isDaytime, config);
  const optionFee = calcOptionFees(options, config);
  const total = Math.max(
    0,
    distance.baseFare + distance.daySurchargeFee + waitFee + timeFee + optionFee,
  );

  const companies = config?.companies || getCompanies();
  const company = companies[companyId] || Object.values(companies)[0];

  return {
    total,
    ...distance,
    waitFee,
    timeFee,
    optionFee,
    breakdown: {
      companyId,
      companyName: company?.name || companyId,
      isDaytime,
      isSpecialPeriod,
      distanceKm: Math.round(distanceKm * 10) / 10,
      waitMinutes: Math.round(waitMinutes),
      lowSpeedSec: Math.round(lowSpeedSec),
      options: { ...options },
    },
  };
}
