import { preprocessRateImage } from './image-input.js';
import { createRateOcrEngine } from './ocr-engine.js';
import { parseRateOcrResult } from './rate-parser.js';
import {
  isApplicableRateCandidateField, validateRateCandidate,
} from './rate-candidate.js';

const EDITABLE_VALIDATION_ISSUES = new Set([
  'INVALID_CANDIDATE_SCHEMA',
  'UNSUPPORTED_CANDIDATE_KEY',
  'INVALID_TIER_TABLE',
  'INVALID_TIER_ROW',
  'INVALID_NUMBER',
  'INVALID_TIER_ORDER',
  'MULTIPLE_TERMINAL_TIERS',
  'PRODUCTION_RATE_RULE_MISMATCH',
  'INVALID_TIME_FARE',
  'INVALID_DAY_HOURS',
]);
const ACCEPTED_RATE_FIELDS = new Set([
  'companyName', 'nightRows', 'dayRows', 'timeFare', 'waitFare', 'dayHours',
]);

function plainCopy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function initialState() {
  return {
    status: 'idle',
    message: '',
    progress: 0,
    previewUrl: '',
    candidate: null,
    valid: false,
  };
}

function abortError() {
  return new DOMException('Rate-photo operation was cancelled', 'AbortError');
}

export function validateRatePhotoDraft(candidate, validateCandidate = validateRateCandidate) {
  const draft = plainCopy(candidate);
  if (Array.isArray(draft?.issues)) {
    draft.issues = draft.issues.filter((issue) => !EDITABLE_VALIDATION_ISSUES.has(issue.code));
  }
  const validation = validateCandidate(draft);
  draft.issues = plainCopy(validation.issues);
  return { candidate: draft, valid: validation.valid, issues: draft.issues };
}

