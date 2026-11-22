/**
 * Resumable-by-restart (NOT by offset) PhotoKit snapshot scanner for DEXTER.
 *
 * Every invocation starts a new volatile native snapshot at offset zero.
 * The caller persists/merges the verified pages by original PHAsset ID.
 * Never persist snapshotToken, resume an old offset on a new token, or claim
 * a complete library scan when maxItems is below the native library total.
 */
function stop(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validateAssets(assets, seen) {
  const nextIds = new Set();
  for (const asset of assets) {
    if (!asset || typeof asset.id !== 'string' ||
        asset.id.length === 0 || asset.id.length > 256 ||
        !['image', 'video', 'other'].includes(asset.type) ||
        (asset.createdAt !== null &&
          (typeof asset.createdAt !== 'string' ||
           !Number.isFinite(Date.parse(asset.createdAt)))) ||
        !validInteger(asset.width, 0, Number.MAX_SAFE_INTEGER) ||
        !validInteger(asset.height, 0, Number.MAX_SAFE_INTEGER) ||
        nextIds.has(asset.id) || seen.has(asset.id)) {
      stop('INVALID_NATIVE_PAGE', 'A página PhotoKit tem dados inválidos ou identificadores repetidos. Nenhum progresso desta página foi confirmado.');
    }
    nextIds.add(asset.id);
  }
  return nextIds;
}

/**
 * @param {Object} options
 * @param {Object} options.plugin - DexterPhotoKit native bridge
 * @param {(page: Object) => (void | Promise<void>)} options.onPage
 *   MUST durably persist/merge every page before resolving.
 * @param {number} [options.maxItems=10000]
 * @param {number} [options.pageSize=200]
 * @param {() => (boolean | Promise<boolean>)} [options.shouldStop]
 * @param {(status: Object) => (void | Promise<void>)} [options.onProgress]
 */
export async function scanSnapshotPages({
  plugin,
  onPage,
  maxItems = 10000,
  pageSize = 200,
  shouldStop = () => false,
  onProgress = () => {}
}) {
  if (!plugin || typeof plugin.authorizationStatus !== 'function' ||
      typeof plugin.requestAuthorization !== 'function' ||
      typeof plugin.beginAssetScan !== 'function' ||
      typeof plugin.getAssetsPage !== 'function' ||
      typeof plugin.endAssetScan !== 'function' ||
      typeof onPage !== 'function' ||
      typeof shouldStop !== 'function' ||
      typeof onProgress !== 'function' ||
      !validInteger(maxItems, 1, 100000) ||
      !validInteger(pageSize, 1, 250)) {
    stop('INVALID_SCAN_CONFIGURATION', 'Configuração de leitura PhotoKit inválida.');
  }

  let { status } = await plugin.authorizationStatus();
  if (status === 'notDetermined') {
    ({ status } = await plugin.requestAuthorization());
  }
  if (status !== 'authorized') {
    stop('PHOTOS_FULL_ACCESS_REQUIRED', 'É necessário autorizar o acesso completo às Fotografias no iPhone.');
  }

  // IMPORTANT: no persistent cursor is accepted. Native tokens expire on
  // app relaunch and on PHPhotoLibraryChangeObserver invalidation.
  const scan = await plugin.beginAssetScan();
  const tokenUsable = typeof scan?.snapshotToken === 'string' &&
    scan.snapshotToken.length >= 1 && scan.snapshotToken.length <= 128;
  if (!tokenUsable || !validInteger(scan.total, 0, Number.MAX_SAFE_INTEGER)) {
    // A malformed total can still accompany a real native session. Close it
    // before rejecting, otherwise the retained PHFetchResult survives until
    // another scan starts or the plugin is released.
    if (tokenUsable) {
      try {
        await plugin.endAssetScan({ snapshotToken: scan.snapshotToken });
      } catch {
        // Do not allow a failed cleanup to mask the invalid-session error.
      }
    }
    stop('INVALID_SCAN_SESSION', 'O PhotoKit devolveu uma sessão de leitura inválida.');
  }

  const snapshotToken = scan.snapshotToken;
  const total = scan.total;
  const target = Math.min(maxItems, total);
  const seen = new Set();
  let processed = 0;
  let pages = 0;
  let finalProgress = null;
  let result = null;

  let primaryError = null;
  try {
    while (processed < target) {
      if (await shouldStop()) {
        result = { state: 'stopped', processed, total, target, pages, complete: false };
        break;
      }
      const limit = Math.min(pageSize, target - processed);
      const page = await plugin.getAssetsPage({
        offset: processed, limit, snapshotToken
      });
      const end = processed + limit;
      if (!page || page.total !== total || !Array.isArray(page.assets) ||
          page.assets.length !== limit ||
          page.nextOffset !== (end < total ? end : null)) {
        stop('INVALID_NATIVE_PAGE', 'A sequência PhotoKit mudou ou está incompleta. Reinicia a análise.');
      }
      const ids = validateAssets(page.assets, seen);
      // The user may have stopped while the native page was in flight.
      // Do not persist that new page after cancellation.
      if (await shouldStop()) {
        result = { state: 'stopped', processed, total, target, pages, complete: false };
        break;
      }
      // Progress is NOT reported until persistence resolves successfully.
      // The caller must store records and a merge checkpoint atomically.
      await onPage({
        assets: page.assets,
        offset: processed,
        nextOffset: end,
        total,
        target
      });
      for (const id of ids) seen.add(id);
      processed = end;
      pages += 1;
      const progress = { processed, total, target, pages };
      // The final page has been stored, but the native snapshot has not yet
      // been certified. Never display 100% progress before endAssetScan agrees.
      if (processed === target) finalProgress = progress;
      else await onProgress(progress);
    }
    if (!result) {
      const complete = processed === total;
      result = {
        state: complete ? 'complete' : 'limit_reached',
        processed, total, target, pages, complete
      };
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    // Ending the native snapshot is the final validity acknowledgment: a
    // library mutation during a slow durable write must fail closed instead
    // of returning "complete". Keep original read/storage errors intact.
    try {
      const closed = await plugin.endAssetScan({ snapshotToken });
      if (!closed || closed.ended !== true) {
        stop('SCAN_END_UNVERIFIED', 'O PhotoKit não confirmou o fecho da sessão de leitura.');
      }
    } catch (endError) {
      if (!primaryError) throw endError;
    }
  }
  // This signal can make the UI show 100%; only emit it after native close
  // confirms the snapshot was not invalidated during the final durable write.
  if (finalProgress) await onProgress(finalProgress);
  return result;
}
