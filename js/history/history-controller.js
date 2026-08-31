import { getConfig } from '../fare.js';
import { deleteRecord, getHistoryCapacity, loadRecords } from '../history.js';
import { HISTORY_RENDER_BATCH_SIZE, renderHistoryView } from '../ui/history-view.js';
import { recordsToCsv } from './csv.js';
import { deliverDailyCsv } from './csv-delivery.js';
import { buildHistoryModel } from './model.js';
import { getHistoryStorageStatus } from './storage.js';
import { buildRewardReport } from './reward-report.js';
import { operatingDayKey } from './operating-day.js';
import {
  normalizeReportTaxRatePercent,
  normalizeRewardProfiles,
} from '../rewards/profile.js';
import { loadSettingsData, saveSettingsData } from '../storage/preferences.js';
import { requestSettingsMutation } from '../app/settings-confirmation.js';

const REPORT_RANGE_ERROR = '終了営業日は開始営業日以降を選んでください。';
const REPORT_TAX_SAVE_ERROR = 'レポート表示用の消費税率を保存できませんでした。もう一度お試しください。';
const reportBindingCleanups = new WeakMap();

function shiftDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return day;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function closestData(event, selector, attribute) {
  return event?.target?.closest?.(selector)?.getAttribute?.(attribute) || '';
}

function exactDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day ? value : '';
}

