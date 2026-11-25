'use client';
// 마을 경제 화면 — 상점·가방·집 안(꾸미기). (v3 사용자 요청 — 재화로 선물·가구를 사고 집 안을 꾸민다)
// 화면은 보여 주기와 입력만 한다. 값(가격·잠금·배치 규칙)은 서버가 같은 순수 규칙(catalog.ts·house.ts)으로 다시 검사한다.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FURNITURE_CATALOG, GIFT_CATALOG, HOUSE_UPGRADE, STYLE_CATALOG, defaultStyle, furnitureOf, type FurnitureItem } from '@/lib/village/catalog';
import { CURRENCY, levelProgress, titleOf } from '@/lib/village/economy';
import { HOUSE_SIZE, coziness, cozyStars, footprint, houseLayout, occupancy, validateHouse, type PlacedItem } from '@/lib/village/house';
import type { VillageEra } from '@/lib/village/map';
import { josa, type EconView, type HouseView } from '@/lib/village/types';
import type { PixelAvatarData } from '@/components/chars/PixelAvatar';
import { TILE, avatarSprite } from './render';
import { SIDE, WALL_TOP, furnitureArt, roomArt } from './interior';

export const coinLabel = (era: VillageEra, n: number) => `${CURRENCY[era].icon} ${n.toLocaleString('ko-KR')}`;
export const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
export const emptyHouse = (era: VillageEra, place: string): HouseView => ({ place, level: 1, floor: defaultStyle(era, 'floor'), wall: defaultStyle(era, 'wall'), items: [] });
export const houseScore = (era: VillageEra, items: PlacedItem[]) => coziness(items, id => furnitureOf(era, id));

/** 상단 한 줄 HUD — 레벨·경험치 막대·재화 (모바일에서도 한 줄) */
export function Hud({ era, econ, name }: { era: VillageEra; econ: EconView | undefined; name: string }) {
  const exp = econ?.exp ?? 0;
  const p = levelProgress(exp);
  const title = titleOf(p.level);
  return (
    <span className="village-hud" title={`${name} — 경험치 ${exp}${p.span ? ` (다음 레벨까지 ${p.span - p.into})` : ''}`}>
      <b>Lv {p.level}</b>{title && <span aria-label={title} title={title}>⭐</span>}
      <span className="village-expbar" aria-label={`경험치 ${Math.round(p.frac * 100)}%`}><i style={{ width: `${Math.round(p.frac * 100)}%` }} /></span>
      <b>{coinLabel(era, econ?.coins ?? 0)}</b>
    </span>
  );
}

