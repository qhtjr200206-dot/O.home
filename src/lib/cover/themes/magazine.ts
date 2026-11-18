// 매거진 — 음악 잡지 표지. 거대한 제호, 표지 사진, 커버 라인·인용문, 바코드.
import type { FrameState, RenderKit, ThemeDef } from '../types';
import { alpha, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, paper, strHash, hash01, setSpacing } from './_paint';

function barcode(ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit, x: number, y: number, w: number, h: number, ink: string, bg: string) {
  const u = f.u;
  ctx.fillStyle = bg; ctx.fillRect(x - 10 * u, y - 10 * u, w + 20 * u, h + 44 * u);
  const seed = strHash(titleOf(f) + artistOf(f));
  let cx = x;
  ctx.fillStyle = ink;
  let i = 0;
  while (cx < x + w) {
    const bw = (1 + Math.floor(hash01(seed % 997 + i) * 3)) * 2 * u;
    if (i % 2 === 0) ctx.fillRect(cx, y, bw, h);
    cx += bw; i++;
  }
  const num = String(seed).padStart(10, '0').slice(0, 10);
  text(ctx, kit, `9 ${num.slice(0, 5)} ${num.slice(5)}`, x + w / 2, y + h + 26 * u, { font: kit.font(18 * u, 400, kit.mono), color: ink, align: 'center' });
}

