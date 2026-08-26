import { getWaitParams } from './config.js';
import { calcStagedWaitFee, validateWaitPricing } from './wait-pricing.js';

export function calcWaitFee(waitMinutes, config) {
  const staged = validateWaitPricing(config?.waitPricing);
  if (staged.ok) return calcStagedWaitFee(Math.max(0, waitMinutes * 60), staged.pricing);

  if (waitMinutes <= 0) return 0;

  const waitParams = config?.waitParams || getWaitParams();
  let fee = waitParams.initialFee;

  if (waitMinutes > waitParams.initialMinutes) {
    const extraMinutes = waitMinutes - waitParams.initialMinutes;
    const extraIntervals = Math.ceil(extraMinutes / waitParams.additionalInterval);
    fee += extraIntervals * waitParams.additionalFee;
  }

  return fee;
}
