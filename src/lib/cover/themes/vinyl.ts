// LP 턴테이블 — 돌아가는 검은 레코드, 가운데 라벨에 사진, 톤암은 진행률만큼 안쪽으로.
import type { AccentPalette, FrameState, RenderKit, ThemeDef, Tone } from '../types';
import { accentWash, alpha, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, progressBar, withShadow, rr, photoBackdrop, grain, vignette, setSpacing, paper, isNative, surfaceOf, rgbOf } from './_paint';

const RPM = 33.333;

function record(ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit, cx: number, cy: number, R: number, labelPhoto = true) {
  const u = f.u;
  const ang = f.time * (RPM / 60) * Math.PI * 2;
  const light = f.palette.tone === 'light';
  if (light) {
    // 밝은 데스크: 판 아래로 살짝 보이는 알루미늄 플래터 테두리
    withShadow(ctx, 50 * u, 22 * u, alpha(f.palette.shadow, 0.32), () => {
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.035, 0, Math.PI * 2);
      const pg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      pg.addColorStop(0, '#f2f2f0'); pg.addColorStop(0.5, '#b9b8b4'); pg.addColorStop(1, '#8e8d89');
      ctx.fillStyle = pg; ctx.fill();
    });
  }
  // 판 그림자
  withShadow(ctx, 70 * u, 30 * u, light ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.6)', () => {
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = '#0b0b0c'; ctx.fill();
  });
  // 홈 (가는 동심원 — 밝기를 번갈아)
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  const g0 = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R);
  g0.addColorStop(0, '#151517'); g0.addColorStop(1, '#0a0a0b');
  ctx.fillStyle = g0; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.lineWidth = Math.max(0.6, 1.1 * u);
  for (let r = R * 0.38; r < R * 0.97; r += 4.2 * u) {
    const k = Math.sin(r * 0.37) * 0.5 + 0.5;
    ctx.strokeStyle = `rgba(255,255,255,${0.025 + k * 0.035})`;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  // 트랙 사이 빈 홈 (곡 구분선처럼)
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 3 * u;
  for (const k of [0.55, 0.7, 0.84]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.stroke(); }
  // 빛 반사 — 판은 돌아도 조명은 고정 (원뿔형 그라데이션)
  const c2 = ctx as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient };
  if (c2.createConicGradient) {
    const cg = c2.createConicGradient(-0.6, cx, cy);
    cg.addColorStop(0, 'rgba(255,255,255,0)');
    cg.addColorStop(0.08, 'rgba(255,255,255,0.13)');
    cg.addColorStop(0.16, 'rgba(255,255,255,0)');
    cg.addColorStop(0.5, 'rgba(255,255,255,0)');
    cg.addColorStop(0.58, 'rgba(255,255,255,0.1)');
    cg.addColorStop(0.66, 'rgba(255,255,255,0)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  ctx.restore();
  // 라벨 (사진) — 판과 같이 돈다
  const L = R * 0.36;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(ang);
  if (labelPhoto && f.settings.photoLayout === 'cover' && f.image) {
    kit.drawPhoto(ctx, { x: -L, y: -L, w: L * 2, h: L * 2 }, { radius: L });
  } else {
    ctx.beginPath(); ctx.arc(0, 0, L, 0, Math.PI * 2); ctx.fillStyle = f.palette.accent; ctx.fill();
    ctx.fillStyle = f.palette.onAccent;
    ctx.textAlign = 'center';
    ctx.font = kit.font(L * 0.15, 700);
    ctx.fillText(kit.fitText(ctx, titleOf(f), L * 1.4), 0, -L * 0.42);
    ctx.font = kit.font(L * 0.1, 500, kit.mono);
    ctx.fillText('SIDE A · 33⅓ RPM', 0, L * 0.55);
  }
  ctx.restore();
  // 라벨 테두리·축
  ctx.beginPath(); ctx.arc(cx, cy, L, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3 * u; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 11 * u, 0, Math.PI * 2);
  const sg = ctx.createRadialGradient(cx - 3 * u, cy - 3 * u, 1, cx, cy, 11 * u);
  sg.addColorStop(0, '#f4f4f4'); sg.addColorStop(1, '#8a8a8a');
  ctx.fillStyle = sg; ctx.fill();
}

/** 앨범 재킷 — 커버 사진을 크게 (레코드는 재킷에서 빠져나온 모양) */
function sleeve(ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit, x: number, y: number, size: number) {
  const u = f.u;
  const light = f.palette.tone === 'light';
  withShadow(ctx, 46 * u, 20 * u, light ? alpha(f.palette.shadow, 0.3) : 'rgba(0,0,0,0.6)', () => {
    ctx.fillStyle = '#111'; ctx.fillRect(x, y, size, size);
  });
  kit.drawPhoto(ctx, { x, y, w: size, h: size });
  // 종이 재킷 질감 — 가장자리 미세한 하이라이트와 닳은 모서리 느낌
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g; ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5 * u; ctx.strokeRect(x + 0.75 * u, y + 0.75 * u, size - 1.5 * u, size - 1.5 * u);
}

function tonearm(ctx: CanvasRenderingContext2D, f: FrameState, cx: number, cy: number, R: number) {
  const u = f.u;
  const px = cx + R * 1.02, py = cy - R * 0.92;   // 회전축
  // 진행률에 따라 바깥 홈 → 안쪽 홈
  const p = f.duration > 0 ? Math.min(1, f.time / f.duration) : 0;
  const a = 0.4 + p * 0.26;   // 라디안 — 아래(+y)에서 왼쪽으로 기울어짐: 바깥 홈 → 안쪽 홈
  const len = R * 1.3;
  ctx.save();
  ctx.translate(px, py);
  const sh = f.palette.tone === 'light' ? 0.6 : 1;   // 밝은 데스크에선 그림자를 옅게
  // 받침
  withShadow(ctx, 20 * u, 8 * u, `rgba(0,0,0,${0.5 * sh})`, () => {
    ctx.beginPath(); ctx.arc(0, 0, 34 * u, 0, Math.PI * 2);
    const bg = ctx.createRadialGradient(-8 * u, -8 * u, 2, 0, 0, 34 * u);
    bg.addColorStop(0, '#e9e9ea'); bg.addColorStop(1, '#8d8f93');
    ctx.fillStyle = bg; ctx.fill();
  });
  ctx.rotate(a);
  // 팔
  withShadow(ctx, 14 * u, 10 * u, `rgba(0,0,0,${0.45 * sh})`, () => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#d8d9dc'; ctx.lineWidth = 9 * u;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, len * 0.86); ctx.lineTo(-len * 0.06, len); ctx.stroke();
  });
  // 헤드셸
  ctx.translate(-len * 0.06, len);
  ctx.rotate(0.25);
  rr(ctx, -16 * u, -10 * u, 32 * u, 54 * u, 6 * u);
  ctx.fillStyle = '#2b2c30'; ctx.fill();
  ctx.fillStyle = f.palette.accent; ctx.fillRect(-16 * u, 30 * u, 32 * u, 6 * u);
  ctx.restore();
  // 무게추
  ctx.save(); ctx.translate(px, py); ctx.rotate(a);
  rr(ctx, -20 * u, -78 * u, 40 * u, 44 * u, 8 * u); ctx.fillStyle = '#4a4c52'; ctx.fill();
  ctx.restore();
}

