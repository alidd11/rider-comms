import * as ImageManipulator from 'expo-image-manipulator';
import { videoTypeFor } from './publishPost';
import type { PrepareMedia } from './publishPost';

/** The server keeps photos at most this size; sending more is wasted data. */
const PHOTO_MAX_EDGE = 2048;

async function blobOf(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return response.blob();
}

/**
 * Photos become JPEG on the phone first: iPhones often hand over HEIC,
 * which the server doesn't decode, and a smaller file uploads faster.
 * Videos go as they are; the server re-encodes them.
 */
export const prepareMediaForUpload: PrepareMedia = async (item) => {
  if (item.kind === 'video') {
    const body = await blobOf(item.uri);
    return { body, type: videoTypeFor(item, body.type) };
  }
  const longest = Math.max(item.width ?? 0, item.height ?? 0);
  const resize = longest > PHOTO_MAX_EDGE
    ? [{ resize: (item.width ?? 0) >= (item.height ?? 0) ? { width: PHOTO_MAX_EDGE } : { height: PHOTO_MAX_EDGE } }]
    : [];
  const jpeg = await ImageManipulator.manipulateAsync(item.uri, resize, {
    compress: 0.9, format: ImageManipulator.SaveFormat.JPEG,
  });
  return { body: await blobOf(jpeg.uri), type: 'image/jpeg' };
};
