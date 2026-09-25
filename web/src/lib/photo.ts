// Client-side photo downscale for completion / crew photos. Mirrors the seed's canvas resize:
// longest edge clamped to <=500px, re-encoded as JPEG at quality 0.72 so the resulting data URL
// stays small enough to persist in the vendor DB. Runs only in the browser.

const MAX_EDGE = 500;
const QUALITY = 0.72;

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.readAsDataURL(file);
  });

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image.'));
    img.src = src;
  });

export async function fileToResizedDataUrl(
  file: File,
  maxEdge: number = MAX_EDGE,
  quality: number = QUALITY,
): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (!width || !height) return dataUrl; // fallback: cannot measure

  if (width > maxEdge || height > maxEdge) {
    if (width >= height) {
      height = Math.round((height * maxEdge) / width);
      width = maxEdge;
    } else {
      width = Math.round((width * maxEdge) / height);
      height = maxEdge;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, width, height);
  let encoded=canvas.toDataURL('image/jpeg',quality);
  for(let q=quality-0.1;encoded.length>350000&&q>=0.2;q-=0.1)encoded=canvas.toDataURL('image/jpeg',q);
  if(encoded.length>350000)throw new Error('Image is too large. Choose a smaller photo.');
  return encoded;
}
