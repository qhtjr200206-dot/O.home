// 카세트 — 반투명 플라스틱 테이프, 손글씨 라벨, 진행률만큼 감기는 두 릴.
import type { FrameState, RenderKit, ThemeDef } from '../types';
import { alpha, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, rr, photoBackdrop, paper, withShadow, grain, setSpacing } from './_paint';

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

function drawCassette(ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit, x: number, y: number, w: number) {
  const u = f.u, s = f.settings;
  const h = w * 0.63;
  const k = w / 1000;   // 카세트 내부 좌표 1000 기준
  const shell = mix('#1d1d21', f.palette.accentDeep, 0.35);
  // 본체
  withShadow(ctx, 60 * u, 30 * u, 'rgba(0,0,0,0.45)', () => {
    rr(ctx, x, y, w, h, 34 * k); ctx.fillStyle = shell; ctx.fill();
  });
  // 플라스틱 하이라이트
  const hg = ctx.createLinearGradient(x, y, x, y + h);
  hg.addColorStop(0, 'rgba(255,255,255,0.14)'); hg.addColorStop(0.5, 'rgba(255,255,255,0.02)'); hg.addColorStop(1, 'rgba(0,0,0,0.2)');
  rr(ctx, x, y, w, h, 34 * k); ctx.fillStyle = hg; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2 * u; ctx.stroke();
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
  if (s.photoLayout === 'cover') kit.drawPhoto(ctx, { x: lx + lw - 210 * k, y: ly + 100 * k, w: 180 * k, h: 180 * k }, { radius: 8 * k });
  ctx.restore();
  // 라벨 글자
  text(ctx, kit, 'A', lx + 26 * k, ly + 52 * k, { font: kit.font(46 * k, 900, kit.mono), color: f.palette.onAccent });
  text(ctx, kit, 'C-60 · TYPE I NORMAL', lx + lw - 24 * k, ly + 46 * k, { font: kit.font(22 * k, 700, kit.mono), color: f.palette.onAccent, align: 'right', spacing: 2 * k });
  const tw = s.photoLayout === 'cover' ? lw - 290 * k : lw - 70 * k;
  // 줄 노트 선
  ctx.strokeStyle = 'rgba(40,60,120,0.18)'; ctx.lineWidth = 2 * k;
  for (const yy of [190, 260]) { ctx.beginPath(); ctx.moveTo(lx + 36 * k, ly + yy * k); ctx.lineTo(lx + 36 * k + tw, ly + yy * k); ctx.stroke(); }
  text(ctx, kit, titleOf(f), lx + 40 * k, ly + 178 * k, { font: kit.font(66 * k, 700), color: '#1d2a4a', maxW: tw - 10 * k });
  text(ctx, kit, artistOf(f), lx + 40 * k, ly + 248 * k, { font: kit.font(40 * k, 500), color: '#33415e', maxW: tw - 10 * k });
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

export const cassette: ThemeDef = {
  id: 'cassette',
  name: '카세트',
  desc: '손글씨 라벨의 카세트테이프 — 진행만큼 감기는 릴',
  suggestedAccent: '#e5533d',
  background(ctx, f, kit) {
    if (f.settings.photoLayout === 'background') { photoBackdrop(ctx, f, kit); return; }
    // 파스텔 책상 — 포인트색의 옅은 톤 + 종이 질감
    paper(ctx, f, { x: 0, y: 0, w: f.width, h: f.height }, mix(f.palette.accentSoft, '#efe7da', 0.45), 0.25);
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings;
    const shape = shapeOf(f);
    const pad = 70 * u;
    const dark = s.photoLayout === 'background';
    const ink = dark ? '#fbf7ef' : '#1f1d1a', sub = dark ? 'rgba(251,247,239,0.7)' : 'rgba(31,29,26,0.62)';
    let cw: number, cx: number, cy: number, lx: number, ly: number, lw: number, lh: number;
    if (shape === 'land') {
      cw = W * 0.5; cx = pad * 1.3; cy = (H - cw * 0.63) / 2 - 20 * u;
      lx = cx + cw + pad * 1.2; lw = W - lx - pad * 1.2; ly = pad * 1.8; lh = H - ly - pad * 2.2;
    } else if (shape === 'square') {
      cw = W - pad * 3.2; cx = (W - cw) / 2; cy = pad;
      lx = pad * 1.3; lw = W - pad * 2.6; ly = cy + cw * 0.63 + 50 * u; lh = H - ly - pad * 1.6;
    } else {
      cw = W - pad * 2; cx = pad; cy = H / W > 1.5 ? H * 0.17 : H * 0.12;
      lx = pad * 1.2; lw = W - pad * 2.4; ly = cy + cw * 0.63 + 120 * u; lh = H - ly - pad * 2.4;
    }
    // 살짝 기운 카세트
    ctx.save();
    const ch = cw * 0.63;
    ctx.translate(cx + cw / 2, cy + ch / 2); ctx.rotate(-0.025); ctx.translate(-(cx + cw / 2), -(cy + ch / 2));
    drawCassette(ctx, f, kit, cx, cy, cw);
    ctx.restore();
    grain(ctx, f, 0.05, 0);
    // 문구 — 카세트 위 메모
    if (s.phrase) {
      const py = shape === 'tall' ? cy - 50 * u : shape === 'land' ? ly - 30 * u : H - pad * 0.6;
      text(ctx, kit, s.phrase, shape === 'land' ? lx : W / 2, py, { font: kit.font(30 * u, 500), color: sub, align: shape === 'land' ? 'left' : 'center', maxW: shape === 'land' ? lw : W - pad * 2 });
    }
    kit.drawLyrics(ctx, { x: lx, y: ly, w: lw, h: lh }, { align: shape === 'land' ? 'left' : 'center', size: (shape === 'tall' ? 58 : 46) * u, color: ink, dimColor: sub, weight: 700, lineHeight: 1.45 });
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
      text(ctx, kit, counter, bx + 20 * u, yy - 2 * u, { font, color: f.palette.accent, spacing: 6 * u });
      ctx.restore();
      text(ctx, kit, `${kit.fmtTime(f.time)} / ${kit.fmtTime(f.duration)}`, bx + tw + 22 * u, yy - 4 * u, { font: kit.font(22 * u, 400, kit.mono), color: sub });
    }
  },
};
