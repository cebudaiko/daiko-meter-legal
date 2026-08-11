// Escape a CSV field: neutralize spreadsheet formula injection (a leading =, +, -, @,
// tab or CR is read as a formula by Excel/Sheets) and quote separators/quotes/newlines.
function csvField(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function recordsToCsv(records) {
  const list = Array.isArray(records) ? records : [];
  // B2-6: 時間料金 included so the fee columns sum to 合計. B2-8: 特別 marks 特別期間 trips.
  const header = '日時,会社,号車,距離(km),時間(分),待機(分),基本料金,待機料金,時間料金,オプション,合計,特別';
  const rows = list.map((record) => {
    const d = new Date(record.date);
    const dateStr = Number.isNaN(d.getTime())
      ? ''
      : `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    return [
      csvField(dateStr),
      csvField(record.companyName || record.company || ''),
      csvField(record.carNumber || ''),
      csvNumber(record.distanceKm).toFixed(1),
      Math.round(csvNumber(record.durationMs) / 60000),
      Math.round(csvNumber(record.waitMs) / 60000),
      csvNumber(record.baseFare),
      csvNumber(record.waitFee),
      csvNumber(record.timeFee),
      csvNumber(record.optionFee),
      csvNumber(record.totalFare),
      csvField(record.isSpecialPeriod ? '○' : ''),
    ].join(',');
  }).join('\r\n');

  return `\uFEFF${header}\r\n${rows}`;
}
