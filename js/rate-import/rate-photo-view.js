import {
  createRatePhotoController, validateRatePhotoDraft,
} from './rate-photo-controller.js';

const FIELD_LABELS = {
  companyName: '会社名',
  nightRows: '夜間の距離料金',
  dayRows: '日中の距離料金',
  timeFare: '低速時間料金',
  waitFare: '待機料金',
  dayHours: '日中の時間帯',
};

function plainCopy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function element(document, tag, { className = '', text = '' } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function boundInput(document, draft, path, {
  type = 'text', value = '', min, max, step, label,
} = {}, onDraftChange = () => {}) {
  const wrapper = element(document, 'label', { className: 'rate-photo-input-label' });
  wrapper.append(element(document, 'span', { text: label }));
  const input = element(document, 'input', { className: 'setting-input' });
  input.type = type;
  input.value = value ?? '';
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  if (step != null) input.step = String(step);
  input.addEventListener('input', () => {
    let target = draft.values;
    for (let index = 0; index < path.length - 1; index += 1) target = target[path[index]];
    target[path.at(-1)] = type === 'checkbox' ? input.checked : input.value;
    onDraftChange(draft);
  });
  if (type === 'checkbox') input.checked = !!value;
  wrapper.append(input);
  return wrapper;
}

function rowsEditor(document, draft, field, onDraftChange) {
  const list = element(document, 'div', { className: 'rate-photo-tier-list' });
  draft.values[field].forEach((row, index) => {
    const line = element(document, 'div', { className: 'rate-photo-tier-row' });
    line.append(
      boundInput(document, draft, [field, index, 'upToKm'], {
        type: 'number', value: row.upToKm, min: 0, step: 0.1, label: '上限km（空欄＝以降）',
      }, onDraftChange),
    );
    const kindLabel = element(document, 'label', { className: 'rate-photo-input-label' });
    kindLabel.append(element(document, 'span', { text: '料金方式' }));
    const kind = element(document, 'select', { className: 'setting-input' });
    for (const [value, text] of [['flat', '定額'], ['perKm', '1kmごと']]) {
      const option = element(document, 'option', { text });
      option.value = value;
      kind.append(option);
    }
    kind.value = row.kind;
    kind.addEventListener('change', () => {
      draft.values[field][index].kind = kind.value;
      onDraftChange(draft);
    });
    kindLabel.append(kind);
    line.append(kindLabel);
    line.append(boundInput(document, draft, [field, index, 'amount'], {
      type: 'number', value: row.amount, min: 0, step: 1, label: '金額（円）',
    }, onDraftChange));
    list.append(line);
  });
  if (!draft.values[field].length) {
    list.append(element(document, 'p', { className: 'rate-photo-empty', text: '読み取れた料金段階はありません。' }));
  }
  return list;
}

function fieldEditor(document, draft, field, onDraftChange) {
  if (field === 'companyName') {
    return boundInput(document, draft, [field], {
      value: draft.values.companyName, label: '会社名',
    }, onDraftChange);
  }
  if (field === 'nightRows' || field === 'dayRows') {
    return rowsEditor(document, draft, field, onDraftChange);
  }
  if (field === 'timeFare') {
    const group = element(document, 'div', { className: 'rate-photo-input-grid' });
    group.append(
      boundInput(document, draft, [field, 'enabled'], { type: 'checkbox', value: draft.values[field].enabled, label: '時間料金を有効にする' }, onDraftChange),
      boundInput(document, draft, [field, 'speedThresholdKmh'], { type: 'number', value: draft.values[field].speedThresholdKmh, min: 0, max: 20, step: 0.1, label: '速度しきい値（km/h）' }, onDraftChange),
      boundInput(document, draft, [field, 'intervalSec'], { type: 'number', value: draft.values[field].intervalSec, min: 1, step: 1, label: '加算間隔（秒）' }, onDraftChange),
      boundInput(document, draft, [field, 'feePerInterval'], { type: 'number', value: draft.values[field].feePerInterval, min: 0, step: 1, label: '加算額（円）' }, onDraftChange),
    );
    return group;
  }
  if (field === 'waitFare') {
    const group = element(document, 'div', { className: 'rate-photo-input-grid' });
    const labels = {
      initialMinutes: '初回時間（分）', initialFee: '初回料金（円）',
      additionalInterval: '以降の間隔（分）', additionalFee: '以降の料金（円）',
    };
    for (const key of Object.keys(labels)) {
      group.append(boundInput(document, draft, [field, key], {
        type: 'number', value: draft.values[field][key], min: 0, step: 1, label: labels[key],
      }, onDraftChange));
    }
    return group;
  }
  const group = element(document, 'div', { className: 'rate-photo-input-grid' });
  group.append(
    boundInput(document, draft, [field, 'start'], { type: 'number', value: draft.values[field].start, min: 0, max: 23.9, step: 0.1, label: '開始時刻' }, onDraftChange),
    boundInput(document, draft, [field, 'end'], { type: 'number', value: draft.values[field].end, min: 0.1, max: 24, step: 0.1, label: '終了時刻' }, onDraftChange),
  );
  return group;
}

function renderCandidateFields(container, candidate, onDraftChange) {
  const document = container.ownerDocument;
  const draft = plainCopy(candidate);
  const acceptedFields = [];
  const sections = [];
  for (const field of Object.keys(FIELD_LABELS)) {
    const metadata = draft.fields[field];
    const section = element(document, 'section', { className: 'rate-photo-field' });
    const heading = element(document, 'div', { className: 'rate-photo-field-heading' });
    const choice = element(document, 'label', { className: 'rate-photo-field-choice' });
    const checkbox = element(document, 'input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!metadata.selected;
    checkbox.dataset.rateField = field;
    if (checkbox.checked) acceptedFields.push(field);
    choice.append(checkbox, element(document, 'strong', { text: `${FIELD_LABELS[field]}を反映` }));
    const confidence = metadata.confidence < 70
      ? `要確認（信頼度 ${Math.round(metadata.confidence)}%）`
      : `信頼度 ${Math.round(metadata.confidence)}%`;
    heading.append(choice, element(document, 'span', { className: 'rate-photo-confidence', text: confidence }));
    section.append(heading);
    if (metadata.sourceText) {
      section.append(element(document, 'p', {
        className: 'rate-photo-source', text: `読み取り元: ${metadata.sourceText}`,
      }));
    }
    section.append(fieldEditor(document, draft, field, onDraftChange));
    sections.push(section);
  }
  container.replaceChildren(...sections);
  return { candidate: draft, acceptedFields };
}

function renderWarnings(container, issues = []) {
  const document = container.ownerDocument;
  const items = issues.map((issue) => element(document, 'li', { text: issue.message }));
  container.replaceChildren(...items);
  container.hidden = items.length === 0;
}

export function renderRatePhotoState(elements, state, onDraftChange = () => {}) {
  elements.status.textContent = state.message || '';
  elements.progress.max = 1;
  elements.progress.value = Math.max(0, Math.min(1, Number(state.progress) || 0));
  elements.progress.hidden = !['validating', 'recognizing'].includes(state.status);
  const reviewing = state.status === 'review' && !!state.candidate;
  elements.review.hidden = !reviewing;
  elements.cancel.hidden = state.status === 'idle';
  elements.apply.disabled = !state.valid;

  if (!reviewing) {
    elements.preview.removeAttribute('src');
    elements.fields.replaceChildren();
    elements.warnings.replaceChildren();
    return { candidate: null, acceptedFields: [] };
  }

  elements.preview.setAttribute('src', state.previewUrl || '');
  renderWarnings(elements.warnings, state.candidate.issues);
  return renderCandidateFields(elements.fields, state.candidate, onDraftChange);
}

function resolveElements(root) {
  const byId = (id) => root.getElementById(id);
  return {
    file: byId('ratePhotoFile'),
    trigger: byId('ratePhotoTrigger'),
    status: byId('ratePhotoStatus'),
    progress: byId('ratePhotoProgress'),
    review: byId('ratePhotoReview'),
    preview: byId('ratePhotoPreview'),
    fields: byId('ratePhotoFields'),
    warnings: byId('ratePhotoWarnings'),
    apply: byId('ratePhotoApply'),
    cancel: byId('ratePhotoCancel'),
  };
}

export function mountRatePhotoView({
  root = document,
  createController = createRatePhotoController,
  controllerDeps = {},
  onApply = () => {},
} = {}) {
  const elements = resolveElements(root);
  if (Object.values(elements).some((entry) => !entry)) return null;

  let draft = null;
  const refreshValidation = (nextDraft) => {
    const validation = validateRatePhotoDraft(nextDraft);
    draft = validation.candidate;
    elements.apply.disabled = !validation.valid;
    renderWarnings(elements.warnings, validation.issues);
  };
  const controller = createController({
    ...controllerDeps,
    onApply,
    onStateChange(state) {
      const review = renderRatePhotoState(elements, state, refreshValidation);
      draft = review.candidate;
    },
  });

  elements.file.addEventListener('change', async () => {
    const file = elements.file.files?.[0];
    elements.file.value = '';
    if (file) await controller.selectFile(file);
  });
  elements.apply.addEventListener('click', async () => {
    const accepted = [...elements.fields.querySelectorAll('[data-rate-field]')]
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.dataset.rateField);
    await controller.apply(accepted, draft);
  });
  elements.cancel.addEventListener('click', async () => {
    await controller.cancel();
    elements.trigger.focus();
  });
  elements.trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      elements.file.click();
    }
  });
  globalThis.addEventListener?.('pagehide', () => { void controller.dispose(); }, { once: true });
  renderRatePhotoState(elements, controller.getState());
  return controller;
}

export function bindRatePhotoSettingsExit({ screenController, state, controller } = {}) {
  if (typeof screenController?.show !== 'function' || typeof controller?.cancel !== 'function') {
    return () => {};
  }
  const originalShow = screenController.show;
  let bound = true;
  screenController.show = function showWithRatePhotoCleanup(screen, ...args) {
    const leavingSettings = bound && state?.currentScreen === 'settings' && screen !== 'settings';
    const result = originalShow.call(this, screen, ...args);
    if (!leavingSettings) return result;
    return Promise.resolve(controller.cancel()).then(() => result);
  };
  return () => {
    if (!bound) return;
    bound = false;
    screenController.show = originalShow;
  };
}
