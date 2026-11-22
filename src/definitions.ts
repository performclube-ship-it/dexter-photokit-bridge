export type PhotoAuthorizationStatus = 'notDetermined' | 'restricted' | 'denied' | 'limited' | 'authorized';
export interface DexterNativeAsset {
  id: string;
  type: 'image' | 'video' | 'other';
  createdAt: string | null;
  width: number;
  height: number;
}
export interface DexterNativeAssetsPage {
  total: number;
  nextOffset: number | null;
  assets: DexterNativeAsset[];
}
export interface DexterPhotoKitPlugin {
  authorizationStatus(): Promise<{ status: PhotoAuthorizationStatus }>;
  requestAuthorization(): Promise<{ status: PhotoAuthorizationStatus }>;
  getAssetsPage(input: { offset: number; limit: number }): Promise<DexterNativeAssetsPage>;
  listAlbums(): Promise<{ albums: Array<{ id: string; title: string }> }>;
  createAlbum(input: { title: string }): Promise<{ id: string }>;
  isAlbumWritable(input: { albumId: string }): Promise<{ writable: boolean }>;
  areAssetsAccessible(input: { assetIds: string[] }): Promise<{ accessible: boolean }>;
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
