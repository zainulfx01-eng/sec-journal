// Screenshot attachments. Pure helpers (tested in Node) plus a browser-only compressor.
// Data is stored as JPEG data URLs inside localStorage. This is LOCAL ONLY until Stage 3 (Supabase).
import { SHOT_KINDS, SHOT_MAX_DIM, SHOT_JPEG_QUALITY, SHOT_TOTAL_CAP_CHARS, SHOT_WARN_RATIO } from './config.js';

// Total data-URL characters used across all trades. Characters approximate bytes for the cap.
export function screenshotUsage(trades) {
  let chars = 0;
  let count = 0;
  for (const t of trades || []) {
    for (const s of t.screenshots || []) {
      chars += String(s.dataUrl || '').length;
      count++;
    }
  }
  const ratio = chars / SHOT_TOTAL_CAP_CHARS;
  return {
    chars,
    count,
    cap: SHOT_TOTAL_CAP_CHARS,
    ratio,
    level: ratio >= 1 ? 'full' : ratio >= SHOT_WARN_RATIO ? 'warn' : 'ok',
    mb: Math.round((chars / 1024 / 1024) * 100) / 100,
  };
}

// Keep only well-formed screenshot records. Anything else is dropped, never guessed at.
export function sanitizeShots(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s === 'object' && SHOT_KINDS.includes(s.kind) && /^data:image\/jpeg;base64,/.test(String(s.dataUrl || '')))
    .map((s) => ({
      id: String(s.id || ''),
      kind: s.kind,
      dataUrl: String(s.dataUrl),
      width: Number(s.width) || null,
      height: Number(s.height) || null,
      bytes: String(s.dataUrl).length,
      createdAt: typeof s.createdAt === 'string' ? s.createdAt : null,
    }))
    .filter((s) => s.id);
}

// Target size for a resize so the longest side is at most maxDim. Never upscales.
export function fitDimensions(width, height, maxDim = SHOT_MAX_DIM) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return null;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scaled: scale < 1 };
}

// Browser-only: decode a picked image file, draw it to a canvas at most SHOT_MAX_DIM wide/tall, export JPEG.
// Returns { dataUrl, width, height }. Throws a readable Error when the file cannot be read.
export async function compressImageFile(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Pick an image file (JPG, PNG or similar).');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const dims = fitDimensions(img.naturalWidth || img.width, img.naturalHeight || img.height);
    if (!dims) throw new Error('This image has no readable size.');
    const canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext('2d');
    // White backdrop so transparent PNGs do not turn black in JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dims.width, dims.height);
    ctx.drawImage(img, 0, 0, dims.width, dims.height);
    const dataUrl = canvas.toDataURL('image/jpeg', SHOT_JPEG_QUALITY);
    if (!/^data:image\/jpeg;base64,/.test(dataUrl)) throw new Error('This browser cannot compress the image. Try a different photo.');
    return { dataUrl, width: dims.width, height: dims.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image. Try another file.'));
    img.src = src;
  });
}
