import { defaultConfig } from '../storage/local-config.js';
import { DEFAULT_LOW_SPEED_THRESHOLD_KMH } from '../fare/low-speed-threshold.js';
import { calculateChange } from '../settlement/change.js';
import {
  CALCULATOR_KEYS,
  calculatorKeyLabel,
  createCalculatorState,
  pressCalculatorKey,
} from '../settlement/calculator.js';
import { advanceDemo, createDemoState, restoreDemoState } from './demo-state.js';
import { clearDemoState, loadDemoState, saveDemoState } from './demo-storage.js';
import { mountRatePhotoView } from '../rate-import/rate-photo-view.js';

export const DEMO_CALCULATOR_KEYS = CALCULATOR_KEYS;

const RATE_PREVIEW_FIELDS = new Set([
  'companyName', 'nightRows', 'dayRows', 'timeFare', 'waitFare', 'dayHours',
]);

export function restoreDemoTransitionFocus(root, previousStatus, nextStatus) {
  let selector = null;

  if (previousStatus !== 'running' && nextStatus === 'running') {
    selector = '[data-demo-action="distance"]';
  } else if (previousStatus === 'running' && nextStatus === 'settled') {
    selector = '[data-settlement]';
  }

  if (!selector) return null;

  const target = root?.querySelector?.(selector) || null;
  target?.focus?.();
  return target;
}

function createDemoConfig() {
  const base = defaultConfig();
  const companyId = Object.keys(base.companies)[0];
  const company = base.companies[companyId];
  return {
    ...base,
    companies: {
      ...base.companies,
      [companyId]: {
        ...company,
        night: {
          ...company.night,
          timeFare: {
            enabled: true,
            speedThresholdKmh: DEFAULT_LOW_SPEED_THRESHOLD_KMH,
            intervalSec: 30,
            feePerInterval: 100,
          },
        },
      },
    },
  };
}

function yen(value) {
  return `${Math.max(0, Number(value) || 0).toLocaleString('ja-JP')}円`;
}

function previewRow(documentRoot, label, value) {
  const row = documentRoot.createElement('p');
  const term = documentRoot.createElement('strong');
  const description = documentRoot.createElement('span');
  term.textContent = label;
  description.textContent = value;
  row.append(term, description);
  return row;
}

function tierPreview(rows = []) {
  return rows.map((row) => (
    row.kind === 'perKm'
      ? `以降1kmごと ${yen(row.amount)}`
      : `${Number(row.upToKm)}kmまで ${yen(row.amount)}`
  )).join(' ／ ');
}

export function renderSessionRatePreview(root, candidate, acceptedFields) {
  if (!root) return null;
  const accepted = new Set(
    (Array.isArray(acceptedFields) ? acceptedFields : [])
      .filter((field) => RATE_PREVIEW_FIELDS.has(field)),
  );
  const values = candidate?.values || {};
  const documentRoot = root.ownerDocument || document;
  const rows = [];
  if (accepted.has('companyName')) rows.push(previewRow(documentRoot, '会社名', values.companyName || '未入力'));
  if (accepted.has('nightRows')) rows.push(previewRow(documentRoot, '夜間料金', tierPreview(values.nightRows)));
  if (accepted.has('dayRows')) rows.push(previewRow(documentRoot, '日中料金', tierPreview(values.dayRows)));
  if (accepted.has('timeFare')) {
    const fare = values.timeFare || {};
    rows.push(previewRow(
      documentRoot,
      '低速時間料金',
      `${Number(fare.speedThresholdKmh)}km/h以下 ${Number(fare.intervalSec)}秒ごと ${yen(fare.feePerInterval)}`,
    ));
  }
  if (accepted.has('waitFare')) {
    const fare = values.waitFare || {};
    rows.push(previewRow(
      documentRoot,
      '待機料金',
      `待機 ${Number(fare.initialMinutes)}分まで ${yen(fare.initialFee)} ／ 以降${Number(fare.additionalInterval)}分ごと ${yen(fare.additionalFee)}`,
    ));
  }
  if (accepted.has('dayHours')) {
    rows.push(previewRow(documentRoot, '日中時間', `${Number(values.dayHours?.start)}時〜${Number(values.dayHours?.end)}時`));
  }
  root.replaceChildren(...rows);
  if (!rows.length) root.textContent = '反映する候補が選ばれていません。';
  return Object.fromEntries([...accepted].map((field) => [field, values[field]]));
}

function restoredState(storage, config) {
  return restoreDemoState(loadDemoState(storage), config);
}

