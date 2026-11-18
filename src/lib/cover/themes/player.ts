// 뮤직 플레이어 — 휴대용 플레이어 본체, 작은 화면 속 커버·진행 막대, 클릭 휠.
import type { AccentPalette, FrameState, RenderKit, ThemeDef, Tone } from '../types';
import { alpha, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, rr, photoBackdrop, withShadow, grain, vignette, isNative, surfaceOf } from './_paint';

/** 톤별 바탕 — 라이트: 포인트색 스튜디오 배경 / 다크: 불 낮춘 어두운 스튜디오 */
const studioBg = (tone: Tone, p: AccentPalette) =>
  tone === 'dark' ? mix(p.accentDeep, '#0f0f13', 0.62) : mix(p.accent, '#ffffff', 0.55);

/** 플레이어 본체·화면 색 — 라이트: 은색 본체 + 밝은 화면 / 다크: 블랙 본체 + 다크 UI */
const DEVICE = {
  light: {
    body: '#e9e9ec', bodyHi: 'rgba(255,255,255,0.55)', bodyLo: 'rgba(0,0,0,0.12)', bodyEdge: 'rgba(0,0,0,0.12)', bezel: '#1a1a1c',
    scr0: '#fbfbfd', scr1: '#e7e8ee', bar0: '#f4f5f8', bar1: '#cfd3db', barLine: 'rgba(0,0,0,0.25)',
    head: '#1d1d1f', title: '#111', artist: '#333', phrase: '#666', meta: '#777', time: '#333', track: '#c9ccd4', batt: '#333', viz2: '#1d1d1f',
    glass: 'rgba(255,255,255,0.25)', coverBack: '#ddd', shadow: 'rgba(0,0,0,0.45)',
    wheel0: '#ffffff', wheel1: '#dcdde2', wheelEdge: 'rgba(0,0,0,0.1)', btn0: '#f0f0f3', btn1: '#d4d5da', btnEdge: 'rgba(0,0,0,0.12)', lab: '#9a9ca3', wheelShadow: 'rgba(0,0,0,0.18)',
  },
  dark: {
    body: '#1c1c20', bodyHi: 'rgba(255,255,255,0.16)', bodyLo: 'rgba(0,0,0,0.3)', bodyEdge: 'rgba(255,255,255,0.1)', bezel: '#050506',
    scr0: '#1b1c21', scr1: '#0f1013', bar0: '#34353b', bar1: '#1f2025', barLine: 'rgba(255,255,255,0.12)',
    head: '#f2f2f5', title: '#ffffff', artist: '#cfcfd6', phrase: '#a2a2ab', meta: '#8e8e97', time: '#d6d6dc', track: '#3a3c44', batt: '#c8c8ce', viz2: '#f2f2f5',
    glass: 'rgba(255,255,255,0.1)', coverBack: '#2a2a2e', shadow: 'rgba(0,0,0,0.6)',
    wheel0: '#3a3b41', wheel1: '#1e1f23', wheelEdge: 'rgba(255,255,255,0.08)', btn0: '#2c2d32', btn1: '#18191c', btnEdge: 'rgba(255,255,255,0.1)', lab: '#8d8f97', wheelShadow: 'rgba(0,0,0,0.4)',
  },
};

