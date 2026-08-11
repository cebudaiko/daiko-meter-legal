import { getNextDistanceFareProgress } from './progress-distance.js';
import { getNextTimeFareProgress } from './progress-time.js';
import { getNextWaitFareProgress } from './progress-wait.js';

export function getNextFareProgress({
  distanceKm = 0,
  waitMinutes = 0,
  lowSpeedSec = 0,
  companyId = 'company_a',
  isDaytime = false,
  isSpecialPeriod = false,
  mode = 'idle',
  currentSpeed = 0,
  fareSnapshot = null,
} = {}) {
  if (mode === 'idle') {
    return {
      active: false,
      kind: 'idle',
      label: '次回加算',
      remainingText: '実車開始で表示',
      progress: 0,
      hint: '--',
    };
  }

  const distance = getNextDistanceFareProgress(distanceKm, companyId, isDaytime, isSpecialPeriod, fareSnapshot);
  const wait = getNextWaitFareProgress(waitMinutes, fareSnapshot);
  const time = getNextTimeFareProgress(lowSpeedSec, companyId, isDaytime, currentSpeed, fareSnapshot);

  const primary = mode === 'waiting' ? wait : distance;
  const hint = time?.active
    ? `低速時間 ${time.remainingText}`
    : primary.hint;

  return {
    ...primary,
    hint,
    secondary: time,
  };
}
