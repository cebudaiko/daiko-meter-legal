import {
  encodeReceiptQrFragment,
  MAX_RECEIPT_QR_DECOMPRESSED_BYTES,
} from './receipt-qr-payload.js';

const PUBLIC_RECEIPT_URL = 'https://cebudaiko.github.io/daiko-meter-legal/receipt.html';
const VENDOR_BASE = new URL('../../assets/vendor/receipt-qr/', import.meta.url);

export { MAX_RECEIPT_QR_DECOMPRESSED_BYTES };

/**
 * Decompresses into one byte beyond the legal receipt-envelope limit.
 * fflate otherwise grows its output buffer for a compressed bomb; with `out`, it
 * truncates instead, so a full sentinel buffer is always rejected.
 */
export function createBoundedReceiptQrDecompressor(unzlib) {
  if (typeof unzlib !== 'function') throw new TypeError('Receipt QR decompressor is unavailable');
  return (compressed) => {
    const output = new Uint8Array(MAX_RECEIPT_QR_DECOMPRESSED_BYTES + 1);
    const inflated = unzlib(compressed, { out: output });
    if (!(inflated instanceof Uint8Array) || inflated.byteLength >= output.byteLength) {
      throw new RangeError('receipt payload is too large');
    }
    return inflated;
  };
}

export async function loadReceiptQrRuntime() {
  const [{ zlibSync, unzlibSync }, { default: qrcode }] = await Promise.all([
    import(new URL('fflate.mjs', VENDOR_BASE).href),
    import(new URL('qrcode.mjs', VENDOR_BASE).href),
  ]);
  return { zlibSync, decompressReceiptQrPayload: createBoundedReceiptQrDecompressor(unzlibSync), qrcode };
}

function runtimeLoader(options) {
  return options.loadRuntime ?? loadReceiptQrRuntime;
}

export async function receiptQrUrl(model, options = {}) {
  const runtime = await runtimeLoader(options)();
  return `${PUBLIC_RECEIPT_URL}#${encodeReceiptQrFragment(model, { compress: runtime.zlibSync })}`;
}

export async function createReceiptQrMatrix(url, options = {}) {
  if (typeof url !== 'string' || !/^[\x20-\x7e]+$/.test(url)) throw new TypeError('Receipt QR URL must be ASCII');
  const runtime = await runtimeLoader(options)();
  if (typeof runtime.qrcode !== 'function') throw new TypeError('Receipt QR generator is unavailable');
  const code = runtime.qrcode(0, 'M');
  code.addData(url);
  code.make();
  const size = code.getModuleCount();
  return {
    size,
    isDark(row, column) {
      return code.isDark(row, column);
    },
  };
}

export function paintReceiptQrCanvas(canvas, matrix, { scale = 8, margin = 4 } = {}) {
  if (!Number.isInteger(scale) || scale <= 0 || !Number.isInteger(margin) || margin < 4) {
    throw new TypeError('Receipt QR canvas scale must be positive and margin must be an integer of at least four modules');
  }
  if (!matrix || !Number.isInteger(matrix.size) || matrix.size <= 0 || typeof matrix.isDark !== 'function') {
    throw new TypeError('Receipt QR matrix is invalid');
  }
  const context = canvas?.getContext?.('2d');
  if (!context) throw new TypeError('Receipt QR canvas is unavailable');
  const length = (matrix.size + margin * 2) * scale;
  canvas.width = length;
  canvas.height = length;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, length, length);
  context.fillStyle = '#000';
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.isDark(row, column)) {
        context.fillRect((column + margin) * scale, (row + margin) * scale, scale, scale);
      }
    }
  }
  return canvas;
}
