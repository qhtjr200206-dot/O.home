'use client';
// 마을 게임 화면 — 캔버스 맵, 시간대별 자율 행동, 조작(이동·선물·메시지·미니게임), 방 관리.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateVillageMap, type VillageMap } from '@/lib/village/map';
import { simulate, phaseAt, PHASE_LABEL, type ActorFrame, type WakeMark } from '@/lib/village/sim';
import { ERAS, GIFTS, MINIGAMES, LIMITS, josa, type ActorOverride, type RoomEvent, type RoomView, type MinigameId } from '@/lib/village/types';
import { villageApi, roomToken, VillageApiError } from '@/lib/village/client';
import { avatarSprite, buildScene, npcAvatar, DARKNESS, PHASE_TINT, SPRITE_WORLD, TILE } from './render';
import { PixelAvatar } from '@/components/chars/PixelAvatar';
import type { PixelAvatarData } from '@/components/chars/PixelAvatar';
import { CatchGame, MemoryGame, type FlipResult } from './Minigames';

const DEFAULT_LOOK: PixelAvatarData = { hair: 0, face: 7, body: 0, hairColor: '#4a4550', skinColor: '#e9c4a8', bodyColor: '#8a8f99' };
type State = { room: RoomView; overrides: ActorOverride[]; events: RoomEvent[]; scores: { actor: string; game: string; best: number }[]; wakes?: WakeMark[]; serverTime: number };
type Panel = null | 'gift' | 'message' | 'game' | 'manage';

