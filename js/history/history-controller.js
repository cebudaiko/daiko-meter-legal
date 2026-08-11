import { getConfig } from '../fare.js';
import { deleteRecord, getHistoryCapacity, loadRecords } from '../history.js';
import { renderHistoryView } from '../ui/history-view.js';
import { recordsToCsv } from './csv.js';
import { deliverDailyCsv } from './csv-delivery.js';
import { buildHistoryModel } from './model.js';
import { getHistoryStorageStatus } from './storage.js';

function shiftDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return day;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function closestData(event, selector, attribute) {
  return event?.target?.closest?.(selector)?.getAttribute?.(attribute) || '';
}

export function createHistoryController({
  els,
  now = () => new Date(),
  cutoff = () => getConfig()?.operatingDayCutoff || '14:00',
  loadRecordsFn = loadRecords,
  deleteRecordFn = deleteRecord,
  getCapacityFn = getHistoryCapacity,
  getStorageStatusFn = getHistoryStorageStatus,
  recordsToCsvFn = recordsToCsv,
  deliverDailyCsvFn = deliverDailyCsv,
  renderView = renderHistoryView,
  confirmDelete = () => globalThis.confirm?.('この走行記録を削除しますか？') ?? true,
  showToast = () => {},
  onReceipt = () => {},
} = {}) {
  let selectedDay = '';
  let model = null;

  function render() {
    const records = loadRecordsFn({ fallbackCutoff: cutoff() });
    model = buildHistoryModel(records, { selectedDay, now: now(), cutoff: cutoff() });
    selectedDay = model.selectedDay;
    renderView(els, model, { ...getCapacityFn(records), ...getStorageStatusFn() });
    return model;
  }

  function selectDay(day) {
    selectedDay = day;
    return render();
  }

  function moveDay(amount) {
    const current = model || render();
    const candidate = shiftDay(current.selectedDay, amount);
    if (candidate > current.todayOperatingDay) return current;
    return selectDay(candidate);
  }

  async function exportSelectedDay() {
    const current = model || render();
    if (!current.dayRecords.length) {
      showToast('選択日の走行記録はありません', 'warning');
      return null;
    }
    const result = await deliverDailyCsvFn({
      csv: recordsToCsvFn(current.dayRecords),
      day: current.selectedDay,
      navigatorRef: globalThis.navigator,
      documentRef: globalThis.document,
    });
    showToast(result === 'shared' ? '選択日のCSVを共有しました' : '選択日のCSVを書き出しました', 'success');
    return result;
  }

  els?.historyDayNav?.addEventListener?.('click', (event) => {
    const amount = Number(closestData(event, '[data-history-shift]', 'data-history-shift'));
    if (amount === -1 || amount === 1) moveDay(amount);
  });
  els?.historyMonthDays?.addEventListener?.('click', (event) => {
    const day = closestData(event, '[data-history-day]', 'data-history-day');
    if (day) selectDay(day);
  });
  els?.historyList?.addEventListener?.('click', (event) => {
    const id = closestData(event, '.history-item-delete', 'data-record-id');
    if (id && confirmDelete()) {
      deleteRecordFn(id);
      render();
      return;
    }
    const receiptId = closestData(event, '.history-item-receipt', 'data-record-id');
    if (receiptId) onReceipt(receiptId);
  });
  els?.historyExportDay?.addEventListener?.('click', () => {
    exportSelectedDay().catch((error) => {
      if (error?.name !== 'AbortError') showToast('CSVを書き出せませんでした', 'error');
    });
  });

  return {
    exportSelectedDay,
    moveDay,
    render,
    selectDay,
    get selectedDay() { return selectedDay; },
  };
}
