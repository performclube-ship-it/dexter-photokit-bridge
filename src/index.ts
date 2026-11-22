import { registerPlugin } from '@capacitor/core';
import type { DexterPhotoKitPlugin } from './definitions';
export const DexterPhotoKit = registerPlugin<DexterPhotoKitPlugin>('DexterPhotoKit');
export type * from './definitions';
