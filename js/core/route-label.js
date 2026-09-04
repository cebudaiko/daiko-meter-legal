export const ROUTE_LABEL_MAX_CODE_POINTS = 160;

export function normalizeRouteLabel(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return [...normalized].length <= ROUTE_LABEL_MAX_CODE_POINTS ? normalized : '';
}

export function confirmedRoute(origin, destination) {
  const normalizedOrigin = normalizeRouteLabel(origin);
  const normalizedDestination = normalizeRouteLabel(destination);
  return normalizedOrigin && normalizedDestination
    ? { origin: normalizedOrigin, destination: normalizedDestination }
    : null;
}