function mountMarkup(root) {
  root.innerHTML = `
    <div class="demo-console">
      <div class="meter-stage" aria-label="模擬メーター">
        <div class="meter-arc" aria-hidden="true"></div>
        <div class="meter-needle" data-meter-needle aria-hidden="true"></div>
        <div class="fare-readout">
          <span class="fare-label">現在の運賃</span>
          <output class="fare-amount" data-fare aria-live="polite">0<small>円</small></output>
        </div>
        <div class="meter-status" data-status role="status" aria-live="polite" aria-atomic="true">スタートを押して体験してください</div>
      </div>
      <dl class="demo-metrics">
        <div><dt>模擬距離</dt><dd data-distance>0.0 km</dd></div>
        <div><dt>低速時間</dt><dd data-low-speed>0 秒</dd></div>
        <div><dt>待機</dt><dd data-wait>0 分</dd></div>
      </dl>
      <div class="demo-actions" aria-label="体験版の操作">
        <button class="demo-button demo-button--primary" type="button" data-demo-action="start">実車スタート</button>
        <button class="demo-button" type="button" data-demo-action="distance">＋500m</button>
        <button class="demo-button" type="button" data-demo-action="low-speed">低速＋30秒</button>
        <button class="demo-button" type="button" data-demo-action="wait">待機</button>
        <button class="demo-button" type="button" data-demo-action="option" aria-pressed="false">オプション</button>
        <button class="demo-button demo-button--settle" type="button" data-demo-action="settle">精算</button>
        <button class="demo-button demo-button--reset" type="button" data-demo-action="reset">デモをリセット</button>
      </div>
      <p class="demo-action-note">待機は1回で10分、オプションは時間外料金を切り替えます。</p>
      <div class="settlement-experience" data-settlement tabindex="-1" hidden>
        <section class="demo-panel" aria-labelledby="changeTitle">
          <h3 id="changeTitle">お釣り候補</h3>
          <div class="change-presets" data-change-presets></div>
          <output class="change-output" data-change-output aria-live="polite">預かり金額を選んでください</output>
        </section>
        <section class="demo-panel" aria-labelledby="calculatorTitle">
          <h3 id="calculatorTitle">四則電卓</h3>
          <output class="calculator-display" data-calculator-display>0</output>
          <div class="calculator-grid" data-calculator-grid></div>
          <button class="demo-button calculator-use" type="button" data-calculator-use>表示額を預かり金に使う</button>
        </section>
        <section class="demo-panel" aria-labelledby="receiptTitle">
          <h3 id="receiptTitle">サンプル領収証</h3>
          <div class="receipt-sample">
            <p><span>領収証番号</span><strong data-receipt-number>—</strong></p>
            <p><span>発行日</span><strong data-receipt-date>—</strong></p>
            <p><span>距離料金</span><strong data-receipt-base>0円</strong></p>
            <p><span>時間・待機・オプション</span><strong data-receipt-extra>0円</strong></p>
            <p class="receipt-total"><span>合計</span><strong data-receipt-total>0円</strong></p>
          </div>
        </section>
        <section class="demo-panel" aria-labelledby="salesTitle">
          <h3 id="salesTitle">デモ売上</h3>
          <div class="sales-summary">
            <div><span>この営業日</span><strong data-day-sales>0件 / 0円</strong></div>
            <div><span>この月</span><strong data-month-sales>0件 / 0円</strong></div>
          </div>
        </section>
      </div>
    </div>`;
  const keypad = root.querySelector('[data-calculator-grid]');
  const documentRoot = root.ownerDocument || document;
  for (const key of DEMO_CALCULATOR_KEYS) {
    const button = documentRoot.createElement('button');
    button.className = 'calculator-key';
    button.type = 'button';
    button.dataset.calculatorKey = key;
    button.textContent = key;
    button.setAttribute('aria-label', calculatorKeyLabel(key));
    keypad.append(button);
  }
}

