// 카세트 — 반투명 플라스틱 테이프, 손글씨 라벨, 진행률만큼 감기는 두 릴.
import type { AccentPalette, FrameState, RenderKit, ThemeDef, Tone } from '../types';
import { alpha, ensureContrast, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, rr, photoBackdrop, paper, withShadow, grain, setSpacing, vignette, isNative, surfaceOf } from './_paint';

/** 톤별 바탕 — 라이트: 파스텔 책상 / 다크: 밤의 책상 위 어두운 펠트 매트 */
const deskBg = (tone: Tone, p: AccentPalette) =>
  tone === 'dark' ? mix(p.accentDeep, '#18171b', 0.62) : mix(p.accentSoft, '#efe7da', 0.45);

function reel(ctx: CanvasRenderingContext2D, f: FrameState, cx: number, cy: number, tapeR: number, hubR: number, ang: number) {
  const u = f.u;
  // 감긴 테이프 (갈색 원반)
  ctx.beginPath(); ctx.arc(cx, cy, tapeR, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx, cy, hubR, cx, cy, tapeR);
  g.addColorStop(0, '#3b2a20'); g.addColorStop(1, '#22170f');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1 * u;
  for (let r = hubR + 6 * u; r < tapeR; r += 7 * u) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
  // 허브 (흰 톱니 바퀴)
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
  ctx.beginPath(); ctx.arc(0, 0, hubR, 0, Math.PI * 2); ctx.fillStyle = '#f1efe9'; ctx.fill();
  ctx.fillStyle = '#1b1b1d';
  ctx.beginPath(); ctx.arc(0, 0, hubR * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f1efe9';
  for (let i = 0; i < 6; i++) {
    ctx.save(); ctx.rotate((i * Math.PI) / 3);
    ctx.fillRect(-hubR * 0.09, -hubR * 0.62, hubR * 0.18, hubR * 0.2);
    ctx.restore();
  }
  ctx.restore();
}

function drawCassette(ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit, x: number, y: number, w: number, labelPhoto = true) {
  const u = f.u, s = f.settings;
  const h = w * 0.63;
  const k = w / 1000;   // 카세트 내부 좌표 1000 기준
  const night = f.palette.tone === 'dark' && s.photoLayout === 'cover';
  const shell = night ? mix('#34343b', f.palette.accent, 0.14) : mix('#1d1d21', f.palette.accentDeep, 0.35);
  // 본체
  withShadow(ctx, 60 * u, 30 * u, night ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.45)', () => {
    rr(ctx, x, y, w, h, 34 * k); ctx.fillStyle = shell; ctx.fill();
  });
  // 플라스틱 하이라이트
  const hg = ctx.createLinearGradient(x, y, x, y + h);
  hg.addColorStop(0, 'rgba(255,255,255,0.14)'); hg.addColorStop(0.5, 'rgba(255,255,255,0.02)'); hg.addColorStop(1, 'rgba(0,0,0,0.2)');
  rr(ctx, x, y, w, h, 34 * k); ctx.fillStyle = hg; ctx.fill();
  ctx.strokeStyle = night ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2 * u; ctx.stroke();
  // 나사 4개
  for (const [sx, sy] of [[40, 40], [960, 40], [40, 590], [960, 590]]) {
    ctx.beginPath(); ctx.arc(x + sx * k, y + sy * k, 13 * k, 0, Math.PI * 2); ctx.fillStyle = '#9a9aa0'; ctx.fill();
    ctx.strokeStyle = '#4a4a50'; ctx.lineWidth = 3 * k;
    ctx.beginPath(); ctx.moveTo(x + (sx - 8) * k, y + sy * k); ctx.lineTo(x + (sx + 8) * k, y + sy * k); ctx.stroke();
  }
  // 라벨 (종이)
  const lx = x + 70 * k, ly = y + 60 * k, lw = 860 * k, lh = 400 * k;
  ctx.save();
  rr(ctx, lx, ly, lw, lh, 18 * k); ctx.clip();
  paper(ctx, f, { x: lx, y: ly, w: lw, h: lh }, '#f3ecdc', 0.35);
  // 위쪽 색 띠 (포인트색) + 사진 띠
  ctx.fillStyle = f.palette.accent; ctx.fillRect(lx, ly, lw, 70 * k);
  ctx.fillStyle = alpha(f.palette.accentDeep, 0.85); ctx.fillRect(lx, ly + 70 * k, lw, 8 * k);
  if (labelPhoto && s.photoLayout === 'cover') kit.drawPhoto(ctx, { x: lx + lw - 210 * k, y: ly + 100 * k, w: 180 * k, h: 180 * k }, { radius: 8 * k });
  ctx.restore();
  // 라벨 글자
  text(ctx, kit, 'A', lx + 26 * k, ly + 52 * k, { font: kit.font(46 * k, 900, kit.mono), color: f.palette.onAccent });
  text(ctx, kit, 'C-60 · TYPE I NORMAL', lx + lw - 24 * k, ly + 46 * k, { font: kit.font(22 * k, 700, kit.mono), color: f.palette.onAccent, align: 'right', spacing: 2 * k });
  const tw = labelPhoto && s.photoLayout === 'cover' ? lw - 290 * k : lw - 70 * k;
  // 줄 노트 선
  ctx.strokeStyle = 'rgba(40,60,120,0.18)'; ctx.lineWidth = 2 * k;
  for (const yy of [190, 260]) { ctx.beginPath(); ctx.moveTo(lx + 36 * k, ly + yy * k); ctx.lineTo(lx + 36 * k + tw, ly + yy * k); ctx.stroke(); }
  text(ctx, kit, titleOf(f), lx + 40 * k, ly + 178 * k, { role: 'title', font: kit.font(66 * k, 700), color: '#1d2a4a', maxW: tw - 10 * k });
  text(ctx, kit, artistOf(f), lx + 40 * k, ly + 248 * k, { role: 'artist', font: kit.font(40 * k, 500), color: '#33415e', maxW: tw - 10 * k });
  // 창 (릴이 보이는 곳)
  const wx = lx + 150 * k, wy = ly + 290 * k, ww = lw - 300 * k, wh = 150 * k;
  rr(ctx, wx, wy, ww, wh, wh / 2); ctx.fillStyle = '#0d0d0f'; ctx.fill();
  // 진행률에 따라 왼쪽 → 오른쪽으로 감김
  const p = f.duration > 0 ? Math.min(1, f.time / f.duration) : 0;
  const minR = 52 * k, maxR = 118 * k;
  const lR = minR + (maxR - minR) * Math.sqrt(1 - p), rR = minR + (maxR - minR) * Math.sqrt(p);
  const lcx = wx + 120 * k, rcx = wx + ww - 120 * k, rcy = wy + wh / 2;
  ctx.save();
  rr(ctx, wx, wy, ww, wh, wh / 2); ctx.clip();
  reel(ctx, f, lcx, rcy, lR, 40 * k, f.time * 2.2);
  reel(ctx, f, rcx, rcy, rR, 40 * k, f.time * 2.2);
  // 창 가운데 — 작은 비주얼라이저 (레벨 미터처럼)
  if (s.visualizer !== 'none') {
    const vx = lcx + 70 * k, vw = rcx - lcx - 140 * k;
    kit.drawVisualizer(ctx, { x: vx, y: wy + 22 * k, w: vw, h: wh - 44 * k }, { color: f.palette.accent, color2: '#f3ecdc', count: 18, mirror: true, innerRadius: 0.3 });
  }
  // 창 유리 반사
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(wx, wy, ww, wh * 0.4);
  ctx.restore();
  // 아래쪽 사다리꼴 (헤드 창)
  ctx.beginPath();
  ctx.moveTo(x + 230 * k, y + h); ctx.lineTo(x + 270 * k, y + 500 * k); ctx.lineTo(x + 730 * k, y + 500 * k); ctx.lineTo(x + 770 * k, y + h); ctx.closePath();
  ctx.fillStyle = mix(shell, '#000000', 0.25); ctx.fill();
  for (const hx of [330, 500, 670]) { ctx.beginPath(); ctx.arc(x + hx * k, y + 560 * k, 16 * k, 0, Math.PI * 2); ctx.fillStyle = '#0a0a0b'; ctx.fill(); }
  return h;
}

