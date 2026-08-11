import { getTimeFareConfig } from './calculator.js';
import { formatSeconds } from './progress-formatters.js';

export function getNextTimeFareProgress(lowSpeedSec, companyId, isDaytime, currentSpeed, fareSnapshot) {
  const config = fareSnapshot?.timeFare || getTimeFareConfig(companyId, isDaytime);
  if (!config?.enabled || currentSpeed > config.speedThresholdKmh) {
    return {
      active: false,
      kind: 'time',
      label: '時間加算',
      remainingText: '--',
      progress: 0,
      hint: '',
    };
  }

  const interval = Math.max(1, Number(config.intervalSec) || 1);
  const elapsed = Math.max(0, lowSpeedSec);
  const remainder = elapsed % interval;
  const remainingSec = Math.ceil(remainder === 0 && elapsed > 0 ? interval : interval - remainder);
  const progress = Math.min(99, Math.max(0, (remainder / interval) * 100));

  return {
    active: true,
    kind: 'time',
    label: '時間加算',
    remainingText: formatSeconds(remainingSec),
    progress,
    hint: `低速時間 ${formatSeconds(remainingSec)}`,
  };
}
