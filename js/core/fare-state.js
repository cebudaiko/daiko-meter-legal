import { calcTotalFare, calcTotalFareFromSnapshot } from '../fare.js';
import { activeRateContext, getTotalWaitMinutes } from './trip-state.js';

export function recalcFareState(state) {
  const previousFare = state.currentFare;

  if (state.mode === 'idle') {
    state.currentFare = 0;
    state.baseFare = 0;
    state.daySurchargePercentFee = 0;
    state.daySurchargeFixedFee = 0;
    state.daySurchargeFee = 0;
    state.waitFee = 0;
    state.timeFee = 0;
    state.optionFee = 0;
    return { previousFare, fareChanged: previousFare !== 0 };
  }

  const rate = activeRateContext(state);
  const input = {
    distanceKm: state.distanceKm,
    waitMinutes: getTotalWaitMinutes(state),
    lowSpeedSec: state.lowSpeedSec,
    companyId: rate.companyId,
    isDaytime: rate.isDaytime,
    isSpecialPeriod: rate.isSpecialPeriod,
    options: state.options,
  };
  const result = state.lockedFareSnapshot
    ? calcTotalFareFromSnapshot(input, state.lockedFareSnapshot)
    : calcTotalFare(input);

  state.currentFare = result.total;
  state.baseFare = result.baseFare;
  state.daySurchargePercentFee = result.daySurchargePercentFee;
  state.daySurchargeFixedFee = result.daySurchargeFixedFee;
  state.daySurchargeFee = result.daySurchargeFee;
  state.waitFee = result.waitFee;
  state.timeFee = result.timeFee;
  state.optionFee = result.optionFee;

  return {
    previousFare,
    fareChanged: previousFare !== state.currentFare,
  };
}