/** 케이스 속지(J카드) — 커버 사진을 크게, 아래 등(스파인)에 제목 */
function jcard(ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit, x: number, y: number, w: number) {
  const u = f.u;
  const spine = w * 0.16;
  const dark = f.palette.tone === 'dark';
  withShadow(ctx, 40 * u, 18 * u, dark ? 'rgba(0,0,0,0.6)' : 'rgba(40,30,20,0.3)', () => {
    ctx.fillStyle = '#f3ecdc'; ctx.fillRect(x, y, w, w + spine);
  });
  kit.drawPhoto(ctx, { x, y, w, h: w });
  // 등(스파인) — 종이 + 포인트색 띠 + 제목
  paper(ctx, f, { x, y: y + w, w, h: spine }, '#f3ecdc', 0.3);
  ctx.fillStyle = f.palette.accent; ctx.fillRect(x, y + w, w * 0.07, spine);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x, y + w, w, 2 * u);
  text(ctx, kit, titleOf(f), x + w * 0.1, y + w + spine * 0.46, { role: 'title', font: kit.font(spine * 0.3, 700), color: '#1d2a4a', maxW: w * 0.84 });
  text(ctx, kit, artistOf(f), x + w * 0.1, y + w + spine * 0.8, { role: 'artist', font: kit.font(spine * 0.2, 500), color: '#33415e', maxW: w * 0.84 });
  return w + spine;
}

