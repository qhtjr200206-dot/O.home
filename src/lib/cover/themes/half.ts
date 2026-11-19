// 하프 — 화면 절반은 사진, 나머지 절반은 단색 면에 큰 제목과 가사. 단순하지만 사진이 크게 보인다.
import type { AccentPalette, ThemeDef, Tone, Rect } from '../types';
import { alpha, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, photoBackdrop, surfaceOf, setSpacing } from './_paint';

/** 톤별 바탕 — 따뜻한 미색 / 깊은 먹색 */
const halfBg = (tone: Tone, p: AccentPalette) => (tone === 'dark' ? mix(p.accentDeep, '#121214', 0.84) : mix(p.accentSoft, '#f8f6f1', 0.8));

/** 사진 칸과 글자 칸 — 가로·정사각은 좌우, 세로는 위아래 */
function split(W: number, H: number, tall: boolean): { photo: Rect; panel: Rect } {
  if (tall) {
    const ph = Math.round(H * 0.52);
    return { photo: { x: 0, y: 0, w: W, h: ph }, panel: { x: 0, y: ph, w: W, h: H - ph } };
  }
  const pw = Math.round(W * 0.5);
  return { photo: { x: 0, y: 0, w: pw, h: H }, panel: { x: pw, y: 0, w: W - pw, h: H } };
}

export const half: ThemeDef = {
  id: 'half',
  name: '하프',
  desc: '절반은 사진, 절반은 단색 — 큰 제목과 가사',
  suggestedAccent: '#e4572e',
  baseTone: 'light',
  toneBg: halfBg,
  background(ctx, f, kit) {
    if (f.settings.photoLayout === 'background') { photoBackdrop(ctx, f, kit); return; }
    ctx.fillStyle = surfaceOf(f, halfBg);
    ctx.fillRect(0, 0, f.width, f.height);
    // 사진 칸은 움직임(흔들림) 변환 밖에서 그려 화면 가장자리가 비지 않게
    kit.drawPhoto(ctx, split(f.width, f.height, shapeOf(f) === 'tall').photo);
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings, p = f.palette;
    const tall = shapeOf(f) === 'tall';
    const { panel } = split(W, H, tall);
    const cover = s.photoLayout === 'cover';
    const ink = p.ink, sub = p.inkSoft, acc = p.accentInk;
    if (!cover) {
      // 전체 배경 — 글자 칸만 바탕색 면을 반투명하게 깐다
      ctx.fillStyle = alpha(p.bg, 0.82);
      ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    }
    // 경계에 포인트색 가는 띠
    ctx.fillStyle = p.accent;
    if (tall) ctx.fillRect(0, panel.y - 4 * u, W, 8 * u); else ctx.fillRect(panel.x - 4 * u, 0, 8 * u, H);

    const pad = 64 * u;
    const x = panel.x + pad, w = panel.w - pad * 2;
    let y = panel.y + pad;
    ctx.save(); setSpacing(ctx, 4 * u);
    text(ctx, kit, (s.phrase || 'PLAYLIST').toUpperCase(), x, y + 18 * u, { role: s.phrase ? 'phrase' : undefined, font: kit.font(20 * u, 700, kit.mono), color: acc, maxW: w });
    ctx.restore();
    const big = (tall ? 76 : 64) * u;
    text(ctx, kit, titleOf(f), x, y + 30 * u + big, { role: 'title', font: kit.font(big, 900), color: ink, maxW: w });
    text(ctx, kit, artistOf(f), x, y + 30 * u + big + 50 * u, { role: 'artist', font: kit.font(30 * u, 500), color: sub, maxW: w });
    y += 30 * u + big + 90 * u;
    let b = panel.y + panel.h - pad;
    if (s.showProgress) {
      ctx.fillStyle = alpha(ink, 0.14); ctx.fillRect(x, b - 3 * u, w, 4 * u);
      ctx.fillStyle = acc; ctx.fillRect(x, b - 3 * u, w * kit.progress, 4 * u);
      text(ctx, kit, kit.fmtTime(f.time), x, b - 20 * u, { font: kit.font(18 * u, 400, kit.mono), color: sub });
      text(ctx, kit, kit.fmtTime(f.duration), x + w, b - 20 * u, { font: kit.font(18 * u, 400, kit.mono), color: sub, align: 'right' });
      b -= 60 * u;
    }
    if (s.visualizer !== 'none') {
      const vh = 60 * u;
      kit.drawVisualizer(ctx, { x, y: b - vh, w, h: vh }, { kind: s.visualizer === 'radial' ? 'bars' : undefined, color: acc, color2: alpha(ink, 0.45), count: 32, alpha: 0.9 });
      b -= vh + 26 * u;
    }
    if (b - y > 40 * u) kit.drawLyrics(ctx, { x, y, w, h: b - y }, { align: 'left', size: (tall ? 44 : 38) * u, color: ink, dimColor: ink, weight: 700, lineHeight: 1.42 });
  },
};
