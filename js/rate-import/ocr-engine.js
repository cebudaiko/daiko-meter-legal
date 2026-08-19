function createAbortError() {
  return new DOMException('OCR recognition was aborted', 'AbortError');
}

function plainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function copyRecognitionResult(result) {
  const data = result?.data ?? {};
  return {
    text: typeof data.text === 'string' ? data.text : String(data.text ?? ''),
    blocks: plainJson(data.blocks ?? []),
    confidence: Number.isFinite(data.confidence) ? data.confidence : 0,
  };
}

function resolveCreateWorker(module) {
  const tesseract = module?.default ?? module;
  if (!tesseract || typeof tesseract.createWorker !== 'function') {
    throw new TypeError('Tesseract module must provide a callable createWorker');
  }
  return tesseract.createWorker;
}

function waitForAbort(signal, promise) {
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => finish(reject, createAbortError());
    const finish = (settle, value) => {
      signal.removeEventListener('abort', onAbort);
      settle(value);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

export function createRateOcrEngine({
  importTesseract,
  assetBase = new URL('../../assets/vendor/ocr/', import.meta.url).href,
} = {}) {
  let active = null;
  let disposed = false;
  let disposePromise = null;

  const loadTesseract = importTesseract
    || (() => import(new URL('tesseract.esm.min.js', assetBase).href));

  function terminateOnce(operation) {
    if (!operation.worker) return Promise.resolve();
    if (!operation.termination) {
      operation.termination = Promise.resolve()
        .then(() => operation.worker.terminate())
        .catch(() => undefined);
    }
    return operation.termination;
  }

  function finishOperation(operation) {
    if (operation.finishing) return operation.cleanup;
    operation.finishing = true;
    void (async () => {
      try {
        if (operation.workerCreation) {
          try {
            await operation.workerCreation;
          } catch {
            // The recognition path propagates worker-creation failures itself.
          }
        }
        await terminateOnce(operation);
      } finally {
        operation.signal?.removeEventListener('abort', operation.abortFromSignal);
        operation.controller.signal.removeEventListener('abort', operation.terminateOnAbort);
        if (active === operation) active = null;
        operation.resolveCleanup();
      }
    })();
    return operation.cleanup;
  }

  function cancel() {
    if (!active) return Promise.resolve();
    active.controller.abort();
    return active.cleanup;
  }

  function recognize(blob, { onProgress = () => {}, signal } = {}) {
    if (disposed) return Promise.reject(new DOMException('OCR engine has been disposed', 'InvalidStateError'));
    if (active) return Promise.reject(new DOMException('OCR is already running', 'InvalidStateError'));
    if (signal?.aborted) return Promise.reject(createAbortError());

    let resolveCleanup;
    const operation = {
      controller: new AbortController(),
      termination: null,
      worker: null,
      workerCreation: null,
      finishing: false,
      signal,
      cleanup: new Promise((resolve) => { resolveCleanup = resolve; }),
      resolveCleanup,
    };
    active = operation;

    operation.terminateOnAbort = () => { void terminateOnce(operation); };
    operation.abortFromSignal = () => operation.controller.abort();
    operation.controller.signal.addEventListener('abort', operation.terminateOnAbort, { once: true });
    signal?.addEventListener('abort', operation.abortFromSignal, { once: true });

    return (async () => {
      try {
        const module = await waitForAbort(operation.controller.signal, loadTesseract());
        const createWorker = resolveCreateWorker(module);
        operation.workerCreation = Promise.resolve()
          .then(() => createWorker('jpn', 1, {
            workerPath: new URL('worker.min.js', assetBase).href,
            corePath: new URL('core/', assetBase).href,
            langPath: new URL('lang/', assetBase).href,
            logger: ({ progress }) => {
              if (!operation.controller.signal.aborted) {
                onProgress(Math.max(0, Math.min(1, Number(progress) || 0)));
              }
            },
          }))
          .then((worker) => {
            operation.worker = worker;
            return worker;
          });
        const worker = await waitForAbort(operation.controller.signal, operation.workerCreation);
        const result = await waitForAbort(
          operation.controller.signal,
          worker.recognize(blob, {}, { text: true, blocks: true }),
        );
        if (operation.controller.signal.aborted) throw createAbortError();
        const copied = copyRecognitionResult(result);
        await finishOperation(operation);
        return copied;
      } catch (error) {
        const cleanup = finishOperation(operation);
        if (operation.controller.signal.aborted) {
          void cleanup;
          throw createAbortError();
        }
        await cleanup;
        throw error;
      }
    })();
  }

  function dispose() {
    if (disposePromise) return disposePromise;
    disposed = true;
    disposePromise = cancel();
    return disposePromise;
  }

  return { recognize, cancel, dispose };
}