/** 톤별 바탕 — 다크: 어두운 원목 데스크 / 라이트: 크림색 밝은 원목(메이플) 데스크 */
const deskBg = (tone: Tone, p: AccentPalette) =>
  tone === 'dark' ? mix(p.accentDeep, '#120f0d', 0.7) : mix(p.accentSoft, '#eee3cf', 0.62);

export const vinyl: ThemeDef = {
  id: 'vinyl',
  name: 'LP 턴테이블',
  desc: '앨범 재킷과 돌아가는 레코드, 톤암',
  suggestedAccent: '#d9a441',
  baseTone: 'dark',
  toneBg: deskBg,
  background(ctx, f, kit) {
    const W = f.width, H = f.height, p = f.palette;
    const light = p.tone === 'light';
    if (f.settings.photoLayout === 'background') {
      photoBackdrop(ctx, f, kit, 0.15);
    } else if (!light) {
      // 어두운 원목 데스크 위 조명 — 포인트색으로 살짝 물든 따뜻한 바탕
      ctx.fillStyle = surfaceOf(f, deskBg);
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W * 0.38, H * 0.32, 0, W * 0.38, H * 0.32, Math.max(W, H) * 0.8);
      g.addColorStop(0, alpha(p.accent, accentWash('dark', 0.22)));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else {
      // 밝은 원목 데스크 — 무광 질감 + 창가 햇빛(왼쪽 위) + 포인트색 반사광
      paper(ctx, f, { x: 0, y: 0, w: W, h: H }, surfaceOf(f, deskBg), 0.2);
      const g = ctx.createRadialGradient(W * 0.3, H * 0.22, 0, W * 0.3, H * 0.22, Math.max(W, H) * 0.85);
      g.addColorStop(0, 'rgba(255,253,246,0.55)');
      g.addColorStop(0.55, alpha(p.accent, accentWash('light', 0.05)));
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // 라이트: 사진 배경이면 덮개색으로 가장자리를 밝게, 데스크면 따뜻한 갈색 그늘
    if (light && f.settings.photoLayout === 'background') vignette(ctx, f, 0.35, rgbOf(p.dim));
    else if (light) vignette(ctx, f, 0.1, p.bgCustom ? rgbOf(mix(p.bg, '#000000', 0.5)) : '92,64,36');
    else vignette(ctx, f, 0.6);
    grain(ctx, f, light ? 0.05 : 0.07, 0);
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings, p = f.palette;
    const shape = shapeOf(f);
    const pad = 76 * u;
    const nat = isNative(f, 'dark');
    const ink = nat ? '#f5efe6' : p.ink, sub = nat ? 'rgba(245,239,230,0.62)' : p.inkSoft;
    // 바탕 위 포인트색 (밝은 바탕에서도 읽히게)
    const acc = nat ? p.accent : p.accentInk;
    let cx: number, cy: number, R: number;
    let tx: number, ty: number, tw: number, ly: number, lh: number;
    // 커버형: 앨범 재킷(사진 크게) + 재킷에서 반쯤 빠져나온 레코드. 전체 배경형은 사진이 이미 크니 큰 레코드만.
    const jacket = s.photoLayout === 'cover';
    let jk: { x: number; y: number; s: number } | null = null;
    const vizBand = s.visualizer !== 'none' && s.visualizer !== 'radial';
    if (jacket) {
      if (shape === 'land') {
        const js = Math.min(H - pad * 2.4, W * 0.36); jk = { x: pad + 10 * u, y: (H - js) / 2, s: js };
        R = js * 0.44; cx = jk.x + js + R * 0.35; cy = H / 2;
        tx = cx + R + 110 * u; tw = W - tx - pad; ty = pad + 40 * u;
        ly = ty + 200 * u; lh = H - ly - 200 * u;
      } else if (shape === 'square') {
        const js = 470 * u; jk = { x: pad, y: pad, s: js };
        R = js * 0.46; cx = pad + js + R * 0.42; cy = pad + js / 2;
        tx = pad; tw = W - pad * 2; ty = pad + js + 70 * u;
        ly = ty + (s.phrase ? 190 : 150) * u; lh = H - ly - (vizBand ? 206 : 120) * u;
      } else {
        // 세로: 재킷 + 오른쪽으로 빠져나온 레코드가 가로폭 안에 들어오게
        const js = Math.min((W - pad * 2) / (1 + 0.44 * 1.35), H * 0.4); jk = { x: pad, y: pad + 40 * u, s: js };
        R = js * 0.44; cx = pad + js + R * 0.35; cy = jk.y + js / 2;
        tx = pad; tw = W - pad * 2; ty = jk.y + js + 110 * u;
        ly = ty + 170 * u; lh = H - ly - 230 * u;
      }
    } else if (shape === 'land') {
      R = H * 0.38; cx = pad + R + 20 * u; cy = H / 2;
      tx = cx + R + 200 * u; tw = W - tx - pad; ty = pad + 40 * u;
      ly = ty + 200 * u; lh = H - ly - 200 * u;
    } else if (shape === 'square') {
      // 정사각: 큰 판을 오른쪽 위 모서리에 걸쳐 잘라 두고, 글자는 왼쪽 아래로
      R = 380 * u; cx = W - 230 * u; cy = 290 * u;
      tx = pad; tw = 470 * u; ty = 440 * u;
      ly = 690 * u; lh = H - ly - (vizBand ? 250 : 150) * u;
    } else {
      R = Math.min(W * 0.4, H * 0.24); cx = W / 2 - 30 * u; cy = pad + R + 60 * u;
      tx = pad; tw = W - pad * 2; ty = cy + R + 110 * u;
      ly = ty + 170 * u; lh = H - ly - 230 * u;
    }
    // 원형 비주얼라이저는 판 둘레, 나머지는 아래 띠
    if (s.visualizer === 'radial') {
      const VR = R * 1.32;
      kit.drawVisualizer(ctx, { x: cx - VR, y: cy - VR, w: VR * 2, h: VR * 2 }, { color: acc, color2: ink, innerRadius: 1.03 / 1.32, glow: 8 * u });
    }
    record(ctx, f, kit, cx, cy, R, !jacket);
    if (jk) sleeve(ctx, f, kit, jk.x, jk.y, jk.s);
    if (cx + R * 1.1 < W) tonearm(ctx, f, cx, cy, R);   // 회전축이 화면 밖이면 생략

    // 제목 묶음 — 레이블처럼 작은 모노 머리말 + 큰 제목
    const big = shape === 'tall' ? 64 : 52;
    ctx.save();
    text(ctx, kit, 'NOW SPINNING', tx, ty, { font: kit.font(18 * u, 700, kit.mono), color: acc, spacing: 4 * u });
    text(ctx, kit, titleOf(f), tx, ty + (big + 18) * u, { font: kit.font(big * u, 800), color: ink, maxW: tw });
    text(ctx, kit, artistOf(f), tx, ty + (big + 66) * u, { font: kit.font(30 * u, 500), color: sub, maxW: tw });
    if (s.phrase) {
      ctx.fillStyle = alpha(acc, 0.9);
      ctx.fillRect(tx, ty + (big + 96) * u, 36 * u, 3 * u);
      text(ctx, kit, s.phrase, tx + 50 * u, ty + (big + 106) * u, { font: kit.font(24 * u, 500), color: sub, maxW: tw - 50 * u });
    }
    ctx.restore();

    if (lh > 50 * u) {
      kit.drawLyrics(ctx, { x: tx, y: ly, w: tw, h: lh }, { align: 'left', size: (shape === 'land' ? 42 : 46) * u, color: ink, dimColor: nat ? sub : ink, weight: 700, lineHeight: 1.45 });
    }
    // 아래 띠: 비주얼라이저 + 진행 막대 (타임코드)
    const bx = shape === 'land' ? tx : pad, bw = shape === 'land' ? tw : W - pad * 2;
    const by = H - pad;
    if (s.visualizer !== 'none' && s.visualizer !== 'radial') {
      const tight = jacket && shape === 'square';   // 재킷 정사각은 가사 칸을 위해 띠를 낮게
      kit.drawVisualizer(ctx, { x: bx, y: by - (tight ? 116 : 150) * u, w: bw, h: (tight ? 56 : 80) * u }, { color: acc, color2: ink, alpha: 0.85, count: 64 });
    }
    if (s.showProgress) {
      progressBar(ctx, bx, by - 40 * u, bw, 4 * u, kit.progress, { track: nat ? 'rgba(255,255,255,0.16)' : p.line, fill: acc, knob: ink, knobR: 8 * u });
      ctx.save(); setSpacing(ctx, 1.5 * u);
      text(ctx, kit, kit.fmtTime(f.time), bx, by, { font: kit.font(20 * u, 400, kit.mono), color: sub });
      text(ctx, kit, kit.fmtTime(f.duration), bx + bw, by, { font: kit.font(20 * u, 400, kit.mono), color: sub, align: 'right' });
      ctx.restore();
    }
  },
};
