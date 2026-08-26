import { buildChangeOptions, calculateChange } from './change.js';
import {
  CALCULATOR_KEYS,
  calculatorKeyLabel,
  createCalculatorState,
  pressCalculatorKey,
} from './calculator.js';
import { formatSettlementYen, renderSettlementRecord } from '../ui/settlement-view.js';

export function createSettlementController({ root = document, onReceipt, onClose, focusTarget } = {}) {
  const screen = root.querySelector?.('#settlementScreen');
  const fare = root.querySelector?.('#settlementFare');
  const breakdown = root.querySelector?.('#settlementBreakdown');
  const options = root.querySelector?.('#changeOptions');
  const tendered = root.querySelector?.('#customTendered');
  const calculatorKeys = root.querySelector?.('#calculatorKeys');
  const receipt = root.querySelector?.('#settlementReceipt');
  const closeButton = root.querySelector?.('#settlementClose');
  let record = null;
  let calculator = createCalculatorState();

  function renderTender() {
    if (!record || !tendered || !options) return;
    const result = calculateChange(record.totalFare, tendered.value);
    const message = options.querySelector('.settlement-change-result');
    if (!message) return;
    if (tendered.value === '') {
      message.textContent = '預かり額を入力すると、お釣りを表示します。';
      message.dataset.state = 'idle';
    } else if (!result.ok) {
      message.textContent = '預かり額が不足しているか、入力が正しくありません。';
      message.dataset.state = 'error';
    } else {
      message.textContent = `お釣り　${formatSettlementYen(result.changeYen)}`;
      message.dataset.state = 'ok';
    }
  }

  function renderOptions() {
    if (!options || !record) return;
    options.replaceChildren();
    const presetWrap = document.createElement('div');
    presetWrap.className = 'settlement-presets';
    for (const option of buildChangeOptions(record.totalFare)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settlement-preset';
      button.textContent = `${formatSettlementYen(option.tenderedYen)} 預り　お釣り ${formatSettlementYen(option.changeYen)}`;
      button.addEventListener('click', () => {
        tendered.value = String(option.tenderedYen);
        renderTender();
      });
      presetWrap.append(button);
    }
    const message = document.createElement('p');
    message.className = 'settlement-change-result';
    message.dataset.state = 'idle';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    message.setAttribute('aria-atomic', 'true');
    presetWrap.append(message);
    options.append(presetWrap);
  }

  function renderCalculator() {
    if (!calculatorKeys) return;
    calculatorKeys.replaceChildren();
    const display = document.createElement('output');
    display.className = 'settlement-calculator-display';
    display.textContent = calculator.display;
    display.setAttribute('aria-live', 'polite');
    calculatorKeys.append(display);
    for (const key of CALCULATOR_KEYS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `settlement-calculator-key ${['C', '⌫'].includes(key) ? 'is-clear' : ''} ${['÷', '×', '-', '+', '='].includes(key) ? 'is-operator' : ''}`;
      button.textContent = key;
      button.setAttribute('aria-label', calculatorKeyLabel(key));
      button.addEventListener('click', () => {
        if (key === '00') {
          calculator = pressCalculatorKey(pressCalculatorKey(calculator, '0'), '0');
        } else {
          calculator = pressCalculatorKey(calculator, key);
        }
        renderCalculator();
      });
      calculatorKeys.append(button);
    }
  }

  function open(savedRecord) {
    if (!savedRecord || !Number.isFinite(Number(savedRecord.totalFare))) return;
    record = savedRecord;
    calculator = createCalculatorState();
    renderSettlementRecord({ fare, breakdown }, record);
    if (tendered) tendered.value = '';
    renderOptions();
    renderTender();
    renderCalculator();
    if (screen) {
      screen.hidden = false;
      screen.focus?.();
    }
  }

  function close() {
    if (screen) screen.hidden = true;
    const closingRecord = record;
    record = null;
    onClose?.(closingRecord);
    focusTarget?.focus?.();
    return closingRecord;
  }

  function finish() {
    if (!record) return;
    const closingRecord = close();
    if (closingRecord) onReceipt?.(closingRecord);
  }

  tendered?.addEventListener('input', renderTender);
  receipt?.addEventListener('click', () => { if (record) onReceipt?.(record); });
  closeButton?.addEventListener('click', finish);

  return { open, close, isOpen: () => Boolean(record && screen && !screen.hidden) };
}
