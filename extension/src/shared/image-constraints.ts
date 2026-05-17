/** Maximum allowed size for a single image attachment (10 MB). */
export const MAX_IMAGE_INPUT_BYTES = 10 * 1024 * 1024;

/** MIME types accepted for image attachments. */
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);