type Tab = 'gift' | 'furniture' | 'style' | 'house';
/** 상점 — 탭: 선물·가구·바닥/벽지·집 확장. 잠긴 상품은 자물쇠와 '레벨 N' */
export function ShopPanel({ era, econ, homeHouse, homeName, busy, onBuy, onUpgrade }: {
  era: VillageEra; econ: EconView | undefined; homeHouse: HouseView | null; homeName: string; busy: boolean;
  onBuy: (item: string, qty: number) => void; onUpgrade: () => void;
}) {
  const [tab, setTab] = useState<Tab>('gift');
  const level = econ?.level ?? 1, coins = econ?.coins ?? 0, inv = econ?.inv ?? {};
  const list = tab === 'gift' ? GIFT_CATALOG[era] : tab === 'furniture' ? FURNITURE_CATALOG[era] : STYLE_CATALOG[era].filter(s => s.price > 0);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div role="tablist" className="village-tabs">
        {([['gift', '🎁 선물'], ['furniture', '🪑 가구'], ['style', '🧱 바닥·벽'], ['house', '🏠 집 확장']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`village-chip${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <small className="village-muted">가진 돈 {coinLabel(era, coins)} · 레벨 {level} — 산 물건은 가방에 들어가요. 되팔기는 없어요.</small>
      {tab !== 'house' ? (
        <div className="village-shop-grid">
          {list.map(it => {
            const locked = level < it.level;
            const owned = inv[it.id] ?? 0;
            const style = tab === 'style';
            const poor = coins < it.price;
            const f = tab === 'furniture' ? it as FurnitureItem : null;
            return (
              <div key={it.id} className={`village-shop-item${locked ? ' locked' : ''}`}>
                <span style={{ fontSize: 24 }} aria-hidden>{'icon' in it ? it.icon : 'kind' in it && it.kind === 'floor' ? '🟫' : '🧱'}</span>
                <b style={{ fontSize: 13 }}>{it.label}</b>
                <small className="village-muted">{f ? `${f.w}×${f.h}칸` : style ? ('kind' in it && it.kind === 'floor' ? '바닥재' : '벽지') : ''}{owned ? ` · 가방 ${owned}` : ''}</small>
                {locked ? <span className="village-lock">🔒 레벨 {it.level}</span> : (
                  <button className="btn btn-dark" disabled={busy || poor || (style && owned > 0)} onClick={() => onBuy(it.id, 1)}
                    title={poor ? '재화가 부족해요' : undefined}>
                    {style && owned ? '가짐' : coinLabel(era, it.price)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {!homeHouse ? <p className="village-muted" style={{ margin: 0 }}>이 캐릭터의 집(‘집’ 종류 장소)이 없어요. 방을 만들 때 집을 정하면 넓힐 수 있어요.</p> : (() => {
            const next = homeHouse.level < 3 ? (homeHouse.level + 1) as 2 | 3 : null;
            const up = next ? HOUSE_UPGRADE[next] : null;
            const size = HOUSE_SIZE[homeHouse.level];
            return (
              <>
                <span><b>{homeName}</b> — 지금 {homeHouse.level}단계 ({size.w}×{size.h}칸)</span>
                {next && up ? (
                  <>
                    <span>다음: {next}단계 ({HOUSE_SIZE[next].w}×{HOUSE_SIZE[next].h}칸) · {coinLabel(era, up.price)} · 레벨 {up.level} 필요</span>
                    {level < up.level ? <span className="village-lock">🔒 레벨 {up.level}</span>
                      : <button className="btn btn-dark" disabled={busy || coins < up.price} onClick={onUpgrade}>집 넓히기 ({coinLabel(era, up.price)})</button>}
                  </>
                ) : <span>가장 넓은 집이에요 ✨</span>}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/** 가방 — 선물·가구·바닥/벽지 */
export function BagPanel({ era, econ, onShop }: { era: VillageEra; econ: EconView | undefined; onShop: (() => void) | null }) {
  const inv = econ?.inv ?? {};
  const gifts = GIFT_CATALOG[era].filter(g => inv[g.id]);
  const furn = FURNITURE_CATALOG[era].filter(f => inv[f.id]);
  const styles = STYLE_CATALOG[era].filter(s => inv[s.id]);
  const row = (icon: string, label: string, n: number, key: string) => <li key={key}><span aria-hidden>{icon}</span> {label} <b>×{n}</b></li>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <small className="village-muted">가진 돈 {coinLabel(era, econ?.coins ?? 0)}</small>
      <b>선물</b>
      {gifts.length ? <ul className="village-bag">{gifts.map(g => row(g.icon, g.label, inv[g.id], g.id))}</ul> : <p className="village-muted" style={{ margin: 0 }}>선물이 없어요.</p>}
      <b>가구</b>
      {furn.length ? <ul className="village-bag">{furn.map(f => row(f.icon, f.label, inv[f.id], f.id))}</ul> : <p className="village-muted" style={{ margin: 0 }}>가구가 없어요.</p>}
      {furn.length > 0 && <small className="village-muted">집에 들어가 ‘꾸미기’에서 놓을 수 있어요.</small>}
      {styles.length > 0 && <><b>바닥·벽지</b><ul className="village-bag">{styles.map(s => row(s.kind === 'floor' ? '🟫' : '🧱', s.label, 1, s.id))}</ul></>}
      {onShop && <button className="btn btn-ghost" onClick={onShop}>🏪 상점 가기</button>}
    </div>
  );
}

/* ---------------- 집 안 ---------------- */
type Mode = { kind: 'walk' } | { kind: 'place'; item: string; r: 0 | 1 } | { kind: 'pick'; k: string } | { kind: 'move'; k: string; r: 0 | 1 };

/** 집 안 — 바닥을 눌러 걷고, 문 칸으로 나가면 마을로 돌아간다. 주민을 조작하면 '꾸미기'로 가구를 놓는다.
 *  실내 위치는 저장하지 않는다(화면에만). 가구 변경은 서버 트랜잭션(house.*)으로만 한다. */
export function HouseInterior({ era, placeName, house, avatar, actorName, residents, canDecorate, inv, busy, onExit, act }: {
  era: VillageEra; placeName: string; house: HouseView; avatar: PixelAvatarData | null | undefined; actorName: string | null;
  residents: string[]; canDecorate: boolean; inv: Record<string, number>; busy: boolean;
  onExit: () => void; act: (action: Record<string, unknown>) => Promise<boolean>;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const L = houseLayout(house.level);
  const look = (id: string) => furnitureOf(era, id);
  const [mode, setMode] = useState<Mode>({ kind: 'walk' });
  const [decor, setDecor] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [msg, setMsg] = useState('');
  const me = useRef({ x: L.door.x, y: L.door.y, path: [] as { x: number; y: number }[], exitAfter: false, dir: 1 as 1 | -1 });
  const bg = useMemo(() => roomArt(era, house.level, house.floor, house.wall), [era, house.level, house.floor, house.wall]);
  const latest = useRef({ house, mode, hover, decor, avatar });
  latest.current = { house, mode, hover, decor, avatar };
  // 문으로 나가는 콜백은 부모가 매번 새로 넘겨도 그리기 루프를 다시 시작하지 않게 ref로 쓴다
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  const score = houseScore(era, house.items);
  // 집이 넓어지면(가구가 한 칸씩 옮겨 간다) 캐릭터도 문 앞에서 다시 시작
  useEffect(() => { me.current = { ...me.current, x: L.door.x, y: L.door.y, path: [] }; }, [house.level]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cv = cvs.current!, box = wrap.current!, ctx = cv.getContext('2d')!;
    let raf = 0, last = performance.now(), stepAcc = 0;
    const draw = (now: number) => {
      const dt = Math.min(100, now - last); last = now;
      const { house: h, mode: md, hover: hv, decor: dc, avatar: av } = latest.current;
      const art = bg;
      const w = box.clientWidth;
      const s = Math.max(1, Math.min(4, w / art.width >= 2 ? Math.floor(w / art.width) : w / art.width));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(art.width * s), H = Math.round(art.height * s);
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
      ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, art.width, art.height);
      ctx.drawImage(art, 0, 0);
      // 걷기: 한 칸 160ms
      const m = me.current;
      stepAcc += dt;
      while (stepAcc > 160 && m.path.length) {
        stepAcc -= 160;
        const n = m.path.shift()!;
        if (n.x !== m.x) m.dir = n.x < m.x ? -1 : 1;
        m.x = n.x; m.y = n.y;
        if (!m.path.length && m.exitAfter) { m.exitAfter = false; onExitRef.current(); }
      }
      if (!m.path.length) stepAcc = 0;
      // 꾸미기: 격자와 문·문 앞 표시
      if (dc) {
        ctx.fillStyle = 'rgba(255,255,255,.10)';
        for (let y = 1; y < L.h; y++) for (let x = 0; x < L.w; x++) if ((x + y) % 2) ctx.fillRect(SIDE + x * TILE, WALL_TOP + y * TILE, TILE, TILE);
        ctx.fillStyle = 'rgba(255,90,90,.18)';
        for (const c of [L.door, L.front]) ctx.fillRect(SIDE + c.x * TILE, WALL_TOP + c.y * TILE, TILE, TILE);
      }
      type D = { row: number; draw: () => void };
      const list: D[] = [];
      for (const it of h.items) {
        const spec = look(it.item); if (!spec) continue;
        const img = furnitureArt(era, spec, it.r);
        const [, fh] = footprint(spec, it.r);
        const hidden = md.kind === 'move' && md.k === it.k;
        list.push({
          row: spec.walk ? it.y - 0.5 : it.y + fh - 1, draw: () => {
            ctx.globalAlpha = hidden ? 0.35 : 1;
            ctx.drawImage(img, SIDE + it.x * TILE, WALL_TOP + (it.y + fh) * TILE - img.height);
            ctx.globalAlpha = 1;
            if (md.kind === 'pick' && md.k === it.k) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1; ctx.strokeRect(SIDE + it.x * TILE + 0.5, WALL_TOP + it.y * TILE + 0.5, img.width - 1, fh * TILE - 1); }
          },
        });
      }
      if (av !== undefined) {
        const spr = avatarSprite(av ?? null, 32 * Math.max(1, Math.round(s * dpr)));
        list.push({
          row: m.y + 0.1, draw: () => {
            const bob = m.path.length ? Math.abs(Math.sin(now / 90)) * 1.5 : 0;
            ctx.save();
            ctx.translate(SIDE + m.x * TILE + TILE / 2, WALL_TOP + (m.y + 1) * TILE - 31 - bob);
            if (m.dir < 0) ctx.scale(-1, 1);
            ctx.drawImage(spr, -16, 0, 32, 32);
            ctx.restore();
          },
        });
      }
      list.sort((a, b) => a.row - b.row).forEach(d => d.draw());
      // 놓을 자리 미리보기(초록 = 놓을 수 있음, 빨강 = 규칙 위반)
      if (hv && (md.kind === 'place' || md.kind === 'move')) {
        const item = md.kind === 'place' ? md.item : h.items.find(i => i.k === md.k)?.item;
        const spec = item ? look(item) : undefined;
        if (spec) {
          const [fw, fh] = footprint(spec, md.r);
          const others = md.kind === 'move' ? h.items.filter(i => i.k !== md.k) : h.items;
          const ok = !validateHouse(h.level, [...others, { k: '~', item: spec.id, x: hv.x, y: hv.y, r: md.r, by: '' }], look);
          ctx.globalAlpha = 0.7;
          const img = furnitureArt(era, spec, md.r);
          ctx.drawImage(img, SIDE + hv.x * TILE, WALL_TOP + (hv.y + fh) * TILE - img.height);
          ctx.globalAlpha = 1;
          ctx.fillStyle = ok ? 'rgba(80,220,120,.28)' : 'rgba(255,80,80,.35)';
          ctx.fillRect(SIDE + hv.x * TILE, WALL_TOP + hv.y * TILE, fw * TILE, fh * TILE);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [bg, era, L.w, L.h, L.door, L.front]); // eslint-disable-line react-hooks/exhaustive-deps

  const cellAt = (e: React.PointerEvent) => {
    const r = cvs.current!.getBoundingClientRect();
    const s = r.width / bg.width;
    const x = Math.floor(((e.clientX - r.left) / s - SIDE) / TILE), y = Math.floor(((e.clientY - r.top) / s - WALL_TOP) / TILE);
    return { x, y };
  };
  const walkTo = (x: number, y: number, exitAfter: boolean) => {
    const { block, w } = occupancy(house.level, house.items, look);
    const m = me.current;
    const start = m.y * w + m.x, goal = y * w + x;
    if (block[goal]) { setMsg('가구가 있어 갈 수 없어요'); return; }
    const prev = new Map<number, number>([[start, start]]);
    const q = [start];
    for (let i = 0; i < q.length && !prev.has(goal); i++) {
      const cx = q[i] % w, cy = Math.floor(q[i] / w);
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || nx >= w || ny < 1 || ny >= L.h) continue;
        const k = ny * w + nx;
        if (prev.has(k) || block[k]) continue;
        prev.set(k, q[i]); q.push(k);
      }
    }
    if (!prev.has(goal)) { setMsg('거기까지 가는 길이 막혀 있어요'); return; }
    const path: { x: number; y: number }[] = [];
    for (let k = goal; k !== start; k = prev.get(k)!) path.unshift({ x: k % w, y: Math.floor(k / w) });
    m.path = path; m.exitAfter = exitAfter;
    if (!path.length && exitAfter) onExit();
  };
  const ownerOf = (x: number, y: number) => {
    const { owner, w } = occupancy(house.level, house.items, look);
    return x >= 0 && y >= 0 && x < L.w && y < L.h ? owner[y * w + x] : null;
  };
  const tap = async (e: React.PointerEvent) => {
    const { x, y } = cellAt(e);
    setMsg('');
    // 문 칸(또는 그 아래 문턱)을 누르면 문까지 걸어가 밖으로 나간다
    if ((x === L.door.x && y >= L.door.y) && mode.kind === 'walk') { walkTo(L.door.x, L.door.y, true); return; }
    if (x < 0 || y < 1 || x >= L.w || y >= L.h) return;
    if (mode.kind === 'place') {
      const problem = validateHouse(house.level, [...house.items, { k: '~', item: mode.item, x, y, r: mode.r, by: '' }], look);
      if (problem) { setMsg(problem); return; }
      if (await act({ type: 'house.place', item: mode.item, x, y, r: mode.r }) && (inv[mode.item] ?? 0) <= 1) setMode({ kind: 'walk' });
      return;
    }
    if (mode.kind === 'move') {
      const it = house.items.find(i => i.k === mode.k);
      if (!it) { setMode({ kind: 'walk' }); return; }
      const problem = validateHouse(house.level, [...house.items.filter(i => i.k !== mode.k), { ...it, x, y, r: mode.r }], look);
      if (problem) { setMsg(problem); return; }
      if (await act({ type: 'house.place', k: mode.k, x, y, r: mode.r })) setMode({ kind: 'pick', k: mode.k });
      return;
    }
    const k = ownerOf(x, y);
    if (decor && k) { setMode({ kind: 'pick', k }); return; }
    if (mode.kind === 'pick') { setMode({ kind: 'walk' }); if (decor) return; }
    if (avatar !== undefined) walkTo(x, y, false);
  };
  const picked = mode.kind === 'pick' ? house.items.find(i => i.k === mode.k) : undefined;
  const pickedSpec = picked ? look(picked.item) : undefined;
  const bagFurniture = FURNITURE_CATALOG[era].filter(f => (inv[f.id] ?? 0) > 0);
  const ownStyle = (kind: 'floor' | 'wall') => STYLE_CATALOG[era].filter(s => s.kind === kind && (s.price === 0 || (inv[s.id] ?? 0) > 0));
  return (
    <div className="village-interior">
      <div className="village-interior-head">
        <b>🏠 {placeName}</b>
        <span className="village-badge">{house.level}단계 · {L.w}×{L.h}칸</span>
        <span className="village-badge" title={`집 점수 ${score} (놓인 가구 가격 합 ÷ 10)`}>아늑함 {stars(cozyStars(score))}</span>
        <span style={{ flex: 1 }} />
        {canDecorate && <button className={`btn ${decor ? 'btn-dark' : 'btn-ghost'}`} aria-pressed={decor} onClick={() => { setDecor(d => !d); setMode({ kind: 'walk' }); }}>🛠 꾸미기</button>}
        <button className="btn btn-ghost" onClick={onExit}>🚪 밖으로</button>
      </div>
      <small className="village-muted">{residents.length ? `주민: ${residents.join(', ')}` : '아직 주민이 없는 집이에요.'}{actorName ? ` · 바닥을 누르면 ${josa(actorName, '이/가')} 걸어가요. 문을 누르면 밖으로 나가요.` : ''}</small>
      <div ref={wrap} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
        <canvas ref={cvs} style={{ touchAction: 'manipulation', cursor: 'pointer', borderRadius: 10, maxWidth: '100%' }}
          role="img" aria-label={`${placeName} 안 — ${house.items.length}개의 가구`}
          onPointerMove={e => { if (mode.kind === 'place' || mode.kind === 'move') setHover(cellAt(e)); }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={e => { void tap(e); }} />
      </div>
      {msg && <p role="alert" className="village-muted" style={{ margin: 0, color: 'var(--accent)' }}>{msg}</p>}
      {decor && (
        <div className="village-decor">
          {mode.kind === 'place' && <span>놓을 칸을 누르세요 — <button className="btn btn-ghost" onClick={() => setMode({ ...mode, r: mode.r ? 0 : 1 })}>↻ 돌리기</button> <button className="btn btn-ghost" onClick={() => setMode({ kind: 'walk' })}>취소</button></span>}
          {mode.kind === 'move' && <span>옮길 칸을 누르세요 — <button className="btn btn-ghost" onClick={() => setMode({ ...mode, r: mode.r ? 0 : 1 })}>↻ 돌리기</button> <button className="btn btn-ghost" onClick={() => setMode({ kind: 'pick', k: mode.k })}>취소</button></span>}
          {picked && pickedSpec && (
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <b>{pickedSpec.icon} {pickedSpec.label}</b>
              <button className="btn btn-ghost" disabled={busy} onClick={async () => {
                const r = (picked.r ? 0 : 1) as 0 | 1;
                const problem = validateHouse(house.level, house.items.map(i => (i.k === picked.k ? { ...i, r } : i)), look);
                if (problem) { setMsg(`돌릴 수 없어요 — ${problem}`); return; }
                await act({ type: 'house.place', k: picked.k, x: picked.x, y: picked.y, r });
              }}>↻ 돌리기</button>
              <button className="btn btn-ghost" onClick={() => setMode({ kind: 'move', k: picked.k, r: picked.r })}>✥ 옮기기</button>
              <button className="btn btn-ghost" disabled={busy} onClick={async () => { if (await act({ type: 'house.remove', k: picked.k })) setMode({ kind: 'walk' }); }}>👜 가방으로</button>
            </span>
          )}
          <div>
            <b style={{ fontSize: 13 }}>가방의 가구</b>
            {!bagFurniture.length ? <p className="village-muted" style={{ margin: '4px 0 0' }}>가방에 가구가 없어요 — 상점에서 사 오세요.</p> : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {bagFurniture.map(f => (
                  <button key={f.id} className={`village-chip${mode.kind === 'place' && mode.item === f.id ? ' on' : ''}`} onClick={() => setMode({ kind: 'place', item: f.id, r: 0 })}>
                    {f.icon} {f.label} ×{inv[f.id]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['floor', 'wall'] as const).map(kind => (
              <label key={kind} style={{ display: 'grid', gap: 2, fontSize: 13 }}>{kind === 'floor' ? '바닥재' : '벽지'}
                <select value={kind === 'floor' ? house.floor : house.wall} disabled={busy} onChange={e => void act({ type: 'house.style', style: e.target.value })}>
                  {ownStyle(kind).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
