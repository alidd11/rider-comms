/**
 * Server-only, fail-closed readiness gate for trusted media processors.
 * This does not scan or transcode media. Never accept these fields from clients:
 * they must come from the trusted quarantine/processing worker and storage checks.
 */
export type SocialMediaProcessingReceipt = {
  kind: 'image' | 'video';
  sourceSha256: string;
  outputSha256: string;
  quarantineScan: 'clean' | 'infected' | 'error' | 'pending';
  unsafeContentReview: 'approved' | 'rejected' | 'pending' | 'error';
  metadataScrub: 'verified' | 'failed' | 'pending';
  outputInspection: 'verified' | 'failed' | 'pending';
  outputStorage: 'private' | 'public' | 'missing';
  videoTranscode?: 'verified' | 'failed' | 'pending';
  videoDurationSeconds?: number;
};

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_VIDEO_SECONDS = 180;

export function isSocialMediaReady(receipt: SocialMediaProcessingReceipt | null | undefined): boolean {
  if (!receipt || (receipt.kind !== 'image' && receipt.kind !== 'video')) return false;
  if (!SHA256.test(receipt.sourceSha256) || !SHA256.test(receipt.outputSha256)) return false;
  if (receipt.quarantineScan !== 'clean' || receipt.unsafeContentReview !== 'approved') return false;
  if (receipt.metadataScrub !== 'verified' || receipt.outputInspection !== 'verified') return false;
  if (receipt.outputStorage !== 'private') return false;
  if (receipt.kind === 'video') {
    return receipt.videoTranscode === 'verified'
      && typeof receipt.videoDurationSeconds === 'number'
      && Number.isFinite(receipt.videoDurationSeconds)
      && receipt.videoDurationSeconds > 0
      && receipt.videoDurationSeconds <= MAX_VIDEO_SECONDS;
  }
  return receipt.videoTranscode === undefined && receipt.videoDurationSeconds === undefined;
}