function device(ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit, x: number, y: number, w: number) {
  const u = f.u, s = f.settings;
  const h = w * 1.66;
  const k = w / 600;
  // 원래 모습(사진 배경 포함)은 은색 본체 — 반대 톤·지정 배경색일 때만 톤을 따른다
  const D = DEVICE[isNative(f, 'light') ? 'light' : f.palette.tone];
  // 본체 — 포인트색이 살짝 섞인 무광 금속 (다크: 블랙 아노다이징)
  const body = mix(D.body, f.palette.accent, D === DEVICE.dark ? 0.06 : 0.12);
  withShadow(ctx, 80 * u, 40 * u, D.shadow, () => {
    rr(ctx, x, y, w, h, 70 * k); ctx.fillStyle = body; ctx.fill();
  });
  const bg = ctx.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, D.bodyHi); bg.addColorStop(0.45, 'rgba(255,255,255,0)'); bg.addColorStop(1, D.bodyLo);
  rr(ctx, x, y, w, h, 70 * k); ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = D.bodyEdge; ctx.lineWidth = 2 * k; ctx.stroke();

  // 화면
  const sx = x + 44 * k, sy = y + 46 * k, sw = w - 88 * k, sh = 450 * k;
  rr(ctx, sx - 6 * k, sy - 6 * k, sw + 12 * k, sh + 12 * k, 22 * k); ctx.fillStyle = D.bezel; ctx.fill();
  ctx.save();
  rr(ctx, sx, sy, sw, sh, 16 * k); ctx.clip();
  const sg = ctx.createLinearGradient(sx, sy, sx, sy + sh);
  sg.addColorStop(0, D.scr0); sg.addColorStop(1, D.scr1);
  ctx.fillStyle = sg; ctx.fillRect(sx, sy, sw, sh);
  // 상태줄
  const barH = 46 * k;
  const tb = ctx.createLinearGradient(sx, sy, sx, sy + barH);
  tb.addColorStop(0, D.bar0); tb.addColorStop(1, D.bar1);
  ctx.fillStyle = tb; ctx.fillRect(sx, sy, sw, barH);
  ctx.fillStyle = D.barLine; ctx.fillRect(sx, sy + barH, sw, 1.5 * k);
  text(ctx, kit, 'Now Playing', sx + sw / 2, sy + 31 * k, { font: kit.font(24 * k, 700), color: D.head, align: 'center' });
  // 재생 아이콘·배터리
  ctx.fillStyle = '#2f6fd6';
  ctx.beginPath(); ctx.moveTo(sx + 20 * k, sy + 14 * k); ctx.lineTo(sx + 38 * k, sy + 23 * k); ctx.lineTo(sx + 20 * k, sy + 32 * k); ctx.closePath(); ctx.fill();
  rr(ctx, sx + sw - 64 * k, sy + 14 * k, 40 * k, 18 * k, 3 * k); ctx.strokeStyle = D.batt; ctx.lineWidth = 2 * k; ctx.stroke();
  ctx.fillStyle = '#3cbb4d'; ctx.fillRect(sx + sw - 61 * k, sy + 17 * k, 30 * k, 12 * k);
  ctx.fillStyle = D.batt; ctx.fillRect(sx + sw - 23 * k, sy + 19 * k, 4 * k, 8 * k);
  // 커버 + 글자
  const cy = sy + barH + 30 * k, cs = 210 * k;
  if (s.photoLayout === 'cover') {
    withShadow(ctx, 14 * k, 6 * k, 'rgba(0,0,0,0.3)', () => { ctx.fillStyle = D.coverBack; ctx.fillRect(sx + 26 * k, cy, cs, cs); });
    kit.drawPhoto(ctx, { x: sx + 26 * k, y: cy, w: cs, h: cs });
    // 커버 반사 (바닥 거울)
    ctx.save(); ctx.globalAlpha = 0.18;
    ctx.translate(0, (cy + cs) * 2); ctx.scale(1, -1);
    kit.drawPhoto(ctx, { x: sx + 26 * k, y: cy, w: cs, h: cs });
    ctx.restore();
  } else {
    kit.drawVisualizer(ctx, { x: sx + 26 * k, y: cy, w: cs, h: cs }, { kind: 'radial', color: f.palette.accent, color2: D.viz2, innerRadius: 0.45 });
  }
  const tx = sx + 26 * k + cs + 24 * k, tw = sw - (tx - sx) - 20 * k;
  text(ctx, kit, titleOf(f), tx, cy + 46 * k, { font: kit.font(32 * k, 800), color: D.title, maxW: tw });
  text(ctx, kit, artistOf(f), tx, cy + 88 * k, { font: kit.font(26 * k, 500), color: D.artist, maxW: tw });
  if (s.phrase) text(ctx, kit, s.phrase, tx, cy + 126 * k, { font: kit.font(22 * k, 400), color: D.phrase, maxW: tw });
  text(ctx, kit, '1 of 12', tx, cy + cs - 10 * k, { font: kit.font(20 * k, 400, kit.mono), color: D.meta });
  // 진행 막대 (광택 파란 막대)
  if (s.showProgress) {
    const py = sy + sh - 66 * k, px = sx + 26 * k, pw = sw - 52 * k;
    rr(ctx, px, py, pw, 16 * k, 3 * k); ctx.fillStyle = D.track; ctx.fill();
    const pg = ctx.createLinearGradient(0, py, 0, py + 16 * k);
    pg.addColorStop(0, mix(f.palette.accent, '#ffffff', 0.35)); pg.addColorStop(1, f.palette.accent);
    rr(ctx, px, py, Math.max(10 * k, pw * kit.progress), 16 * k, 3 * k); ctx.fillStyle = pg; ctx.fill();
    text(ctx, kit, kit.fmtTime(f.time), px, py + 44 * k, { font: kit.font(20 * k, 700, kit.mono), color: D.time });
    text(ctx, kit, '-' + kit.fmtTime(Math.max(0, f.duration - f.time)), px + pw, py + 44 * k, { font: kit.font(20 * k, 700, kit.mono), color: D.time, align: 'right' });
  }
  // 화면 아래 작은 비주얼라이저 (cover 배치일 때)
  if (s.photoLayout === 'cover' && s.visualizer !== 'none') {
    kit.drawVisualizer(ctx, { x: sx + 26 * k, y: cy + cs + 14 * k, w: sw - 52 * k, h: sh - (cy + cs + 14 * k - sy) - 100 * k }, { color: f.palette.accent, color2: D.viz2, count: 40, alpha: 0.9 });
  }
  // 유리 반사
  const gl = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
  gl.addColorStop(0, D.glass); gl.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl; ctx.fillRect(sx, sy, sw, sh);
  ctx.restore();

  // 클릭 휠
  const wcx = x + w / 2, wcy = y + 46 * k + sh + 250 * k, wr = 205 * k;
  const wg = ctx.createRadialGradient(wcx, wcy - wr * 0.4, wr * 0.1, wcx, wcy, wr);
  wg.addColorStop(0, D.wheel0); wg.addColorStop(1, mix(D.wheel1, f.palette.accent, 0.08));
  withShadow(ctx, 10 * k, 3 * k, D.wheelShadow, () => {
    ctx.beginPath(); ctx.arc(wcx, wcy, wr, 0, Math.PI * 2); ctx.fillStyle = wg; ctx.fill();
  });
  ctx.strokeStyle = D.wheelEdge; ctx.lineWidth = 2 * k; ctx.stroke();
  ctx.beginPath(); ctx.arc(wcx, wcy, wr * 0.38, 0, Math.PI * 2);
  const cg = ctx.createLinearGradient(0, wcy - wr * 0.38, 0, wcy + wr * 0.38);
  cg.addColorStop(0, D.btn0); cg.addColorStop(1, D.btn1);
  ctx.fillStyle = cg; ctx.fill(); ctx.strokeStyle = D.btnEdge; ctx.stroke();
  const lab = D.lab;
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
  baseTone: 'light',
  toneBg: studioBg,
  background(ctx, f, kit) {
    const W = f.width, H = f.height, p = f.palette;
    if (f.settings.photoLayout === 'background') { photoBackdrop(ctx, f, kit); return; }
    const light = p.tone === 'light';
    const g = ctx.createLinearGradient(0, 0, W, H);
    if (p.bgCustom) {
      // 지정 배경색 — 같은 색 안에서 밝기만 살짝 흐르게 (글자 대비 유지)
      g.addColorStop(0, mix(p.bg, '#ffffff', light ? 0.25 : 0.08));
      g.addColorStop(1, mix(p.bg, '#000000', light ? 0.08 : 0.3));
    } else if (light) {
      g.addColorStop(0, mix(p.accent, '#ffffff', 0.55));
      g.addColorStop(1, mix(p.accent, '#1a1a22', 0.35));
    } else {
      // 어두운 스튜디오 — 포인트색이 밴 먹색이 오른쪽 아래로 더 가라앉는다
      g.addColorStop(0, mix(p.accent, '#1a1a20', 0.72));
      g.addColorStop(1, mix(p.accentDeep, '#050507', 0.7));
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 바닥 스튜디오 조명 원
    const r = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.7);
    r.addColorStop(0, light ? 'rgba(255,255,255,0.35)' : alpha(p.accent, 0.16)); r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    vignette(ctx, f, light ? 0.35 : 0.55);
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
    const p = f.palette;
    const nat = isNative(f, 'light');
    const bgPhoto = s.photoLayout === 'background';
    // 원래 모습: 스튜디오 배경 위 먹색 / 사진 배경 위 흰색. 그 밖엔 팔레트
    const ink = nat ? (bgPhoto ? '#ffffff' : '#141418') : p.ink;
    const sub = nat ? (bgPhoto ? 'rgba(255,255,255,0.7)' : alpha('#141418', 0.55)) : p.inkSoft;
    if (shape !== 'tall' && s.phrase) text(ctx, kit, s.phrase, lr.x, pad * 1.4, { font: kit.font(26 * u, 600), color: sub, maxW: lr.w });
    kit.drawLyrics(ctx, lr, { align, size: (shape === 'square' ? 40 : 48) * u, color: ink, dimColor: nat ? sub : ink, weight: 800, lineHeight: 1.4 });
  },
};
