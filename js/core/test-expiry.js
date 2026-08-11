// Test-build expiry check (pure, DOM-free so it can be unit-tested).
//
// The paid store build NEVER injects an expiry, so this must fail-safe: an absent or
// malformed expiry is treated as "not configured" → never expired. Only a valid ISO
// date injected at build time (test/friend APK only) can lock the app.
const DAY_MS = 86_400_000;

// evaluateExpiry(expiryISO, now) → { configured, expired, daysLeft }
//   configured: false when no valid expiry is baked in (production build / bad value)
//   expired:    true once `now` reaches or passes the expiry instant
//   daysLeft:   whole days remaining (rounded up) while valid; 0 when expired; null when unconfigured
export function evaluateExpiry(expiryISO, now) {
  if (!expiryISO) return { configured: false, expired: false, daysLeft: null };
  const expMs = new Date(expiryISO).getTime();
  if (!Number.isFinite(expMs)) return { configured: false, expired: false, daysLeft: null };

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return { configured: true, expired: false, daysLeft: null };

  if (nowMs >= expMs) return { configured: true, expired: true, daysLeft: 0 };
  return { configured: true, expired: false, daysLeft: Math.ceil((expMs - nowMs) / DAY_MS) };
}
