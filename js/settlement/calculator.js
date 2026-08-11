const OPERATORS = new Set(['+', '-', '×', '÷']);
const MAX_DISPLAY_LENGTH = 12;

export const CALCULATOR_KEYS = Object.freeze([
  'C', '⌫', '÷', '×', '7', '8', '9', '-', '4', '5', '6', '+', '1', '2', '3', '=', '0', '.', '00',
]);

export function calculatorKeyLabel(key) {
  if (key === '⌫') return '1文字削除';
  if (key === '.') return '小数点';
  return key;
}

export function createCalculatorState() {
  return {
    accumulator: null,
    display: '0',
    error: false,
    pendingOperator: null,
    waitingForOperand: false,
  };
}

function errorState() {
  return { ...createCalculatorState(), display: 'エラー', error: true, waitingForOperand: true };
}

function parseDisplay(display) {
  const value = Number(display);
  return Number.isFinite(value) ? value : null;
}

function formatValue(value) {
  if (!Number.isFinite(value)) return null;
  const text = String(Number(value.toPrecision(MAX_DISPLAY_LENGTH)));
  return text.length <= MAX_DISPLAY_LENGTH ? text : null;
}

function applyOperator(left, operator, right) {
  switch (operator) {
    case '+': return left + right;
    case '-': return left - right;
    case '×': return left * right;
    case '÷': return right === 0 ? null : left / right;
    default: return null;
  }
}

function appendDigit(state, key) {
  if (state.waitingForOperand) {
    return { ...state, display: key, waitingForOperand: false };
  }
  if (state.display === '0') return { ...state, display: key };
  if (state.display.length >= MAX_DISPLAY_LENGTH) return state;
  return { ...state, display: `${state.display}${key}` };
}

function appendDecimal(state) {
  if (state.waitingForOperand) return { ...state, display: '0.', waitingForOperand: false };
  if (state.display.includes('.') || state.display.length >= MAX_DISPLAY_LENGTH) return state;
  return { ...state, display: `${state.display}.` };
}

function pressOperator(state, key) {
  const current = parseDisplay(state.display);
  if (current === null) return errorState();
  if (state.pendingOperator && !state.waitingForOperand) {
    const result = applyOperator(state.accumulator, state.pendingOperator, current);
    const display = formatValue(result);
    if (display === null) return errorState();
    return { ...state, accumulator: Number(display), display, pendingOperator: key, waitingForOperand: true };
  }
  if (state.pendingOperator) return { ...state, pendingOperator: key };
  return { ...state, accumulator: current, pendingOperator: key, waitingForOperand: true };
}

function pressEquals(state) {
  if (!state.pendingOperator || state.waitingForOperand) return state;
  const result = applyOperator(state.accumulator, state.pendingOperator, parseDisplay(state.display));
  const display = formatValue(result);
  if (display === null) return errorState();
  return { ...state, accumulator: null, display, pendingOperator: null, waitingForOperand: true };
}

export function pressCalculatorKey(state, key) {
  if (!state || typeof state !== 'object') state = createCalculatorState();
  if (key === 'C') return createCalculatorState();
  if (state.error) return state;
  if (/^\d$/.test(key)) return appendDigit(state, key);
  if (key === '.') return appendDecimal(state);
  if (key === '⌫') {
    if (state.waitingForOperand) return state;
    const display = state.display.length > 1 ? state.display.slice(0, -1) : '0';
    return { ...state, display: display === '-' ? '0' : display };
  }
  if (OPERATORS.has(key)) return pressOperator(state, key);
  if (key === '=') return pressEquals(state);
  return state;
}
