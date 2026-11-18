// 뮤직 플레이어 — 휴대용 플레이어 본체, 작은 화면 속 커버·진행 막대, 클릭 휠.
import type { FrameState, RenderKit, ThemeDef } from '../types';
import { alpha, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, rr, photoBackdrop, withShadow, grain, vignette } from './_paint';

function device(ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit, x: number, y: number, w: number) {
  const u = f.u, s = f.settings;
  const h = w * 1.66;
  const k = w / 600;
  // 본체 — 포인트색이 살짝 섞인 무광 금속
  const body = mix('#e9e9ec', f.palette.accent, 0.12);
  withShadow(ctx, 80 * u, 40 * u, 'rgba(0,0,0,0.45)', () => {
    rr(ctx, x, y, w, h, 70 * k); ctx.fillStyle = body; ctx.fill();
  });
  const bg = ctx.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, 'rgba(255,255,255,0.55)'); bg.addColorStop(0.45, 'rgba(255,255,255,0)'); bg.addColorStop(1, 'rgba(0,0,0,0.12)');
  rr(ctx, x, y, w, h, 70 * k); ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 2 * k; ctx.stroke();

  // 화면
  const sx = x + 44 * k, sy = y + 46 * k, sw = w - 88 * k, sh = 450 * k;
  rr(ctx, sx - 6 * k, sy - 6 * k, sw + 12 * k, sh + 12 * k, 22 * k); ctx.fillStyle = '#1a1a1c'; ctx.fill();
  ctx.save();
  rr(ctx, sx, sy, sw, sh, 16 * k); ctx.clip();
  const sg = ctx.createLinearGradient(sx, sy, sx, sy + sh);
  sg.addColorStop(0, '#fbfbfd'); sg.addColorStop(1, '#e7e8ee');
  ctx.fillStyle = sg; ctx.fillRect(sx, sy, sw, sh);
  // 상태줄
  const barH = 46 * k;
  const tb = ctx.createLinearGradient(sx, sy, sx, sy + barH);
  tb.addColorStop(0, '#f4f5f8'); tb.addColorStop(1, '#cfd3db');
  ctx.fillStyle = tb; ctx.fillRect(sx, sy, sw, barH);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(sx, sy + barH, sw, 1.5 * k);
  text(ctx, kit, 'Now Playing', sx + sw / 2, sy + 31 * k, { font: kit.font(24 * k, 700), color: '#1d1d1f', align: 'center' });
  // 재생 아이콘·배터리
  ctx.fillStyle = '#2f6fd6';
  ctx.beginPath(); ctx.moveTo(sx + 20 * k, sy + 14 * k); ctx.lineTo(sx + 38 * k, sy + 23 * k); ctx.lineTo(sx + 20 * k, sy + 32 * k); ctx.closePath(); ctx.fill();
  rr(ctx, sx + sw - 64 * k, sy + 14 * k, 40 * k, 18 * k, 3 * k); ctx.strokeStyle = '#333'; ctx.lineWidth = 2 * k; ctx.stroke();
  ctx.fillStyle = '#3cbb4d'; ctx.fillRect(sx + sw - 61 * k, sy + 17 * k, 30 * k, 12 * k);
  ctx.fillStyle = '#333'; ctx.fillRect(sx + sw - 23 * k, sy + 19 * k, 4 * k, 8 * k);
  // 커버 + 글자
  const cy = sy + barH + 30 * k, cs = 210 * k;
  if (s.photoLayout === 'cover') {
    withShadow(ctx, 14 * k, 6 * k, 'rgba(0,0,0,0.3)', () => { ctx.fillStyle = '#ddd'; ctx.fillRect(sx + 26 * k, cy, cs, cs); });
    kit.drawPhoto(ctx, { x: sx + 26 * k, y: cy, w: cs, h: cs });
    // 커버 반사 (바닥 거울)
    ctx.save(); ctx.globalAlpha = 0.18;
    ctx.translate(0, (cy + cs) * 2); ctx.scale(1, -1);
    kit.drawPhoto(ctx, { x: sx + 26 * k, y: cy, w: cs, h: cs });
    ctx.restore();
  } else {
    kit.drawVisualizer(ctx, { x: sx + 26 * k, y: cy, w: cs, h: cs }, { kind: 'radial', color: f.palette.accent, color2: '#1d1d1f', innerRadius: 0.45 });
  }
  const tx = sx + 26 * k + cs + 24 * k, tw = sw - (tx - sx) - 20 * k;
  text(ctx, kit, titleOf(f), tx, cy + 46 * k, { font: kit.font(32 * k, 800), color: '#111', maxW: tw });
  text(ctx, kit, artistOf(f), tx, cy + 88 * k, { font: kit.font(26 * k, 500), color: '#333', maxW: tw });
  if (s.phrase) text(ctx, kit, s.phrase, tx, cy + 126 * k, { font: kit.font(22 * k, 400), color: '#666', maxW: tw });
  text(ctx, kit, '1 of 12', tx, cy + cs - 10 * k, { font: kit.font(20 * k, 400, kit.mono), color: '#777' });
  // 진행 막대 (광택 파란 막대)
  if (s.showProgress) {
    const py = sy + sh - 66 * k, px = sx + 26 * k, pw = sw - 52 * k;
    rr(ctx, px, py, pw, 16 * k, 3 * k); ctx.fillStyle = '#c9ccd4'; ctx.fill();
    const pg = ctx.createLinearGradient(0, py, 0, py + 16 * k);
    pg.addColorStop(0, mix(f.palette.accent, '#ffffff', 0.35)); pg.addColorStop(1, f.palette.accent);
    rr(ctx, px, py, Math.max(10 * k, pw * kit.progress), 16 * k, 3 * k); ctx.fillStyle = pg; ctx.fill();
    text(ctx, kit, kit.fmtTime(f.time), px, py + 44 * k, { font: kit.font(20 * k, 700, kit.mono), color: '#333' });
    text(ctx, kit, '-' + kit.fmtTime(Math.max(0, f.duration - f.time)), px + pw, py + 44 * k, { font: kit.font(20 * k, 700, kit.mono), color: '#333', align: 'right' });
  }
  // 화면 아래 작은 비주얼라이저 (cover 배치일 때)
  if (s.photoLayout === 'cover' && s.visualizer !== 'none') {
    kit.drawVisualizer(ctx, { x: sx + 26 * k, y: cy + cs + 14 * k, w: sw - 52 * k, h: sh - (cy + cs + 14 * k - sy) - 100 * k }, { color: f.palette.accent, color2: '#1d1d1f', count: 40, alpha: 0.9 });
  }
  // 유리 반사
  const gl = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
  gl.addColorStop(0, 'rgba(255,255,255,0.25)'); gl.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl; ctx.fillRect(sx, sy, sw, sh);
  ctx.restore();

  // 클릭 휠
  const wcx = x + w / 2, wcy = y + 46 * k + sh + 250 * k, wr = 205 * k;
  const wg = ctx.createRadialGradient(wcx, wcy - wr * 0.4, wr * 0.1, wcx, wcy, wr);
  wg.addColorStop(0, '#ffffff'); wg.addColorStop(1, mix('#dcdde2', f.palette.accent, 0.08));
  withShadow(ctx, 10 * k, 3 * k, 'rgba(0,0,0,0.18)', () => {
    ctx.beginPath(); ctx.arc(wcx, wcy, wr, 0, Math.PI * 2); ctx.fillStyle = wg; ctx.fill();
  });
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 2 * k; ctx.stroke();
  ctx.beginPath(); ctx.arc(wcx, wcy, wr * 0.38, 0, Math.PI * 2);
  const cg = ctx.createLinearGradient(0, wcy - wr * 0.38, 0, wcy + wr * 0.38);
  cg.addColorStop(0, '#f0f0f3'); cg.addColorStop(1, '#d4d5da');
  ctx.fillStyle = cg; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.stroke();
  const lab = '#9a9ca3';
  text(ctx, kit, 'MENU', wcx, wcy - wr * 0.66, { font: kit.font(26 * k, 800), color: lab, align: 'center', baseline: 'middle' });
  ctx.fillStyle = lab;
  const tri = (cx0: number, cy0: number, dir: number, sz: number) => {
    ctx.beginPath(); ctx.moveTo(cx0 - dir * sz * 0.5, cy0 - sz * 0.5); ctx.lineTo(cx0 + dir * sz * 0.5, cy0); ctx.lineTo(cx0 - dir * sz * 0.5, cy0 + sz * 0.5); ctx.closePath(); ctx.fill();
  };
  const sz = 22 * k;
  tri(wcx + wr * 0.62, wcy, 1, sz); tri(wcx + wr * 0.62 + sz * 0.8, wcy, 1, sz); ctx.fillRect(wcx + wr * 0.62 + sz * 1.3, wcy - sz / 2, 4 * k, sz);
  tri(wcx - wr * 0.62, wcy, -1, sz); tri(wcx - wr * 0.62 - sz * 0.8, wcy, -1, sz); ctx.fillRect(wcx - wr * 0.62 - sz * 1.3 - 4 * k, wcy - sz / 2, 4 * k, sz);
  tri(wcx - 10 * k, wcy + wr * 0.66, 1, sz * 0.9); ctx.fillRect(wcx + 10 * k, wcy + wr * 0.66 - sz * 0.45, 5 * k, sz * 0.9); ctx.fillRect(wcx + 19 * k, wcy + wr * 0.66 - sz * 0.45, 5 * k, sz * 0.9);
  return h;
}

