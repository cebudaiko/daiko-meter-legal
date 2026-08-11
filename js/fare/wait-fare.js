import { getWaitParams } from './config.js';

export function calcWaitFee(waitMinutes, config) {
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
