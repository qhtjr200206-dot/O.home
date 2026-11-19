// 영화 필름 — 스프로킷 구멍이 난 필름 띠 안의 한 장면, 자막처럼 흐르는 가사, 그레인과 깜빡임.
import type { AccentPalette, ThemeDef, Tone } from '../types';
import { alpha, ensureContrast, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, rr, grain, vignette, hash01, setSpacing, isNative, surfaceOf, toneDim, rgbOf } from './_paint';

/** 톤별 바탕 — 다크: 불 꺼진 영사실 / 라이트: 필름을 올려 둔 라이트박스의 유백색 발광면 */
const roomBg = (tone: Tone, p: AccentPalette) => (tone === 'dark' ? '#0a0908' : mix(p.accentSoft, '#f7f5ef', 0.82));

/** 필름 띠 하나 (가로 방향: 위·아래 / 세로 방향: 좌·우) */
function sprockets(ctx: CanvasRenderingContext2D, u: number, x: number, y: number, w: number, h: number, vertical: boolean, offset: number, holeColor = '#e9e2d0', stripColor = '#0d0c0b') {
  ctx.fillStyle = stripColor;
  ctx.fillRect(x, y, w, h);
  const hole = 30 * u, pitch = 56 * u, holeL = 22 * u;
  ctx.fillStyle = holeColor;
  const len = vertical ? h : w;
  const o = ((offset % pitch) + pitch) % pitch;
  for (let p = -pitch + o; p < len + pitch; p += pitch) {
    if (vertical) rr(ctx, x + (w - hole) / 2, y + p, hole, holeL, 4 * u);
    else rr(ctx, x + p, y + (h - hole) / 2, holeL, hole, 4 * u);
    ctx.fill();
  }
}