export const player: ThemeDef = {
  id: 'player',
  name: '뮤직 플레이어',
  desc: '클릭 휠 달린 휴대용 플레이어 — 작은 화면 속 지금 재생',
  suggestedAccent: '#3d7bea',
  background(ctx, f, kit) {
    const W = f.width, H = f.height;
    if (f.settings.photoLayout === 'background') { photoBackdrop(ctx, f, kit); return; }
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, mix(f.palette.accent, '#ffffff', 0.55));
    g.addColorStop(1, mix(f.palette.accent, '#1a1a22', 0.35));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 바닥 스튜디오 조명 원
    const r = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.7);
    r.addColorStop(0, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    vignette(ctx, f, 0.35);
    grain(ctx, f, 0.04, 0);
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings;
    const shape = shapeOf(f);
    const pad = 70 * u;
    let dw: number, dx: number, dy: number;
    let lr: { x: number; y: number; w: number; h: number };
    let align: 'left' | 'center' = 'left';
    if (shape === 'tall') {
      dw = Math.min(W * 0.7, (H * 0.64) / 1.66); dx = (W - dw) / 2; dy = pad * 1.2;
      lr = { x: pad, y: dy + dw * 1.66 + 50 * u, w: W - pad * 2, h: H - (dy + dw * 1.66 + 50 * u) - pad }; align = 'center';
    } else {
      dw = shape === 'land' ? (H - pad * 2) / 1.66 : 500 * u;
      dx = shape === 'land' ? W * 0.12 : pad; dy = (H - dw * 1.66) / 2;
      const lx = dx + dw + pad * (shape === 'land' ? 1.6 : 0.9);
      lr = { x: lx, y: pad * 2, w: W - lx - pad, h: H - pad * 4 };
    }
    device(ctx, f, kit, dx, dy, dw);
    const dark = s.photoLayout === 'background';
    const ink = dark ? '#ffffff' : '#141418', sub = dark ? 'rgba(255,255,255,0.7)' : alpha('#141418', 0.55);
    if (shape !== 'tall' && s.phrase) text(ctx, kit, s.phrase, lr.x, pad * 1.4, { font: kit.font(26 * u, 600), color: sub, maxW: lr.w });
    kit.drawLyrics(ctx, lr, { align, size: (shape === 'square' ? 40 : 48) * u, color: ink, dimColor: sub, weight: 800, lineHeight: 1.4 });
  },
};