export const cassette: ThemeDef = {
  id: 'cassette',
  name: '카세트',
  desc: '손글씨 라벨의 카세트테이프 — 진행만큼 감기는 릴',
  suggestedAccent: '#e5533d',
  baseTone: 'light',
  toneBg: deskBg,
  background(ctx, f, kit) {
    if (f.settings.photoLayout === 'background') { photoBackdrop(ctx, f, kit); return; }
    const W = f.width, H = f.height, p = f.palette;
    if (p.tone === 'light') {
      // 파스텔 책상 — 포인트색의 옅은 톤 + 종이 질감
      paper(ctx, f, { x: 0, y: 0, w: W, h: H }, surfaceOf(f, deskBg), 0.25);
      return;
    }
    // 밤의 책상 — 펠트 결(섬유 질감 진하게) + 스탠드 불빛이 왼쪽 위에서 따뜻하게 떨어진다
    paper(ctx, f, { x: 0, y: 0, w: W, h: H }, surfaceOf(f, deskBg), 0.4);
    const g = ctx.createRadialGradient(W * 0.25, H * 0.1, 0, W * 0.25, H * 0.1, Math.max(W, H) * 0.9);
    g.addColorStop(0, alpha(mix(p.accent, '#ffd9a0', 0.6), 0.2));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    vignette(ctx, f, 0.5);
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings;
    const shape = shapeOf(f);
    const pad = 70 * u;
    const p = f.palette;
    const nat = isNative(f, 'light');
    const bgPhoto = s.photoLayout === 'background';
    // 원래 모습: 책상 위 먹색 / 사진 배경 위 흰색. 그 밖엔 팔레트
    const ink = nat ? (bgPhoto ? '#fbf7ef' : '#1f1d1a') : p.ink;
    const sub = nat ? (bgPhoto ? 'rgba(251,247,239,0.7)' : 'rgba(31,29,26,0.62)') : p.inkSoft;
    let cw: number, cx: number, cy: number, lx: number, ly: number, lw: number, lh: number;
    // 커버형: 케이스 속지(J카드)에 사진을 크게 + 옆/아래 카세트. 전체 배경형은 사진이 이미 크니 카세트만 크게.
    let card: { x: number; y: number; w: number } | null = null;
    if (s.photoLayout === 'cover') {
      if (shape === 'land') {
        const jw = Math.min((H - pad * 2.6) / 1.16, W * 0.42);
        card = { x: pad * 1.3, y: (H - jw * 1.16) / 2, w: jw };
        cx = card.x + jw + pad * 0.9; cw = W - cx - pad * 1.3; cw = Math.min(cw, (H * 0.42) / 0.63); cy = pad * 1.2;
        lx = cx; lw = W - lx - pad * 1.2; ly = cy + cw * 0.63 + 50 * u; lh = H - ly - pad * 2.2;
      } else if (shape === 'square') {
        const jw = 440 * u;
        card = { x: pad, y: pad * 1.1, w: jw };
        cx = pad + jw + 50 * u; cw = W - cx - pad; cy = card.y + (jw * 1.16 - cw * 0.63) / 2;
        lx = pad * 1.3; lw = W - pad * 2.6; ly = card.y + jw * 1.16 + 40 * u; lh = H - ly - pad * 1.6;
      } else {
        const jw = Math.min(W - pad * 3, H * 0.36);
        card = { x: (W - jw) / 2, y: H / W > 1.5 ? H * 0.08 : pad * 1.1, w: jw };
        // 카세트는 속지 등(스파인) 위에 겹쳐 앞에 놓인다 (사진은 가리지 않음)
        cw = Math.min(W - pad * 2.4, jw * 1.1); cx = (W - cw) / 2; cy = card.y + jw * 1.02;
        lx = pad * 1.2; lw = W - pad * 2.4; ly = cy + cw * 0.63 + 50 * u; lh = H - ly - pad * 2.4;
      }
    } else if (shape === 'land') {
      cw = W * 0.5; cx = pad * 1.3; cy = (H - cw * 0.63) / 2 - 20 * u;
      lx = cx + cw + pad * 1.2; lw = W - lx - pad * 1.2; ly = pad * 1.8; lh = H - ly - pad * 2.2;
    } else if (shape === 'square') {
      cw = W - pad * 3.2; cx = (W - cw) / 2; cy = pad;
      lx = pad * 1.3; lw = W - pad * 2.6; ly = cy + cw * 0.63 + 50 * u; lh = H - ly - pad * 1.6;
    } else {
      cw = W - pad * 2; cx = pad; cy = H / W > 1.5 ? H * 0.17 : H * 0.12;
      lx = pad * 1.2; lw = W - pad * 2.4; ly = cy + cw * 0.63 + 120 * u; lh = H - ly - pad * 2.4;
    }
    if (card) {
      ctx.save();
      const ch0 = card.w * 1.16;
      ctx.translate(card.x + card.w / 2, card.y + ch0 / 2); ctx.rotate(0.018); ctx.translate(-(card.x + card.w / 2), -(card.y + ch0 / 2));
      jcard(ctx, f, kit, card.x, card.y, card.w);
      ctx.restore();
    }
    // 살짝 기운 카세트
    ctx.save();
    const ch = cw * 0.63;
    ctx.translate(cx + cw / 2, cy + ch / 2); ctx.rotate(-0.025); ctx.translate(-(cx + cw / 2), -(cy + ch / 2));
    drawCassette(ctx, f, kit, cx, cy, cw, !card);
    ctx.restore();
    grain(ctx, f, 0.05, 0);
    // 문구 — 카세트 위 메모
    if (s.phrase) {
      const py = shape === 'tall' ? (card ? card.y - 26 * u : cy - 50 * u) : shape === 'land' ? ly - 30 * u : H - pad * 0.6;
      text(ctx, kit, s.phrase, shape === 'land' ? lx : W / 2, py, { role: 'phrase', font: kit.font(30 * u, 500), color: sub, align: shape === 'land' ? 'left' : 'center', maxW: shape === 'land' ? lw : W - pad * 2 });
    }
    kit.drawLyrics(ctx, { x: lx, y: ly, w: lw, h: lh }, { align: shape === 'land' ? 'left' : 'center', size: (shape === 'tall' ? 58 : 46) * u, color: ink, dimColor: nat ? sub : ink, weight: 700, lineHeight: 1.45 });
    // 진행 — 테이프 카운터 숫자
    if (s.showProgress) {
      const cxp = shape === 'land' ? lx : W / 2;
      const yy = H - pad * (shape === 'square' ? 1.15 : 1);
      const counter = String(Math.floor(f.time)).padStart(3, '0');
      ctx.save(); setSpacing(ctx, 6 * u);
      const font = kit.font(30 * u, 700, kit.mono);
      ctx.font = font;
      const tw = ctx.measureText(counter).width + 40 * u;
      const bx = shape === 'land' ? cxp : cxp - tw / 2 - 150 * u;
      rr(ctx, bx, yy - 40 * u, tw, 54 * u, 10 * u); ctx.fillStyle = '#121214'; ctx.fill();
      // 어두운 바탕에선 카운터 창 테두리로 바탕과 분리
      if (p.tone === 'dark' && !nat) { ctx.strokeStyle = p.line; ctx.lineWidth = 2 * u; ctx.stroke(); }
      text(ctx, kit, counter, bx + 20 * u, yy - 2 * u, { font, color: nat ? p.accent : ensureContrast(p.accent, '#121214', 3.5), spacing: 6 * u });
      ctx.restore();
      text(ctx, kit, `${kit.fmtTime(f.time)} / ${kit.fmtTime(f.duration)}`, bx + tw + 22 * u, yy - 4 * u, { font: kit.font(22 * u, 400, kit.mono), color: sub });
    }
  },
};
