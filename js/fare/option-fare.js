import { getOptionConfig } from './config.js';

export function calcOptionFees(options = {}, config) {
  const optionConfig = config?.options || getOptionConfig();
  let total = 0;
  if (options.overtime) total += optionConfig.overtimeFee;
  if (options.cancellation) total += optionConfig.cancellationFee;
  if (options.insurance) total += optionConfig.insuranceFee;
  if (options.snowRemoval) total += optionConfig.snowRemovalFee;
  if (options.chainService) total += optionConfig.chainServiceFee;
  if (options.remoteFee > 0) total += options.remoteFee;
  if (options.pickupFee > 0) total += options.pickupFee;
  if (options.highwayFee > 0) total += options.highwayFee;
  if (options.parkingFee > 0) total += options.parkingFee;
  if (options.surcharge > 0) total += options.surcharge;
  if (options.discount > 0) total -= options.discount;
  return total;
}
