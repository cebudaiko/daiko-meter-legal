import {
  createReceiptQrMatrix,
  paintReceiptQrCanvas,
  receiptQrUrl,
} from './receipt-qr-runtime.js';

const A4_WIDTH_POINTS = 595;
const A4_HEIGHT_POINTS = 842;
const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const FONT_SANS = '"Noto Sans JP", "Yu Gothic", "Hiragino Sans", sans-serif';
const FONT_SERIF = '"Yu Mincho", "Hiragino Mincho ProN", serif';
const PDF_QR_SIZE = 200;
const PDF_QR_X = PAGE_WIDTH - 100 - PDF_QR_SIZE;
const PDF_QR_Y = 1418;

function yen(value) {
  const number = Number(value);
  const integer = Number.isFinite(number) ? Math.trunc(number) : 0;
  return `¥${integer.toLocaleString('ja-JP')}`;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function surchargeRows(labels, percentFee, fixedFee, totalFee) {
  const percent = nonNegativeInteger(percentFee);
  const fixed = nonNegativeInteger(fixedFee);
  const total = nonNegativeInteger(totalFee);
  if (total <= 0 && percent <= 0 && fixed <= 0) return [];
  return [
    [labels.total, yen(total), 'group'],
    ...(percent > 0 ? [[labels.percent, yen(percent), 'subordinate']] : []),
    ...(fixed > 0 ? [[labels.fixed, yen(fixed), 'subordinate']] : []),
  ];
}

export function receiptPdfContent(model = {}) {
  const issuer = model.issuer && typeof model.issuer === 'object' ? model.issuer : {};
  const options = Array.isArray(model.optionDetails) ? model.optionDetails : [];
  const hideTripDetails = model.hideTripDetails === true;
  const trip = hideTripDetails ? '' : [model.companyName, model.carNumber].filter(Boolean).join(' ・ ');
  const issueText = model.issuedDateTime || model.issuedDate || '';

  return {
    title: '領収証',
    addressee: model.addressee ? `${model.addressee} 様` : '',
    total: yen(model.totalFare),
    issuedAt: issueText ? `発行日時  ${issueText}` : '',
    note: model.note ? `但し  ${model.note}` : '',
    feeRows: [
      ['基本料金', yen(model.baseFare), 'normal'],
      ...surchargeRows({
        total: '日中割増計',
        percent: 'うち 日中率割増',
        fixed: 'うち 日中固定加算',
      }, model.daySurchargePercentFee, model.daySurchargeFixedFee, model.daySurchargeFee),
      ...surchargeRows({
        total: '冬期割増計',
        percent: 'うち 冬期率割増',
        fixed: 'うち 冬期固定加算',
      }, model.winterSurchargePercentFee, model.winterSurchargeFixedFee, model.winterSurchargeFee),
      ['時間料金', yen(model.timeFee), 'normal'],
      ['待機料金', yen(model.waitFee), 'normal'],
      ['オプション料金', yen(model.optionFee), 'normal'],
      ...options.map((option) => [option?.label || '', yen(option?.amount), 'subordinate']),
      ['合計', yen(model.totalFare), 'total'],
    ],
    tripFacts: hideTripDetails ? [] : [
      ['走行距離', model.distanceText || '0.0 km'],
      ['実車時間', model.serviceDurationText || '00:00:00'],
      ['待機時間', model.waitDurationText || '00:00:00'],
    ],
    routeText: !hideTripDetails && model.routeText ? `経路  ${model.routeText}` : '',
    tripReference: trip ? `走行記録  ${trip}` : '',
    issuerRows: [
      ...(issuer.name ? [['発行者', issuer.name]] : []),
      ...(issuer.registrationNumber ? [['登録番号', issuer.registrationNumber]] : []),
      ...(issuer.address ? [['所在地', issuer.address]] : []),
      ...(issuer.phone ? [['電話', issuer.phone]] : []),
    ],
    receiptNumber: `RECEIPT NO.  ${model.receiptNumber || ''}`,
  };
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function concatenate(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function buildImagesPdf(images = []) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new TypeError('At least one PDF image is required');
  }
  images.forEach(({ imageBytes, imageWidth, imageHeight, imageFilter = '/DCTDecode', overlays = [] } = {}) => {
    if (!(imageBytes instanceof Uint8Array) || imageBytes.length === 0) {
      throw new TypeError('PDF image bytes are required');
    }
    if (!Number.isInteger(imageWidth) || imageWidth <= 0
      || !Number.isInteger(imageHeight) || imageHeight <= 0) {
      throw new TypeError('PDF image dimensions are invalid');
    }
    if (imageFilter !== '/DCTDecode' && imageFilter !== '/FlateDecode') {
      throw new TypeError('PDF image filter is invalid');
    }
    if (!Array.isArray(overlays)) throw new TypeError('PDF overlays must be an array');
    overlays.forEach(({ imageBytes: overlayBytes, imageWidth: overlayWidth, imageHeight: overlayHeight, imageFilter: overlayFilter = '/DCTDecode', x, y, width, height } = {}) => {
      if (!(overlayBytes instanceof Uint8Array) || overlayBytes.length === 0
        || !Number.isInteger(overlayWidth) || overlayWidth <= 0
        || !Number.isInteger(overlayHeight) || overlayHeight <= 0
        || (overlayFilter !== '/DCTDecode' && overlayFilter !== '/FlateDecode')
        || !Number.isFinite(x) || !Number.isFinite(y)
        || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new TypeError('PDF overlay is invalid');
      }
    });
  });

  const objects = [
    ascii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    null,
  ];
  const pageIds = [];
  let nextId = 3;
  function imageObject(id, { imageBytes, imageWidth, imageHeight, imageFilter }) {
    return concatenate([
      ascii(`${id} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${imageFilter} /Length ${imageBytes.length} >>\nstream\n`),
      imageBytes,
      ascii('\nendstream\nendobj\n'),
    ]);
  }
  images.forEach(({ imageBytes, imageWidth, imageHeight, imageFilter = '/DCTDecode', overlays = [] }, index) => {
    const pageId = nextId;
    const imageId = nextId + 1;
    const overlayIds = overlays.map((_, overlayIndex) => nextId + 2 + overlayIndex);
    const contentsId = nextId + 2 + overlays.length;
    nextId = contentsId + 1;
    pageIds.push(pageId);
    const imageName = `Im${index}`;
    const overlayNames = overlays.map((_, overlayIndex) => `Qr${index}_${overlayIndex}`);
    const resources = [
      `/${imageName} ${imageId} 0 R`,
      ...overlayNames.map((name, overlayIndex) => `/${name} ${overlayIds[overlayIndex]} 0 R`),
    ].join(' ');
    const instructions = [
      `q\n${A4_WIDTH_POINTS} 0 0 ${A4_HEIGHT_POINTS} 0 0 cm\n/${imageName} Do\nQ\n`,
      ...overlays.map((overlay, overlayIndex) => {
        const width = (overlay.width / PAGE_WIDTH) * A4_WIDTH_POINTS;
        const height = (overlay.height / PAGE_HEIGHT) * A4_HEIGHT_POINTS;
        const x = (overlay.x / PAGE_WIDTH) * A4_WIDTH_POINTS;
        const y = ((PAGE_HEIGHT - overlay.y - overlay.height) / PAGE_HEIGHT) * A4_HEIGHT_POINTS;
        return `q\n${width} 0 0 ${height} ${x} ${y} cm\n/${overlayNames[overlayIndex]} Do\nQ\n`;
      }),
    ].join('');
    const contents = ascii(instructions);
    objects.push(
      ascii(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH_POINTS} ${A4_HEIGHT_POINTS}] /Resources << /XObject << ${resources} >> >> /Contents ${contentsId} 0 R >>\nendobj\n`),
      imageObject(imageId, { imageBytes, imageWidth, imageHeight, imageFilter }),
      ...overlays.map((overlay, overlayIndex) => imageObject(overlayIds[overlayIndex], overlay)),
      concatenate([
        ascii(`${contentsId} 0 obj\n<< /Length ${contents.length} >>\nstream\n`),
        contents,
        ascii('endstream\nendobj\n'),
      ]),
    );
  });
  objects[1] = ascii(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${images.length} >>\nendobj\n`);

  const header = ascii('%PDF-1.4\n');
  const offsets = [];
  let cursor = header.length;
  for (const object of objects) {
    offsets.push(cursor);
    cursor += object.length;
  }
  const xrefOffset = cursor;
  const xrefEntries = offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  const trailer = ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefEntries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return concatenate([header, ...objects, trailer]);
}

export function buildImagePdf(image = {}) {
  return buildImagesPdf([image]);
}

function text(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ');
}

function setFont(context, size, weight = 400, family = FONT_SANS) {
  context.font = `${weight} ${size}px ${family}`;
}

function fitFont(context, value, { maxWidth, preferred, minimum = 16, weight = 400, family } = {}) {
  let size = preferred;
  while (size > minimum) {
    setFont(context, size, weight, family);
    if (context.measureText(text(value)).width <= maxWidth) return size;
    size -= 1;
  }
  setFont(context, minimum, weight, family);
  return minimum;
}

function truncateToWidth(context, value, maxWidth) {
  const source = text(value);
  if (context.measureText(source).width <= maxWidth) return source;
  const suffix = '…';
  const characters = [...source];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join('')}${suffix}`;
    if (context.measureText(candidate).width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join('')}${suffix}`;
}

function clippedLine(context, value, maxWidth, overflow, label) {
  const source = text(value);
  const clipped = truncateToWidth(context, source, maxWidth);
  if (clipped !== source) overflow.push([label, source]);
  return clipped;
}

function drawLine(context, x1, y1, x2, y2, color = '#cbd5e1', width = 1) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function drawFeeRows(context, rows, overflow, { left, right, top, bottom }) {
  const rowHeight = Math.max(24, Math.min(50, (bottom - top) / Math.max(rows.length, 1)));
  const fontSize = Math.max(16, Math.min(24, Math.floor(rowHeight * 0.48)));
  rows.forEach(([label, value, modifier], index) => {
    const y = top + (index * rowHeight);
    if (modifier === 'total') {
      context.fillStyle = '#eff6ff';
      context.fillRect(left, y, right - left, rowHeight);
    }
    drawLine(context, left, y + rowHeight, right, y + rowHeight,
      modifier === 'total' ? '#172033' : '#cbd5e1', modifier === 'total' ? 3 : 1);
    const subordinate = modifier === 'subordinate';
    const weight = modifier === 'total' || modifier === 'group' ? 700 : 400;
    setFont(context, subordinate ? Math.max(15, fontSize - 3) : fontSize, weight);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = subordinate ? '#526078' : '#172033';
    context.fillText(
      clippedLine(context, label, right - left - 260, overflow, '料金項目'),
      left + (subordinate ? 28 : 0),
      y + (rowHeight / 2),
    );
    context.textAlign = 'right';
    context.fillText(
      clippedLine(context, value, 230, overflow, `${label}の金額`),
      right,
      y + (rowHeight / 2),
    );
  });
  return top + (rows.length * rowHeight);
}

function drawTripFacts(context, facts, overflow, { left, right, top }) {
  const gap = 18;
  const width = ((right - left) - (gap * 2)) / 3;
  facts.forEach(([label, value], index) => {
    const x = left + (index * (width + gap));
    context.fillStyle = '#f8fafc';
    context.fillRect(x, top, width, 100);
    context.strokeStyle = '#cbd5e1';
    context.lineWidth = 2;
    context.strokeRect(x, top, width, 100);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#526078';
    setFont(context, 18, 500);
    context.fillText(label, x + 18, top + 33);
    context.fillStyle = '#172033';
    fitFont(context, value, { maxWidth: width - 36, preferred: 26, minimum: 18, weight: 700 });
    context.fillText(
      clippedLine(context, value, width - 36, overflow, label),
      x + 18,
      top + 75,
    );
  });
}

function drawReceiptPage(context, content, { qr = null } = {}) {
  const left = 100;
  const right = PAGE_WIDTH - 100;
  const overflow = [];
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.fillStyle = '#1d4ed8';
  context.fillRect(0, 0, PAGE_WIDTH, 14);

  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#526078';
  setFont(context, 18, 700);
  context.fillText('DRIVING SERVICE RECEIPT', left, 82);
  context.fillStyle = '#172033';
  setFont(context, 66, 700, FONT_SERIF);
  context.fillText(content.title, left, 157);
  if (content.issuedAt) {
    context.textAlign = 'right';
    context.fillStyle = '#526078';
    fitFont(context, content.issuedAt, { maxWidth: 500, preferred: 22, minimum: 17, weight: 500 });
    context.fillText(clippedLine(context, content.issuedAt, 500, overflow, '発行日時'), right, 117);
  }

  if (content.addressee) {
    context.textAlign = 'left';
    context.fillStyle = '#172033';
    fitFont(context, content.addressee, { maxWidth: right - left, preferred: 38, minimum: 21, weight: 500 });
    context.fillText(
      clippedLine(context, content.addressee, right - left, overflow, '宛名'),
      left,
      255,
    );
    drawLine(context, left, 272, right, 272, '#172033', 2);
  }

  drawLine(context, left, 320, right, 320, '#172033', 3);
  context.textAlign = 'left';
  context.fillStyle = '#172033';
  setFont(context, 23, 500);
  context.fillText('領収金額', left, 390);
  context.textAlign = 'right';
  fitFont(context, content.total, { maxWidth: 560, preferred: 72, minimum: 46, weight: 700 });
  context.fillText(clippedLine(context, content.total, 560, overflow, '領収金額'), right - 58, 402);
  setFont(context, 18, 500);
  context.fillText('税込', right, 398);
  drawLine(context, left, 432, right, 432, '#172033', 3);

  context.textAlign = 'left';
  context.fillStyle = '#172033';
  setFont(context, 22, 400);
  if (content.note) {
    context.fillText(clippedLine(context, content.note, right - left, overflow, '但し書き'), left, 480);
  }

  const feeTop = 520;
  const feeBottom = 1130;
  const feeEnd = drawFeeRows(context, content.feeRows, overflow, {
    left, right, top: feeTop, bottom: feeBottom,
  });
  const tripTop = Math.max(feeEnd + 34, 1160);
  if (content.tripFacts.length > 0) {
    drawTripFacts(context, content.tripFacts, overflow, { left, right, top: tripTop });
  }
  if (content.routeText) {
    context.textAlign = 'left';
    context.fillStyle = '#526078';
    setFont(context, 18, 500);
    context.fillText(
      clippedLine(context, content.routeText, right - left, overflow, '経路'),
      left,
      tripTop + 135,
    );
  }
  if (content.tripReference) {
    context.textAlign = 'left';
    context.fillStyle = '#526078';
    setFont(context, 18, 400);
    context.fillText(
      clippedLine(context, content.tripReference, right - left, overflow, '走行記録'),
      left,
      tripTop + (content.routeText ? 170 : 135),
    );
  }

  const footerTop = Math.max(tripTop + (content.routeText ? 225 : 190), 1435);
  drawLine(context, left, footerTop - 30, right, footerTop - 30, '#cbd5e1', 2);
  context.textAlign = 'left';
  const issuerValueWidth = qr ? 410 : 480;
  content.issuerRows.forEach(([label, value], index) => {
    const y = footerTop + (index * 40);
    context.fillStyle = '#526078';
    setFont(context, 18, 500);
    context.fillText(label, left, y);
    context.fillStyle = '#172033';
    fitFont(context, value, { maxWidth: issuerValueWidth, preferred: label === '発行者' ? 24 : 19, minimum: 14, weight: label === '発行者' ? 700 : 400 });
    context.fillText(clippedLine(context, value, issuerValueWidth, overflow, label), left + 110, y);
  });

  if (qr) {
    context.fillStyle = '#eff6ff';
    context.fillRect(PDF_QR_X, 1632, PDF_QR_SIZE, 64);
    context.fillStyle = '#1d4ed8';
    context.fillRect(PDF_QR_X, 1632, 6, 64);
    context.fillStyle = '#172033';
    context.textAlign = 'left';
    fitFont(context, content.receiptNumber, { maxWidth: PDF_QR_SIZE - 26, preferred: 14, minimum: 10, weight: 700 });
    context.fillText(
      clippedLine(context, content.receiptNumber, PDF_QR_SIZE - 26, overflow, '領収番号'),
      PDF_QR_X + 18,
      1670,
    );
    return overflow;
  }

  context.fillStyle = '#eff6ff';
  context.fillRect(right - 430, footerTop - 4, 430, 90);
  context.fillStyle = '#1d4ed8';
  context.fillRect(right - 430, footerTop - 4, 8, 90);
  context.fillStyle = '#172033';
  context.textAlign = 'left';
  fitFont(context, content.receiptNumber, { maxWidth: 380, preferred: 20, minimum: 13, weight: 700 });
  context.fillText(
    clippedLine(context, content.receiptNumber, 380, overflow, '領収番号'),
    right - 397,
    footerTop + 48,
  );
  return overflow;
}

function jpegBytesFromCanvas(canvas, atobFn) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
  const separator = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:image/jpeg;base64,') || separator === -1) {
    throw new TypeError('Receipt canvas JPEG export failed');
  }
  const binary = atobFn(dataUrl.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function losslessPdfImageFromCanvas(canvas, documentRef) {
  const compressionStream = documentRef?.defaultView?.CompressionStream ?? globalThis.CompressionStream;
  const context = canvas?.getContext?.('2d');
  if (typeof compressionStream !== 'function' || !context?.getImageData || typeof Response !== 'function') return null;
  try {
    const { width: imageWidth, height: imageHeight } = canvas;
    const rgba = context.getImageData(0, 0, imageWidth, imageHeight).data;
    const rgb = new Uint8Array(imageWidth * imageHeight * 3);
    for (let source = 0, target = 0; source < rgba.length; source += 4) {
      rgb[target] = rgba[source];
      rgb[target + 1] = rgba[source + 1];
      rgb[target + 2] = rgba[source + 2];
      target += 3;
    }
    const stream = new compressionStream('deflate');
    const writer = stream.writable.getWriter();
    const compressed = new Response(stream.readable).arrayBuffer();
    await writer.write(rgb);
    await writer.close();
    return {
      imageBytes: new Uint8Array(await compressed),
      imageWidth,
      imageHeight,
      imageFilter: '/FlateDecode',
    };
  } catch {
    return null;
  }
}

async function createReceiptPdfQr(model, documentRef, createQrCanvas) {
  try {
    const url = await receiptQrUrl(model);
    const matrix = await createReceiptQrMatrix(url);
    const canvas = createQrCanvas?.() ?? documentRef?.createElement?.('canvas');
    if (!canvas) return null;
    paintReceiptQrCanvas(canvas, matrix, { scale: 4, margin: 4 });
    const image = await losslessPdfImageFromCanvas(canvas, documentRef);
    return image ? { image } : null;
  } catch {
    // QR delivery is optional: the existing PDF must remain available when the QR cannot be made.
    return null;
  }
}

function receiptPdfImageFromCanvas(canvas, atobFn) {
  return {
    imageBytes: jpegBytesFromCanvas(canvas, atobFn),
    imageWidth: PAGE_WIDTH,
    imageHeight: PAGE_HEIGHT,
  };
}

function createReceiptCanvas(documentRef) {
  const canvas = documentRef?.createElement?.('canvas');
  const context = canvas?.getContext?.('2d');
  if (!canvas || !context || typeof canvas.toDataURL !== 'function') {
    throw new TypeError('Receipt PDF canvas is unavailable');
  }
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  return { canvas, context };
}

function wrapToWidth(context, value, maxWidth) {
  const lines = [];
  let current = '';
  let currentWidth = 0;
  for (const character of [...text(value)]) {
    const characterWidth = context.measureText(character).width;
    if (current && currentWidth + characterWidth > maxWidth) {
      lines.push(current);
      current = character;
      currentWidth = characterWidth;
    } else {
      current += character;
      currentWidth += characterWidth;
    }
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

function renderContinuationImages(entries, content, documentRef, atobFn) {
  const images = [];
  const left = 100;
  const right = PAGE_WIDTH - 100;
  const bottom = PAGE_HEIGHT - 105;
  let canvas;
  let context;
  let y;
  let pageNumber = 1;

  function finishPage() {
    if (!canvas || !context) return;
    context.textAlign = 'right';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#526078';
    setFont(context, 17, 500);
    context.fillText(`PAGE ${pageNumber}`, right, PAGE_HEIGHT - 58);
    images.push({
      imageBytes: jpegBytesFromCanvas(canvas, atobFn),
      imageWidth: PAGE_WIDTH,
      imageHeight: PAGE_HEIGHT,
    });
  }

  function startPage() {
    finishPage();
    pageNumber += 1;
    ({ canvas, context } = createReceiptCanvas(documentRef));
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    context.fillStyle = '#1d4ed8';
    context.fillRect(0, 0, PAGE_WIDTH, 14);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#526078';
    setFont(context, 18, 700);
    context.fillText('DRIVING SERVICE RECEIPT', left, 82);
    context.fillStyle = '#172033';
    setFont(context, 44, 700, FONT_SERIF);
    context.fillText('領収証（続き）', left, 146);
    context.textAlign = 'right';
    setFont(context, 17, 700);
    context.fillText(truncateToWidth(context, content.receiptNumber, 470), right, 126);
    drawLine(context, left, 185, right, 185, '#172033', 2);
    y = 235;
  }

  function drawLabel(label, continued = false) {
    if (y + 45 > bottom) startPage();
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#1d4ed8';
    setFont(context, 20, 700);
    context.fillText(`${label}${continued ? '（続き）' : ''}`, left, y);
    y += 38;
  }

  startPage();
  for (const [label, value] of entries) {
    drawLabel(label);
    context.fillStyle = '#172033';
    setFont(context, 23, 400);
    const lines = wrapToWidth(context, value, right - left);
    let continued = false;
    for (const line of lines) {
      if (y + 34 > bottom) {
        startPage();
        drawLabel(label, true);
        context.fillStyle = '#172033';
        setFont(context, 23, 400);
        continued = true;
      }
      context.fillText(line, left, y);
      y += 34;
    }
    drawLine(context, left, y + 4, right, y + 4, '#cbd5e1', 1);
    y += continued ? 30 : 34;
  }
  finishPage();
  return images;
}

export async function renderReceiptPageImages(model = {}, {
  documentRef = globalThis.document,
  createQrCanvas,
} = {}) {
  const atobFn = documentRef?.defaultView?.atob || globalThis.atob;
  if (typeof atobFn !== 'function') throw new TypeError('Receipt PDF Base64 decoder is unavailable');
  try {
    await documentRef?.fonts?.ready;
  } catch {
    // System Japanese fonts remain available even if a web font readiness probe fails.
  }
  const content = receiptPdfContent(model);
  const qr = await createReceiptPdfQr(model, documentRef, createQrCanvas);
  const { canvas, context } = createReceiptCanvas(documentRef);
  const overflow = drawReceiptPage(context, content, { qr });
  const images = [{
    ...receiptPdfImageFromCanvas(canvas, atobFn),
    overlays: qr ? [{
      ...qr.image,
      x: PDF_QR_X,
      y: PDF_QR_Y,
      width: PDF_QR_SIZE,
      height: PDF_QR_SIZE,
    }] : [],
  }];
  if (overflow.length > 0) {
    images.push(...renderContinuationImages(overflow, content, documentRef, atobFn));
  }
  return images;
}

export async function renderReceiptPageImage(model = {}, options = {}) {
  const [image] = await renderReceiptPageImages(model, options);
  return { bytes: image.imageBytes, width: image.imageWidth, height: image.imageHeight };
}

export async function buildReceiptPdf(model = {}, options = {}) {
  const images = await renderReceiptPageImages(model, options);
  return buildImagesPdf(images);
}