export const magazine: ThemeDef = {
  id: 'magazine',
  name: '매거진',
  desc: '거대한 제호와 커버 라인 — 음악 잡지 표지',
  suggestedAccent: '#e23b2e',
  background(ctx, f) {
    paper(ctx, f, { x: 0, y: 0, w: f.width, h: f.height }, '#f2eee6', 0.22);
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings;
    const shape = shapeOf(f);
    const land = shape === 'land';
    const pad = 56 * u;
    const full = s.photoLayout === 'background';
    const ink = '#141210';
    const vol = 1 + (strHash(titleOf(f)) % 48);
    const vizOn = s.visualizer !== 'none';

    // 제호 크기 — 칸 너비를 꽉 채우는 PLAYLIST
    const mastW = land ? W * 0.42 - pad * 1.6 : W - pad * 2;
    ctx.save();
    ctx.font = kit.font(200 * u, 900);
    const ms = (200 * u * mastW) / ctx.measureText('PLAYLIST').width;
    ctx.restore();
    const mastY = pad + ms * 0.78;
    const issueY = mastY + 34 * u;
    const bottomBand = (shape === 'tall' ? 330 : 250) * u;

    // 사진 — 표지 전체(배경 배치) / 가로형은 오른쪽 판 / 나머지는 제호 아래 큰 판
    const photo = full
      ? { x: 0, y: 0, w: W, h: H }
      : land
        ? { x: W * 0.42, y: pad, w: W * 0.58 - pad, h: H - pad * 2 }
        : { x: pad, y: issueY + 26 * u, w: W - pad * 2, h: H - pad - bottomBand - (issueY + 26 * u) };
    kit.drawPhoto(ctx, photo, { dim: full ? s.bgDim * 0.5 : 0 });
    if (full) {
      const g = ctx.createLinearGradient(0, H * 0.4, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const g2 = ctx.createLinearGradient(0, 0, 0, issueY + 60 * u);
      g2.addColorStop(0, 'rgba(0,0,0,0.25)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, issueY + 60 * u);
    }
    if (full && land) {
      // 가로 표지: 왼쪽 글자 단은 종이 띠 위에 (사진 위 검은 글자는 안 읽힌다)
      ctx.fillStyle = 'rgba(242,238,230,0.94)';
      ctx.fillRect(0, 0, W * 0.42 - pad * 0.4, H);
    }
    const paperInk = full && !land ? '#ffffff' : ink;

    // 제호
    ctx.save();
    ctx.font = kit.font(ms, 900);
    setSpacing(ctx, -ms * 0.02);
    ctx.fillStyle = f.palette.accent;
    ctx.fillText('PLAYLIST', pad, mastY);
    ctx.restore();
    ctx.fillStyle = paperInk; ctx.fillRect(pad, issueY - 22 * u, mastW, 2 * u);
    text(ctx, kit, `VOL. ${String(vol).padStart(2, '0')}  ·  THE LISTENING ISSUE  ·  ₩0`, pad, issueY + 6 * u, { font: kit.font(17 * u, 700, kit.mono), color: paperInk, spacing: 2 * u, maxW: mastW });

    const bottomY = H - pad;
    const bcW = 170 * u, bcH = 64 * u;
    const bcX = W - pad - bcW, bcY = bottomY - bcH - 30 * u;

    if (land) {
      const colX = pad, colW = W * 0.42 - pad * 1.8;
      const ty = issueY + 110 * u;
      text(ctx, kit, 'COVER STORY', colX, ty - 40 * u, { font: kit.font(18 * u, 700, kit.mono), color: f.palette.accent, spacing: 3 * u });
      text(ctx, kit, titleOf(f), colX, ty + 30 * u, { font: kit.font(76 * u, 900), color: ink, maxW: colW });
      text(ctx, kit, artistOf(f), colX, ty + 82 * u, { font: kit.font(32 * u, 500), color: alpha(ink, 0.7), maxW: colW });
      let lyB = bottomY - 70 * u;
      if (vizOn && s.visualizer === 'radial') {
        const R = 130 * u;
        kit.drawVisualizer(ctx, { x: photo.x + photo.w - R * 2 - 30 * u, y: photo.y + 30 * u, w: R * 2, h: R * 2 }, { color: '#ffffff', color2: f.palette.accent, innerRadius: 0.45 });
      } else if (vizOn) {
        kit.drawVisualizer(ctx, { x: colX, y: lyB - 80 * u, w: colW, h: 80 * u }, { color: f.palette.accent, color2: ink, count: 36, innerRadius: 0.3 });
        lyB -= 110 * u;
      }
      if (s.phrase) {
        text(ctx, kit, '“', colX, lyB, { font: kit.font(80 * u, 900), color: f.palette.accent });
        text(ctx, kit, s.phrase, colX + 46 * u, lyB - 6 * u, { font: kit.font(26 * u, 700), color: ink, maxW: colW - 46 * u });
        lyB -= 80 * u;
      }
      const lyT = ty + 130 * u;
      kit.drawLyrics(ctx, { x: colX, y: lyT, w: colW, h: Math.max(0, lyB - lyT) }, {
        align: 'left', size: 36 * u, weight: 800, color: ink, dimColor: alpha(ink, 0.6), lineHeight: 1.32,
      });
      // 사진 위 바코드
      barcode(ctx, f, kit, bcX, bcY, bcW, bcH, ink, '#ffffff');
      if (s.showProgress) {
        ctx.fillStyle = alpha(ink, 0.2); ctx.fillRect(colX, bottomY - 6 * u, colW, 2 * u);
        ctx.fillStyle = f.palette.accent; ctx.fillRect(colX, bottomY - 8 * u, colW * kit.progress, 6 * u);
        text(ctx, kit, `P. ${kit.fmtTime(f.time)} — ${kit.fmtTime(f.duration)}`, colX, bottomY - 22 * u, { font: kit.font(16 * u, 700, kit.mono), color: alpha(ink, 0.7), spacing: 2 * u });
      }
      return;
    }

    // 세로·정사각 — 아래 띠: 왼쪽 커버 라인, 오른쪽 인용문 + 바코드
    const colX = pad, leftW = (W - pad * 2) * 0.58;
    const ty = bottomY - (shape === 'tall' ? 150 : 110) * u;
    const lineColor = full ? '#ffffff' : ink;
    text(ctx, kit, 'COVER STORY', colX, ty - (shape === 'tall' ? 100 : 78) * u, { font: kit.font(18 * u, 700, kit.mono), color: full ? '#ffffff' : f.palette.accent, spacing: 3 * u });
    text(ctx, kit, titleOf(f), colX, ty, { font: kit.font((shape === 'tall' ? 92 : 68) * u, 900), color: lineColor, maxW: leftW });
    text(ctx, kit, artistOf(f), colX, ty + 48 * u, { font: kit.font(30 * u, 500), color: full ? 'rgba(255,255,255,0.8)' : alpha(ink, 0.7), maxW: leftW });
    const rx = colX + leftW + 40 * u, rw = W - pad - rx;
    if (s.phrase) {
      text(ctx, kit, '“', rx, bcY - 44 * u, { font: kit.font(70 * u, 900), color: f.palette.accent });
      text(ctx, kit, s.phrase, rx + 38 * u, bcY - 56 * u, { font: kit.font(22 * u, 700), color: lineColor, maxW: rw - 38 * u });
    }
    barcode(ctx, f, kit, bcX, bcY, bcW, bcH, ink, '#ffffff');
    // 사진 위: 가사 (흰 굵은 커버 문구) + 아래쪽 비주얼라이저
    const area = full ? { y: issueY + 70 * u, b: ty - (shape === 'tall' ? 150 : 120) * u } : { y: photo.y + 36 * u, b: photo.y + photo.h - 30 * u };
    let lyB = area.b;
    if (vizOn && s.visualizer === 'radial') {
      const R = 120 * u;
      kit.drawVisualizer(ctx, { x: W - pad * 1.4 - R * 2, y: (full ? issueY + 60 * u : photo.y + 30 * u), w: R * 2, h: R * 2 }, { color: '#ffffff', color2: f.palette.accent, innerRadius: 0.45 });
    } else if (vizOn) {
      kit.drawVisualizer(ctx, { x: pad * 1.6, y: lyB - 76 * u, w: W - pad * 3.2, h: 76 * u }, { color: '#ffffff', color2: f.palette.accent, count: 44, alpha: 0.92, innerRadius: 0.3 });
      lyB -= 106 * u;
    }
    kit.drawLyrics(ctx, { x: pad * 1.6, y: area.y, w: W - pad * 3.2, h: Math.max(0, lyB - area.y) }, {
      align: 'left', size: (shape === 'tall' ? 52 : 46) * u, weight: 900, color: '#ffffff', dimColor: 'rgba(255,255,255,0.82)',
      shadow: 'rgba(0,0,0,0.55)', lineHeight: 1.28,
    });
    if (s.showProgress) {
      const pw = leftW;
      ctx.fillStyle = full ? 'rgba(255,255,255,0.3)' : alpha(ink, 0.2); ctx.fillRect(colX, bottomY - 6 * u, pw, 2 * u);
      ctx.fillStyle = f.palette.accent; ctx.fillRect(colX, bottomY - 8 * u, pw * kit.progress, 6 * u);
      text(ctx, kit, `P. ${kit.fmtTime(f.time)} — ${kit.fmtTime(f.duration)}`, colX + pw, bottomY - 22 * u, { font: kit.font(16 * u, 700, kit.mono), color: full ? '#fff' : mix(ink, '#888', 0.3), spacing: 2 * u, align: 'right' });
    }
  },
};