function loadedRows(loader) {
  try {
    const rows = typeof loader === 'function' ? loader() : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function normalizedCompanyId(value) {
  const candidate = value && typeof value === 'object' ? value.id : value;
  return typeof candidate === 'string' ? candidate.trim() : '';
}

export function createHistoryController({
  els,
  state,
  now = () => new Date(),
  cutoff = () => getConfig()?.operatingDayCutoff || '14:00',
  loadRecordsFn = loadRecords,
  deleteRecordFn = deleteRecord,
  getCapacityFn = getHistoryCapacity,
  getStorageStatusFn = getHistoryStorageStatus,
  recordsToCsvFn = recordsToCsv,
  deliverDailyCsvFn = deliverDailyCsv,
  buildReport = buildRewardReport,
  loadAttendanceRecordsFn,
  loadActiveAttendancesFn,
  attendanceCompanyIdsFn = () => [],
  attendanceStoreFactory,
  readSettingsFn = loadSettingsData,
  saveSettingsFn = saveSettingsData,
  confirmDialog,
  renderView = renderHistoryView,
  confirmDelete = () => globalThis.confirm?.('この走行記録を削除しますか？') ?? true,
  showToast = () => {},
  onReceipt = () => {},
} = {}) {
  let selectedDay = '';
  let model = null;
  let capacity = {};
  let visibleLimit = HISTORY_RENDER_BATCH_SIZE;
  let rewardReport = null;
  let reportInitialized = false;
  let pendingReportTaxValue = null;
  const reportControls = {
    preset: 'today',
    startDay: '',
    endDay: '',
    validStartDay: '',
    validEndDay: '',
    customStartDay: '',
    customEndDay: '',
    profileId: '',
    displayTaxRatePercent: 10,
    profiles: [],
    error: '',
  };

  function currentSettings() {
    let settings = {};
    try {
      const value = readSettingsFn?.();
      settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      settings = {};
    }
    return {
      ...settings,
      rewardProfiles: normalizeRewardProfiles(settings.rewardProfiles),
      reportTaxRatePercent: normalizeReportTaxRatePercent(settings.reportTaxRatePercent),
    };
  }

  function sharedReportTaxRate(settings) {
    if (state && typeof state === 'object'
      && Object.hasOwn(state, 'reportTaxRatePercent')) {
      return normalizeReportTaxRatePercent(state.reportTaxRatePercent);
    }
    return normalizeReportTaxRatePercent(settings?.reportTaxRatePercent);
  }

  function commitSharedReportTaxRate(taxRate) {
    if (state && typeof state === 'object') state.reportTaxRatePercent = taxRate;
    try {
      state?.rewardProfileSettingsController?.setReportTaxRatePercent?.(taxRate);
    } catch {
      // Persistence already committed; a stale settings view must not roll it back.
    }
  }

  function reportAttendance(records, settings) {
    const attendanceRecords = [...loadedRows(loadAttendanceRecordsFn)];
    const activeAttendances = [...loadedRows(loadActiveAttendancesFn)];
    if (typeof attendanceStoreFactory !== 'function') {
      return { attendanceRecords, activeAttendances };
    }

    const companyIds = new Set();
    const addCompanyId = (value) => {
      const id = normalizedCompanyId(value);
      if (id) companyIds.add(id);
    };
    for (const value of loadedRows(attendanceCompanyIdsFn)) addCompanyId(value);
    addCompanyId(settings?.companyId);
    for (const record of Array.isArray(records) ? records : []) addCompanyId(record?.companyId);

    for (const companyId of companyIds) {
      try {
        const store = attendanceStoreFactory(companyId);
        attendanceRecords.push(...loadedRows(() => store?.listCompleted?.()));
        activeAttendances.push(...loadedRows(() => store?.listActive?.()));
      } catch {
        // One unreadable company scope must not hide every other report scope.
      }
    }
    return { attendanceRecords, activeAttendances };
  }

  function rangeForPreset(preset, currentNow, currentCutoff) {
    const today = operatingDayKey(currentNow, currentCutoff);
    if (preset === 'month') return { startDay: `${today.slice(0, 7)}-01`, endDay: today };
    if (preset === 'custom' && reportControls.customStartDay && reportControls.customEndDay) {
      return { startDay: reportControls.customStartDay, endDay: reportControls.customEndDay };
    }
    return { startDay: today, endDay: today };
  }

  function initializeReport(currentNow, currentCutoff, settings) {
    reportControls.profiles = settings.rewardProfiles;
    if (reportControls.profileId
      && !reportControls.profiles.some((row) => row.id === reportControls.profileId)) {
      reportControls.profileId = '';
    }
    if (reportInitialized) return;
    reportInitialized = true;
    reportControls.displayTaxRatePercent = sharedReportTaxRate(settings);
    const range = rangeForPreset('today', currentNow, currentCutoff);
    Object.assign(reportControls, {
      ...range,
      validStartDay: range.startDay,
      validEndDay: range.endDay,
      customStartDay: range.startDay,
      customEndDay: range.endDay,
    });
  }

  function reportWithControls(report = rewardReport) {
    if (!report) return null;
    return {
      ...report,
      controls: {
        preset: reportControls.preset,
        startDay: reportControls.startDay,
        endDay: reportControls.endDay,
        profileId: reportControls.profileId,
        displayTaxRatePercent: reportControls.displayTaxRatePercent,
        profiles: reportControls.profiles.map((row) => ({ ...row })),
        error: reportControls.error,
      },
    };
  }

  function buildCurrentReport(records, currentNow, currentCutoff) {
    const settings = currentSettings();
    const attendance = reportAttendance(records, settings);
    initializeReport(currentNow, currentCutoff, settings);
    reportControls.profiles = settings.rewardProfiles;
    reportControls.displayTaxRatePercent = sharedReportTaxRate(settings);
    if (reportControls.profileId
      && !reportControls.profiles.some((row) => row.id === reportControls.profileId)) {
      reportControls.profileId = '';
    }
    if (reportControls.preset !== 'custom') {
      const range = rangeForPreset(reportControls.preset, currentNow, currentCutoff);
      Object.assign(reportControls, {
        ...range, validStartDay: range.startDay, validEndDay: range.endDay,
      });
    }
    rewardReport = buildReport({
      records,
      attendanceRecords: attendance.attendanceRecords,
      activeAttendances: attendance.activeAttendances,
      rewardProfiles: reportControls.profiles,
      startDay: reportControls.validStartDay,
      endDay: reportControls.validEndDay,
      profileId: reportControls.profileId,
      displayTaxRatePercent: reportControls.displayTaxRatePercent,
      now: currentNow,
    });
    return reportWithControls();
  }

  function restorePendingReportTaxDraft() {
    if (pendingReportTaxValue !== null && els?.rewardReportTaxRate) {
      els.rewardReportTaxRate.value = pendingReportTaxValue;
    }
  }

  function renderCurrent(report = reportWithControls()) {
    if (!model) return null;
    const viewState = report ? { ...report, visibleLimit } : { visibleLimit };
    renderView(els, model, capacity, viewState);
    restorePendingReportTaxDraft();
    return model;
  }

  function render() {
    const currentNow = now();
    const currentCutoff = cutoff();
    const records = loadRecordsFn({ fallbackCutoff: currentCutoff });
    model = buildHistoryModel(records, { selectedDay, now: currentNow, cutoff: currentCutoff });
    selectedDay = model.selectedDay;
    capacity = { ...getCapacityFn(records), ...getStorageStatusFn() };
    return renderCurrent(buildCurrentReport(records, currentNow, currentCutoff));
  }

  function renderPreviousReport() {
    if (!model || !rewardReport) return render();
    return renderCurrent(reportWithControls());
  }

  function selectReportPreset(preset) {
    if (!['today', 'month', 'custom'].includes(preset)) return model;
    const range = rangeForPreset(preset, now(), cutoff());
    Object.assign(reportControls, {
      preset,
      startDay: range.startDay,
      endDay: range.endDay,
      validStartDay: range.startDay,
      validEndDay: range.endDay,
      error: '',
    });
    return render();
  }

  function applyCustomRange(startDay, endDay) {
    Object.assign(reportControls, { preset: 'custom', startDay, endDay });
    const validStartDay = exactDay(startDay);
    const validEndDay = exactDay(endDay);
    if (!validStartDay || !validEndDay || validStartDay > validEndDay) {
      reportControls.error = REPORT_RANGE_ERROR;
      return renderPreviousReport();
    }
    Object.assign(reportControls, {
      validStartDay,
      validEndDay,
      customStartDay: validStartDay,
      customEndDay: validEndDay,
      error: '',
    });
    return render();
  }

  function selectReportProfile(profileId) {
    const candidate = String(profileId ?? '');
    reportControls.profileId = reportControls.profiles.some((row) => row.id === candidate)
      ? candidate : '';
    reportControls.error = '';
    return render();
  }

  function updateReportTaxRate(value) {
    const taxRate = normalizeReportTaxRatePercent(value);
    const draftValue = String(value ?? '');
    pendingReportTaxValue = draftValue;
    const restore = () => {
      pendingReportTaxValue = null;
      if (els?.rewardReportTaxRate) {
        els.rewardReportTaxRate.value = String(sharedReportTaxRate(currentSettings()));
      }
      reportControls.error = '';
      renderPreviousReport();
    };
    const outcome = requestSettingsMutation({
      confirmDialog,
      label: 'レポート表示用の消費税率',
      onCancel: restore,
      onDismiss: restore,
      onConfirm: () => {
        if (['running', 'waiting', 'finalizing'].includes(state?.mode)
          || state?.isFinalizing === true || state?.finalizing === true) {
          restore();
          reportControls.error = '走行中・待機中は報酬設定を変更できません。';
          renderPreviousReport();
          return { ok: false, error: 'active_trip' };
        }
        const settings = currentSettings();
        try {
          const result = saveSettingsFn?.({ ...settings, reportTaxRatePercent: taxRate });
          if (result === false || (result && typeof result === 'object' && result.ok === false)) {
            throw new Error('settings_write_failed');
          }
        } catch {
          pendingReportTaxValue = draftValue;
          reportControls.error = REPORT_TAX_SAVE_ERROR;
          renderPreviousReport();
          return { ok: false, error: 'storage_failed' };
        }
        pendingReportTaxValue = null;
        commitSharedReportTaxRate(taxRate);
        reportControls.displayTaxRatePercent = taxRate;
        if (els?.rewardReportTaxRate) els.rewardReportTaxRate.value = String(taxRate);
        reportControls.error = '';
        render();
        return { ok: true, value: taxRate };
      },
    });
    if (outcome && typeof outcome === 'object') return outcome;
    return { ok: true, pending: true, value: taxRate };
  }

  function syncReportTaxRate(value) {
    const taxRate = normalizeReportTaxRatePercent(value);
    pendingReportTaxValue = null;
    if (state && typeof state === 'object') state.reportTaxRatePercent = taxRate;
    reportControls.displayTaxRatePercent = taxRate;
    reportControls.error = '';
    if (els?.rewardReportTaxRate) els.rewardReportTaxRate.value = String(taxRate);
    if (reportInitialized && model) render();
    return taxRate;
  }

  function selectDay(day) {
    selectedDay = day;
    visibleLimit = HISTORY_RENDER_BATCH_SIZE;
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
    const loadMore = event?.target?.closest?.('[data-history-load-more]');
    if (loadMore && model) {
      visibleLimit += HISTORY_RENDER_BATCH_SIZE;
      renderCurrent();
      return;
    }
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

  const reportBindingKey = els?.rewardReportPresets || els?.rewardReportStart
    || els?.rewardReportProfile || els?.rewardReportTaxRate;
  reportBindingCleanups.get(reportBindingKey)?.();
  const onPresetClick = (event) => {
    const preset = closestData(event, '[data-report-preset]', 'data-report-preset');
    if (preset) selectReportPreset(preset);
  };
  const onRangeChange = () => applyCustomRange(
    String(els?.rewardReportStart?.value || ''),
    String(els?.rewardReportEnd?.value || ''),
  );
  const onProfileChange = () => selectReportProfile(els?.rewardReportProfile?.value);
  const onTaxChange = () => updateReportTaxRate(els?.rewardReportTaxRate?.value);
  els?.rewardReportPresets?.addEventListener?.('click', onPresetClick);
  els?.rewardReportStart?.addEventListener?.('change', onRangeChange);
  els?.rewardReportEnd?.addEventListener?.('change', onRangeChange);
  els?.rewardReportProfile?.addEventListener?.('change', onProfileChange);
  els?.rewardReportTaxRate?.addEventListener?.('change', onTaxChange);
  const cleanupReportBindings = () => {
    els?.rewardReportPresets?.removeEventListener?.('click', onPresetClick);
    els?.rewardReportStart?.removeEventListener?.('change', onRangeChange);
    els?.rewardReportEnd?.removeEventListener?.('change', onRangeChange);
    els?.rewardReportProfile?.removeEventListener?.('change', onProfileChange);
    els?.rewardReportTaxRate?.removeEventListener?.('change', onTaxChange);
  };
  if (reportBindingKey) reportBindingCleanups.set(reportBindingKey, cleanupReportBindings);

  return {
    applyCustomRange,
    destroy() {
      cleanupReportBindings();
      if (reportBindingCleanups.get(reportBindingKey) === cleanupReportBindings) {
        reportBindingCleanups.delete(reportBindingKey);
      }
    },
    exportSelectedDay,
    moveDay,
    render,
    selectReportPreset,
    selectReportProfile,
    selectDay,
    syncReportTaxRate,
    updateReportTaxRate,
    get reportState() { return reportWithControls()?.controls || { ...reportControls }; },
    get selectedDay() { return selectedDay; },
  };
}