const kst = (t: number) => {
  const d = new Date(t + 9 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

export function VillageGame({ roomId, loggedIn, isAdmin, onLeave, onNeedPassword }: {
  roomId: string; loggedIn: boolean; isAdmin: boolean; onLeave: () => void; onNeedPassword: (msg: string) => void;
}) {
  const [st, setSt] = useState<State | null>(null);
  const [controls, setControls] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState('');
  const [clock, setClock] = useState(Date.now());
  const offset = useRef(0);
  // 개발 서버 전용 시간 이동(?vt=13:30) — 낮·저녁 장면을 시험하기 위함. 운영 빌드에서는 사라진다.
  const devShift = useRef(0);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const m = /^(\d{1,2}):(\d{2})$/.exec(new URLSearchParams(window.location.search).get('vt') ?? '');
    if (!m) return;
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const want = Number(m[1]) * 60 + Number(m[2]), cur = now.getUTCHours() * 60 + now.getUTCMinutes();
    devShift.current = (want - cur) * 60_000;
  }, []);
  const lastAt = useRef(0);
  const token = roomToken.get(roomId) ?? '';

  const fail = useCallback((e: unknown) => {
    if (e instanceof VillageApiError && e.status === 401) { roomToken.clear(roomId); onNeedPassword(e.message); return; }
    setToast((e as Error).message);
  }, [roomId, onNeedPassword]);
  // 부모가 콜백을 매번 새로 넘겨도 조작 목록을 다시 불러오지 않도록 최신 fail을 ref로 쓴다
  const failRef = useRef(fail);
  useEffect(() => { failRef.current = fail; }, [fail]);

  // 처음 불러오기 + 3초 폴링(탭이 숨겨지면 쉰다)
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async (first: boolean) => {
      try {
        const r = await villageApi<State>('state', { roomId, token, since: first ? 0 : lastAt.current });
        if (!alive) return;
        offset.current = r.serverTime - Date.now() + devShift.current;
        if (r.events.length) lastAt.current = Math.max(lastAt.current, ...r.events.map(e => e.at));
        setSt(prev => {
          if (first || !prev) return r;
          const seen = new Set(prev.events.map(e => e.id));
          return { ...r, events: [...prev.events, ...r.events.filter(e => !seen.has(e.id))].slice(-120) };
        });
      } catch (e) { if (alive) failRef.current(e); }
      if (alive) timer = setTimeout(() => load(false), document.hidden ? 10_000 : 3_000);
    };
    void load(true);
    return () => { alive = false; clearTimeout(timer); };
  }, [roomId, token]);   // fail은 ref로 — 부모 재렌더마다 폴링이 처음부터 다시 시작되지 않게
  useEffect(() => {
    if (!loggedIn) { setControls([]); return; }
    villageApi<{ actors: string[] }>('controls', { roomId, token }).then(r => {
      setControls(r.actors);
      // 조작할 캐릭터가 있으면 처음부터 하나를 골라 둔다 — 좁은 화면에서는 '내 캐릭터' 칩이 지도 아래에 있어
      // 고르는 곳을 못 찾고 "선택이 안 된다"고 느꼈다 (v2.0 사용자 제보). NPC보다 캐릭터를 먼저 고른다.
      const first = r.actors.find(id => !id.startsWith('npc:')) ?? r.actors[0];
      if (first) { setSelected(cur => cur ?? first); setFocus(cur => cur ?? first); }
    }).catch(e => { setControls([]); failRef.current(e); });   // 실패를 조용히 삼키면 '조작할 캐릭터 없음'으로만 보인다
  }, [roomId, token, loggedIn]);
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 15_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  const room = st?.room;
  const placesKey = JSON.stringify(room?.places ?? []);
  const map = useMemo<VillageMap | null>(() => room ? generateVillageMap(room.seed, room.era, JSON.parse(placesKey)) : null, [room?.seed, room?.era, placesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const era = ERAS.find(e => e.id === room?.era) ?? ERAS[1];
  const channel = era.id === 'modern' ? '메시지' : era.channel;
  const nameOf = useCallback((id?: string) => room?.actors.find(a => a.id === id)?.name ?? '?', [room]);

  // 내 행동은 다음 폴링을 기다리지 않고 바로 반영
  const refresh = useCallback(async () => {
    const r = await villageApi<State>('state', { roomId, token, since: lastAt.current });
    if (r.events.length) lastAt.current = Math.max(lastAt.current, ...r.events.map(e => e.at));
    setSt(prev => prev ? { ...r, events: [...prev.events, ...r.events.filter(e => !prev.events.some(p => p.id === e.id))].slice(-120) } : r);
  }, [roomId, token]);
  const send = useCallback(async (action: Record<string, unknown>, okMsg?: string) => {
    try {
      await villageApi('act', { roomId, token, action });
      if (okMsg) setToast(okMsg);
      await refresh();
      return true;
    } catch (e) { fail(e); return false; }
  }, [roomId, token, fail, refresh]);

  if (!st || !room || !map) return <div className="village-card">마을을 불러오는 중…</div>;
  const sel = room.actors.find(a => a.id === selected) ?? null;
  const focused = room.actors.find(a => a.id === (focus ?? selected)) ?? null;
  const shifted = devShift.current ? st.overrides.map(o => ({ ...o, at: o.at + devShift.current })) : st.overrides;
  const wakes = devShift.current ? (st.wakes ?? []).map(w => ({ ...w, at: w.at + devShift.current })) : (st.wakes ?? []);
  const t = clock + offset.current;
  const phase = phaseAt(t);
  // 캐릭터 고르기 (v2.0 사용자 제보 — "마을에서 캐릭터 선택 불가"). 예전에는 조작할 캐릭터를 사이드 패널의
  // '내 캐릭터' 칩으로만 고를 수 있었고, 지도·'마을 사람들' 목록에서 캐릭터를 눌러도 초상만 바뀌었다.
  // 좁은 화면에선 그 칩이 지도 아래로 밀려 있어 "눌러도 안 골라진다"가 됐다. 이제 어디서 누르든
  // 내가 조작할 수 있는 캐릭터면 바로 조작 대상으로 고르고, 아니면 살펴보기(깨우기·선물 대상)로 연다.
  const pickActor = (id: string) => {
    setFocus(id);
    if (controls.includes(id)) { setSelected(id); return; }
    if (loggedIn && !controls.length) setToast('이 캐릭터를 조작할 권한이 없어요 — 살펴보기만 할 수 있습니다');
  };
  const focusFrame = focused ? simulate(map, room.seed, room.actors, shifted, t, wakes).find(f => f.id === focused.id) : undefined;
  // 깨우는 쪽: 고른 내 캐릭터, 없으면 내가 조작할 수 있는 첫 캐릭터(서버가 같은 권한을 다시 확인한다)
  const waker = sel?.id ?? controls[0] ?? null;
  const wake = (to: string) => {
    if (!waker) { setToast(loggedIn ? '깨우려면 조작할 수 있는 캐릭터가 있어야 해요' : '로그인하면 깨울 수 있어요'); return; }
    void send({ type: 'wake', actor: waker, to }, waker === to ? `${josa(nameOf(to), '이/가')} 일어났어요` : `${josa(nameOf(waker), '이/가')} ${josa(nameOf(to), '을/를')} 깨웠어요`);
  };

  return (
    <div className="village-layout">
      <div className="village-stage">
        <div className="village-topbar">
          <b style={{ fontSize: 16 }}>{room.name}</b>
          <span className="village-badge">{era.label}</span>
          <span className="village-badge" title="한국 시각 기준 시간대">🕒 {kst(t)} · {PHASE_LABEL[phase]}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onLeave}>나가기</button>
        </div>
        <VillageCanvas map={map} room={room} overrides={shifted} wakes={wakes} offset={offset} selected={selected} focus={focus}
          onTile={(x, y) => {
            if (!selected || !controls.includes(selected)) { setToast(controls.length ? '지도에서 내 캐릭터를 누르거나 “내 캐릭터”에서 먼저 고르세요' : '이 방에 조작할 수 있는 캐릭터가 없어요'); return; }
            // 서버가 허용한 위치만 반영한다. 거절된 이동은 화면에 나타나지 않는다.
            void send({ type: 'move', actor: selected, x, y });
          }}
          onActor={pickActor} />
        {toast && <div role="status" className="village-toast">{toast}</div>}
        {room.worldview && <details className="village-card" style={{ marginTop: 8 }}><summary>세계관</summary><p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{room.worldview}</p></details>}
      </div>

      <aside className="village-side">
        <section className="village-card">
          <h3>내 캐릭터</h3>
          {!loggedIn && <p className="village-muted">로그인하면 권한 있는 캐릭터를 조작할 수 있어요. 지금은 구경 중입니다.</p>}
          {loggedIn && !controls.length && <p className="village-muted">이 방에 내가 조작할 수 있는 캐릭터가 없습니다. (캐릭터 작성자·권한을 받은 회원·관리자만 조작)</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {controls.map(id => (
              <button key={id} className={`village-chip${selected === id ? ' on' : ''}`} aria-pressed={selected === id}
                onClick={() => {
                  const on = selected !== id;
                  setSelected(on ? id : null); setFocus(id);
                  // 좁은 화면에서는 패널이 지도 아래에 있으므로, 고른 뒤 바로 지도를 누를 수 있게 지도로 올린다
                  if (on && window.matchMedia('(max-width: 900px)').matches) document.querySelector('.village-stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}>
                {selected === id ? '🎮 ' : ''}{nameOf(id)}
              </button>
            ))}
          </div>
          {sel && (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <small className="village-muted">맵을 누르면 {josa(sel.name, '이/가')} 그곳으로 걸어갑니다. 5분 동안 조작하지 않으면 설정대로 다시 혼자 움직여요.</small>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-dark" onClick={() => setPanel('gift')}>🎁 선물</button>
                <button className="btn btn-dark" onClick={() => setPanel('message')}>{era.id === 'sf' ? '📡' : era.id === 'past' ? '✉️' : '📱'} {channel}</button>
                <button className="btn btn-dark" onClick={() => setPanel('game')}>🎲 미니게임</button>
                <button className="btn btn-ghost" onClick={() => { void send({ type: 'release', actor: sel.id }, `${josa(sel.name, '이/가')} 다시 혼자 움직입니다`); setSt(p => p ? { ...p, overrides: p.overrides.filter(o => o.id !== sel.id) } : p); }}>자율로 돌려보내기</button>
              </div>
            </div>
          )}
        </section>

        {panel && sel && (
          <section className="village-card">
            <div style={{ display: 'flex', alignItems: 'center' }}><h3 style={{ flex: 1 }}>{panel === 'gift' ? '선물하기' : panel === 'message' ? `${channel} 보내기` : panel === 'game' ? '미니게임' : ''}</h3><button className="btn btn-ghost" onClick={() => setPanel(null)} aria-label="닫기">✕</button></div>
            {panel === 'gift' && <GiftPanel room={room} from={sel.id} onSend={(to, item) => send({ type: 'gift', actor: sel.id, to, item }, '선물을 건넸어요').then(ok => ok && setPanel(null))} />}
            {panel === 'message' && <MessagePanel room={room} from={sel.id} events={st.events} onSend={(to, text) => send({ type: 'message', actor: sel.id, to, text }, `${josa(channel, '을/를')} 보냈어요`)} />}
            {panel === 'game' && <GamePanel room={room} actor={sel.id} scores={st.scores}
              start={async game => { try { return await villageApi<{ gameId: string; seed?: string }>('act', { roomId, token, action: { type: 'gameStart', actor: sel.id, game } }); } catch (e) { fail(e); return null; } }}
              flip={async (gameId, card) => {
                try { return await villageApi<FlipResult>('act', { roomId, token, action: { type: 'gameFlip', actor: sel.id, gameId, card } }); }
                catch (e) { fail(e); return null; }
              }}
              onMemoryDone={score => { setToast(`${score}점 기록!`); void refresh(); }}
              submit={async (game, gameId, input) => {
                try {
                  const r = await villageApi<{ score: number }>('act', { roomId, token, action: { type: 'game', actor: sel.id, game, gameId, input } });
                  setToast(`${r.score}점 기록!`);
                  await refresh();
                } catch (e) { fail(e); }
              }} />}
          </section>
        )}

        {focused && (
          <section className="village-card village-portrait" aria-label={`${focused.name} 살펴보기`}>
            <PixelAvatar value={focused.avatar ?? (focused.kind === 'npc' ? npcAvatar(focused.id, focused.name) : DEFAULT_LOOK)} size={128} />
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>{focused.name}</h3>
              <small className="village-muted">{focused.kind === 'npc' ? `NPC${focused.role ? ` · ${focused.role}` : ''}` : focused.avatar ? '캐릭터 프로필 도트' : '도트 비공개 캐릭터'}</small>
              {focused.lines.length > 0 && <p className="village-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>“{focused.lines[0]}”</p>}
              {focusFrame?.sleeping && (
                <button className="btn btn-dark" style={{ marginTop: 8 }} onClick={() => wake(focused.id)} disabled={!waker}
                  title={waker ? undefined : '조작할 수 있는 캐릭터가 있어야 깨울 수 있어요'}>
                  ⏰ {waker === focused.id ? '일어나기' : `${focused.name} 깨우기`}
                </button>
              )}
            </div>
          </section>
        )}

        <section className="village-card">
          <h3>마을 사람들</h3>
          <ActorList room={room} map={map} overrides={shifted} wakes={wakes} offset={offset.current} focus={focus} selected={selected} onFocus={pickActor} onWake={waker ? wake : null} />
        </section>

        <section className="village-card">
          <h3>마을 소식</h3>
          <Feed room={room} events={st.events} />
        </section>

        {(room.isOwner || isAdmin) && (
          <section className="village-card">
            <h3>방 관리</h3>
            <ManagePanel roomId={roomId} isAdmin={isAdmin} onDeleted={onLeave} onToken={tok => { roomToken.set(roomId, tok); setToast('비밀번호를 바꿨어요 — 다른 사람은 새 비밀번호로 다시 들어와야 합니다'); }} />
          </section>
        )}
      </aside>
    </div>
  );
}

/* ---------------- 캔버스 ---------------- */
function VillageCanvas({ map, room, overrides, wakes, offset, selected, focus, onTile, onActor }: {
  map: VillageMap; room: RoomView; overrides: ActorOverride[]; wakes: WakeMark[]; offset: React.RefObject<number>;
  selected: string | null; focus: string | null; onTile: (x: number, y: number) => void; onActor: (id: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ x: map.width * TILE / 2, y: map.height * TILE / 2, scale: 2, follow: true });
  const [, force] = useState(0);
  const scene = useMemo(() => buildScene(map, room.seed), [map, room.seed]);
  // 폴링마다 room 객체가 새로 와도 외형이 같으면 다시 만들지 않는다(원본 캐릭터 도트가 바뀌면 바로 반영)
  const lookKey = JSON.stringify(room.actors.map(a => [a.id, a.name, a.avatar]));
  const sprites = useMemo(() => new Map<string, PixelAvatarData | null>(room.actors.map(a => [a.id, a.avatar ?? (a.kind === 'npc' ? npcAvatar(a.id, a.name) : null)])), [lookKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useRef({ overrides, wakes, selected, focus, room, sprites });
  latest.current = { overrides, wakes, selected, focus, room, sprites };
  const frames = useRef<ActorFrame[]>([]);
  // 화면에 실제로 그려진 위치(걷는 중 보간된 위치) — 누르기 판정은 목적지가 아니라 보이는 자리로 한다
  const drawn = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    const cv = cvs.current!, box = wrap.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    const rp = drawn.current;
    // 어둠 층을 따로 그려 불빛 자리만 도려내는 데 쓰는 화면 밖 캔버스
    const dark = document.createElement('canvas');
    const dctx = dark.getContext('2d')!;
    const spriteMemo = new Map<string, { av: PixelAvatarData | null; px: number; img: HTMLCanvasElement }>();
    let initialized = false;
    const fit = () => {
      const w = box.clientWidth, h = Math.min(Math.max(300, window.innerHeight * 0.62), w * 0.8);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!initialized && w > 0 && h > 0) {
        const fitScale = Math.min(w / (map.width * TILE), h / (map.height * TILE));
        cam.current.scale = Math.max(fitScale, w < 600 ? 1.6 : fitScale);
        initialized = true;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    let lastT = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(100, now - lastT); lastT = now;
      const t = Date.now() + (offset.current ?? 0);
      const { overrides: ov, wakes: wk, selected: sel, focus: fo, room, sprites } = latest.current;
      const fr = simulate(map, room.seed, room.actors, ov, t, wk);
      frames.current = fr;
      const W = cv.clientWidth, H = cv.clientHeight, c = cam.current, s = c.scale;
      // 카메라: 조작/선택한 캐릭터를 따라간다
      const target = fr.find(f => f.id === (sel ?? fo));
      if (c.follow && target) {
        const p = rp.get(target.id) ?? target;
        c.x += ((p.x + 0.5) * TILE - c.x) * Math.min(1, dt / 250);
        c.y += ((p.y + 0.5) * TILE - c.y) * Math.min(1, dt / 250);
      }
      const halfW = W / 2 / s, halfH = H / 2 / s;
      c.x = Math.max(Math.min(halfW, map.width * TILE / 2), Math.min(map.width * TILE - Math.min(halfW, map.width * TILE / 2), c.x));
      c.y = Math.max(Math.min(halfH, map.height * TILE / 2), Math.min(map.height * TILE - Math.min(halfH, map.height * TILE / 2), c.y));
      const ox = W / 2 - c.x * s, oy = H / 2 - c.y * s;
      ctx.fillStyle = '#1b1e26'; ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
      // 지면 — 두 장을 0.7초마다 번갈아 그려 물결·유도선이 반짝인다. 화면 원점을 기기 픽셀에 맞춰
      // 배율이 정수가 아니어도 칸 경계가 흔들리지 않게 한다
      const dpr = cv.width / Math.max(1, W);
      const snap = (v: number) => Math.round(v * dpr) / dpr;
      const gx = snap(ox), gy = snap(oy);
      const ground = scene.ground[Math.floor(now / 700) % 2];
      ctx.drawImage(ground, gx, gy, ground.width * s, ground.height * s);
      const phase = phaseAt(t);
      const list = fr.map(f => {
        const cur = rp.get(f.id);
        if (!cur || Math.hypot(cur.x - f.x, cur.y - f.y) > 6) rp.set(f.id, { x: f.x, y: f.y });
        else {
          const d = Math.hypot(f.x - cur.x, f.y - cur.y), step = dt / 220;
          if (d <= step) { cur.x = f.x; cur.y = f.y; } else { cur.x += (f.x - cur.x) / d * step; cur.y += (f.y - cur.y) / d * step; }
        }
        const p = rp.get(f.id)!;
        const walking = f.moving || Math.hypot(p.x - f.x, p.y - f.y) > 0.05;
        return { f, p, walking };
      });
      // 건물·나무·가로등과 캐릭터를 바닥선(y) 순으로 함께 그린다 — 건물 뒤를 지나가면 가려진다
      type Item = { y: number; prop?: (typeof scene.props)[number]; actor?: (typeof list)[number] };
      const items: Item[] = [...scene.props.map(prop => ({ y: prop.sortY, prop })), ...list.map(actor => ({ y: actor.p.y, actor }))].sort((a, b) => a.y - b.y);
      for (const it of items) {
        if (it.prop) {
          const pr = it.prop;
          ctx.drawImage(pr.img, snap(gx + pr.x * s), snap(gy + pr.y * s), pr.img.width * s, pr.img.height * s);
          continue;
        }
        const { f, p, walking } = it.actor!;
        const sx = ox + (p.x + 0.5) * TILE * s, sy = oy + (p.y + 1) * TILE * s;
        const size = SPRITE_WORLD * s;
        const bob = walking ? Math.abs(Math.sin(now / 110)) * 2.2 * s * 0.5 : f.sleeping ? 0 : Math.sin(now / 600 + p.x) * 0.6;
        ctx.fillStyle = 'rgba(10,12,30,.28)';
        ctx.beginPath(); ctx.ellipse(sx, sy - 2, size * 0.24, size * 0.07, 0, 0, Math.PI * 2); ctx.fill();
        if (f.id === sel || f.id === fo) {
          ctx.strokeStyle = f.id === sel ? '#ffd166' : '#ffffff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(sx, sy - 2, size * 0.32, size * 0.1, 0, 0, Math.PI * 2); ctx.stroke();
        }
        // 32칸 원본 도트를 정수 배율로 키운 스프라이트를 1:1로 그린다(선명한 도트)
        const av = sprites.get(f.id) ?? null;
        const devPx = Math.round(size * dpr);
        let memo = spriteMemo.get(f.id);
        if (!memo || memo.av !== av || memo.px !== devPx) { memo = { av, px: devPx, img: avatarSprite(av, devPx) }; spriteMemo.set(f.id, memo); }
        const img = memo.img;
        ctx.save();
        ctx.globalAlpha = f.sleeping ? 0.8 : 1;
        const w = img.width / dpr;
        ctx.translate(snap(sx), snap(sy - w * 0.95 - bob));
        if (f.dir < 0) ctx.scale(-1, 1);
        ctx.drawImage(img, snap(-w / 2), 0, w, w);
        ctx.restore();
      }
      // 시간대 색: 곱하기로 물들이고(아침 노랑·저녁 분홍·밤 파랑), 어둠 층은 불빛 자리만 도려낸다
      const tint = PHASE_TINT[phase];
      if (tint) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H); ctx.restore(); }
      const darkness = DARKNESS[phase];
      if (darkness) {
        if (dark.width !== cv.width || dark.height !== cv.height) { dark.width = cv.width; dark.height = cv.height; }
        dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        dctx.globalCompositeOperation = 'source-over';
        dctx.clearRect(0, 0, W, H);
        dctx.fillStyle = darkness; dctx.fillRect(0, 0, W, H);
        dctx.globalCompositeOperation = 'destination-out';
        const flicker = 0.94 + Math.sin(now / 240) * 0.03;
        for (const l of scene.lights) {
          const lx = gx + l.x * s, ly = gy + l.y * s, r = l.r * s * flicker;
          if (lx < -r || ly < -r || lx > W + r || ly > H + r) continue;
          const g = dctx.createRadialGradient(lx, ly, 0, lx, ly, r);
          g.addColorStop(0, 'rgba(0,0,0,.95)'); g.addColorStop(0.45, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          dctx.fillStyle = g; dctx.fillRect(lx - r, ly - r, r * 2, r * 2);
        }
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(dark, 0, 0); ctx.restore();
        // 불빛 색(더하기) — 창문·가로등 빛이 은은하게 번진다
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (const l of scene.lights) {
          const lx = gx + l.x * s, ly = gy + l.y * s, r = l.r * s * 0.7 * flicker;
          if (lx < -r || ly < -r || lx > W + r || ly > H + r) continue;
          const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
          g.addColorStop(0, `${l.color}.3)`); g.addColorStop(1, `${l.color}0)`);
          ctx.fillStyle = g; ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
        }
        ctx.restore();
      }
      // 글자(맨 위): 장소 이름, 캐릭터 이름·말풍선·상태
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.max(10, Math.min(13, 5.5 * s))}px system-ui, sans-serif`;
      for (const pl of map.places) {
        const lx = ox + (pl.x + 0.5) * TILE * s, ly = oy + (pl.y + 1.25) * TILE * s;
        const w = ctx.measureText(pl.name).width + 10;
        ctx.fillStyle = 'rgba(20,22,30,.72)'; roundRect(ctx, lx - w / 2, ly - 8, w, 16, 6); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(pl.name, lx, ly);
      }
      for (const { f, p, walking } of list) {
        const a = room.actors.find(x => x.id === f.id)!;
        const sx = ox + (p.x + 0.5) * TILE * s, sy = oy + (p.y + 1) * TILE * s;
        const size = SPRITE_WORLD * s;
        ctx.font = `600 ${Math.max(10, Math.min(12, 5 * s))}px system-ui, sans-serif`;
        const label = `${f.controlled ? '🎮' : ''}${a.name}`;
        const w = ctx.measureText(label).width + 8;
        ctx.fillStyle = a.kind === 'npc' ? 'rgba(70,70,80,.85)' : a.color; roundRect(ctx, sx - w / 2, sy + 2, w, 15, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(label, sx, sy + 9.5);
        const top = sy - size - 4;
        if (f.sleeping) { ctx.font = `700 ${12}px system-ui`; ctx.fillStyle = '#e8ecff'; ctx.fillText('Zz', sx + size * 0.3, top + 4 - Math.sin(now / 500) * 3); }
        else if (f.woke) { ctx.font = `800 ${15}px system-ui`; ctx.fillStyle = '#ffd166'; ctx.fillText('!', sx + size * 0.28, top + 2 - Math.abs(Math.sin(now / 150)) * 4); }
        else if (f.speech && !walking) bubble(ctx, sx, top, f.speech, '#fff', '#222');
        else if (f.partner && !walking) { ctx.font = '14px serif'; ctx.fillText(Math.floor(now / 1500) % 2 ? '💬' : '♪', sx + size * 0.32, top + 6); }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [map, scene, offset]);

  // 탭/클릭 = 이동 또는 캐릭터 선택, 끌기 = 화면 이동
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const toWorld = (clientX: number, clientY: number) => {
    const r = cvs.current!.getBoundingClientRect(), c = cam.current;
    return { wx: (clientX - r.left - r.width / 2) / c.scale + c.x, wy: (clientY - r.top - r.height / 2) / c.scale + c.y };
  };
  const zoom = (k: number) => { cam.current.scale = Math.max(0.8, Math.min(5, cam.current.scale * k)); force(n => n + 1); };
  const step = (dx: number, dy: number) => {
    const actor = frames.current.find(f => f.id === selected);
    if (!actor) { if (!selected) onTile(-1, -1); return; }
    const x = Math.round(actor.x) + dx, y = Math.round(actor.y) + dy;
    if (x >= 0 && y >= 0 && x < map.width && y < map.height) { onTile(x, y); cam.current.follow = true; }
  };
  return (
    <div ref={wrap} className="village-canvas-wrap">
      <canvas ref={cvs} role="group" tabIndex={0} aria-label="마을 지도. 캐릭터를 선택한 뒤 방향키를 한 번씩 눌러 한 칸씩 이동합니다. 마우스나 터치로 이동하거나 지도를 끌 수 있습니다."
        onKeyDown={e => {
          const directions: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
          const direction = directions[e.key];
          if (!direction) return;
          e.preventDefault();
          if (e.repeat) return;
          step(...direction);
        }}
        style={{ display: 'block', touchAction: 'none', borderRadius: 12, cursor: 'pointer' }}
        onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false }; try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 이미 끝난 포인터 — 끌기 없이 탭으로 처리 */ } }}
        onPointerMove={e => {
          const d = drag.current; if (!d) return;
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moved = true;
          if (d.moved) { cam.current.follow = false; cam.current.x = d.cx - (e.clientX - d.x) / cam.current.scale; cam.current.y = d.cy - (e.clientY - d.y) / cam.current.scale; }
        }}
        onPointerUp={e => {
          const d = drag.current; drag.current = null;
          if (!d || d.moved) return;
          const { wx, wy } = toWorld(e.clientX, e.clientY);
          // 캐릭터를 눌렀는지 먼저 본다
          // 보이는 자리(걷는 중 보간 위치)로 판정하고, 겹치면 앞(아래)에 있는 캐릭터를 고른다
          const hit = frames.current
            .map(f => ({ f, p: drawn.current.get(f.id) ?? f }))
            .filter(({ p }) => Math.abs((p.x + 0.5) * TILE - wx) < SPRITE_WORLD * 0.36 && wy < (p.y + 1) * TILE + 3 && wy > (p.y + 1) * TILE - SPRITE_WORLD * 0.95)
            .sort((a, b) => b.p.y - a.p.y)[0]?.f;
          if (hit && hit.id !== latest.current.selected) { onActor(hit.id); cam.current.follow = true; return; }
          const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
          if (tx >= 0 && ty >= 0 && tx < map.width && ty < map.height) { onTile(tx, ty); cam.current.follow = true; }
        }} />
      <div className="village-zoom">
        <button type="button" onClick={() => zoom(1.25)} aria-label="확대">＋</button>
        <button type="button" onClick={() => zoom(0.8)} aria-label="축소">－</button>
        <button type="button" onClick={() => { cam.current.follow = true; force(n => n + 1); }} aria-label="선택한 캐릭터 따라가기">◎</button>
      </div>
      {selected && <div role="group" aria-label="선택한 캐릭터 한 칸 이동" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <span style={{ alignSelf: 'center', padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,.92)', color: '#2b2733', fontWeight: 600 }}>한 칸 이동:</span>
        <button type="button" className="btn btn-ghost" aria-label="위로 한 칸" onClick={() => step(0, -1)}>↑</button>
        <button type="button" className="btn btn-ghost" aria-label="왼쪽으로 한 칸" onClick={() => step(-1, 0)}>←</button>
        <button type="button" className="btn btn-ghost" aria-label="아래로 한 칸" onClick={() => step(0, 1)}>↓</button>
        <button type="button" className="btn btn-ghost" aria-label="오른쪽으로 한 칸" onClick={() => step(1, 0)}>→</button>
      </div>}
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function bubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string) {
  ctx.font = '500 12px system-ui, sans-serif';
  const t = text.length > 28 ? text.slice(0, 27) + '…' : text;
  const w = Math.min(220, ctx.measureText(t).width + 14), h = 22;
  ctx.fillStyle = bg; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
  roundRect(ctx, x - w / 2, y - h - 6, w, h, 9); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 5, y - 6.5); ctx.lineTo(x, y); ctx.lineTo(x + 5, y - 6.5); ctx.fill();
  ctx.fillStyle = fg; ctx.fillText(t, x, y - h / 2 - 6);
}

/* ---------------- 패널들 ---------------- */
function ActorList({ room, map, overrides, wakes, offset, focus, selected, onFocus, onWake }: {
  room: RoomView; map: VillageMap; overrides: ActorOverride[]; wakes: WakeMark[]; offset: number; focus: string | null; selected: string | null;
  onFocus: (id: string) => void; onWake: ((id: string) => void) | null;
}) {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 5000); return () => clearInterval(i); }, []);
  const frames = simulate(map, room.seed, room.actors, overrides, t + offset, wakes);
  const placeName = (id: string) => map.places.find(p => p.id === id)?.name ?? '광장';
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
      {room.actors.map(a => {
        const f = frames.find(x => x.id === a.id)!;
        const status = f.controlled ? '조작 중' : f.sleeping ? `${placeName(f.place)}에서 자는 중` : f.moving ? `${josa(placeName(f.place), '으로/로')} 가는 중` : f.partner ? `${placeName(f.place)}에서 ${josa(room.actors.find(x => x.id === f.partner)?.name ?? '?', '와/과')} 어울리는 중` : `${placeName(f.place)}에 있음`;
        return (
          <li key={a.id}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button type="button" onClick={() => onFocus(a.id)} className={`village-row${focus === a.id || selected === a.id ? ' on' : ''}`} aria-pressed={selected === a.id}>
                <span style={{ width: 10, height: 10, borderRadius: 10, background: a.color, flexShrink: 0 }} />
                <b>{selected === a.id ? '🎮 ' : ''}{a.name}</b>{a.kind === 'npc' && <small className="village-muted"> NPC{a.role ? `·${a.role}` : ''}</small>}
                <small className="village-muted" style={{ marginLeft: 'auto', textAlign: 'right' }}>{status}</small>
              </button>
              {f.sleeping && onWake && <button type="button" className="village-chip" style={{ minHeight: 32, minWidth: 36, padding: '4px 8px', flexShrink: 0 }} onClick={() => onWake(a.id)} aria-label={`${a.name} 깨우기`} title={`${a.name} 깨우기`}>⏰</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Feed({ room, events }: { room: RoomView; events: RoomEvent[] }) {
  const name = (id?: string) => room.actors.find(a => a.id === id)?.name ?? '?';
  const era = ERAS.find(e => e.id === room.era)!;
  const gift = (id?: string) => GIFTS[room.era].find(g => g.id === id);
  const list = [...events].reverse().slice(0, 40);
  if (!list.length) return <p className="village-muted">아직 소식이 없어요. 선물이나 {josa(era.id === 'modern' ? '메시지' : era.channel, '을/를')} 보내 보세요.</p>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, maxHeight: 260, overflow: 'auto' }}>
      {list.map(e => (
        <li key={e.id} style={{ fontSize: 13 }}>
          <span className="village-muted">{kst(e.at)} </span>
          {e.type === 'gift' && <>🎁 <b>{name(e.from)}</b> → <b>{name(e.to)}</b>: {gift(e.item)?.icon} {gift(e.item)?.label}</>}
          {e.type === 'message' && <>{era.id === 'sf' ? '📡' : era.id === 'past' ? '✉️' : '📱'} <b>{josa(name(e.from), '이/가')}</b> <b>{name(e.to)}</b>에게 {era.verb}</>}
          {e.type === 'game' && <>🎲 <b>{name(e.from)}</b> — {MINIGAMES.find(g => g.id === e.game)?.label} {e.score}점</>}
          {e.type === 'wake' && (e.from === e.to ? <>⏰ <b>{josa(name(e.from), '이/가')}</b> 잠에서 깼어요</> : <>⏰ <b>{josa(name(e.from), '이/가')}</b> <b>{josa(name(e.to), '을/를')}</b> 깨웠어요</>)}
        </li>
      ))}
    </ul>
  );
}

function GiftPanel({ room, from, onSend }: { room: RoomView; from: string; onSend: (to: string, item: string) => void }) {
  const others = room.actors.filter(a => a.id !== from);
  const [to, setTo] = useState(others[0]?.id ?? '');
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label>받는 사람 <select value={to} onChange={e => setTo(e.target.value)}>{others.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 6 }}>
        {GIFTS[room.era].map(g => (
          <button key={g.id} type="button" className="village-gift" onClick={() => to && onSend(to, g.id)}><span style={{ fontSize: 26 }}>{g.icon}</span>{g.label}</button>
        ))}
      </div>
    </div>
  );
}

function MessagePanel({ room, from, events, onSend }: { room: RoomView; from: string; events: RoomEvent[]; onSend: (to: string, text: string) => Promise<boolean> }) {
  const others = room.actors.filter(a => a.id !== from);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const [text, setText] = useState('');
  const name = (id?: string) => room.actors.find(a => a.id === id)?.name ?? '?';
  const thread = events.filter(e => e.type === 'message' && ((e.from === from && e.to === to) || (e.from === to && e.to === from)));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (text.trim() && await onSend(to, text)) setText(''); };
  const style = room.era;
  return (
    <form onSubmit={submit} className={`village-msg village-msg-${style}`}>
      <label className="village-msg-to">{style === 'past' ? '받는 이' : style === 'sf' ? '채널' : '대화 상대'}
        <select value={to} onChange={e => setTo(e.target.value)}>{others.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      </label>
      <div className="village-msg-thread" aria-live="polite">
        {!thread.length && <p className="village-msg-empty">{style === 'past' ? '아직 주고받은 편지가 없습니다.' : style === 'sf' ? '...치직... 수신 기록 없음' : '대화를 시작해 보세요'}</p>}
        {thread.map(m => (
          <div key={m.id} className={`village-msg-item${m.from === from ? ' me' : ''}`}>
            {style === 'past' && <><div className="village-letter-head">{name(m.to)}에게</div><p>{m.text}</p><div className="village-letter-sign">— {name(m.from)} 씀 · {kst(m.at)}</div></>}
            {style === 'modern' && <><span className="village-phone-bubble">{m.text}</span><small>{kst(m.at)}</small></>}
            {style === 'sf' && <code>[{kst(m.at)}] {name(m.from)} ▶ {name(m.to)} :: {m.text}</code>}
          </div>
        ))}
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} maxLength={LIMITS.message} rows={style === 'past' ? 4 : 2}
        aria-label="보낼 내용" placeholder={style === 'past' ? '정성껏 편지를 적어 보세요' : style === 'sf' ? '송신할 메시지 입력...' : '메시지 입력'} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <small style={{ flex: 1 }}>{text.length}/{LIMITS.message} · 방 안의 모두가 볼 수 있어요</small>
        <button className="btn btn-dark" disabled={!text.trim()}>{style === 'past' ? '편지 부치기' : style === 'sf' ? '송신' : '보내기'}</button>
      </div>
    </form>
  );
}

function GamePanel({ room, actor, scores, start, submit, flip, onMemoryDone }: {
  room: RoomView; actor: string; scores: { actor: string; game: string; best: number }[];
  start: (game: MinigameId) => Promise<{ gameId: string; seed?: string } | null>;
  submit: (game: MinigameId, gameId: string, input: number[]) => Promise<void>;
  flip: (gameId: string, card: number) => Promise<FlipResult | null>;
  onMemoryDone: (score: number) => void;
}) {
  const [game, setGame] = useState<{ id: MinigameId; gameId: string; seed?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submitRef = useRef(submit);
  useEffect(() => { submitRef.current = submit; }, [submit]);
  const doneRef = useRef(onMemoryDone);
  useEffect(() => { doneRef.current = onMemoryDone; }, [onMemoryDone]);
  const gameRef = useRef<{ id: MinigameId; gameId: string; seed?: string } | null>(null);
  // 판이 끝나면 게임 화면을 닫고 입력을 서버에 보낸다(이벤트·타이머 콜백에서만 호출됨 — 렌더 중 갱신 없음)
  const finish = useCallback((input: number[]) => {
    const g = gameRef.current;
    gameRef.current = null;
    setGame(null);
    if (g) void submitRef.current(g.id, g.gameId, input);
  }, []);
  const memoryDone = useCallback((score: number) => {
    gameRef.current = null;
    setGame(null);
    doneRef.current(score);
  }, []);
  const memoryFlip = useCallback((card: number) => {
    const g = gameRef.current;
    return g ? flip(g.gameId, card) : Promise.resolve(null);
  }, [flip]);
  const name = (id: string) => room.actors.find(a => a.id === id)?.name ?? '?';
  if (game?.id === 'catch' && game.seed) return <CatchGame key={game.gameId} era={room.era} seed={game.seed} onFinish={finish} />;
  if (game?.id === 'memory') return <MemoryGame key={game.gameId} flip={memoryFlip} onDone={memoryDone} />;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {MINIGAMES.map(g => <button key={g.id} className="btn btn-dark" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await start(g.id);
          setBusy(false);
          if (r) { gameRef.current = { id: g.id, ...r }; setGame(gameRef.current); }
        }}>{g.label} 시작</button>)}
      </div>
      {MINIGAMES.map(g => {
        const rank = scores.filter(s => s.game === g.id).sort((a, b) => b.best - a.best).slice(0, 5);
        return (
          <div key={g.id}>
            <b>{g.label} 순위</b>
            {!rank.length ? <p className="village-muted" style={{ margin: 0 }}>기록 없음</p> : (
              <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>{rank.map(s => <li key={s.actor} style={{ fontWeight: s.actor === actor ? 700 : 400 }}>{name(s.actor)} — {s.best}점</li>)}</ol>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ManagePanel({ roomId, isAdmin, onDeleted, onToken }: { roomId: string; isAdmin: boolean; onDeleted: () => void; onToken: (t: string) => void }) {
  const [pw, setPw] = useState('');
  const pwMin = isAdmin ? LIMITS.adminPasswordMin : LIMITS.passwordMin;
  const [msg, setMsg] = useState('');
  const [confirming, setConfirming] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <form onSubmit={async e => {
        e.preventDefault(); setMsg('');
        if (!window.confirm('비밀번호를 변경하면 다른 참가자는 새 비밀번호로 다시 입장해야 합니다. 변경할까요?')) return;
        try { const r = await villageApi<{ token: string }>('password', { roomId, password: pw }); onToken(r.token); setPw(''); }
        catch (err) { setMsg((err as Error).message); }
      }} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input type="password" autoComplete="new-password" aria-label="새 방 비밀번호" placeholder={`새 비밀번호 (${pwMin}자 이상)`} value={pw} minLength={pwMin} maxLength={LIMITS.passwordMax} onChange={e => setPw(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
        <button className="btn btn-ghost" disabled={pw.length < pwMin}>비밀번호 변경</button>
      </form>
      {!confirming ? <button className="btn btn-ghost" onClick={() => setConfirming(true)}>방 삭제…</button> : (
        <div role="alertdialog" aria-label="방 삭제 확인" style={{ display: 'grid', gap: 6 }}>
          <span>방과 모든 위치·메시지·선물·기록이 지워지고 되돌릴 수 없습니다. 삭제하면 새 방을 다시 만들 수 있어요.</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-dark" onClick={async () => {
              try { await villageApi('delete', { roomId }); roomToken.clear(roomId); onDeleted(); }
              catch (err) { setMsg((err as Error).message); }
            }}>삭제</button>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>취소</button>
          </div>
        </div>
      )}
      {msg && <p role="alert" style={{ margin: 0, color: 'var(--accent)' }}>{msg}</p>}
    </div>
  );
}
