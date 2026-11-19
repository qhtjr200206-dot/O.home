// 유튜브 플리 — 흔한 유튜브 「플레이리스트」 썸네일·재생 화면 느낌.
// 큰 16:9 썸네일(겹친 재생목록 카드), 빨간 진행 막대, 자막(CC)처럼 흐르는 가사, 채널 줄과 「모두 재생」 버튼.
import type { AccentPalette, FrameState, RenderKit, ThemeDef, Tone, Rect } from '../types';
import { alpha, mix } from '../color';
import { shapeOf, titleOf, artistOf, text, rr, photoBackdrop, withShadow, surfaceOf } from './_paint';

/** 톤별 바탕 — 유튜브 다크(#0f0f0f) / 라이트(흰색) */
const ytBg = (tone: Tone, p: AccentPalette) => (tone === 'dark' ? mix(p.accentDeep, '#0f0f0f', 0.94) : mix(p.accentSoft, '#ffffff', 0.92));

interface YtLayout {
  thumb: Rect;
  /** 썸네일 안에 자막으로 가사를 넣는지 (아니면 lyr 칸에) */
  cc: boolean;
  lyr: Rect | null;
  infoY: number;
  pillY: number;
  /** 가로형: 오른쪽 재생목록 패널 */
  panel: Rect | null;
}

function layout(f: FrameState): YtLayout {
  const u = f.u, W = f.width, H = f.height;
  const shape = shapeOf(f);
  const pad = 64 * u;
  if (shape === 'land') {
    const th = Math.min(H - pad - 86 * u - 290 * u, W * 0.62 * 9 / 16), tw = th * 16 / 9;
    const thumb = { x: pad, y: pad + 86 * u, w: tw, h: th };
    const px = thumb.x + thumb.w + 40 * u;
    const panel = { x: px, y: thumb.y - 24 * u, w: W - px - pad, h: H - pad - (thumb.y - 24 * u) };
    return { thumb, cc: false, lyr: { x: panel.x + 28 * u, y: panel.y + 130 * u, w: panel.w - 56 * u, h: panel.h - 160 * u }, infoY: thumb.y + thumb.h + 40 * u, pillY: H - pad - 60 * u, panel };
  }
  const tw = W - pad * 2;
  const tall = shape === 'tall';
  const th = tall && H / W > 1.5 ? tw : tw * 9 / 16;   // 9:16은 정사각 썸네일
  const thumb = { x: pad, y: pad + 86 * u, w: tw, h: th };
  const infoY = thumb.y + th + 40 * u;
  const pillY = H - pad - 60 * u;
  const lyr = tall ? { x: pad, y: infoY + 170 * u, w: tw, h: pillY - 30 * u - (infoY + 170 * u) } : null;
  return { thumb, cc: !tall, lyr, infoY, pillY, panel: null };
}

/** 앰비언트 빛 — 사진을 아주 작게 줄였다 키워 흐린 색 덩어리로 (가장자리는 투명하게 번짐). 사진·비율별로 한 번만 만든다 */
const ambientCache = new WeakMap<object, { key: string; c: HTMLCanvasElement }>();
function ambient(img: CanvasImageSource, iw: number, ih: number, ratio: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || !(iw > 0 && ih > 0)) return null;
  const key = ratio.toFixed(3);
  const hit = ambientCache.get(img as object);
  if (hit && hit.key === key) return hit.c;
  // 1단계: 안쪽 칸(여백 25%)에 사진을 cover로 아주 작게
  const tw = 28, th = Math.max(8, Math.round(tw / ratio));
  const a = document.createElement('canvas'); a.width = tw; a.height = th;
  const x = a.getContext('2d'); if (!x) return null;
  const mw = tw * 0.62, mh = th * 0.62, k = Math.max(mw / iw, mh / ih);
  x.save(); x.beginPath(); x.rect((tw - mw) / 2, (th - mh) / 2, mw, mh); x.clip();
  x.drawImage(img, (tw - iw * k) / 2, (th - ih * k) / 2, iw * k, ih * k);
  x.restore();
  // 2단계: 두 배씩 키우며 부드럽게 보간 (필터 없이 — 사파리 포함). 여백이 투명이라 가장자리가 번진다
  let c: HTMLCanvasElement = a;
  for (let i = 0; i < 4; i++) {
    const n = document.createElement('canvas'); n.width = c.width * 2; n.height = c.height * 2;
    const nx = n.getContext('2d')!; nx.imageSmoothingEnabled = true; nx.imageSmoothingQuality = 'high';
    nx.drawImage(c, 0, 0, n.width, n.height);
    c = n;
  }
  const out = c;
  ambientCache.set(img as object, { key, c: out });
  return out;
}