export function createRatePhotoController({
  preprocessImage = preprocessRateImage,
  createOcrEngine: makeOcrEngine = createRateOcrEngine,
  parseCandidate = parseRateOcrResult,
  validateCandidate = validateRateCandidate,
  onStateChange = () => {},
  onApply = () => {},
} = {}) {
  let state = initialState();
  let current = null;
  let generation = 0;
  let selectionRequestEpoch = 0;
  let disposed = false;
  let disposePromise = null;

  function publish(patch) {
    state = { ...state, ...patch };
    onStateChange(plainCopy(state));
  }

  function getState() {
    return plainCopy(state);
  }

  function disposeEngineOnce(operation) {
    if (operation.engineDisposePromise) return operation.engineDisposePromise;
    const engine = operation.engine;
    if (!engine) return Promise.resolve();
    operation.engineDisposePromise = Promise.resolve()
      .then(() => engine.dispose?.())
      .catch(() => undefined)
      .finally(() => {
        if (operation.engine === engine) operation.engine = null;
      });
    return operation.engineDisposePromise;
  }

  function releaseOperation(operation) {
    if (!operation) return Promise.resolve();
    if (operation.releasePromise) return operation.releasePromise;
    operation.controller.abort();
    operation.releasePromise = (async () => {
      try {
        await disposeEngineOnce(operation);
      } finally {
        try {
          operation.image?.dispose?.();
        } finally {
          operation.image = null;
          if (current === operation) current = null;
        }
      }
    })();
    return operation.releasePromise;
  }

  async function cancelCurrent({ announce = true } = {}) {
    const cancelToken = ++generation;
    const operation = current;
    operation?.controller.abort();
    await operation?.pipelineSettled;
    await releaseOperation(operation);
    if (announce && !disposed && generation === cancelToken && current === null) {
      publish({
        status: 'cancelled',
        message: '読み取りを取り消しました。',
        progress: 0,
        previewUrl: '',
        candidate: null,
        valid: false,
      });
      publish(initialState());
    }
  }

  async function selectFile(file) {
    if (disposed) throw new DOMException('Rate-photo controller has been disposed', 'InvalidStateError');
    const selectionRequest = ++selectionRequestEpoch;
    if (current) await cancelCurrent();
    if (disposed || selectionRequest !== selectionRequestEpoch) return getState();

    const token = ++generation;
    let resolvePipeline;
    const operation = {
      token,
      controller: new AbortController(),
      image: null,
      engine: null,
      engineDisposePromise: null,
      releasePromise: null,
      pipelineSettled: new Promise((resolve) => { resolvePipeline = resolve; }),
      resolvePipeline,
    };
    current = operation;
    publish({
      status: 'validating',
      message: '画像の種類とサイズを確認しています。',
      progress: 0,
      previewUrl: '',
      candidate: null,
      valid: false,
    });

    try {
      const image = await preprocessImage(file);
      if (operation.controller.signal.aborted || token !== generation) {
        image?.dispose?.();
        throw abortError();
      }
      operation.image = image;

      operation.engine = makeOcrEngine();
      publish({
        status: 'recognizing',
        message: 'OCRで料金表を読み取っています。',
        progress: 0,
        previewUrl: operation.image.previewUrl,
      });
      const result = await operation.engine.recognize(operation.image.blob, {
        signal: operation.controller.signal,
        onProgress(progress) {
          if (current === operation && token === generation && !operation.controller.signal.aborted) {
            publish({
              status: 'recognizing',
              message: 'OCRで料金表を読み取っています。',
              progress: Math.max(0, Math.min(1, Number(progress) || 0)),
            });
          }
        },
      });
      if (operation.controller.signal.aborted || token !== generation) throw abortError();

      await disposeEngineOnce(operation);
      if (operation.controller.signal.aborted || token !== generation) throw abortError();
      const candidate = plainCopy(parseCandidate(result));
      const validation = validateCandidate(candidate);
      candidate.issues = plainCopy(validation.issues);
      publish({
        status: 'review',
        message: validation.valid
          ? '読み取り結果を確認・修正し、反映する項目を選んでください。'
          : '矛盾する候補があります。設定へは反映できません。',
        progress: 1,
        previewUrl: operation.image.previewUrl,
        candidate,
        valid: validation.valid,
      });
      return getState();
    } catch (error) {
      const cancelled = operation.controller.signal.aborted
        || token !== generation
        || error?.name === 'AbortError';
      await releaseOperation(operation);
      if (cancelled) return getState();
      publish({
        status: 'error',
        message: '料金表を読み取れませんでした。画像を確認し、もう一度お試しください。',
        progress: 0,
        previewUrl: '',
        candidate: null,
        valid: false,
      });
      return getState();
    } finally {
      operation.resolvePipeline();
    }
  }

  async function apply(acceptedFields, draftCandidate = state.candidate) {
    if (disposed) throw new DOMException('Rate-photo controller has been disposed', 'InvalidStateError');
    if (state.status !== 'review') throw new DOMException('No rate-photo review is active', 'InvalidStateError');
    const draft = validateRatePhotoDraft(draftCandidate, validateCandidate);
    if (!draft.valid) throw new TypeError('Rate-photo candidate is invalid');
    const candidate = draft.candidate;
    const operation = current;
    const token = operation?.token;
    const accepted = plainCopy(acceptedFields);
    const invalidAccepted = !Array.isArray(accepted)
      || accepted.some((field) => typeof field !== 'string' || !ACCEPTED_RATE_FIELDS.has(field));
    const unsafeAccepted = Array.isArray(accepted)
      && accepted.some((field) => (
        ACCEPTED_RATE_FIELDS.has(field) && !isApplicableRateCandidateField(candidate, field)
      ));

    async function failApply(error) {
      await releaseOperation(operation);
      if (!disposed && generation === token && current === null) {
        publish({
          status: 'error',
          message: '料金設定フォームへ反映できませんでした。内容を確認し、もう一度お試しください。',
          progress: 0,
          previewUrl: '',
          candidate: null,
          valid: false,
        });
      }
      throw error;
    }

    if (invalidAccepted) {
      return failApply(new TypeError('Unsupported rate-photo field'));
    }
    if (unsafeAccepted) {
      return failApply(new TypeError('Unsafe rate-photo field'));
    }

    publish({ status: 'applied', message: '選択した候補を料金設定フォームへ反映しました。' });
    try {
      await onApply(plainCopy(candidate), accepted);
    } catch (error) {
      return failApply(error);
    }
    await releaseOperation(operation);
    if (!disposed && generation === token && current === null) publish(initialState());
  }

  function cancel() {
    if (disposed) return disposePromise || Promise.resolve();
    selectionRequestEpoch += 1;
    return cancelCurrent();
  }

  function dispose() {
    if (disposePromise) return disposePromise;
    disposed = true;
    selectionRequestEpoch += 1;
    generation += 1;
    disposePromise = (async () => {
      const operation = current;
      operation?.controller.abort();
      await operation?.pipelineSettled;
      await releaseOperation(operation);
      state = initialState();
    })();
    return disposePromise;
  }

  return { selectFile, apply, cancel, dispose, getState };
}
