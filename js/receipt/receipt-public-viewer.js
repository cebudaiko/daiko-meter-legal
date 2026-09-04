import { decodeReceiptQrFragment } from './receipt-qr-payload.js';
import { loadReceiptQrRuntime } from './receipt-qr-runtime.js';
import { buildReceiptPdf } from './receipt-pdf.js';
import { receiptMarkup } from './receipt-markup.js';

const INVALID_MESSAGE = '領収証データを読み取れません';
const READY_MESSAGE = '領収証を表示しています。';

function requiredElement(documentRef, id) {
  const element = documentRef?.getElementById?.(id);
  if (!element) throw new TypeError(`Public receipt element is missing: ${id}`);
  return element;
}

function fragmentFrom(locationRef) {
  const hash = locationRef?.hash;
  if (typeof hash !== 'string' || hash.length <= 1) throw new TypeError('Receipt fragment is missing');
  return hash.slice(1);
}

function invalidMarkup() {
  return `<section class="receipt-public-error" role="alert"><h1>${INVALID_MESSAGE}</h1><p>QRコードをもう一度読み取るか、発行元へご確認ください。</p></section>`;
}

async function decodePublicFragment(fragment, { decodeFragment, loadRuntime }) {
  if (decodeFragment) return decodeFragment(fragment);
  const runtime = await loadRuntime();
  return decodeReceiptQrFragment(fragment, { decompress: runtime.decompressReceiptQrPayload });
}

/** Maps only QR-schema receipt fields into the rendering/PDF model. */
export function publicReceiptToDisplayModel(value) {
  if (!value || typeof value !== 'object' || value.v !== 1) throw new TypeError('Unsupported public receipt');
  const fees = value.fees ?? {};
  return {
    receiptNumber: value.n,
    issuedDateTime: value.at,
    totalFare: value.total,
    baseFare: fees.base,
    daySurchargeFee: fees.day,
    winterSurchargeFee: fees.winter,
    timeFee: fees.time,
    waitFee: fees.wait,
    optionFee: fees.option,
    optionDetails: Array.isArray(value.options) ? value.options.map(({ label, amount }) => ({ label, amount })) : [],
    note: value.note,
    issuer: {
      name: value.issuer?.name,
      registrationNumber: value.issuer?.registrationNumber,
      address: value.issuer?.address,
      phone: value.issuer?.phone,
    },
    // The public viewer intentionally never receives or renders trip/customer fields.
    addressee: '', companyName: '', carNumber: '', routeText: '',
    distanceText: '', serviceDurationText: '', waitDurationText: '',
    hideTripDetails: true,
  };
}

function appendDownloadLink(documentRef, createDownloadLink) {
  const link = createDownloadLink?.() ?? documentRef?.createElement?.('a');
  if (!link) throw new TypeError('Browser download is unavailable');
  if (!createDownloadLink && documentRef?.body?.append) documentRef.body.append(link);
  return link;
}

export async function mountPublicReceipt({
  root,
  locationRef = globalThis.location,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  decodeFragment,
  loadRuntime = loadReceiptQrRuntime,
  buildPdf = buildReceiptPdf,
  createObjectUrl = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
  revokeObjectUrl = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
  createDownloadLink,
  setTimeoutFn = globalThis.setTimeout,
} = {}) {
  const documentRoot = root ?? requiredElement(documentRef, 'receiptPublicDocument');
  const status = requiredElement(documentRef, 'receiptPublicStatus');
  const downloadButton = requiredElement(documentRef, 'receiptPublicDownload');
  const printButton = requiredElement(documentRef, 'receiptPublicPrint');
  let model;
  try {
    const decoded = await decodePublicFragment(fragmentFrom(locationRef), { decodeFragment, loadRuntime });
    model = publicReceiptToDisplayModel(decoded);
  } catch {
    documentRoot.innerHTML = invalidMarkup();
    status.textContent = INVALID_MESSAGE;
    downloadButton.disabled = true;
    printButton.disabled = true;
    return 'invalid';
  }

  documentRoot.innerHTML = receiptMarkup(model, { includeTripDetails: false, includeQr: false });
  status.textContent = READY_MESSAGE;
  downloadButton.disabled = false;
  printButton.disabled = false;

  let downloadPromise = null;
  downloadButton.addEventListener('click', async (event) => {
    event?.preventDefault?.();
    if (downloadPromise) return downloadPromise;
    downloadPromise = (async () => {
      downloadButton.disabled = true;
      status.textContent = 'PDFを作成しています。';
      try {
        const pdf = await buildPdf(model, { documentRef });
        if (typeof createObjectUrl !== 'function' || typeof revokeObjectUrl !== 'function') throw new TypeError('Browser download is unavailable');
        const href = createObjectUrl(new Blob([pdf], { type: 'application/pdf' }));
        const link = appendDownloadLink(documentRef, createDownloadLink);
        link.href = href;
        link.download = `jirochanzu-receipt-${model.receiptNumber}.pdf`;
        link.click();
        setTimeoutFn(() => {
          revokeObjectUrl(href);
          link.remove?.();
        }, 10_000);
        status.textContent = 'PDFを保存しました。';
      } catch {
        status.textContent = 'PDFを保存できませんでした。ブラウザの印刷からPDF保存してください。';
      } finally {
        downloadButton.disabled = false;
        downloadPromise = null;
      }
    })();
    return downloadPromise;
  });
  printButton.addEventListener('click', (event) => {
    event?.preventDefault?.();
    windowRef?.print?.();
  });
  return 'ready';
}

if (globalThis.document?.getElementById?.('receiptPublicDocument')) {
  void mountPublicReceipt();
}
