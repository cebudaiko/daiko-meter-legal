export const GPS_FRESH_MS = 8_000;

export function monotonicNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function finalizeWaitIfNeeded(state, now = Date.now()) {
  if (!state.waitStartTime) return;
  state.totalWaitMs += Math.max(0, now - state.waitStartTime);
  state.waitStartTime = null;
}

export function toggleWaitState(state, now = Date.now(), nowMono = monotonicNow()) {
  if (state.mode === 'idle') return;

  if (state.mode === 'waiting') {
    state.totalWaitMs += Math.max(0, now - state.waitStartTime);
    state.waitStartTime = null;
    state.mode = 'running';
    // Resume starts a new monotonic charging interval. A suspended ticker/GPS
    // must never bridge the completed wait into low-speed time fare.
    state.lastLowSpeedTickTs = nowMono;
    return;
  }

  // Close the running interval under the trip's locked rule before switching to
  // waiting. Resetting the cursor without this step would silently discard the
  // time since the last ticker/fix.
  accrueConfirmedSpeedInterval(state, nowMono, state.lockedFareSnapshot?.timeFare);
  state.waitStartTime = now;
  state.mode = 'waiting';
  // Mark the exact entry boundary even if no ticker or GPS event occurs in wait mode.
  state.lastLowSpeedTickTs = nowMono;
}

// Charge elapsed monotonic time under the last fresh speed classification. A new
// fix closes the preceding interval, then becomes the classification for future
// ticks; therefore a fresh high-speed fix stops future charging without erasing
// the low-speed/garage interval that led up to it.
export function accrueLowSpeedFromFix(state, fixTs, timeFareConfig, nowMono = fixTs) {
  if (state.lastFixTs != null && fixTs <= state.lastFixTs) return false;
  accrueConfirmedSpeedInterval(state, nowMono, timeFareConfig);
  state.lastFixTs = fixTs;
  state.lastFreshFixMonoMs = nowMono;
  state.lastFreshSpeedKmh = state.currentSpeed;
  state.lastLowSpeedTickTs = nowMono;
  return true;
}

// Ticks keep the monotonic cursor moving even while native GPS suppresses stationary
// fixes. Fixes and ticks share the same cursor, so an elapsed interval is charged once.
export function accrueLowSpeedFromTick(state, now, timeFareConfig) {
  accrueConfirmedSpeedInterval(state, now, timeFareConfig);
  if (state.lastLowSpeedTickTs == null || now >= state.lastLowSpeedTickTs) {
    state.lastLowSpeedTickTs = now;
  }
}

function accrueConfirmedSpeedInterval(state, nowMono, timeFareConfig) {
  const from = state.lastLowSpeedTickTs;
  if (from == null || nowMono < from) return;
  if (
    state.mode === 'running'
    && timeFareConfig?.enabled
    && state.lastFreshSpeedKmh != null
    && state.lastFreshSpeedKmh <= timeFareConfig.speedThresholdKmh
  ) {
    state.lowSpeedSec += (nowMono - from) / 1000;
  }
}

export function isGpsFixFresh(state, nowMono = monotonicNow()) {
  if (state.lastFreshFixMonoMs == null) return false;
  const age = nowMono - state.lastFreshFixMonoMs;
  return age >= 0 && age <= GPS_FRESH_MS;
}

export function updateElapsed(state, now = Date.now()) {
  if (!state.startTime) return;
  state.elapsedMs = Math.max(0, now - state.startTime); // clamp: a backward clock jump cannot go negative
}

export function getTotalWaitMinutes(state, now = Date.now()) {
  let totalMs = state.totalWaitMs;
  if (state.waitStartTime) {
    totalMs += Math.max(0, now - state.waitStartTime);
  }
  return totalMs / (1000 * 60);
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '00:00';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
