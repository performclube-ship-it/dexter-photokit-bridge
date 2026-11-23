import { registerPlugin } from '@capacitor/core';
import type { DexterPhotoKitPlugin } from './definitions';
export const DexterPhotoKit = registerPlugin<DexterPhotoKitPlugin>('DexterPhotoKit');
export type * from './definitions';
export { scanSnapshotPages } from './snapshotScan.js';
export type { SnapshotScanPage, SnapshotScanProgress, SnapshotScanResult } from './snapshotScan.js';
export { classifyLocalPages } from './progressiveClassification.js';
export type * from './progressiveClassification.js';