/** 빨간 재생 로고 (둥근 사각 + 흰 삼각형) */
function logo(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string) {
  const w = h * 1.42;
  rr(ctx, x, y, w, h, h * 0.28); ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(x + w * 0.4, y + h * 0.28); ctx.lineTo(x + w * 0.66, y + h * 0.5); ctx.lineTo(x + w * 0.4, y + h * 0.72); ctx.closePath(); ctx.fill();
  return w;
}

/** 재생목록 아이콘 (세 줄 + 작은 재생 삼각형) */
function listIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, s * 0.62, s * 0.12);
  ctx.fillRect(x, y + s * 0.3, s * 0.62, s * 0.12);
  ctx.fillRect(x, y + s * 0.6, s * 0.36, s * 0.12);
  ctx.beginPath(); ctx.moveTo(x + s * 0.5, y + s * 0.44); ctx.lineTo(x + s, y + s * 0.7); ctx.lineTo(x + s * 0.5, y + s * 0.96); ctx.closePath(); ctx.fill();
}

function thumbnail(ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit, L: YtLayout, red: string, ink: string) {
  const u = f.u, s = f.settings, t = L.thumb;
  const r = 22 * u;
  const dark = f.palette.tone === 'dark';
  // 겹친 재생목록 카드 두 장 (요즘 유튜브 재생목록 썸네일)
  rr(ctx, t.x + 48 * u, t.y - 26 * u, t.w - 96 * u, 40 * u, 12 * u); ctx.fillStyle = alpha(ink, dark ? 0.18 : 0.14); ctx.fill();
  rr(ctx, t.x + 24 * u, t.y - 13 * u, t.w - 48 * u, 40 * u, 14 * u); ctx.fillStyle = alpha(ink, dark ? 0.32 : 0.26); ctx.fill();
  withShadow(ctx, 30 * u, 10 * u, dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.18)', () => { rr(ctx, t.x, t.y, t.w, t.h, r); ctx.fillStyle = '#000'; ctx.fill(); });
  kit.drawPhoto(ctx, t, { radius: r });
  ctx.save();
  rr(ctx, t.x, t.y, t.w, t.h, r); ctx.clip();
  // 아래쪽 어둡게 — 자막·진행 막대가 사진 위에서 읽히게
  const g = ctx.createLinearGradient(0, t.y + t.h * (L.cc ? 0.42 : 0.7), 0, t.y + t.h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = g; ctx.fillRect(t.x, t.y, t.w, t.h);
  // 오른쪽 아래 배지 — 「≡▶ 재생목록」
  const bh = 44 * u;
  ctx.font = kit.font(24 * u, 700);
  const label = '재생목록';
  const bw = ctx.measureText(label).width + 74 * u;
  const bx = t.x + t.w - bw - 18 * u, by = t.y + 18 * u;
  rr(ctx, bx, by, bw, bh, 8 * u); ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fill();
  listIcon(ctx, bx + 14 * u, by + 11 * u, 22 * u, '#ffffff');
  text(ctx, kit, label, bx + 50 * u, by + bh / 2 + 1 * u, { font: kit.font(24 * u, 700), color: '#ffffff', baseline: 'middle' });
  // 자막(CC) 가사
  if (L.cc) {
    const cy = t.y + t.h * 0.52, ch = t.h - (cy - t.y) - 70 * u;
    kit.drawLyrics(ctx, { x: t.x + 48 * u, y: cy, w: t.w - 96 * u, h: ch }, {
      align: 'center', size: 40 * u, color: '#ffffff', dimColor: 'rgba(255,255,255,0.72)', weight: 700,
      shadow: 'rgba(0,0,0,0.95)', lineHeight: 1.36, contextScale: 0.74,
    });
  }
  // 재생 시간 + 빨간 진행 막대 (썸네일 맨 아래)
  if (s.showProgress) {
    const py = t.y + t.h - 6 * u;
    ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.fillRect(t.x, py, t.w, 6 * u);
    ctx.fillStyle = red; ctx.fillRect(t.x, py, t.w * kit.progress, 6 * u);
    ctx.beginPath(); ctx.arc(t.x + t.w * kit.progress, py + 3 * u, 11 * u, 0, Math.PI * 2); ctx.fillStyle = red; ctx.fill();
    text(ctx, kit, `${kit.fmtTime(f.time)} / ${kit.fmtTime(f.duration)}`, t.x + 26 * u, py - 22 * u, { font: kit.font(22 * u, 600, kit.mono), color: '#ffffff' });
  }
  ctx.restore();
}

export const youtube: ThemeDef = {
  id: 'youtube',
  name: '유튜브 플리',
  desc: '유튜브 재생목록 썸네일처럼 — 큰 썸네일, 자막 가사, 빨간 진행 막대',
  suggestedAccent: '#ff0033',
  baseTone: 'dark',
  toneBg: ytBg,
  background(ctx, f, kit) {
    if (f.settings.photoLayout === 'background') { photoBackdrop(ctx, f, kit, 0.1); return; }
    const W = f.width, H = f.height;
    ctx.fillStyle = surfaceOf(f, ytBg);
    ctx.fillRect(0, 0, W, H);
    // 앰비언트 모드 — 썸네일 둘레로 사진 색이 은은하게 번진다
    const t = layout(f).thumb;
    const glow = f.image ? ambient(f.image, f.imageW, f.imageH, t.w / t.h) : null;
    if (glow) {
      const e = 0.22;
      ctx.save();
      ctx.globalAlpha = f.palette.tone === 'dark' ? 0.8 : 0.45;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(glow, t.x - t.w * e, t.y - t.h * e, t.w * (1 + 2 * e), t.h * (1 + 2 * e));
      ctx.restore();
    }
  },
  foreground(ctx, f, kit) {
    const u = f.u, W = f.width, s = f.settings, p = f.palette;
    const L = layout(f);
    const pad = 64 * u;
    const ink = p.ink, sub = p.inkSoft;
    const red = p.accent;   // 썸네일(사진) 위 진행 막대는 포인트색 그대로
    // 머리줄 — 빨간 로고 + Playlist
    const lh = 46 * u;
    const lw = logo(ctx, pad, pad, lh, p.accent);
    text(ctx, kit, 'Playlist', pad + lw + 14 * u, pad + lh / 2 + 2 * u, { font: kit.font(34 * u, 800), color: ink, baseline: 'middle', spacing: -0.5 * u });
    if (s.phrase) text(ctx, kit, s.phrase, (L.panel ? L.thumb.x + L.thumb.w : W - pad), pad + lh / 2 + 2 * u, { role: 'phrase', font: kit.font(24 * u, 500), color: sub, baseline: 'middle', align: 'right', maxW: W * 0.45 });
    thumbnail(ctx, f, kit, L, red, ink);
    // 채널 줄 — 동그란 프로필(사진) + 제목 + 아티스트 · 재생목록
    const t = L.thumb;
    const av = 34 * u, ax = t.x + av, ay = L.infoY + av;
    ctx.save(); ctx.beginPath(); ctx.arc(ax, ay, av, 0, Math.PI * 2); ctx.clip();
    kit.drawPhoto(ctx, { x: ax - av, y: ay - av, w: av * 2, h: av * 2 });
    ctx.restore();
    const ix = t.x + av * 2 + 22 * u, iw = t.w - av * 2 - 22 * u;
    text(ctx, kit, titleOf(f), ix, L.infoY + 30 * u, { role: 'title', font: kit.font(40 * u, 800), color: ink, maxW: iw });
    text(ctx, kit, `${artistOf(f)} · 재생목록`, ix, L.infoY + 74 * u, { role: 'artist', font: kit.font(26 * u, 500), color: sub, maxW: iw });
    // 가사 — 세로형은 채널 줄 아래 크게, 가로형은 오른쪽 재생목록 패널
    if (L.panel) {
      const P = L.panel;
      rr(ctx, P.x, P.y, P.w, P.h, 22 * u); ctx.fillStyle = p.tone === 'dark' ? alpha('#ffffff', 0.06) : alpha('#000000', 0.04); ctx.fill();
      ctx.strokeStyle = p.line; ctx.lineWidth = 1.5 * u; ctx.stroke();
      text(ctx, kit, titleOf(f), P.x + 28 * u, P.y + 52 * u, { role: 'title', font: kit.font(30 * u, 800), color: ink, maxW: P.w - 56 * u });
      text(ctx, kit, `${artistOf(f)} · 가사`, P.x + 28 * u, P.y + 90 * u, { role: 'artist', font: kit.font(22 * u, 500), color: sub, maxW: P.w - 56 * u });
      ctx.fillStyle = p.line; ctx.fillRect(P.x, P.y + 112 * u, P.w, 1.5 * u);
    }
    if (L.lyr) {
      kit.drawLyrics(ctx, L.lyr, { align: 'left', size: (L.panel ? 36 : 46) * u, color: ink, dimColor: ink, weight: 800, lineHeight: 1.4 });
    }
    // 「모두 재생」·「셔플」 버튼 + 비주얼라이저
    const pillH = 60 * u, py = L.pillY;
    const pill = (x: number, label: string, fill: string, fg: string, icon: 'play' | 'shuffle') => {
      ctx.font = kit.font(26 * u, 700);
      const w = ctx.measureText(label).width + 92 * u;
      rr(ctx, x, py, w, pillH, pillH / 2); ctx.fillStyle = fill; ctx.fill();
      ctx.fillStyle = fg;
      const cx = x + 38 * u, cy = py + pillH / 2;
      if (icon === 'play') { ctx.beginPath(); ctx.moveTo(cx - 9 * u, cy - 12 * u); ctx.lineTo(cx + 12 * u, cy); ctx.lineTo(cx - 9 * u, cy + 12 * u); ctx.closePath(); ctx.fill(); }
      else {
        ctx.strokeStyle = fg; ctx.lineWidth = 3.5 * u; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - 13 * u, cy - 8 * u); ctx.lineTo(cx + 12 * u, cy + 8 * u); ctx.moveTo(cx - 13 * u, cy + 8 * u); ctx.lineTo(cx + 12 * u, cy - 8 * u); ctx.stroke();
      }
      text(ctx, kit, label, x + 62 * u, cy + 1 * u, { font: kit.font(26 * u, 700), color: fg, baseline: 'middle' });
      return w;
    };
    const left = L.panel ? t.x : pad;
    const w1 = pill(left, '모두 재생', ink, p.bg, 'play');
    const w2 = pill(left + w1 + 16 * u, '셔플', alpha(ink, 0.1), ink, 'shuffle');
    const vx = left + w1 + w2 + 56 * u, vr = (L.panel ? t.x + t.w : W - pad);
    if (s.visualizer !== 'none' && vr - vx > 120 * u) {
      kit.drawVisualizer(ctx, { x: vx, y: py + 4 * u, w: vr - vx, h: pillH - 8 * u }, { kind: s.visualizer === 'radial' ? 'bars' : undefined, color: p.accentInk, color2: alpha(ink, 0.5), count: 40, mirror: true, innerRadius: 0.3 });
    }
  },
};
