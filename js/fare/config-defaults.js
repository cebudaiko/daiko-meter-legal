export { DEFAULT_LOW_SPEED_THRESHOLD_KMH } from './low-speed-threshold.js';
import { DEFAULT_LOW_SPEED_THRESHOLD_KMH } from './low-speed-threshold.js';
export { DEFAULT_DAY_PRICING } from './day-pricing.js';
import { DEFAULT_DAY_PRICING } from './day-pricing.js';

export const DEFAULT_TABLES = {
  company_a: {
    name: 'セブ代行',
    shortName: 'CEBU',
    night: {
      tiers: [
        { upToKm: 4.1, flatFare: 1650 },
        { upToKm: 4.9, flatFare: 1980 },
        { upToKm: 25.9, perKm: 330 },
        { upToKm: Infinity, perKm: 660 },
      ],
      longDistanceBase: 8910,
      timeFare: {
        enabled: true,
        speedThresholdKmh: DEFAULT_LOW_SPEED_THRESHOLD_KMH,
        intervalSec: 90,
        feePerInterval: 100,
      },
    },
    day: {
      tiers: [
        { upToKm: 3.0, flatFare: 2000 },
        { upToKm: Infinity, perKm: 500 },
      ],
    },
    dayStart: 7,
    dayEnd: 18,
    dayPricing: DEFAULT_DAY_PRICING,
  },
  company_b: {
    name: 'パリ代行',
    shortName: 'PARIS',
    night: {
      tiers: [
        { upToKm: 3.0, flatFare: 1980 },
        { upToKm: Infinity, perKm: 440 },
      ],
      timeFare: {
        enabled: true,
        speedThresholdKmh: DEFAULT_LOW_SPEED_THRESHOLD_KMH,
        intervalSec: 90,
        feePerInterval: 100,
      },
    },
    day: {
      tiers: [
        { upToKm: 3.0, flatFare: 2500 },
        { upToKm: Infinity, perKm: 500 },
      ],
    },
    dayStart: 7,
    dayEnd: 18,
    dayPricing: DEFAULT_DAY_PRICING,
  },
};

export const DEFAULT_OPTIONS = {
  overtimeFee: 500,
  cancellationFee: 1000,
  insuranceFee: 500,
};

export const DEFAULT_WAIT = {
  initialMinutes: 10,
  initialFee: 1000,
  additionalInterval: 5,
  additionalFee: 500,
};

export const DEFAULT_SPECIAL = {
  tiers: [
    { upToKm: 3.0, flatFare: 1800 },
    { upToKm: Infinity, perKm: 400 },
  ],
};
