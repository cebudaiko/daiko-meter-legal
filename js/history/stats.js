export function summarizeRecords(records) {
  const list = Array.isArray(records) ? records : [];
  return list.reduce((summary, record) => ({
    count: summary.count + 1,
    totalFare: summary.totalFare + (Number(record?.totalFare) || 0),
    totalDistance: summary.totalDistance + (Number(record?.distanceKm) || 0),
    totalDuration: summary.totalDuration + (Number(record?.durationMs) || 0),
    totalWait: summary.totalWait + (Number(record?.waitMs) || 0),
  }), {
    count: 0,
    totalFare: 0,
    totalDistance: 0,
    totalDuration: 0,
    totalWait: 0,
  });
}

export function getTodayStatsFromRecords(records) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const todayRecords = records.filter(r => new Date(r.date).getTime() >= todayMs);

  const summary = summarizeRecords(todayRecords);
  return {
    count: summary.count,
    totalFare: summary.totalFare,
    totalDistance: summary.totalDistance,
    totalDuration: summary.totalDuration,
  };
}
