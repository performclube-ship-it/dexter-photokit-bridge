export type PhotoAuthorizationStatus = 'notDetermined' | 'restricted' | 'denied' | 'limited' | 'authorized';
export interface DexterNativeAsset {
  id: string;
  type: 'image' | 'video' | 'other';
  createdAt: string | null;
  width: number;
  height: number;
}
export interface DexterAssetScan { snapshotToken: string; total: number; }
export interface DexterNativeAssetsPage {
  total: number;
  nextOffset: number | null;
  assets: DexterNativeAsset[];
}
export interface DexterPhotoKitPlugin {
  authorizationStatus(): Promise<{ status: PhotoAuthorizationStatus }>;
  requestAuthorization(): Promise<{ status: PhotoAuthorizationStatus }>;
  /** Begin a volatile fixed-result scan; save the token only for this live session. */
  beginAssetScan(): Promise<DexterAssetScan>;
  getAssetsPage(input: { offset: number; limit: number; snapshotToken?: string }): Promise<DexterNativeAssetsPage>;
  endAssetScan(input: { snapshotToken: string }): Promise<{ ended: boolean }>;
  listAlbums(): Promise<{ albums: Array<{ id: string; title: string }> }>;
  createAlbum(input: { title: string }): Promise<{ id: string }>;
  isAlbumWritable(input: { albumId: string }): Promise<{ writable: boolean }>;
  areAssetsAccessible(input: { assetIds: string[] }): Promise<{ accessible: boolean }>;
  /** Explicit review: maximum 10 local-only 128px JPEGs, no iCloud download. Do not persist or upload dataUrl. */
  getPilotPreviews(input: { assetIds: string[] }): Promise<{
    previews: Array<{ id: string; status: 'ready' | 'icloud' | 'unavailable'; dataUrl?: string }>;
  }>;
  /** Safety pilot: maximum 10 unique original PhotoKit assets per native write until real-device validation. */
  addExistingAssets(input: { albumId: string; assetIds: string[] }): Promise<{
    requestedCount: number;
    addedCount: number;
    alreadyPresentCount: number;
  }>;
  verifyAlbumMembership(input: { albumId: string; assetIds: string[] }): Promise<{
    complete: boolean;
    presentCount: number;
    missingCount: number;
  }>;
}
