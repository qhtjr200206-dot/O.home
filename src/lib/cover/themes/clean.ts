// 클린 — 장식 없는 단색 바탕, 가운데 큰 사진, 가운데 정렬 글자. 가장 단순한 플레이리스트 커버.
import type { AccentPalette, ThemeDef, Tone } from '../types';
import { alpha, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, photoBackdrop, withShadow, rr, surfaceOf } from './_paint';

/** 톤별 바탕 — 포인트색이 아주 살짝 밴 흰색 / 먹색 */
const cleanBg = (tone: Tone, p: AccentPalette) => (tone === 'dark' ? mix(p.accentDeep, '#111113', 0.86) : mix(p.accentSoft, '#fbfbfa', 0.86));

export const clean: ThemeDef = {
  id: 'clean',
  name: '클린',
  desc: '단색 바탕 가운데 큰 사진 — 장식 없이 깔끔하게',
  suggestedAccent: '#3a6df0',
  baseTone: 'light',
  toneBg: cleanBg,
  background(ctx, f, kit) {
    if (f.settings.photoLayout === 'background') { photoBackdrop(ctx, f, kit); return; }
    ctx.fillStyle = surfaceOf(f, cleanBg);
    ctx.fillRect(0, 0, f.width, f.height);
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings, p = f.palette;
    const shape = shapeOf(f);
    const pad = 80 * u;
    const ink = p.ink, sub = p.inkSoft, acc = p.accentInk;
    const cover = s.photoLayout === 'cover';
    const viz = s.visualizer !== 'none';
    const bars = viz && s.visualizer !== 'radial';
    const photo = (x: number, y: number, size: number) => {
      if (s.visualizer === 'radial') {
        const VR = size * 0.5 * 1.36;
        kit.drawVisualizer(ctx, { x: x + size / 2 - VR, y: y + size / 2 - VR, w: VR * 2, h: VR * 2 }, { color: acc, color2: alpha(ink, 0.4), innerRadius: 0.74, alpha: 0.8 });
      }
      withShadow(ctx, 50 * u, 18 * u, p.tone === 'light' ? alpha(p.shadow, 0.22) : 'rgba(0,0,0,0.55)', () => { rr(ctx, x, y, size, size, 18 * u); ctx.fillStyle = '#111'; ctx.fill(); });
      kit.drawPhoto(ctx, { x, y, w: size, h: size }, { radius: 18 * u });
    };
    // 글자 묶음 (가운데 정렬) — 제목·아티스트·문구 → 가사 → 비주얼라이저 → 진행
    const block = (cx: number, top: number, bottom: number, w: number, big: number) => {
      text(ctx, kit, titleOf(f), cx, top + big * 0.9, { font: kit.font(big, 800), color: ink, align: 'center', maxW: w });
      text(ctx, kit, artistOf(f), cx, top + big * 0.9 + 46 * u, { font: kit.font(28 * u, 500), color: sub, align: 'center', maxW: w });
      let y = top + big * 0.9 + 46 * u;
      if (s.phrase) { text(ctx, kit, s.phrase, cx, y + 40 * u, { font: kit.font(22 * u, 500), color: acc, align: 'center', maxW: w }); y += 40 * u; }
      let b = bottom;
      if (s.showProgress) {
        const pw = Math.min(w, 520 * u);
        ctx.fillStyle = alpha(ink, 0.14); ctx.fillRect(cx - pw / 2, b - 2 * u, pw, 3 * u);
        ctx.fillStyle = acc; ctx.fillRect(cx - pw / 2, b - 2 * u, pw * kit.progress, 3 * u);
        text(ctx, kit, kit.fmtTime(f.time), cx - pw / 2 - 16 * u, b + 6 * u, { font: kit.font(18 * u, 400, kit.mono), color: sub, align: 'right' });
        text(ctx, kit, kit.fmtTime(f.duration), cx + pw / 2 + 16 * u, b + 6 * u, { font: kit.font(18 * u, 400, kit.mono), color: sub });
        b -= 36 * u;
      }
      if (bars) {
        const vw = Math.min(w, 420 * u);
        kit.drawVisualizer(ctx, { x: cx - vw / 2, y: b - 50 * u, w: vw, h: 50 * u }, { color: acc, color2: alpha(ink, 0.5), count: 36, mirror: true, alpha: 0.85 });
        b -= 74 * u;
      }
      const ly = y + 34 * u;
      if (b - ly > 40 * u) kit.drawLyrics(ctx, { x: cx - w / 2, y: ly, w, h: b - ly }, { align: 'center', size: 36 * u, color: ink, dimColor: ink, weight: 700, lineHeight: 1.45, contextScale: 0.8 });
    };
    if (shape === 'land') {
      if (cover) {
        const size = H - pad * 2;
        photo(pad * 1.2, pad, size);
        const x0 = pad * 1.2 + size + pad;
        block((x0 + W - pad) / 2, pad * 1.3, H - pad, W - pad - x0, 60 * u);
      } else block(W / 2, H * 0.2, H - pad, W * 0.6, 72 * u);
      return;
    }
    if (cover) {
      const tall = shape === 'tall';
      const size = tall ? Math.min(W - pad * 2, H * 0.5) : 500 * u;
      const y = tall ? (H / W > 1.5 ? H * 0.1 : pad) : pad * 0.8;
      photo((W - size) / 2, y, size);
      block(W / 2, y + size + 40 * u, H - pad * 0.8, W - pad * 2, (tall ? 60 : 50) * u);
    } else {
      block(W / 2, H * 0.32, H - pad, W - pad * 2, 72 * u);
    }
  },
};
