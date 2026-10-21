'use client';
// 별밤 배경 (v2.1 사용자 요청 — 캐릭터 화면을 개인용 홈(gnuboard 아보카도) 프로필 뷰어처럼)
// 짙은 남색 성운 그라데이션 + 반짝이는 별 + 가끔 지나가는 유성.
// 화면 전체에 고정으로 깔리고, 상단바·콘텐츠는 그 위에 그대로 올라간다.
//
// 보는 사람이 라이트 모드를 고르면(프로필 메뉴, v2.1) 별밤을 깔지 않고 원래 테마로 보인다 —
// 별밤 전용 색(.cosmic)도 body.has-starfield 일 때만 적용된다.
//
// body에 포털로 붙인다 — .page는 등장 애니메이션(transform) 동안 position:fixed의 기준이
// 페이지 자신으로 바뀌어서, 안에 두면 첫 0.35초 동안 배경이 페이지 크기로 잘려 보인다.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '@/lib/ThemeProvider';

interface Star { x: number; y: number; r: number; base: number; amp: number; speed: number; phase: number; hue: number }
interface Meteor { x: number; y: number; vx: number; vy: number; life: number; max: number }

/* 본문에 직접 칠한 어두운 글자색 밝히기 (v2.1 사용자 제보 — 「TRPG 캐릭터에서 일부 글자가 어두워
   읽을 수 없다」). 편집기로 쓴 소개글은 밝은 배경을 기준으로 검정·진회색을 직접 넣어 둔 경우가 있다.
   별밤 위에서는 그런 글자만 골라 같은 색상의 밝은 톤으로 바꾼다 — 배경색을 따로 깔아 둔 글자는
   그 배경 위에서 읽히므로 건드리지 않는다. 원래 색은 data-cf-orig에 두고 별밤이 꺼지면 되돌린다. */
const TEXT_ROOTS = '.cosmic .prose, .cosmic .post-body, .cosmic .html-body, .cosmic-main .widget';

function parseRgb(c: string): [number, number, number, number] | null {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b);
};
/** 같은 색상(hue)을 유지한 채 밝게 — 무채색이면 연한 회백색 */
function lighten([r, g, b]: number[]): string {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 18) return '#e3e7f0';
  const rr = r / 255, gg = g / 255, bb = b / 255, mx = max / 255, mn = min / 255, d = mx - mn;
  let h = mx === rr ? ((gg - bb) / d) % 6 : mx === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  h = Math.round(h * 60); if (h < 0) h += 360;
  return `hsl(${h} 70% 78%)`;
}
function hasOwnBg(el: Element, root: Element): boolean {
  for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
    const bg = parseRgb(getComputedStyle(n).backgroundColor);
    if (bg && bg[3] > .3) return true;
  }
  return false;
}
function fixDarkText() {
  document.querySelectorAll(TEXT_ROOTS).forEach(root => {
    root.querySelectorAll<HTMLElement>('[style*="color"], font[color]').forEach(el => {
      if (el.dataset.cfOrig != null) return;
      const c = parseRgb(getComputedStyle(el).color);
      if (!c || lum(c) > .18 || hasOwnBg(el, root)) return;
      el.dataset.cfOrig = el.style.color;
      el.style.color = lighten(c);
    });
  });
}
function restoreDarkText() {
  document.querySelectorAll<HTMLElement>('[data-cf-orig]').forEach(el => {
    el.style.color = el.dataset.cfOrig ?? '';
    delete el.dataset.cfOrig;
  });
}

export function StarField() {
  const { isLight } = useTheme();
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { setMounted(true); }, []);

  // 어두운 글자 밝히기 — 내용이 늦게 불러와지거나 탭을 바꿔도 따라가도록 DOM 변화를 지켜본다
  useEffect(() => {
    if (!mounted || isLight) return;
    let t = 0;
    const run = () => { cancelAnimationFrame(t); t = requestAnimationFrame(fixDarkText); };
    run();
    const host = document.getElementById('appMain') ?? document.body;
    const mo = new MutationObserver(run);
    mo.observe(host, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(t); restoreDarkText(); };
  }, [mounted, isLight]);

  useEffect(() => {
    if (!mounted || isLight) return;
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let stars: Star[] = [];
    let meteor: Meteor | null = null;
    let raf = 0;
    let w = 0, h = 0;

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 화면 넓이에 비례 — 큰 화면에서도 과하지 않게 상한
      const n = Math.min(420, Math.round((w * h) / 3200));
      stars = Array.from({ length: n }, () => {
        const big = Math.random() < .06;
        return {
          x: Math.random() * w, y: Math.random() * h,
          r: big ? 1.1 + Math.random() * .9 : .3 + Math.random() * .8,
          base: .25 + Math.random() * .55, amp: .15 + Math.random() * .35,
          speed: .4 + Math.random() * 1.6, phase: Math.random() * Math.PI * 2,
          // 대부분 흰색, 일부만 푸른빛·금빛
          hue: Math.random() < .7 ? 0 : Math.random() < .75 ? 215 : 45,
        };
      });
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const sec = t / 1000;
      for (const s of stars) {
        const a = Math.max(0, Math.min(1, s.base + (reduce ? 0 : Math.sin(sec * s.speed + s.phase) * s.amp)));
        ctx.fillStyle = s.hue ? `hsla(${s.hue},80%,85%,${a})` : `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        if (s.r > 1.1) {
          // 큰 별은 은은한 빛 번짐 + 십자 광채
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5);
          g.addColorStop(0, `rgba(190,210,255,${a * .35})`); g.addColorStop(1, 'rgba(190,210,255,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = `rgba(220,230,255,${a * .4})`; ctx.lineWidth = .6;
          ctx.beginPath();
          ctx.moveTo(s.x - s.r * 4, s.y); ctx.lineTo(s.x + s.r * 4, s.y);
          ctx.moveTo(s.x, s.y - s.r * 4); ctx.lineTo(s.x, s.y + s.r * 4);
          ctx.stroke();
        }
      }
      if (!reduce) {
        if (!meteor && Math.random() < .0025) {
          const sp = 7 + Math.random() * 5;
          meteor = { x: Math.random() * w * .8 + w * .2, y: Math.random() * h * .35, vx: -sp, vy: sp * .45, life: 0, max: 55 + Math.random() * 30 };
        }
        if (meteor) {
          const m = meteor;
          m.life++; m.x += m.vx; m.y += m.vy;
          const fade = Math.sin((m.life / m.max) * Math.PI);
          const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 12, m.y - m.vy * 12);
          g.addColorStop(0, `rgba(255,255,255,${.85 * fade})`); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - m.vx * 12, m.y - m.vy * 12); ctx.stroke();
          if (m.life >= m.max) meteor = null;
        }
        raf = requestAnimationFrame(draw);
      }
    };

    build();
    if (reduce) draw(0); else raf = requestAnimationFrame(draw);
    const onResize = () => { build(); if (reduce) draw(0); };
    // 탭이 안 보일 때는 그리지 않는다
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(draw);
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    document.body.classList.add('has-starfield');
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      document.body.classList.remove('has-starfield');
    };
  }, [mounted, isLight]);

  if (!mounted || isLight) return null;
  return createPortal(
    <div className="starfield" aria-hidden="true">
      <div className="starfield-nebula" />
      <canvas ref={canvasRef} />
    </div>,
    document.body,
  );
}