export const film: ThemeDef = {
  id: 'film',
  name: '필름',
  desc: '필름 띠 속 한 장면 — 자막처럼 흐르는 가사',
  suggestedAccent: '#f2b33d',
  baseTone: 'dark',
  toneBg: roomBg,
  background(ctx, f) {
    const W = f.width, H = f.height;
    ctx.fillStyle = surfaceOf(f, roomBg);
    ctx.fillRect(0, 0, W, H);
    if (f.palette.tone === 'light') {
      // 라이트박스 — 가운데가 가장 밝게 빛나는 우윳빛 아크릴 면
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(255,255,255,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, H = f.height, s = f.settings, p = f.palette;
    const shape = shapeOf(f);
    const nat = isNative(f, 'dark');
    const light = p.tone === 'light';
    // 바탕(영사실/라이트박스) 위 글자색
    const cIn = nat ? '#fff7e8' : p.ink;                         // 제목
    const cSub = nat ? alpha('#fff7e8', 0.7) : p.inkSoft;        // 아티스트
    const cCred = nat ? alpha('#ffffff', 0.75) : p.inkSoft;      // 크레디트
    const cLy = nat ? '#fffbe6' : p.ink;                         // 자막
    const acc = nat ? p.accent : p.accentInk;
    const surf = surfaceOf(f, roomBg);
    // 사진 위에 깔리는 밝은 덮개/후광 색 (라이트)
    const veil = s.photoLayout === 'background' ? p.dim : surf;
    const vertical = shape === 'tall';
    const band = 92 * u;
    // 필름이 아주 천천히 흘러간다 (프로젝터 느낌)
    const roll = f.time * 6 * u;
    // 장면(사진) 창
    const fx = vertical ? band : 0, fy = vertical ? 0 : band;
    const fw = vertical ? W - band * 2 : W, fh = vertical ? H : H - band * 2;
    // 사진 — 필름 창을 꽉 채움. cover 배치면 창 안 가운데 프레임(테두리 여백) + 위아래 레터박스
    const flick = s.photoLayout === 'background' && s.bgStyle !== 'blur' ? 1 : 1 - 0.05 * hash01(Math.floor(f.time * 18));
    ctx.save();
    ctx.globalAlpha = flick;
    if (s.photoLayout === 'background') {
      kit.drawPhoto(ctx, { x: fx, y: fy, w: fw, h: fh }, { dim: toneDim(f, s.bgDim * 0.8), blur: s.bgBlur * 10 * u });
    } else {
      // 레터박스 2.39:1 느낌 — 가로 화면은 위아래 검은 띠, 세로 화면은 가운데 장면
      const sw = fw - 60 * u;
      const sh = vertical ? Math.min(fh * 0.42, sw) : fh - 150 * u;
      const sx = fx + (fw - sw) / 2, sy = vertical ? fy + 130 * u : fy + 40 * u;
      kit.drawPhoto(ctx, { x: sx, y: sy, w: sw, h: sh }, { radius: 6 * u });
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3 * u; rr(ctx, sx, sy, sw, sh, 6 * u); ctx.stroke();
    }
    ctx.restore();
    // 필름 질감: 그레인 + 세로 스크래치 + 가장자리 번짐
    grain(ctx, f, light ? 0.08 : 0.16, 18, { x: fx, y: fy, w: fw, h: fh });
    const bucket = Math.floor(f.time * 8);
    for (let i = 0; i < 3; i++) {
      if (hash01(bucket * 3 + i) > 0.55) continue;
      const sxp = fx + hash01(bucket * 7 + i) * fw;
      // 다크: 빛 새는 흰 스크래치 / 라이트: 라이트박스 위 먼지·머리카락 같은 어두운 선
      ctx.fillStyle = light ? `rgba(40,32,24,${0.05 + hash01(bucket + i) * 0.08})` : `rgba(255,250,235,${0.08 + hash01(bucket + i) * 0.12})`;
      ctx.fillRect(sxp, fy, Math.max(1, 1.4 * u), fh);
    }
    if ((s.photoLayout !== 'background' || s.bgStyle === 'blur') && light) vignette(ctx, f, 0.14, p.bgCustom ? rgbOf(mix(surf, '#000000', 0.45)) : '86,74,58');
    else if (s.photoLayout !== 'background' || s.bgStyle === 'blur') vignette(ctx, f, 0.7);
    if (!vertical && (s.photoLayout !== 'background' || s.bgStyle === 'blur')) {
      // 크레디트·자막이 사진 위에서도 읽히게 위아래를 살짝 어둡게 (라이트: 덮개색으로 밝게)
      const sc = nat ? '0,0,0' : rgbOf(light ? veil : p.bgCustom ? p.bg : '#000000');
      const k = light ? 1.25 : 1;
      const g = ctx.createLinearGradient(0, fy, 0, fy + fh);
      if (light) {
        // 라이트: 먹색 자막이 사진 어두운 부분에 묻히지 않게 아래쪽을 더 넓고 진하게 밝힌다
        g.addColorStop(0, `rgba(${sc},0.72)`); g.addColorStop(0.3, `rgba(${sc},0)`);
        g.addColorStop(0.48, `rgba(${sc},0)`); g.addColorStop(0.7, `rgba(${sc},0.82)`); g.addColorStop(1, `rgba(${sc},0.92)`);
      } else {
        g.addColorStop(0, `rgba(${sc},0.55)`); g.addColorStop(0.3, `rgba(${sc},0)`);
        g.addColorStop(0.62, `rgba(${sc},0)`); g.addColorStop(1, `rgba(${sc},0.7)`);
      }
      ctx.fillStyle = g; ctx.fillRect(fx, fy, fw, fh);
    }

    // 필름 띠
    // 구멍 너머로 보이는 빛 — 다크: 영사기 빛 / 라이트: 라이트박스 면
    const hole = light ? mix(surf, '#ffffff', 0.6) : '#e9e2d0';
    // 라이트: 라이트박스 위 현상된 필름 베이스처럼 반투명 회갈색 띠 (검은 띠는 라이트 화면을 어둡게 만든다)
    const strip = light ? mix(surf, '#5f574d', 0.5) : '#0d0c0b';
    if (vertical) {
      sprockets(ctx, u, 0, 0, band, H, true, roll, hole, strip);
      sprockets(ctx, u, W - band, 0, band, H, true, roll, hole, strip);
    } else {
      sprockets(ctx, u, 0, 0, W, band, false, roll, hole, strip);
      sprockets(ctx, u, 0, H - band, W, band, false, roll, hole, strip);
    }
    // 띠 가장자리 인쇄 글자 (필름 코드)
    ctx.save();
    ctx.fillStyle = alpha(nat ? p.accent : ensureContrast(p.accent, strip, 3), 0.95);   // 필름 띠 위 인쇄 글자 (다크: 검은 띠, 라이트: 회갈색 띠)
    ctx.font = kit.font(15 * u, 700, kit.mono);
    setSpacing(ctx, 3 * u);
    const frameNo = 12 + Math.floor(f.time * 0.5);
    const codes = [`▶ ${frameNo}A`, 'SAFETY FILM 400', `${frameNo + 1}`, '◀ 24 FPS'];
    if (vertical) {
      ctx.translate(band - 8 * u, 0); ctx.rotate(Math.PI / 2);
      codes.forEach((c, i) => ctx.fillText(c, ((i * H) / 4 + 80 * u - roll) % H + 0, 0));
    } else {
      codes.forEach((c, i) => ctx.fillText(c, ((i * W) / 4 + 60 * u - roll + W) % W, band - 6 * u));
    }
    ctx.restore();

    // 오프닝 크레디트 — 왼쪽 위 / 타임코드 오른쪽 위
    const ix = fx + 56 * u, iy = fy + 70 * u;
    text(ctx, kit, (s.phrase || 'ORIGINAL SOUNDTRACK').toUpperCase(), ix, iy, { font: kit.font(18 * u, 700, kit.mono), color: cCred, spacing: 4 * u, maxW: fw * 0.6 });
    const ttlSize = vertical ? 64 : 58;
    const shotBottom = fy + 130 * u + Math.min(fh * 0.42, fw - 60 * u);
    const tY = vertical ? shotBottom + 100 * u : iy + 70 * u;
    text(ctx, kit, titleOf(f), ix, tY, { font: kit.font(ttlSize * u, 800), color: cIn, maxW: fw - 112 * u });
    text(ctx, kit, artistOf(f), ix, tY + 52 * u, { font: kit.font(28 * u, 500), color: cSub, maxW: fw - 112 * u, spacing: 1 * u });
    // 타임코드 HH:MM:SS:FF
    const fr = Math.floor((f.time % 1) * 24);
    const tc = `00:${kit.fmtTime(f.time).padStart(5, '0')}:${String(fr).padStart(2, '0')}`;
    text(ctx, kit, tc, fx + fw - 56 * u, iy, { font: kit.font(22 * u, 700, kit.mono), color: acc, align: 'right', spacing: 2 * u });
    // 녹화 점
    if (f.playing && Math.floor(f.time * 2) % 2 === 0) {
      ctx.beginPath(); ctx.arc(fx + fw - 56 * u - 210 * u, iy - 8 * u, 8 * u, 0, Math.PI * 2); ctx.fillStyle = '#ff3b30'; ctx.fill();
    }

    // 자막 — 화면 아래 가운데, 검은 그림자
    const subBottom = fy + fh - (s.showProgress ? 120 : 60) * u;
    const vizOn = s.visualizer !== 'none';
    const subTop = vertical ? tY + (vizOn ? 210 : 110) * u : subBottom - ((s.lyricContext ? 1 + s.lyricContextLines * 2 : 1) * 60 * u + 30 * u);
    kit.drawLyrics(ctx, { x: fx + 60 * u, y: subTop, w: fw - 120 * u, h: subBottom - subTop }, {
      align: 'center', size: 42 * u, color: cLy, dimColor: nat ? 'rgba(255,251,230,0.7)' : cLy, weight: 700,
      // 자막 그림자 — 라이트에선 밝은 번짐(후광)으로 사진 위 먹색 글자를 띄운다
      shadow: light ? alpha(veil, 0.95) : 'rgba(0,0,0,0.95)', lineHeight: 1.4, contextScale: 0.78,
    });
    // 비주얼라이저 — 오른쪽 아래 작은 사운드트랙 띠 (광학 사운드트랙처럼)
    if (vizOn) {
      const radial = s.visualizer === 'radial';
      const vw = radial ? 170 * u : vertical ? fw - 112 * u : fw * 0.26, vh = radial ? 170 * u : 80 * u;
      const vx = vertical && !radial ? ix : fx + fw - vw - 56 * u;
      const vy = vertical ? tY + 90 * u : iy + 40 * u;
      kit.drawVisualizer(ctx, { x: vx, y: vy, w: vw, h: vh }, { color: acc, color2: cIn, alpha: 0.85, count: 40, mirror: true, innerRadius: 0.35 });
    }
    // 진행 — 필름 리더처럼 얇은 선 + 남은 시간
    if (s.showProgress) {
      const py = fy + fh - 54 * u;
      ctx.fillStyle = nat ? 'rgba(255,255,255,0.18)' : alpha(p.ink, 0.18); ctx.fillRect(ix, py, fw - 112 * u, 2 * u);
      ctx.fillStyle = acc; ctx.fillRect(ix, py - 1 * u, (fw - 112 * u) * kit.progress, 4 * u);
      text(ctx, kit, `REEL 1 — ${kit.fmtTime(f.time)} / ${kit.fmtTime(f.duration)}`, ix, py - 16 * u, { font: kit.font(16 * u, 400, kit.mono), color: nat ? 'rgba(255,255,255,0.6)' : p.inkSoft, spacing: 2 * u });
    }
  },
};
