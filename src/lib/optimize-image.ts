/** Max payload the backend accepts (512 KB encoded). */
export const MAX_LOGO_BYTES = 512 * 1024;

/**
 * Downsample a raster image to ≤512 px on the longest edge, then re-encode as
 * WebP (PNG fallback) stepping quality from 0.92 down until the base64 payload
 * fits within MAX_LOGO_BYTES.  SVG files are returned as-is (still size-checked
 * by the caller via MAX_LOGO_BYTES).
 *
 * Throws if the browser cannot decode the file (corrupt / unsupported format)
 * so callers can surface a clear message instead of a generic failure.
 */
export async function optimizeImage(file: File): Promise<File> {
  if (file.type === 'image/svg+xml') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Unable to read this image. Try a PNG, JPEG or WebP file.');
  }

  const MAX_PX = 512;
  const scale = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const supportsWebP = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  const mime = supportsWebP ? 'image/webp' : 'image/png';

  // Step quality down until the base64 fits the backend limit.
  for (let quality = 0.92; quality >= 0.30; quality -= 0.12) {
    const blob: Blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b ?? new Blob()), mime, quality);
    });
    if (blob.size <= MAX_LOGO_BYTES) {
      return new File([blob], file.name.replace(/\.[^.]+$/, supportsWebP ? '.webp' : '.png'), { type: mime });
    }
  }

  // Last resort: PNG at default quality.
  const blob: Blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? new Blob()), 'image/png');
  });
  return new File([blob], file.name.replace(/\.[^.]+$/, '.png'), { type: 'image/png' });
}

/**
 * Optimizes a logo file and enforces the backend size limit, throwing a
 * localized error when the result is still too big (e.g. an oversized SVG).
 */
export async function prepareLogoUpload(file: File, tooBigMessage: string): Promise<File> {
  const optimized = await optimizeImage(file);
  if (optimized.size > MAX_LOGO_BYTES) {
    throw new Error(tooBigMessage);
  }
  return optimized;
}
