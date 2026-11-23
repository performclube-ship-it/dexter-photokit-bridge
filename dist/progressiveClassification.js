/**
 * DEXTER: opt-in local Vision classification coordinator for paged native IDs.
 * Classification results are review suggestions: never album-write rules.
 * This helper neither loads pixels, uploads data nor writes Apple Photos.
 * The caller MUST keep labels transient and store retry IDs locally only.
 */
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
const safeInt = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const allowedStatus = new Set(['ready', 'icloud', 'unavailable', 'unsupported']);

function verifyResult(ids, response) {
  if (!Array.isArray(response?.results) || response.results.length !== ids.length) {
    fail('INVALID_CLASSIFICATION_RESULT', 'O PhotoKit não devolveu todos os resultados da seleção.');
  }
  for (let i = 0; i < ids.length; i++) {
    const item = response.results[i];
    if (!item || item.id !== ids[i] || !allowedStatus.has(item.status) ||
        !Array.isArray(item.labels) || item.labels.length > 3 ||
        (item.status !== 'ready' && item.labels.length !== 0)) {
      fail('INVALID_CLASSIFICATION_RESULT', 'O PhotoKit devolveu identificadores, estados ou sugestões inválidos.');
    }
    for (const observation of item.labels) {
      if (!observation || typeof observation.label !== 'string' ||
          !observation.label.trim() || observation.label.length > 256 ||
          typeof observation.confidence !== 'number' ||
          !Number.isFinite(observation.confidence) ||
          observation.confidence < 0 || observation.confidence > 1) {
        fail('INVALID_CLASSIFICATION_RESULT', 'O PhotoKit devolveu sugestões inválidas.');
      }
    }
  }
  return response.results;
}

/**
 * @param {object} input
 * @param {object} input.plugin - Existing native DexterPhotoKit bridge.
 * @param {Iterable<string[]>|AsyncIterable<string[]>} input.assetPages
 *   Pages of local PHAsset identifiers (1–250 IDs per page).
 * @param {number} input.expectedCount - EXACT selected count, never an estimate.
 * @param {Function} input.onReviewBatch - Local review/queue handler; must
 *   explicitly return {acknowledged:true} AFTER handling the entire batch.
 * @param {number} [input.batchSize=10] - 1..10; never silently truncates.
 * @param {Function} [input.shouldStop]
 * @param {Function} [input.onProgress] - Counts only; never image labels.
 */
export async function classifyLocalPages({
  plugin, assetPages, expectedCount, onReviewBatch, batchSize = 10,
  shouldStop = () => false, onProgress = () => {}
}) {
  if (!plugin || typeof plugin.authorizationStatus !== 'function' ||
      typeof plugin.requestAuthorization !== 'function' ||
      typeof plugin.classifyPilotAssets !== 'function' ||
      !assetPages || !(Symbol.asyncIterator in Object(assetPages) || Symbol.iterator in Object(assetPages)) ||
      !safeInt(expectedCount, 0, 100000) || !safeInt(batchSize, 1, 10) ||
      typeof onReviewBatch !== 'function' || typeof shouldStop !== 'function' ||
      typeof onProgress !== 'function') {
    fail('INVALID_CLASSIFICATION_CONFIGURATION', 'Configuração de classificação local inválida.');
  }
  const totals = { processed: 0, expectedCount, batches: 0, retryableCount: 0, unsupportedCount: 0 };
  const state = name => ({ state: name, ...totals,
    complete: name === 'complete', needsRetry: totals.retryableCount > 0 });
  if (!expectedCount) {
    // A zero-count review must still exhaust the supplied selection source.
    // Otherwise an erroneous empty selection can hide actual assets.
    for await (const page of assetPages) {
      if (await shouldStop()) return state('stopped');
      if (!Array.isArray(page) || page.length === 0 || page.length > 250) {
        fail('INVALID_ASSET_PAGE', 'Página de identificadores inválida para reconhecimento.');
      }
      fail('EXCESS_ASSET_SELECTION', 'A origem contém fotografias que não foram confirmadas.');
    }
    return (await shouldStop()) ? state('stopped') : state('complete');
  }
  let {status} = await plugin.authorizationStatus();
  if (status === 'notDetermined') ({status} = await plugin.requestAuthorization());
  if (status !== 'authorized') {
    fail('PHOTOS_FULL_ACCESS_REQUIRED', 'O reconhecimento local requer acesso completo às Fotografias.');
  }
  const seen = new Set();
  async function flush(ids) {
    if (await shouldStop()) return false;
    // Swift caps this endpoint at ten, reads pixels locally and blocks iCloud networking.
    const response = await plugin.classifyPilotAssets({assetIds: [...ids]});
    const results = verifyResult(ids, response);
    if (await shouldStop()) return false;
    const retryable = results.filter(r => r.status === 'icloud' || r.status === 'unavailable')
      .map(r => ({id: r.id, reason: r.status}));
    const ack = await onReviewBatch({results, retryable, processedBefore: totals.processed, expectedCount});
    if (!ack || ack.acknowledged !== true) {
      fail('REVIEW_NOT_ACKNOWLEDGED', 'A revisão local não confirmou a classificação deste lote.');
    }
    totals.processed += ids.length;
    totals.batches += 1;
    totals.retryableCount += retryable.length;
    totals.unsupportedCount += results.filter(r => r.status === 'unsupported').length;
    // Stop after acknowledged local review retains counts, but never claims completion.
    if (await shouldStop()) return false;
    // An acknowledged last batch is not proof that the source has ended.
    // Deferring the full-count event avoids false 100% for trailing IDs.
    if (totals.processed < expectedCount) await onProgress({...totals});
    return !(await shouldStop());
  }
  let pending = [];
  for await (const page of assetPages) {
    if (await shouldStop()) return state('stopped');
    if (!Array.isArray(page) || page.length === 0 || page.length > 250) {
      fail('INVALID_ASSET_PAGE', 'Página de identificadores inválida para reconhecimento.');
    }
    for (const id of page) {
      if (typeof id !== 'string' || !id.length || id.length > 256 || seen.has(id)) {
        fail('INVALID_ASSET_PAGE', 'Identificador ausente, duplicado ou inválido na seleção.');
      }
      seen.add(id);
      if (seen.size > expectedCount) {
        fail('EXCESS_ASSET_SELECTION', 'A origem contém mais fotografias do que as confirmadas.');
      }
      pending.push(id);
      if (pending.length === batchSize) {
        if (!(await flush(pending))) return state('stopped');
        pending = [];
      }
    }
  }
  if (seen.size !== expectedCount) {
    fail('INCOMPLETE_ASSET_SOURCE', 'Nem todas as fotografias confirmadas foram fornecidas.');
  }
  if (pending.length && !(await flush(pending))) return state('stopped');
  if (await shouldStop()) return state('stopped');
  // Only the exhausted, exact-count source is eligible for final progress.
  await onProgress({...totals}); // counts only; never image labels or pixels
  if (await shouldStop()) return state('stopped');
  return state(totals.retryableCount ? 'retry_pending' : 'complete');
}
