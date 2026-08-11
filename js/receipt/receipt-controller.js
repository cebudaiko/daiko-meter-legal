import { buildReceiptModel } from './receipt-model.js';
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
  print = () => globalThis.print?.(),
  showToast = () => {},
} = {}) {
  const screen = root.querySelector?.('#receiptScreen');
  const documentRoot = root.querySelector?.('#receiptDocument');
  const addresseeInput = root.querySelector?.('#receiptAddressee');
  const saveAddressee = root.querySelector?.('#receiptSaveAddressee');
  const printButton = root.querySelector?.('#receiptPrint');
  const shareButton = root.querySelector?.('#receiptShare');
  const closeButton = root.querySelector?.('#receiptClose');
  const status = root.querySelector?.('#receiptStatus');
  const memory = new Map();
  const shareFn = share === undefined ? globalThis.navigator?.share?.bind(globalThis.navigator) : share;
  let currentRecord = null;
  let currentModel = null;

  function currentIssuer() {
    return typeof issuer === 'function' ? issuer() : issuer;
  }

  function render() {
    if (!currentRecord) return null;
    const key = currentModel?.recordId || buildReceiptModel(currentRecord).recordId;
    const addressee = memory.has(key) ? memory.get(key) : currentRecord.receiptAddressee;
    currentModel = buildReceiptModel(currentRecord, { issuer: currentIssuer(), addressee });
    renderReceipt(documentRoot, currentModel);
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
    const model = render();
    if (addresseeInput) addresseeInput.value = model.addressee;
    if (saveAddressee) saveAddressee.checked = false;
    if (status) status.textContent = '';
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
    if (!addresseeSaved) showToast(ADDRESSEE_SAVE_ERROR, 'error');
  }

  function printReceipt() {
    rememberAddressee();
    persistAddressee();
    print?.();
  }

  async function shareReceipt() {
    rememberAddressee();
    const addresseeSaved = persistAddressee();
    if (!currentModel) return 'unavailable';
    if (typeof shareFn !== 'function') {
      if (status) {
        const unsupported = 'この端末では共有できません。「印刷 / PDF」で保存してください。';
        status.textContent = addresseeSaved ? unsupported : `${ADDRESSEE_SAVE_ERROR} ${unsupported}`;
      }
      return 'unsupported';
    }
    try {
      await shareFn(sharePayload(currentModel));
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

  addresseeInput?.addEventListener?.('input', rememberAddressee);
  printButton?.addEventListener?.('click', printReceipt);
  shareButton?.addEventListener?.('click', () => { shareReceipt(); });
  closeButton?.addEventListener?.('click', close);

  return {
    close,
    open,
    print: printReceipt,
    share: shareReceipt,
    isOpen: () => Boolean(currentRecord && screen && !screen.hidden),
  };
}
