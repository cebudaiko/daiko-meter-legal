import { getConfig } from '../fare/config.js';
import { createFareSnapshot } from '../fare/rate-snapshot.js';
import { normalizeOperatingDayCutoff } from '../history/operating-day.js';
import { createRewardAssignments } from '../rewards/assignments.js';

const EMPTY_REWARD_ASSIGNMENTS = Object.freeze([]);

export function createDefaultOptions() {
  return {
    overtime: false,
    insurance: false,
    cancellation: false,
    snowRemoval: false,
    chainService: false,
    remoteFee: 0,
    surcharge: 0,
    pickupFee: 0,
    highwayFee: 0,
    parkingFee: 0,
    discount: 0,
  };
}

export function createMeterState() {
  return {
    mode: 'idle',
    isFinalizing: false,
    companyId: 'company_a',
    isDaytime: false,
    isSpecialPeriod: false,
    isWinter: false,
    // Rate context is locked at 実車開始. Automatic day/night changes cannot re-rate
    // a trip; the explicit confirmed TOP company switch is the sole snapshot-replacement
    // path and deliberately recalculates the current session from its start boundary.
    lockedCompanyId: null,
    lockedIsDaytime: false,
    lockedIsSpecialPeriod: false,
    lockedIsWinter: false,
    lockedOperatingDayCutoff: '14:00',
    lockedFareSnapshot: null,
    activeAttendances: [],
    activeRewardProfileIds: new Set(),
    lockedRewardAssignments: EMPTY_REWARD_ASSIGNMENTS,
    carNumber: '',

    startTime: null,
    startedAt: '',
    endedAt: '',
    elapsedMs: 0,
    timerInterval: null,

    waitStartTime: null,
    totalWaitMs: 0,
    preTripWaiting: false,

    gpsTracker: null,
    distanceKm: 0,
    currentSpeed: 0,
    gpsStatus: 'off',

    currentFare: 0,
    baseFare: 0,
    daySurchargePercentFee: 0,
    daySurchargeFixedFee: 0,
    daySurchargeFee: 0,
    winterSurchargePercentFee: 0,
    winterSurchargeFixedFee: 0,
    winterSurchargeFee: 0,
    waitFee: 0,
    timeFee: 0,
    optionFee: 0,

    lowSpeedSec: 0,
    lastFixTs: null,
    lastFreshFixMonoMs: null,
    lastFreshSpeedKmh: null,
    // Shared monotonic cursor for fix/ticker time charging; never persisted because
    // performance.now() has a new origin after a reload.
    lastLowSpeedTickTs: null,

    options: createDefaultOptions(),

    currentScreen: 'meter',
    optionsPanelOpen: false,
  };
}

export function resetTripForStart(state, carNumber, now = Date.now(), config = getConfig()) {
  state.mode = 'running';
  state.isFinalizing = false;
  state.startTime = now;
  state.lockedCompanyId = state.companyId;
  state.lockedIsDaytime = state.isDaytime;
  state.lockedIsSpecialPeriod = state.isSpecialPeriod;
  state.lockedIsWinter = !!state.isWinter;
  state.lockedOperatingDayCutoff = normalizeOperatingDayCutoff(config?.operatingDayCutoff);
  state.lockedFareSnapshot = createFareSnapshot(config, {
    companyId: state.lockedCompanyId,
    isDaytime: state.lockedIsDaytime,
    isSpecialPeriod: state.lockedIsSpecialPeriod,
    isWinter: state.lockedIsWinter,
  });
  state.lockedRewardAssignments = createRewardAssignments(state.activeAttendances);
  state.startedAt = new Date(now).toISOString();
  state.endedAt = '';
  state.elapsedMs = 0;
  state.totalWaitMs = 0;
  state.waitStartTime = null;
  state.preTripWaiting = false;
  state.distanceKm = 0;
  state.currentSpeed = 0;
  state.carNumber = carNumber;
  state.lowSpeedSec = 0;
  state.lastFixTs = null;
  state.lastFreshFixMonoMs = null;
  state.lastFreshSpeedKmh = null;
  state.lastLowSpeedTickTs = null;
  state.options = createDefaultOptions();
}

// The rate context (company + day/night + special period) the fare must use right now.
// During an active trip it is the context LOCKED at 実車開始; when idle it follows the
// live selection (so the meter screen previews the band that the next trip will charge).
export function activeRateContext(state) {
  if (state.mode !== 'idle' && state.lockedCompanyId != null) {
    return {
      companyId: state.lockedCompanyId,
      isDaytime: state.lockedIsDaytime,
      isSpecialPeriod: state.lockedIsSpecialPeriod,
      isWinter: !!state.lockedIsWinter,
    };
  }
  return {
    companyId: state.companyId,
    isDaytime: state.isDaytime,
    isSpecialPeriod: state.isSpecialPeriod,
    isWinter: !!state.isWinter,
  };
}
