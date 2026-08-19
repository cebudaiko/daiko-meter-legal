const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_EDGE = 12_000;
const MAX_IMAGE_PIXELS = 80_000_000;
const MAX_PREVIEW_EDGE = 2_048;

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export function detectRateImageMime(bytes) {
  const source = asBytes(bytes);
  if (!source) return null;
  if (source[0] === 0xFF && source[1] === 0xD8) return 'image/jpeg';
  if (
    source[0] === 0x89 && source[1] === 0x50 && source[2] === 0x4E && source[3] === 0x47
    && source[4] === 0x0D && source[5] === 0x0A && source[6] === 0x1A && source[7] === 0x0A
  ) return 'image/png';
  if (
    source[0] === 0x52 && source[1] === 0x49 && source[2] === 0x46 && source[3] === 0x46
    && source[8] === 0x57 && source[9] === 0x45 && source[10] === 0x42 && source[11] === 0x50
  ) return 'image/webp';
  return null;
}

function closeBitmap(bitmap) {
  try {
    bitmap?.close?.();
  } catch {
    // Releasing an already-invalid browser bitmap must not change validation outcomes.
  }
}

function defaultCreateCanvas(width, height) {
  const canvas = globalThis.OffscreenCanvas
    ? new globalThis.OffscreenCanvas(width, height)
    : globalThis.document?.createElement?.('canvas');
  if (!canvas) throw new TypeError('Image canvas is unavailable');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function resolveDeps(deps = {}) {
  const nativeCreateImageBitmap = globalThis.createImageBitmap;
  return {
    createImageBitmap: deps.createImageBitmap
      ?? (typeof nativeCreateImageBitmap === 'function' ? nativeCreateImageBitmap.bind(globalThis) : undefined),
    createCanvas: deps.createCanvas ?? defaultCreateCanvas,
    createObjectURL: deps.createObjectURL ?? ((blob) => globalThis.URL?.createObjectURL?.(blob)),
    revokeObjectURL: deps.revokeObjectURL ?? ((url) => globalThis.URL?.revokeObjectURL?.(url)),
  };
}

async function readImageHeader(file) {
  if (!file || typeof file.slice !== 'function') throw new TypeError('Invalid image file');
  let header;
  try {
    header = await file.slice(0, 16).arrayBuffer();
  } catch {
    throw new TypeError('Image file could not be read');
  }
  return new Uint8Array(header);
}

function assertFileSize(file) {
  if (!Number.isFinite(file?.size) || file.size < 0 || file.size > MAX_FILE_BYTES) {
    throw new RangeError('Image file size is invalid');
  }
}

function assertDimensions(bitmap) {
  const { width, height } = bitmap ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('Image dimensions are invalid');
  }
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new RangeError('Image dimensions exceed the allowed limit');
  }
  return { width, height };
}

async function decodeValidatedRateImage(file, deps) {
  assertFileSize(file);
  const mime = detectRateImageMime(await readImageHeader(file));
  if (!mime) throw new TypeError('Unsupported image file');
  const declaredMime = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (declaredMime && declaredMime !== mime) throw new TypeError('Image MIME does not match its file data');
  if (typeof deps.createImageBitmap !== 'function') throw new TypeError('Image decoder is unavailable');

  let bitmap;
  try {
    bitmap = await deps.createImageBitmap(file);
  } catch {
    throw new TypeError('Image decoder rejected the file');
  }
  try {
    return { mime, bitmap, ...assertDimensions(bitmap) };
  } catch (error) {
    closeBitmap(bitmap);
    throw error;
  }
}

export async function validateRateImageFile(file, deps = {}) {
  const decoded = await decodeValidatedRateImage(file, resolveDeps(deps));
  try {
    return { mime: decoded.mime, width: decoded.width, height: decoded.height };
  } finally {
    closeBitmap(decoded.bitmap);
  }
}

async function canvasBlob(canvas) {
  if (typeof canvas?.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/png' });
  if (typeof canvas?.toBlob !== 'function') throw new TypeError('Image canvas cannot export a blob');
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new TypeError('Image canvas export failed'));
    }, 'image/png');
  });
}

function previewDimensions(width, height) {
  const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function preprocessRateImage(file, deps = {}) {
  const browser = resolveDeps(deps);
  const decoded = await decodeValidatedRateImage(file, browser);
  try {
    const output = previewDimensions(decoded.width, decoded.height);
    if (typeof browser.createCanvas !== 'function') throw new TypeError('Image canvas is unavailable');
    const canvas = browser.createCanvas(output.width, output.height);
    const context = canvas?.getContext?.('2d');
    if (!context || typeof context.drawImage !== 'function') throw new TypeError('Image canvas is unavailable');
    context.drawImage(decoded.bitmap, 0, 0, output.width, output.height);
    const blob = await canvasBlob(canvas);
    if (!blob) throw new TypeError('Image canvas export failed');
    const previewUrl = browser.createObjectURL(blob);
    if (typeof previewUrl !== 'string' || !previewUrl) throw new TypeError('Image preview URL is unavailable');

    let disposed = false;
    return {
      blob,
      previewUrl,
      ...output,
      dispose() {
        if (disposed) return;
        disposed = true;
        try {
          browser.revokeObjectURL(previewUrl);
        } finally {
          closeBitmap(decoded.bitmap);
        }
      },
    };
  } catch (error) {
    closeBitmap(decoded.bitmap);
    throw error;
  }
}
