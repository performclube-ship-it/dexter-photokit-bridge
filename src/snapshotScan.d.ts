import type { DexterNativeAsset, DexterPhotoKitPlugin } from './definitions';
export type SnapshotScanPage = {
  assets: DexterNativeAsset[];
  offset: number;
  nextOffset: number;
  total: number;
  target: number;
};
export type SnapshotScanProgress = {
  processed: number;
  total: number;
  target: number;
  pages: number;
};
export type SnapshotScanResult = SnapshotScanProgress & {
  state: 'complete' | 'limit_reached' | 'stopped';
  complete: boolean;
};
export declare function scanSnapshotPages(options: {
  plugin: Pick<DexterPhotoKitPlugin, 'authorizationStatus' | 'requestAuthorization' | 'beginAssetScan' | 'getAssetsPage' | 'endAssetScan'>;
  /** Must DURABLY merge/persist this page before resolving. Do not persist scan tokens. */
  onPage: (page: SnapshotScanPage) => void | Promise<void>;
  maxItems?: number;
  pageSize?: number;
  shouldStop?: () => boolean | Promise<boolean>;
  onProgress?: (progress: SnapshotScanProgress) => void | Promise<void>;
}): Promise<SnapshotScanResult>;
