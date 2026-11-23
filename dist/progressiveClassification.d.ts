/** Bounded local Vision coordinator: result labels must remain transient. */
export interface LocalVisionObservation { label: string; confidence: number }
export interface LocalVisionResult {
  id: string;
  status: 'ready' | 'icloud' | 'unavailable' | 'unsupported';
  labels: LocalVisionObservation[];
}
export interface LocalVisionProgress {
  processed: number;
  expectedCount: number;
  batches: number;
  retryableCount: number;
  unsupportedCount: number;
}
export interface LocalVisionOutcome extends LocalVisionProgress {
  state: 'complete' | 'retry_pending' | 'stopped';
  complete: boolean;
  needsRetry: boolean;
}
export interface LocalVisionBridge {
  authorizationStatus(): Promise<{ status: string }>;
  requestAuthorization(): Promise<{ status: string }>;
  classifyPilotAssets(input: { assetIds: string[] }): Promise<{ results: LocalVisionResult[] }>;
}
export interface LocalVisionOptions {
  plugin: LocalVisionBridge;
  assetPages: Iterable<string[]> | AsyncIterable<string[]>;
  expectedCount: number;
  onReviewBatch(input: {
    results: LocalVisionResult[];
    retryable: Array<{id: string; reason: 'icloud' | 'unavailable'}>;
    processedBefore: number;
    expectedCount: number;
  }): Promise<{acknowledged: true}>;
  batchSize?: number;
  shouldStop?: () => boolean | Promise<boolean>;
  onProgress?: (counts: LocalVisionProgress) => void | Promise<void>;
}
/**
 * Calls native local classification in batches <= 10, requires an explicit
 * local review acknowledgement and retains unavailable/cloud-only IDs for retry.
 * No PhotoKit mutation. Restarts require re-enumerating local IDs from offset 0
 * and merging local handled statuses by ID; never share device-local IDs.
 */
export declare function classifyLocalPages(options: LocalVisionOptions): Promise<LocalVisionOutcome>;
