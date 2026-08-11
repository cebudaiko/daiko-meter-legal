function csvWithBom(csv) {
  const value = String(csv ?? '');
  return value.startsWith('\uFEFF') ? value : `\uFEFF${value}`;
}

export function dailyCsvFilename(day) {
  const safeDay = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? day : 'unknown';
  return `jirochanzu-sales-${safeDay}.csv`;
}

export async function deliverDailyCsv({
  csv,
  day,
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
}) {
  const filename = dailyCsvFilename(day);
  const contents = csvWithBom(csv);
  const FileCtor = documentRef?.defaultView?.File || globalThis.File;
  const BlobCtor = documentRef?.defaultView?.Blob || globalThis.Blob;

  if (typeof FileCtor === 'function'
    && typeof navigatorRef?.canShare === 'function'
    && typeof navigatorRef.share === 'function') {
    const file = new FileCtor([contents], filename, { type: 'text/csv;charset=utf-8' });
    const sharePayload = { files: [file], title: `${day} 営業日売上` };
    if (navigatorRef.canShare(sharePayload)) {
      try {
        await navigatorRef.share(sharePayload);
        return 'shared';
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
      }
    }
  }

  const urlApi = documentRef?.defaultView?.URL || globalThis.URL;
  const blob = new BlobCtor([contents], { type: 'text/csv;charset=utf-8' });
  const url = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  documentRef.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    urlApi.revokeObjectURL(url);
  }
  return 'downloaded';
}
