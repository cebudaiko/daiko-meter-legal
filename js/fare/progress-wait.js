import { calcWaitFee } from './calculator.js';
import { formatSeconds } from './progress-formatters.js';

export function getNextWaitFareProgress(waitMinutes, fareSnapshot) {
  const feeAt = (minutes) => fareSnapshot
    ? calcWaitFee(minutes, { waitParams: fareSnapshot.waitParams || fareSnapshot.wait })
    : calcWaitFee(minutes);
  const currentSec = Math.max(0, Math.floor(waitMinutes * 60));
  const currentFee = feeAt(currentSec / 60);
  let nextSec = null;

  for (let sec = currentSec + 1; sec <= currentSec + 7200; sec++) {
    if (feeAt(sec / 60) > currentFee) {
      nextSec = sec;
      break;
    }
  }

  if (!nextSec) {
    return {
      active: false,
      kind: 'wait',
      label: '待機加算',
      remainingText: '--',
      progress: 0,
      hint: '待機料金の上限なし',
    };
  }

  let startSec = currentSec;
  while (startSec > 0 && feeAt((startSec - 1) / 60) === currentFee) {
    startSec--;
  }

  const span = Math.max(1, nextSec - startSec);
  const progress = Math.min(99, Math.max(0, ((currentSec - startSec) / span) * 100));
  const remainingSec = Math.max(0, nextSec - currentSec);

  return {
    active: true,
    kind: 'wait',
    label: '待機加算',
    remainingText: formatSeconds(remainingSec),
    progress,
    hint: `次の待機料金まで ${formatSeconds(remainingSec)}`,
  };
}
