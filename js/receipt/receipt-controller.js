import { buildReceiptModel } from './receipt-model.js';
import { deliverReceiptAttachment } from './receipt-delivery.js';
import { deliverReceiptQrPng } from './receipt-qr-delivery.js';
import { createReceiptQrMatrix, paintReceiptQrCanvas, receiptQrUrl } from './receipt-qr-runtime.js';
import { renderReceipt } from '../ui/receipt-view.js';

const ADDRESSEE_SAVE_ERROR = '宛名を履歴に保存できませんでした。領収証はこのまま利用できます。';

function plainText(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

function sharePayload(model) {
  const issuer = Object.values(model.issuer || {}).map(plainText).filter(Boolean).join(' / ');
  const lines = [
    `領収金額: ¥${model.totalFare.toLocaleString('ja-JP')}`,
    `領収番号: ${plainText(model.receiptNumber)}`,
    issuer ? `発行者: ${issuer}` : '',
  ].filter(Boolean);
  return {
    title: `領収証 ${plainText(model.receiptNumber)}`,
    text: lines.join('\n'),
  };
}

export function createReceiptController({
  root = document,
  lookupRecord = () => null,
  updateRecord = () => null,
  issuer = {},
  share,
  delivery = deliverReceiptAttachment,
  deliverQrPng = deliverReceiptQrPng,
  receiptQrUrl: createQrUrl = receiptQrUrl,
  createReceiptQrMatrix: createQrMatrix = createReceiptQrMatrix,
  paintReceiptQrCanvas: paintQrCanvas = paintReceiptQrCanvas,
  print = () => globalThis.print?.(),
  showToast = () => {},
} = {}) {
  const screen = root.querySelector?.('#receiptScreen');
  const documentRoot = root.querySelector?.('#receiptDocument');
  const addresseeInput = root.querySelector?.('#receiptAddressee');
  const saveAddressee = root.querySelector?.('#receiptSaveAddressee');
  const printButton = root.querySelector?.('#receiptPrint');
  const shareButton = root.querySelector?.('#receiptShare');
  const qrSaveButton = root.querySelector?.('#receiptQrSave');
  const closeButton = root.querySelector?.('#receiptClose');
  const status = root.querySelector?.('#receiptStatus');
  const memory = new Map();
  const shareFn = share;
  let currentRecord = null;
  let currentModel = null;
  let shareOperation = null;
  let qrSaveOperation = null;
  let renderRevision = 0;
  let paintedQrRevision = 0;

  function currentIssuer() {
    return typeof issuer === 'function' ? issuer() : issuer;
  }

  function qrFailureMessage(error) {
    if (/too large|上限/i.test(String(error?.message || ''))) {
      return 'QRデータが上限を超えたため表示できません。印刷 / PDF は引き続き利用できます。';
    }
    return 'QRを生成できませんでした。印刷 / PDF は引き続き利用できます。';
  }

  function qrSaveIsReady() {
    return Boolean(currentRecord && currentModel
      && paintedQrRevision === renderRevision && !qrSaveOperation);
  }

  function syncQrSaveButton() {
    if (qrSaveButton) qrSaveButton.disabled = !qrSaveIsReady();
  }

  async function renderReceiptQr(model, revision) {
    syncQrSaveButton();
    if (status) status.textContent = 'QRを生成しています…';
    try {
      const url = await createQrUrl(model);
      const matrix = await createQrMatrix(url);
      if (revision !== renderRevision || !currentRecord) return;
      const canvas = root.querySelector?.('[data-receipt-qr-canvas]');
      if (!canvas) throw new TypeError('Receipt QR canvas is unavailable');
      paintQrCanvas(canvas, matrix);
      paintedQrRevision = revision;
      syncQrSaveButton();
      if (status) status.textContent = 'QRを読み取って領収証を保存できます。';
    } catch (error) {
      if (revision !== renderRevision || !currentRecord) return;
      syncQrSaveButton();
      if (status) status.textContent = qrFailureMessage(error);
    }
  }

  function render() {
    if (!currentRecord) return null;
    const key = currentModel?.recordId || buildReceiptModel(currentRecord).recordId;
    const addressee = memory.has(key) ? memory.get(key) : currentRecord.receiptAddressee;
    currentModel = buildReceiptModel(currentRecord, { issuer: currentIssuer(), addressee });
    renderReceipt(documentRoot, currentModel);
    renderRevision += 1;
    paintedQrRevision = 0;
    syncQrSaveButton();
    void renderReceiptQr(currentModel, renderRevision);
    return currentModel;
  }

  function rememberAddressee() {
    if (!currentModel) return;
    memory.set(currentModel.recordId, String(addresseeInput?.value || '').trim());
    render();
  }

  function persistAddressee() {
    if (!currentModel || !saveAddressee?.checked) return true;
    const value = memory.has(currentModel.recordId)
      ? memory.get(currentModel.recordId)
      : String(addresseeInput?.value || '').trim();
    let updated = null;
    try {
      updated = updateRecord(currentModel.recordId, (record) => ({ ...record, receiptAddressee: value }));
    } catch {
      updated = null;
    }
    if (!updated) {
      if (status) status.textContent = ADDRESSEE_SAVE_ERROR;
      return false;
    }
    currentRecord = updated;
    return true;
  }

  function open(recordOrId) {
    const record = recordOrId && typeof recordOrId === 'object'
      ? recordOrId
      : lookupRecord(String(recordOrId ?? ''));
    if (!record) return null;
    currentRecord = record;
    currentModel = null;
    if (status) status.textContent = '';
    const model = render();
    if (addresseeInput) addresseeInput.value = model.addressee;
    if (saveAddressee) saveAddressee.checked = false;
    if (screen) screen.hidden = false;
    addresseeInput?.focus?.();
    return model;
  }

  function close() {
    rememberAddressee();
    const addresseeSaved = persistAddressee();
    if (screen) screen.hidden = true;
    if (saveAddressee) saveAddressee.checked = false;
    currentRecord = null;
    currentModel = null;
    renderRevision += 1;
    paintedQrRevision = 0;
    syncQrSaveButton();
    if (!addresseeSaved) showToast(ADDRESSEE_SAVE_ERROR, 'error');
  }

  function printReceipt() {
    rememberAddressee();
    persistAddressee();
    print?.();
  }

  async function canvasPngBytes(canvas) {
    if (typeof canvas?.toBlob !== 'function') throw new TypeError('Receipt QR canvas is unavailable');
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || typeof blob.arrayBuffer !== 'function') throw new TypeError('Receipt QR PNG is unavailable');
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function performSaveQr({ model, canvas, revision }) {
    try {
      const pngBytes = await canvasPngBytes(canvas);
      const result = await deliverQrPng({ model, pngBytes });
      if (status && revision === renderRevision) {
        status.textContent = result === 'unsupported'
          ? 'この端末ではQR画像を保存できませんでした。'
          : result === 'shared'
            ? 'QR画像を共有しました。'
            : 'QR画像を保存しました。';
      }
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') return 'aborted';
      if (status && revision === renderRevision) status.textContent = 'QR画像を保存できませんでした。';
      return 'failed';
    }
  }

  function saveQr() {
    if (qrSaveOperation) return qrSaveOperation;
    const canvas = root.querySelector?.('[data-receipt-qr-canvas]');
    if (!qrSaveIsReady() || !canvas) return Promise.resolve('unsupported');
    const snapshot = { model: currentModel, canvas, revision: renderRevision };
    const tracked = performSaveQr(snapshot).finally(() => {
      if (qrSaveOperation === tracked) qrSaveOperation = null;
      syncQrSaveButton();
    });
    qrSaveOperation = tracked;
    syncQrSaveButton();
    return tracked;
  }

  async function performShareReceipt() {
    rememberAddressee();
    const addresseeSaved = persistAddressee();
    if (!currentModel) return 'unavailable';
    if (shareFn !== undefined && typeof shareFn !== 'function') {
      if (status) {
        const unsupported = 'この端末では共有できません。「印刷 / PDF」で保存してください。';
        status.textContent = addresseeSaved ? unsupported : `${ADDRESSEE_SAVE_ERROR} ${unsupported}`;
      }
      return 'unsupported';
    }
    try {
      const payload = sharePayload(currentModel);
      let result;
      if (typeof shareFn === 'function') {
        await shareFn(payload);
        result = 'shared';
      } else {
        result = await delivery({ model: currentModel, payload });
      }
      if (result === 'unsupported') {
        if (status) {
          const unsupported = 'この端末では領収証ファイルを共有できません。「印刷 / PDF」で保存してください。';
          status.textContent = addresseeSaved ? unsupported : `${ADDRESSEE_SAVE_ERROR} ${unsupported}`;
        }
        return 'unsupported';
      }
      if (status && addresseeSaved) status.textContent = '領収証を共有しました。';
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'aborted';
      if (status) {
        const failed = '領収証を共有できませんでした。「印刷 / PDF」をお使いください。';
        status.textContent = addresseeSaved ? failed : `${ADDRESSEE_SAVE_ERROR} ${failed}`;
      }
      return 'failed';
    }
  }

  function shareReceipt() {
    if (shareOperation) return shareOperation;
    if (shareButton) shareButton.disabled = true;
    const tracked = performShareReceipt().finally(() => {
      if (shareOperation === tracked) shareOperation = null;
      if (shareButton) shareButton.disabled = false;
    });
    shareOperation = tracked;
    return tracked;
  }

  addresseeInput?.addEventListener?.('input', rememberAddressee);
  printButton?.addEventListener?.('click', printReceipt);
  shareButton?.addEventListener?.('click', () => { shareReceipt(); });
  qrSaveButton?.addEventListener?.('click', () => { saveQr(); });
  closeButton?.addEventListener?.('click', close);

  return {
    close,
    open,
    print: printReceipt,
    saveQr,
    share: shareReceipt,
    isOpen: () => Boolean(currentRecord && screen && !screen.hidden),
  };
}
