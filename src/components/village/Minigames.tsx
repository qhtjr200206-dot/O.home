'use client';
// 미니게임 2종 — 별 줍기(반사신경), 짝 맞추기(기억력).
// 별 줍기: 판의 시드는 서버가 발급하고, 끝나면 '점수'가 아니라 플레이 입력(바구니 위치)을 보낸다.
// 서버가 같은 규칙(src/lib/village/games.ts)으로 재생해 점수를 계산한다.
// 짝 맞추기: 카드 배치는 서버에만 있고, 한 장씩 뒤집을 때마다 서버가 그 카드만 알려 주고 점수를 매긴다.
import React, { useEffect, useRef, useState } from 'react';
import { CATCH, MEMORY, catchStart, catchStep } from '@/lib/village/games';
import type { VillageEra } from '@/lib/village/types';

export function CatchGame({ era, seed, onFinish }: { era: VillageEra; seed: string; onFinish: (xs: number[]) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [left, setLeft] = useState(CATCH.TICKS * CATCH.TICK_MS / 1000);
  const [score, setScore] = useState(0);
  // 부모가 다시 그려져 콜백이 바뀌어도 진행 중인 판을 다시 시작하지 않는다
  const finishRef = useRef(onFinish);
  useEffect(() => { finishRef.current = onFinish; }, [onFinish]);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    const { W, H } = CATCH;
    const s = catchStart(seed);
    const xs: number[] = [];
    let basket = W / 2, raf = 0, last = performance.now(), acc = 0, shownLeft = -1, shownScore = -1, done = false;
    const keys = new Set<string>();
    const icon = era === 'sf' ? '💎' : era === 'past' ? '🌼' : '⭐';
    const clamp = (x: number) => Math.max(CATCH.BASKET_MIN, Math.min(CATCH.BASKET_MAX, x));
    const move = (clientX: number) => { const r = cv.getBoundingClientRect(); basket = clamp(((clientX - r.left) / r.width) * W); };
    const onPointer = (e: PointerEvent) => move(e.clientX);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); if (e.type === 'keydown') keys.add(e.key); else keys.delete(e.key); } };
    const clearKeys = () => keys.clear();
    cv.addEventListener('pointermove', onPointer); cv.addEventListener('pointerdown', onPointer);
    cv.addEventListener('keydown', onKey); cv.addEventListener('keyup', onKey); cv.addEventListener('blur', clearKeys);
    const loop = (t: number) => {
      const dt = Math.min(250, t - last); last = t;
      if (keys.has('ArrowLeft')) basket = clamp(basket - dt * 0.35);
      if (keys.has('ArrowRight')) basket = clamp(basket + dt * 0.35);
      // 고정 틱으로 진행 — 서버 재생과 같은 결과가 나온다
      acc += dt;
      while (acc >= CATCH.TICK_MS && s.tick < CATCH.TICKS) {
        const x = Math.round(basket);
        xs.push(x); catchStep(s, x); acc -= CATCH.TICK_MS;
      }
      ctx.fillStyle = era === 'sf' ? '#1d2340' : era === 'past' ? '#f4ecd8' : '#e8f3ff';
      ctx.fillRect(0, 0, W, H);
      ctx.font = '22px serif'; ctx.textAlign = 'center';
      for (const it of s.items) ctx.fillText(it.bad ? '💣' : icon, it.x, it.y);
      ctx.fillStyle = era === 'sf' ? '#7ff3ff' : '#8a5a3c';
      ctx.fillRect(basket - 24, H - 22, 48, 12);
      // 화면 글자는 값이 바뀔 때만 갱신(매 프레임 다시 그리지 않음)
      const nextLeft = Math.ceil((CATCH.TICKS - s.tick) * CATCH.TICK_MS / 1000);
      if (nextLeft !== shownLeft) { shownLeft = nextLeft; setLeft(nextLeft); }
      if (s.score !== shownScore) { shownScore = s.score; setScore(s.score); }
      if (s.tick >= CATCH.TICKS) { if (!done) { done = true; finishRef.current(xs); } return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); cv.removeEventListener('pointermove', onPointer); cv.removeEventListener('pointerdown', onPointer); cv.removeEventListener('keydown', onKey); cv.removeEventListener('keyup', onKey); cv.removeEventListener('blur', clearKeys); };
  }, [era, seed]);
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
      <div>남은 시간 {left}초 · <span aria-live="polite" aria-atomic="true">점수 {score}</span></div>
      <canvas ref={ref} width={CATCH.W} height={CATCH.H} tabIndex={0} style={{ width: 'min(300px, 100%)', touchAction: 'none', borderRadius: 10, border: '1px solid var(--line)' }} aria-label="별 줍기 — 게임 화면에 초점을 두고 좌우 화살표를 누르거나 손가락이나 마우스로 바구니를 움직이세요" />
      <small>폭탄을 받으면 2점 감점 · 점수는 서버가 다시 계산해요</small>
    </div>
  );
}

export interface FlipResult { icon: string; match?: boolean; done?: boolean; score?: number }
/** 짝 맞추기 — 카드 배치는 서버에만 있다. 한 장 누를 때마다 서버에 물어 그 카드 그림만 받는다. */
export function MemoryGame({ flip: askServer, onDone }: { flip: (card: number) => Promise<FlipResult | null>; onDone: (score: number) => void }) {
  const total = MEMORY.PAIRS * 2;
  const [icons, setIcons] = useState<(string | null)[]>(() => Array(total).fill(null));
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const openRef = useRef<number[]>([]);
  const matchedRef = useRef<number[]>([]);
  const busy = useRef(false);
  const finished = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const flip = async (i: number) => {
    if (busy.current || finished.current || openRef.current.includes(i) || matchedRef.current.includes(i)) return;
    busy.current = true;
    const r = await askServer(i);
    if (!r) { busy.current = false; return; }
    setIcons(prev => { const n = [...prev]; n[i] = r.icon; return n; });
    const next = [...openRef.current, i];
    openRef.current = next;
    setOpen(next);
    if (next.length < 2) { busy.current = false; return; }
    setMoves(m => m + 1);
    const [a, b] = next;
    // 두 장을 잠깐 보여 준 뒤 정리한다. 부모 알림은 타이머 콜백에서만(렌더 중 부모 갱신 없음)
    timer.current = setTimeout(() => {
      timer.current = null;
      if (r.match) {
        matchedRef.current = [...matchedRef.current, a, b];
        setMatched(matchedRef.current);
      } else {
        setIcons(prev => { const n = [...prev]; n[a] = null; n[b] = null; return n; });
      }
      openRef.current = [];
      setOpen([]);
      busy.current = false;
      if (r.done && !finished.current) {
        finished.current = true;
        doneRef.current(r.score ?? 0);
      }
    }, MEMORY.PAIR_MS + 50);
  };
  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
      <div aria-live="polite">뒤집은 횟수 {moves} · 맞춘 짝 {matched.length / 2}/{MEMORY.PAIRS}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(52px, 64px))', gap: 6 }}>
        {icons.map((icon, i) => {
          const shown = !!icon && (open.includes(i) || matched.includes(i));
          return (
            <button key={i} type="button" onClick={() => flip(i)} aria-label={shown ? `카드 ${i + 1}: ${icon}` : `카드 ${i + 1}`}
              style={{ aspectRatio: '1', fontSize: 28, borderRadius: 10, border: '1px solid var(--line)', background: shown ? '#fff' : 'var(--accent)', cursor: 'pointer' }}>
              {shown ? icon : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
