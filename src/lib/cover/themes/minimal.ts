// 심플 — 음악 앱의 「지금 재생 중」 화면. 큰 커버, 정돈된 글자, 얇은 진행 막대.
import type { AccentPalette, ThemeDef, Tone } from '../types';
import { alpha, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, progressBar, transport, withShadow, rr, photoBackdrop, grain, isNative, surfaceOf } from './_paint';

/** 톤별 바탕 — 다크: 포인트색이 밴 먹색 / 라이트: 음악 앱 라이트 모드의 거의 흰 바탕 */
const appBg = (tone: Tone, p: AccentPalette) =>
  tone === 'dark' ? mix(p.accentDeep, '#0c0c0e', 0.55) : mix(p.accentSoft, '#fbfbfc', 0.72);

export const minimal: ThemeDef = {
  id: 'minimal',
  name: '심플',
  desc: '음악 앱 「지금 재생 중」처럼 정갈한 카드',
  suggestedAccent: '#1ed760',
  baseTone: 'dark',
  toneBg: appBg,
  background(ctx, f, kit) {
    const W = f.width, H = f.height, p = f.palette;
    const light = p.tone === 'light';
    if (f.settings.photoLayout === 'background') {
      photoBackdrop(ctx, f, kit, 0.1);
    } else if (!light) {
      // 포인트색이 위에서 번지는 어두운 바탕
      ctx.fillStyle = surfaceOf(f, appBg);
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, alpha(p.accent, 0.55));
      g.addColorStop(0.55, alpha(p.accent, 0.08));
      g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      // 라이트 모드 — 흰 바탕 위쪽에 포인트색이 옅게 번지고, 오른쪽 위에 둥근 빛 번짐 하나
      ctx.fillStyle = surfaceOf(f, appBg);
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, alpha(p.accent, 0.24));
      g.addColorStop(0.5, alpha(p.accent, 0.04));
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const r = ctx.createRadialGradient(W * 0.85, H * 0.08, 0, W * 0.85, H * 0.08, Math.max(W, H) * 0.55);
      r.addColorStop(0, alpha(p.accent, 0.16));
      r.addColorStop(1, alpha(p.accent, 0));
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, W, H);
    }
    grain(ctx, f, light ? 0.03 : 0.05, 0);
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings;
    const shape = shapeOf(f);
    const p = f.palette;
    const nat = isNative(f, 'dark');
    const light = p.tone === 'light';
    // 글자 — 원래 모습은 흰 글자, 그 밖엔 팔레트 (white = 본문 글자색)
    const white = nat ? '#ffffff' : p.ink;
    const sub = nat ? 'rgba(255,255,255,0.66)' : p.inkSoft;
    const acc = nat ? p.accent : p.accentInk;
    const pad = 72 * u;
    const bg = s.photoLayout === 'background';
    const viz = s.visualizer !== 'none';

    // 머리말 — 문구가 있으면 「플레이리스트 이름」 자리에
    const head = (x: number, y: number, align: CanvasTextAlign, maxW: number) => {
      text(ctx, kit, 'PLAYING FROM PLAYLIST', x, y, { font: kit.font(17 * u, 600, kit.mono), color: sub, align, spacing: 2.4 * u, maxW });
      if (s.phrase) text(ctx, kit, s.phrase, x, y + 34 * u, { font: kit.font(26 * u, 700), color: white, align, maxW });
    };
    const titleBlock = (x: number, y: number, w: number, big = 1) => {
      // y = 제목 글자 위쪽
      text(ctx, kit, titleOf(f), x, y + 50 * u * big, { font: kit.font(54 * u * big, 800), color: white, maxW: w - 70 * u });
      text(ctx, kit, artistOf(f), x, y + 98 * u * big, { font: kit.font(30 * u * big, 500), color: sub, maxW: w - 70 * u });
      // 좋아요 표시 (포인트색 원 안 체크)
      const hx = x + w - 24 * u, hy = y + 36 * u * big;
      ctx.beginPath(); ctx.arc(hx, hy, 22 * u, 0, Math.PI * 2); ctx.fillStyle = f.palette.accent; ctx.fill();
      ctx.strokeStyle = f.palette.onAccent; ctx.lineWidth = 4.5 * u; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(hx - 9 * u, hy); ctx.lineTo(hx - 2 * u, hy + 7 * u); ctx.lineTo(hx + 10 * u, hy - 7 * u); ctx.stroke();
    };
    const coverAt = (x: number, y: number, w: number) => {
      if (s.visualizer === 'radial') {
        // 원형은 커버 뒤에서 퍼져 나오는 빛 고리로
        const VR = w * 0.5 * 1.42;
        kit.drawVisualizer(ctx, { x: x + w / 2 - VR, y: y + w / 2 - VR, w: VR * 2, h: VR * 2 }, { color: acc, color2: white, innerRadius: 0.72, alpha: 0.9 });
      }
      withShadow(ctx, 60 * u, 24 * u, light ? alpha(p.shadow, 0.28) : 'rgba(0,0,0,0.5)', () => {
        rr(ctx, x, y, w, w, 14 * u); ctx.fillStyle = '#111'; ctx.fill();
      });
      kit.drawPhoto(ctx, { x, y, w, h: w }, { radius: 14 * u });
    };
    const lyrics = (x: number, y: number, w: number, h: number, size: number) => {
      if (h < size * 1.2) return;
      kit.drawLyrics(ctx, { x, y, w, h }, {
        align: 'left', size, color: white, dimColor: nat ? 'rgba(255,255,255,0.78)' : white, weight: 800, lineHeight: 1.4, contextScale: 0.8,
      });
    };
    // 아래 묶음: [비주얼라이저] · 진행 막대 · (컨트롤) — 위쪽 y를 돌려준다
    const bottom = (x: number, w: number, yEnd: number, controls: boolean): number => {
      let y = yEnd;
      if (controls) { transport(ctx, x + w / 2, y - 42 * u, 38 * u, white, f.playing, 3); y -= 110 * u; }
      if (s.showProgress) {
        progressBar(ctx, x, y - 48 * u, w, 6 * u, kit.progress, { track: nat ? 'rgba(255,255,255,0.22)' : alpha(white, 0.16), fill: white, knob: white, knobR: 9 * u });
        text(ctx, kit, kit.fmtTime(f.time), x, y - 8 * u, { font: kit.font(20 * u, 400, kit.mono), color: sub });
        text(ctx, kit, '-' + kit.fmtTime(Math.max(0, f.duration - f.time)), x + w, y - 8 * u, { font: kit.font(20 * u, 400, kit.mono), color: sub, align: 'right' });
        y -= 80 * u;
      }
      if (viz && !(s.visualizer === 'radial' && !bg)) {
        const vh = 84 * u;
        kit.drawVisualizer(ctx, { x, y: y - vh, w, h: vh }, { color: acc, color2: white, alpha: 0.9, count: 56 });
        y -= vh + 26 * u;
      }
      return y;
    };

    if (shape === 'tall') {
      const x = pad, w = W - pad * 2;
      head(W / 2, pad + 8 * u, 'center', w);
      const top = pad + (s.phrase ? 84 : 50) * u;
      const lowTop = bottom(x, w, H - pad * 0.7, true);
      if (bg) {
        titleBlock(x, lowTop - 150 * u, w, 1.15);
        lyrics(x, top + 20 * u, w, lowTop - 170 * u - top - 20 * u, 58 * u);
      } else {
        const cw = Math.min(w, (lowTop - top) * 0.6);
        coverAt((W - cw) / 2, top + 26 * u, cw);
        const ty = top + 26 * u + cw + 34 * u;
        titleBlock(x, ty, w);
        lyrics(x, ty + 130 * u, w, lowTop - (ty + 130 * u), 44 * u);
      }
    } else if (shape === 'square') {
      const x = pad, w = W - pad * 2;
      const lowTop = bottom(x, w, H - pad * 0.8, false);
      if (bg) {
        head(x, pad + 8 * u, 'left', w);
        titleBlock(x, pad + (s.phrase ? 80 : 46) * u, w, 1.1);
        const ly = pad + (s.phrase ? 220 : 186) * u;
        lyrics(x, ly, w, lowTop - ly, 54 * u);
      } else {
        const cw = 380 * u;
        coverAt(x, pad, cw);
        const ix = x + cw + 48 * u, iw = W - ix - pad;
        head(ix, pad + 26 * u, 'left', iw);
        titleBlock(ix, pad + cw - 118 * u, iw);
        lyrics(x, pad + cw + 30 * u, w, lowTop - (pad + cw + 30 * u), 42 * u);
      }
    } else {
      const ch = H - pad * 2.4;
      const cy = (H - ch) / 2;
      const cx = pad * 1.3;
      const ix = bg ? cx : cx + ch + pad * 1.1;
      const iw = W - ix - pad * 1.3;
      if (!bg) coverAt(cx, cy, ch);
      head(ix, cy + 18 * u, 'left', iw);
      const lowTop = bottom(ix, iw, cy + ch + 20 * u, false);
      titleBlock(ix, lowTop - 140 * u, iw, bg ? 1.2 : 1);
      const ly = cy + (s.phrase ? 90 : 56) * u;
      lyrics(ix, ly, iw, lowTop - (bg ? 180 : 150) * u - ly, (bg ? 54 : 40) * u);
    }
  },
};
