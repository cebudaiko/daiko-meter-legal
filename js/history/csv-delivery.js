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
  capacitorRef = globalThis.Capacitor,
}) {
  const filename = dailyCsvFilename(day);
  const contents = csvWithBom(csv);
  const FileCtor = documentRef?.defaultView?.File || globalThis.File;
  const BlobCtor = documentRef?.defaultView?.Blob || globalThis.Blob;

  let isNativePlatform = false;
  try {
    isNativePlatform = capacitorRef?.isNativePlatform?.() === true;
  } catch {
    isNativePlatform = false;
  }
  const filesystem = capacitorRef?.Plugins?.Filesystem;
  const nativeShare = capacitorRef?.Plugins?.Share;
  if (isNativePlatform
    && typeof filesystem?.writeFile === 'function'
    && typeof filesystem?.deleteFile === 'function'
    && typeof nativeShare?.share === 'function') {
    const fileOptions = {
      path: filename,
      data: contents,
      directory: 'CACHE',
      encoding: 'utf8',
    };
    const { uri } = await filesystem.writeFile(fileOptions);
    try {
      try {
        await nativeShare.share({
          title: `${day} 営業日売上`,
          files: [uri],
          dialogTitle: 'CSVの保存先または共有先を選択',
        });
      } catch (error) {
        if (error?.message === 'Share canceled') {
          const abortError = new Error('Share canceled');
          abortError.name = 'AbortError';
          throw abortError;
        }
        throw error;
      }
    } finally {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await filesystem.deleteFile({ path: filename, directory: 'CACHE' });
          break;
        } catch (error) {
          if (attempt === 1) {
            const cleanupError = new Error('CSVの一時ファイルを削除できませんでした');
            cleanupError.name = 'CsvCleanupError';
            cleanupError.cause = error;
            throw cleanupError;
          }
          // Retry once: a chooser may briefly retain the cache file on return.
        }
      }
    }
    return 'shared';
  }

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
