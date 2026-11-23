'use client';
// 마을(웹게임) — 자관별 도트 마을. 방 목록 → 비밀번호 입장 → 게임. 모든 방 데이터는 서버 API로만 오간다.
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { backend, isServerMode } from '@/lib/backend';
import { useLocalList } from '@/lib/postStore';
import { CHAR_SEED, REL_SEED, type Character, type Relation } from '@/lib/charStore';
import { ERAS, type RoomSummary, type VillageEra } from '@/lib/village/types';
import { villageApi, roomToken, VillageApiError } from '@/lib/village/client';
import { CreateRoomForm } from '@/components/village/CreateRoomForm';
import { VillageGame } from '@/components/village/VillageGame';
import { PageTitle } from '@/components/ui/PageText';

type Mode = { kind: 'lobby' } | { kind: 'create' } | { kind: 'join'; room: RoomSummary; msg?: string } | { kind: 'play'; roomId: string };

export default function VillagePage() {
  const { user, isAdmin, ready } = useAuth();
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>({ kind: 'lobby' });
  const [server, setServer] = useState<'checking' | 'ok' | 'off'>('checking');

  const refresh = useCallback(async () => {
    try { setRooms((await villageApi<{ rooms: RoomSummary[] }>('list')).rooms); setError(''); }
    catch (e) {
      setRooms([]);
      setError((e as Error).message);
      if (e instanceof VillageApiError && e.status === 503) setServer('off');
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    const be = backend();
    if (!isServerMode() || !be || be.kind !== 'firebase') { setServer('off'); return; }
    setServer('ok');
    void refresh();
  }, [ready, user?.id, refresh]);

  const mine = rooms?.filter(r => r.mine) ?? [];
  const canCreate = !!user && (isAdmin || mine.length === 0);
  const open = (room: RoomSummary) => setMode(roomToken.get(room.id) ? { kind: 'play', roomId: room.id } : { kind: 'join', room });
  const eraLabel = (e: VillageEra) => ERAS.find(x => x.id === e)?.label ?? e;

  return (
    <section className="page village-page">
      <div className="page-head">
        <PageTitle>VILLAGE</PageTitle>
        <p className="village-muted" style={{ margin: 0 }}>자관 캐릭터들이 시간대에 맞춰 살아가는 도트 마을 — 방마다 따로, 비밀번호로 들어갑니다.</p>
      </div>

      {server === 'off' && (
        <div className="village-card" role="status">
          <b>마을을 지금 열 수 없습니다.</b>
          <p className="village-muted" style={{ marginBottom: 0 }}>{error || '마을은 서버(Firebase) 연결에서만 동작합니다. 사이트 관리자에게 서버 설정을 확인해 달라고 알려 주세요.'}</p>
        </div>
      )}

      {server === 'ok' && mode.kind === 'lobby' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="village-card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              {!user && <span>방을 만들거나 들어가려면 로그인해 주세요.</span>}
              {user && isAdmin && <span>관리자는 방을 제한 없이 만들 수 있습니다.</span>}
              {user && !isAdmin && (mine.length ? <span>회원은 방을 하나만 가질 수 있어요. 내 방을 삭제하면 새로 만들 수 있습니다.</span> : <span>회원은 방을 하나 만들 수 있어요.</span>)}
            </div>
            <button className="btn btn-dark" disabled={!canCreate} onClick={() => setMode({ kind: 'create' })}>＋ 마을 만들기</button>
            <button className="btn btn-ghost" onClick={() => void refresh()}>새로고침</button>
          </div>
          {error && <p role="alert" style={{ color: 'var(--accent)' }}>{error}</p>}
          {rooms === null ? <div className="village-card">방 목록을 불러오는 중…</div> : !rooms.length ? (
            <div className="village-card">아직 마을이 없어요.</div>
          ) : (
            <ul className="village-rooms">
              {rooms.map(r => (
                <li key={r.id}>
                  <button type="button" className="village-room" disabled={!user} onClick={() => open(r)}>
                    <span className="village-room-icon" aria-hidden>{r.era === 'sf' ? '🛰️' : r.era === 'past' ? '🏯' : '🏙️'}</span>
                    <b>{r.name}</b>
                    <small className="village-muted">{eraLabel(r.era)}{r.mine ? ' · 내 방' : ''}</small>
                    <small className="village-muted">🔒 비밀번호 필요</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {server === 'ok' && mode.kind === 'create' && (
        <CreateRoomForm chars={chars} rels={rels}
          onCancel={() => setMode({ kind: 'lobby' })}
          onCreated={id => { void refresh(); setMode({ kind: 'play', roomId: id }); }} />
      )}

      {server === 'ok' && mode.kind === 'join' && (
        <JoinForm room={mode.room} msg={mode.msg} onCancel={() => setMode({ kind: 'lobby' })} onJoined={() => setMode({ kind: 'play', roomId: mode.room.id })} />
      )}

      {server === 'ok' && mode.kind === 'play' && (
        <VillageGame key={mode.roomId} roomId={mode.roomId} loggedIn={!!user} isAdmin={isAdmin}
          onLeave={() => { setMode({ kind: 'lobby' }); void refresh(); }}
          onNeedPassword={msg => {
            const room = rooms?.find(r => r.id === mode.roomId);
            setMode(room ? { kind: 'join', room, msg } : { kind: 'lobby' });
            if (!room) { setError(msg); void refresh(); }
          }} />
      )}
    </section>
  );
}

function JoinForm({ room, msg, onJoined, onCancel }: { room: RoomSummary; msg?: string; onJoined: () => void; onCancel: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(msg ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <form className="village-card" style={{ display: 'grid', gap: 10, maxWidth: 420 }} onSubmit={async e => {
      e.preventDefault(); setBusy(true); setErr('');
      try {
        const r = await villageApi<{ token: string }>('join', { roomId: room.id, password: pw });
        roomToken.set(room.id, r.token);
        onJoined();
      } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
    }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>🔒 {room.name}</h2>
      <label style={{ display: 'grid', gap: 4 }}>방 비밀번호
        <input type="password" name="village-room-password" autoComplete="off" autoFocus required value={pw} onChange={e => setPw(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', font: 'inherit' }} />
      </label>
      {err && <p role="alert" style={{ margin: 0, color: 'var(--accent)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-dark" disabled={busy || !pw}>{busy ? '확인 중…' : '들어가기'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>목록으로</button>
      </div>
    </form>
  );
}
