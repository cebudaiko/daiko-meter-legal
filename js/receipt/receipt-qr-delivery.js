import { createRuntimeId } from '../core/platform-compat.js';

function normalizedReceiptNumber(value) {
  const source = String(value ?? '').trim();
  return /^[A-Z0-9-]{1,64}$/i.test(source) ? source : 'unknown';
}

function bytesToBase64(bytes, btoaFn) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Receipt QR PNG bytes are invalid');
  if (typeof btoaFn !== 'function') throw new TypeError('Base64 encoder is unavailable');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoaFn(binary);
}

function abortError(error) {
  if (error?.name === 'AbortError') return error;
  if (error?.message !== 'Share canceled') return error;
  const normalized = new Error('Share canceled');
  normalized.name = 'AbortError';
  return normalized;
}

async function deleteTemporaryQr(filesystem, path) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await filesystem.deleteFile({ path, directory: 'CACHE' });
      return;
    } catch (error) {
      if (attempt === 1) {
        const cleanupError = new Error('領収証QRの一時ファイルを削除できませんでした');
        cleanupError.name = 'ReceiptQrCleanupError';
        cleanupError.cause = error;
        throw cleanupError;
      }
    }
  }
}

function qrCachePath(filename, createShareId) {
  const shareId = String(createShareId?.() ?? '').trim();
  if (!/^[a-z0-9-]{1,128}$/i.test(shareId)) throw new TypeError('Receipt QR share ID is invalid');
  return `receipt-qr/${shareId}/${filename}`;
}

function nativePayload(model, uri) {
  const receiptNumber = normalizedReceiptNumber(model?.receiptNumber);
  return {
    title: `領収証QR ${receiptNumber}`,
    text: `領収番号: ${receiptNumber}`,
    files: [uri],
    dialogTitle: '領収証QRの保存先を選択',
  };
}

export function receiptQrPngFilename(receiptNumber) {
  return `jirochanzu-receipt-${normalizedReceiptNumber(receiptNumber)}-qr.png`;
}

export async function deliverReceiptQrPng({
  model,
  pngBytes,
  documentRef = globalThis.document,
  capacitorRef = globalThis.Capacitor,
  urlApi = globalThis.URL,
  setTimeoutFn = globalThis.setTimeout,
  createShareId = () => createRuntimeId('receipt-qr'),
} = {}) {
  const filename = receiptQrPngFilename(model?.receiptNumber);
  let native = false;
  try {
    native = capacitorRef?.isNativePlatform?.() === true;
  } catch {
    native = false;
  }

  const filesystem = capacitorRef?.Plugins?.Filesystem;
  const nativeShare = capacitorRef?.Plugins?.Share;
  if (native) {
    if (typeof filesystem?.writeFile !== 'function'
      || typeof filesystem?.deleteFile !== 'function'
      || typeof nativeShare?.share !== 'function') return 'unsupported';
    const btoaFn = documentRef?.defaultView?.btoa || globalThis.btoa;
    const path = qrCachePath(filename, createShareId);
    const { uri } = await filesystem.writeFile({
      path,
      data: bytesToBase64(pngBytes, btoaFn),
      directory: 'CACHE',
      recursive: true,
    });
    try {
      await nativeShare.share(nativePayload(model, uri));
      return 'shared';
    } catch (error) {
      await deleteTemporaryQr(filesystem, path);
      throw abortError(error);
    }
  }

  if (typeof documentRef?.createElement !== 'function'
    || typeof urlApi?.createObjectURL !== 'function'
    || typeof urlApi?.revokeObjectURL !== 'function'
    || typeof setTimeoutFn !== 'function'
    || typeof Blob !== 'function') return 'unsupported';

  const url = urlApi.createObjectURL(new Blob([pngBytes], { type: 'image/png' }));
  const link = documentRef.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeoutFn(() => urlApi.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
