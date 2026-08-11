import { calcBaseFare } from './calculator.js';
import { calcFromTiers } from './tier-calculator.js';
import { formatMeters } from './progress-formatters.js';

export function getNextDistanceFareProgress(distanceKm, companyId, isDaytime, isSpecialPeriod, fareSnapshot) {
  const fareAt = (km) => fareSnapshot
    ? calcFromTiers(
      km,
      fareSnapshot.distanceFare?.tiers || [],
      fareSnapshot.distanceFare?.longDistanceBase ?? undefined,
    )
    : calcBaseFare(km, companyId, isDaytime, isSpecialPeriod);
  const currentDist10 = Math.max(0, Math.round(distanceKm * 10));
  const currentFare = fareAt(currentDist10 / 10);
  let nextDist10 = null;

  for (let dist10 = currentDist10 + 1; dist10 <= currentDist10 + 2000; dist10++) {
    if (fareAt(dist10 / 10) > currentFare) {
      nextDist10 = dist10;
      break;
    }
  }

  if (!nextDist10) {
    return {
      active: false,
      kind: 'distance',
      label: '距離加算',
      remainingText: '--',
      progress: 0,
      hint: '距離料金の上限なし',
    };
  }

  let startDist10 = currentDist10;
  while (startDist10 > 0 && fareAt((startDist10 - 1) / 10) === currentFare) {
    startDist10--;
  }

  const span = Math.max(1, nextDist10 - startDist10);
  const progress = Math.min(99, Math.max(0, ((currentDist10 - startDist10) / span) * 100));
  const remainingMeters = Math.max(0, (nextDist10 - currentDist10) * 100);

  return {
    active: true,
    kind: 'distance',
    label: '距離加算',
    remainingText: formatMeters(remainingMeters),
    progress,
    hint: `次の距離料金まで ${formatMeters(remainingMeters)}`,
  };
}