export function createDemoController({ root, storage } = {}) {
  if (!root) return null;
  const config = createDemoConfig();
  let state = restoredState(storage, config);
  let calculator = createCalculatorState();
  mountMarkup(root);

  const element = (selector) => root.querySelector(selector);
  const actionButtons = [...root.querySelectorAll('[data-demo-action]')];

  function renderChangePresets() {
    const host = element('[data-change-presets]');
    host.replaceChildren();
    for (const option of state.changeOptions || []) {
      const button = document.createElement('button');
      button.className = 'change-preset';
      button.type = 'button';
      button.dataset.tendered = String(option.tenderedYen);
      button.textContent = `${yen(option.tenderedYen)} → お釣り ${yen(option.changeYen)}`;
      host.append(button);
    }
  }

  function render() {
    const running = state.status === 'running';
    const settled = state.status === 'settled';
    element('[data-fare]').replaceChildren(document.createTextNode((Number(state.totalFare) || 0).toLocaleString('ja-JP')));
    const unit = document.createElement('small');
    unit.textContent = '円';
    element('[data-fare]').append(unit);
    element('[data-distance]').textContent = `${(Number(state.distanceKm) || 0).toFixed(1)} km`;
    element('[data-low-speed]').textContent = `${Math.round(Number(state.lowSpeedSec) || 0)} 秒`;
    element('[data-wait]').textContent = `${Math.round(Number(state.waitMinutes) || 0)} 分`;
    element('[data-status]').textContent = running
      ? '模擬計測中 — 距離や時間を加えてください'
      : (settled ? '精算済み — 下の精算結果をお試しください' : 'スタートを押して体験してください');
    element('[data-meter-needle]').style.transform = `rotate(${Math.min(52, -52 + (Number(state.distanceKm) || 0) * 14)}deg)`;

    for (const button of actionButtons) {
      const action = button.dataset.demoAction;
      button.disabled = action === 'start' ? running : (!running && action !== 'reset');
    }
    element('[data-demo-action="option"]').setAttribute('aria-pressed', String(Boolean(state.options?.overtime)));
    element('[data-settlement]').hidden = !settled;
    if (!settled) return;

    renderChangePresets();
    const receipt = state.receipt || {};
    element('[data-receipt-number]').textContent = receipt.receiptNumber || '—';
    element('[data-receipt-date]').textContent = receipt.issuedDate || '—';
    element('[data-receipt-base]').textContent = yen(receipt.baseFare);
    element('[data-receipt-extra]').textContent = yen((receipt.timeFee || 0) + (receipt.waitFee || 0) + (receipt.optionFee || 0));
    element('[data-receipt-total]').textContent = yen(receipt.totalFare);
    const day = state.history?.daySummary || {};
    const month = state.history?.monthSummary || {};
    element('[data-day-sales]').textContent = `${day.count || 0}件 / ${yen(day.totalFare)}`;
    element('[data-month-sales]').textContent = `${month.count || 0}件 / ${yen(month.totalFare)}`;
  }

  function showChange(tendered) {
    const result = calculateChange(state.totalFare, tendered);
    element('[data-change-output]').textContent = result.ok
      ? `お預かり ${yen(tendered)} ／ お釣り ${yen(result.changeYen)}`
      : '預かり金額が運賃に足りません';
  }

  root.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target || !root.contains(target)) return;
    if (target.dataset.calculatorKey) {
      const key = target.dataset.calculatorKey;
      calculator = key === '00'
        ? pressCalculatorKey(pressCalculatorKey(calculator, '0'), '0')
        : pressCalculatorKey(calculator, key);
      element('[data-calculator-display]').textContent = calculator.display;
      return;
    }
    if (target.dataset.calculatorUse !== undefined) {
      showChange(Number(calculator.display));
      return;
    }
    if (target.dataset.tendered) {
      showChange(Number(target.dataset.tendered));
      return;
    }
    const type = target.dataset.demoAction;
    if (!type) return;
    const previousStatus = state.status;
    if (type === 'reset') {
      clearDemoState(storage);
      state = createDemoState(config);
      calculator = createCalculatorState();
      element('[data-calculator-display]').textContent = calculator.display;
      element('[data-change-output]').textContent = '預かり金額を選んでください';
    } else {
      const details = {
        distance: { km: 0.5 },
        'low-speed': { seconds: 30 },
        wait: { seconds: 600 },
        option: { name: 'overtime' },
        settle: { now: new Date().toISOString() },
      }[type] || {};
      state = advanceDemo(state, { type, ...details }, config);
      saveDemoState(storage, state);
    }
    render();
    restoreDemoTransitionFocus(root, previousStatus, state.status);
  });

  render();
  return { getState: () => state };
}

if (typeof document !== 'undefined') {
  createDemoController({
    root: document.querySelector('#demoMount'),
    storage: globalThis.localStorage,
  });
  mountRatePhotoView({
    root: document,
    onApply(candidate, acceptedFields) {
      renderSessionRatePreview(
        document.querySelector('[data-rate-memory-preview]'),
        candidate,
        acceptedFields,
      );
    },
  });
}
