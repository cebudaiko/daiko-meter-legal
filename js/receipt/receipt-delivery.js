import { buildReceiptPdf } from './receipt-pdf.js';
import { createRuntimeId } from '../core/platform-compat.js';

function normalizedReceiptNumber(value) {
  const source = String(value ?? '').trim();
  return /^[A-Z0-9-]{1,64}$/i.test(source) ? source : 'unknown';
}

function abortError(error) {
  if (error?.name === 'AbortError') return error;
  if (error?.message !== 'Share canceled') return error;
  const normalized = new Error('Share canceled');
  normalized.name = 'AbortError';
  return normalized;
}

async function deleteTemporaryReceipt(filesystem, filename) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await filesystem.deleteFile({ path: filename, directory: 'CACHE' });
      return;
    } catch (error) {
      if (attempt === 1) {
        const cleanupError = new Error('領収証の一時ファイルを削除できませんでした');
        cleanupError.name = 'ReceiptCleanupError';
        cleanupError.cause = error;
        throw cleanupError;
      }
    }
  }
}

export function receiptAttachmentFilename(receiptNumber) {
  return `jirochanzu-receipt-${normalizedReceiptNumber(receiptNumber)}.pdf`;
}

function bytesToBase64(bytes, btoaFn) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Receipt PDF bytes are invalid');
  if (typeof btoaFn !== 'function') throw new TypeError('Base64 encoder is unavailable');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoaFn(binary);
}

function receiptShareCachePath(filename, createShareId) {
  const shareId = String(createShareId?.() ?? '').trim();
  if (!/^[a-z0-9-]{1,128}$/i.test(shareId)) {
    throw new TypeError('Receipt share ID is invalid');
  }
  return `receipt-share/${shareId}/${filename}`;
}

export async function deliverReceiptAttachment({
  model,
  payload,
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
  capacitorRef = globalThis.Capacitor,
  buildPdf = buildReceiptPdf,
  createShareId = () => createRuntimeId('receipt-share'),
} = {}) {
  const filename = receiptAttachmentFilename(model?.receiptNumber);
  let isNativePlatform = false;
  try {
    isNativePlatform = capacitorRef?.isNativePlatform?.() === true;
  } catch {
    isNativePlatform = false;
  }

  const filesystem = capacitorRef?.Plugins?.Filesystem;
  const nativeShare = capacitorRef?.Plugins?.Share;
  if (isNativePlatform) {
    if (typeof filesystem?.writeFile !== 'function'
      || typeof filesystem?.deleteFile !== 'function'
      || typeof nativeShare?.share !== 'function') return 'unsupported';

    const pdf = await buildPdf(model, { documentRef });
    const btoaFn = documentRef?.defaultView?.btoa || globalThis.btoa;
    const path = receiptShareCachePath(filename, createShareId);
    const { uri } = await filesystem.writeFile({
      path,
      data: bytesToBase64(pdf, btoaFn),
      directory: 'CACHE',
      recursive: true,
    });
    try {
      await nativeShare.share({
        ...payload,
        files: [uri],
        dialogTitle: '領収証の共有先を選択',
      });
    } catch (error) {
      await deleteTemporaryReceipt(filesystem, path);
      throw abortError(error);
    }
    return 'shared';
  }

  const FileCtor = documentRef?.defaultView?.File || globalThis.File;
  if (typeof FileCtor === 'function'
    && typeof navigatorRef?.canShare === 'function'
    && typeof navigatorRef?.share === 'function') {
    const pdf = await buildPdf(model, { documentRef });
    const file = new FileCtor([pdf], filename, { type: 'application/pdf' });
    const filePayload = { ...payload, files: [file] };
    if (navigatorRef.canShare({ files: [file] })) {
      try {
        await navigatorRef.share(filePayload);
        return 'shared';
      } catch (error) {
        throw abortError(error);
      }
    }
  }

  return 'unsupported';
}
