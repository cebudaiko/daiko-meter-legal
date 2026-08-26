import { calcWaitFee } from './calculator.js';
import { formatSeconds } from './progress-formatters.js';
import { getNextStagedWaitIncrease, validateWaitPricing } from './wait-pricing.js';

function inactiveWaitProgress(hint) {
  return {
    active: false, kind: 'wait', label: '待機加算', remainingText: '--', progress: 0, hint,
  };
}

function formatStagedWaitSeconds(remainingSec) {
  const formatted = formatSeconds(remainingSec);
  return formatted.endsWith('分') ? `${formatted}00秒` : formatted;
}

function activeWaitProgress(remainingSec, progress) {
  const remainingText = formatStagedWaitSeconds(remainingSec);
  return {
    active: true,
    kind: 'wait',
    label: '待機加算',
    remainingText,
    progress: Math.min(99, Math.max(0, progress)),
    hint: `次の待機料金まで ${remainingText}`,
  };
}

export function getNextWaitFareProgress(waitMinutes, fareSnapshot) {
  const staged = validateWaitPricing(fareSnapshot?.waitPricing);
  if (staged.ok) {
    const currentSec = Math.max(0, Math.floor(waitMinutes * 60));
    const next = getNextStagedWaitIncrease(currentSec, staged.pricing);
    if (!next) return inactiveWaitProgress('今後の待機加算なし');
    const span = Math.max(1, next.nextSec - next.startSec);
    const remainingSec = next.nextSec - currentSec;
    return activeWaitProgress(remainingSec, ((currentSec - next.startSec) / span) * 100);
  }
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
