// 로그 편집기 — 인장(아바타) 이미지 줄이기·바꾸기. 브라우저에서만 쓴다 (캔버스).
//
// 코코포리아 로그에는 인장이 원본 크기 PNG로 통째로 들어 있어 용량 대부분을 차지하고,
// 반대로 작게 뭉개져 들어온 그림은 화질이 깨져 보인다 (사용자 제보). 그래서
//  · 로그에 든 인장은 화면 크기(40px)의 몇 배 정도로만 다시 그려 WebP로 줄이고
//  · 사용자가 올린 사진으로 바꿀 수 있게 하되, 그것도 같은 크기로 줄여 HTML 안에 넣는다.
// 파일은 서버에 올리지 않는다 — 모두 이 브라우저 안에서 data: URL로 끝난다.

/** 인장 화질 단계 — 한 변 픽셀 · WebP 품질. 표시는 40px(모바일 32px)이라 2~4배면 충분히 선명하다 */
export const AVATAR_PRESETS = {
  high: { label: '고화질', size: 160, quality: 0.9 },
  normal: { label: '표준', size: 112, quality: 0.85 },
  light: { label: '가볍게', size: 80, quality: 0.78 },
  tiny: { label: '최소', size: 56, quality: 0.7 },
} as const;
export type AvatarPreset = keyof typeof AVATAR_PRESETS;
/** 용량 맞추기에서 차례로 내려 볼 순서 */
export const PRESET_ORDER: AvatarPreset[] = ['high', 'normal', 'light', 'tiny'];

let webpOk: boolean | null = null;
function canWebp(): boolean {
  if (webpOk === null) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      webpOk = c.toDataURL('image/webp').startsWith('data:image/webp');
    } catch { webpOk = false; }
  }
  return webpOk;
}

async function toBitmap(src: string | Blob): Promise<ImageBitmap | HTMLImageElement> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch { /* 아래 <img>로 */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

/**
 * 정사각형으로 가운데를 잘라 size×size 이하로 다시 그린다 (인장은 정사각형 칸에 cover로 들어간다).
 * 원본이 더 작으면 키우지 않는다. 결과가 원본보다 크면 원본(data: URL일 때)을 그대로 돌려준다.
 */
export async function shrinkImage(src: string | Blob, size: number, quality: number): Promise<string> {
  const bmp = await toBitmap(src);
  const w = bmp.width;
  const h = bmp.height;
  const side = Math.min(w, h);
  const out = Math.max(1, Math.min(size, side));
  const c = document.createElement('canvas');
  c.width = c.height = out;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp as CanvasImageSource, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
  if ('close' in bmp) bmp.close();
  const url = canWebp() ? c.toDataURL('image/webp', quality) : c.toDataURL('image/png');
  if (typeof src === 'string' && src.startsWith('data:') && src.length <= url.length) return src;
  return url;
}

/** 여러 장을 한꺼번에 — 같은 원본은 한 번만 처리 */
export async function shrinkAll(
  sources: Record<number, string | Blob>, size: number, quality: number,
): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  const memo = new Map<string | Blob, Promise<string>>();
  await Promise.all(Object.entries(sources).map(async ([k, src]) => {
    let p = memo.get(src);
    if (!p) {
      p = shrinkImage(src, size, quality).catch(() => (typeof src === 'string' ? src : ''));
      memo.set(src, p);
    }
    out[Number(k)] = await p;
  }));
  return out;
}

/** 문자열의 실제 바이트 수 (UTF-8) */
export const byteSize = (s: string) => new Blob([s]).size;

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}
