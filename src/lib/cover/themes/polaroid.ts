// 폴라로이드 — 종이 위에 테이프로 붙인 즉석 사진, 아래 여백에 손글씨 제목, 날짜 도장처럼 찍힌 재생 시간.
import type { AccentPalette, ThemeDef, Tone } from '../types';
import { alpha, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, rr, photoBackdrop, paper, withShadow, hash01, grain, vignette, isNative, surfaceOf } from './_paint';

/** 톤별 바탕 — 라이트: 종이 / 다크: 검은 앨범 속지(크라프트 흑지) */
const pageBg = (tone: Tone, p: AccentPalette) =>
  tone === 'dark' ? mix(p.accentDeep, '#1a1816', 0.72) : mix(p.accentSoft, '#f4efe6', 0.6);

function tape(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, rot: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.beginPath();
  // 찢긴 양 끝
  const teeth = 7;
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 0; i <= teeth; i++) ctx.lineTo(w / 2 + (i % 2 ? -h * 0.08 : 0), -h / 2 + (h * i) / teeth);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = teeth; i >= 0; i--) ctx.lineTo(-w / 2 + (i % 2 ? h * 0.08 : 0), -h / 2 + (h * i) / teeth);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

export const polaroid: ThemeDef = {
  id: 'polaroid',
  name: '폴라로이드',
  desc: '종이 위 즉석 사진과 마스킹테이프, 손글씨 제목',
  suggestedAccent: '#e86a4a',
  baseTone: 'light',
  toneBg: pageBg,
  background(ctx, f, kit) {
    if (f.settings.photoLayout === 'background') { photoBackdrop(ctx, f, kit, -0.1); return; }
    const dark = f.palette.tone === 'dark';
    // 다크: 섬유가 보이는 검은 앨범 속지 + 가장자리 그늘
    paper(ctx, f, { x: 0, y: 0, w: f.width, h: f.height }, surfaceOf(f, pageBg), dark ? 0.5 : 0.35);
    if (dark) vignette(ctx, f, 0.45);
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings;
    const shape = shapeOf(f);
    const pad = 80 * u;
    const p = f.palette;
    const nat = isNative(f, 'light');
    const bgPhoto = s.photoLayout === 'background';
    // 원래 모습: 종이 위 먹색 / 사진 배경 위 흰색. 그 밖엔 팔레트
    const ink = nat ? (bgPhoto ? '#fdfaf3' : '#2a2724') : p.ink;
    const sub = nat ? (bgPhoto ? 'rgba(253,250,243,0.72)' : 'rgba(42,39,36,0.62)') : p.inkSoft;
    const acc = nat ? p.accent : p.accentInk;
    const darkPage = p.tone === 'dark' && !bgPhoto;
    // 폴라로이드 크기 (가로:세로 = 0.86:1, 사진 정사각)
    let pw: number, px: number, py: number, rot: number;
    let lr: { x: number; y: number; w: number; h: number };
    if (shape === 'land') {
      pw = (H - pad * 2.2) * 0.86; px = pad * 1.6; py = (H - pw / 0.86) / 2; rot = -0.045;
      const lx = px + pw + pad * 1.4; lr = { x: lx, y: pad * 1.6, w: W - lx - pad * 1.3, h: H - pad * 3.4 };
    } else if (shape === 'square') {
      pw = 500 * u; px = pad * 0.8; py = pad; rot = -0.05;   // 사진이 작아 보이지 않게 (예전 430)
      const lx = px + pw + 56 * u; lr = { x: lx, y: pad * 2.2, w: W - lx - pad * 0.7, h: H - pad * 3.8 };
    } else {
      pw = Math.min(W - pad * 2.6, H * 0.52 * 0.86); px = (W - pw) / 2; py = H * 0.07; rot = -0.035;
      lr = { x: pad, y: py + pw / 0.86 + 90 * u, w: W - pad * 2, h: H - (py + pw / 0.86 + 90 * u) - pad * 1.6 };
    }
    const ph = pw / 0.86;
    const m = pw * 0.06;   // 사진 테두리 여백
    const imgS = pw - m * 2;
    ctx.save();
    ctx.translate(px + pw / 2, py + ph / 2); ctx.rotate(rot); ctx.translate(-(px + pw / 2), -(py + ph / 2));
    withShadow(ctx, 40 * u, 18 * u, darkPage ? 'rgba(0,0,0,0.6)' : 'rgba(40,30,20,0.35)', () => {
      ctx.fillStyle = '#fbfaf6'; ctx.fillRect(px, py, pw, ph);
    });
    paper(ctx, f, { x: px, y: py, w: pw, h: ph }, '#fbfaf6', 0.18);
    // 사진 (배경 배치여도 폴라로이드 안에는 사진을 둔다 — 같은 사진이 배경으로 번짐)
    kit.drawPhoto(ctx, { x: px + m, y: py + m, w: imgS, h: imgS });
    // 즉석 사진 특유의 색 바램
    const fade = ctx.createLinearGradient(px, py, px + imgS, py + imgS);
    fade.addColorStop(0, 'rgba(255,236,200,0.14)'); fade.addColorStop(1, 'rgba(60,40,90,0.10)');
    ctx.fillStyle = fade; ctx.fillRect(px + m, py + m, imgS, imgS);
    grain(ctx, { ...f, time: 0 }, 0.12, 0, { x: px + m, y: py + m, w: imgS, h: imgS });
    // 날짜 도장 — 재생 시간을 사진 오른쪽 아래에 주황 LCD 숫자처럼
    if (s.showProgress) {
      ctx.save();
      ctx.shadowColor = alpha(f.palette.accent, 0.8); ctx.shadowBlur = 8 * u;
      text(ctx, kit, `'${kit.fmtTime(f.time)}  ${kit.fmtTime(f.duration)}`, px + m + imgS - 22 * u, py + m + imgS - 22 * u, { font: kit.font(pw * 0.045, 700, kit.mono), color: mix(f.palette.accent, '#ffb347', 0.4), align: 'right', spacing: 2 * u });
      ctx.restore();
      // 사진 아래 가는 진행선
      ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(px + m, py + m + imgS + 10 * u, imgS, 3 * u);
      ctx.fillStyle = alpha(f.palette.accent, 0.8); ctx.fillRect(px + m, py + m + imgS + 10 * u, imgS * kit.progress, 3 * u);
    }
    // 아래 여백 — 손글씨 제목 (펜 잉크)
    const capY = py + m + imgS + (ph - m - imgS) * 0.52;
    text(ctx, kit, titleOf(f), px + pw / 2, capY, { font: kit.font(pw * 0.085, 700), color: '#25324f', align: 'center', maxW: pw - m * 2 });
    text(ctx, kit, '— ' + artistOf(f), px + pw / 2, capY + pw * 0.07, { font: kit.font(pw * 0.048, 500), color: '#3b4a6b', align: 'center', maxW: pw - m * 2 });
    ctx.restore();
    // 테이프 두 조각
    // 마스킹테이프 — 검은 속지 위에선 덜 비치게(불투명도↑) 해서 색이 탁해지지 않게
    const tc = alpha(mix(f.palette.accent, '#efe3c8', 0.55), darkPage ? 0.9 : 0.78);
    tape(ctx, px + pw * 0.5, py - 6 * u, pw * 0.34, 54 * u, 0.04 + hash01(3) * 0.04, tc);
    // 문구 — 오른쪽/아래에 손으로 쓴 메모처럼
    let ly = lr.y;
    if (s.phrase) {
      text(ctx, kit, s.phrase, lr.x, lr.y + 30 * u, { font: kit.font(36 * u, 600), color: acc, maxW: lr.w });
      ctx.strokeStyle = alpha(acc, 0.6); ctx.lineWidth = 3 * u; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lr.x, lr.y + 48 * u);
      for (let i = 0; i <= 20; i++) ctx.lineTo(lr.x + (Math.min(lr.w, 360 * u) * i) / 20, lr.y + 48 * u + Math.sin(i * 1.3) * 3 * u);
      ctx.stroke();
      ly += 90 * u;
    }
    // 비주얼라이저 — 아래쪽 연필 선 느낌
    let lh = lr.h - (ly - lr.y);
    if (s.visualizer !== 'none') {
      const radial = s.visualizer === 'radial';
      const vh = radial ? 200 * u : 90 * u;
      kit.drawVisualizer(ctx, { x: radial ? lr.x + lr.w - vh : lr.x, y: lr.y + lr.h - vh, w: radial ? vh : lr.w, h: vh }, { color: nat ? (bgPhoto ? '#fdfaf3' : '#2a2724') : p.ink, color2: acc, alpha: 0.75, count: 44, thickness: 3 * u, innerRadius: 0.35 });
      lh -= vh + 30 * u;
    }
    kit.drawLyrics(ctx, { x: lr.x, y: ly, w: lr.w, h: lh }, { align: shape === 'tall' ? 'center' : 'left', size: (shape === 'square' ? 40 : 44) * u, color: ink, dimColor: nat ? sub : ink, weight: 600, lineHeight: 1.5 });
  },
};
