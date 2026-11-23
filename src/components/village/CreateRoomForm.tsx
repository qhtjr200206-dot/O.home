'use client';
// 방 만들기 — 자관을 고르면 멤버 캐릭터가 채워지고, 주요 장소·NPC·세계관·시대를 입력한다.
import React, { useMemo, useState } from 'react';
import type { Character, Relation } from '@/lib/charStore';
import { ERAS, LIMITS, PERSONALITIES, type Personality, type VillageEra } from '@/lib/village/types';
import { villageApi, roomToken } from '@/lib/village/client';
import { useMembers } from '@/lib/members';

type CharCfg = { personality: Personality; home: string; lines: string; allow: string[] };
type NpcCfg = { name: string; role: string; personality: Personality; home: string; lines: string };

const field: React.CSSProperties = { display: 'grid', gap: 4 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', font: 'inherit', background: '#fff', color: 'var(--ink)' };

export function CreateRoomForm({ chars, rels, onCreated, onCancel }: {
  chars: Character[]; rels: Relation[]; onCreated: (roomId: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [era, setEra] = useState<VillageEra>('modern');
  const [worldview, setWorldview] = useState('');
  const [password, setPassword] = useState('');
  const [relId, setRelId] = useState('');
  const [placesText, setPlacesText] = useState('카페\n공원\n학교');
  const [picked, setPicked] = useState<Record<string, CharCfg>>({});
  const [npcs, setNpcs] = useState<NpcCfg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const members = useMembers();
  // 방은 여럿이 함께 보는 공간 — '나만보기' 캐릭터는 넣을 수 없다(서버도 같은 기준으로 거부)
  const usable = useMemo(() => chars.filter(c => c.visibility === 'public' || c.visibility === 'member'), [chars]);
  const hiddenPrivate = chars.length - usable.length;
  const memberName = (uid: string) => members.find(m => m.id === uid)?.nickname ?? `회원 ${uid.slice(0, 6)}…`;

  const places = useMemo(() => placesText.split(/\n|,/).map(s => s.trim()).filter(Boolean).slice(0, LIMITS.places)
    .map((n, i) => ({ id: `p${i}`, name: n.slice(0, LIMITS.placeName) })), [placesText]);
  const pickRel = (id: string) => {
    setRelId(id);
    const rel = rels.find(r => r.id === id);
    if (!rel) return;
    const next: Record<string, CharCfg> = { ...picked };
    for (const m of rel.members) if (usable.some(c => c.id === m.charId) && !next[m.charId]) {
      next[m.charId] = { personality: 'calm', home: '', lines: m.quote ? m.quote : '', allow: [] };
    }
    setPicked(next);
  };
  const toggle = (id: string) => setPicked(p => {
    const n = { ...p };
    if (n[id]) delete n[id]; else n[id] = { personality: 'calm', home: '', lines: '', allow: [] };
    return n;
  });
  const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean).slice(0, LIMITS.lines);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!Object.keys(picked).length) { setError('캐릭터를 한 명 이상 골라 주세요'); return; }
    setBusy(true);
    try {
      const room = {
        name, era, worldview, password, relId,
        places: places.map(p => p.name),
        chars: Object.entries(picked).map(([id, c]) => ({ id, personality: c.personality, home: c.home, lines: lines(c.lines), allow: c.allow })),
        npcs: npcs.filter(n => n.name.trim()).map(n => ({ ...n, lines: lines(n.lines) })),
      };
      const r = await villageApi<{ roomId: string; token: string }>('create', { room });
      roomToken.set(r.roomId, r.token);
      onCreated(r.roomId);
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  const personalitySelect = ({ value, onChange, label }: { value: Personality; onChange: (v: Personality) => void; label: string }) => (
    <select aria-label={label} style={input} value={value} onChange={e => onChange(e.target.value as Personality)}>
      {PERSONALITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
    </select>
  );
  const homeSelect = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <select aria-label={label} style={input} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">집: 자동(장소 중 하나)</option>
      {places.map(p => <option key={p.id} value={p.id}>집: {p.name}</option>)}
    </select>
  );

  return (
    <form onSubmit={submit} className="village-card" style={{ display: 'grid', gap: 14 }} aria-label="방 만들기">
      <h2 style={{ margin: 0, fontSize: 18 }}>새 마을 만들기</h2>
      <label style={field}>방 이름<input style={input} required maxLength={LIMITS.name} value={name} onChange={e => setName(e.target.value)} placeholder="예: 바닷가 마을" /></label>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        <legend style={{ marginBottom: 6 }}>세계관 시대 — 연락 수단이 정해집니다</legend>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ERAS.map(x => (
            <label key={x.id} className={`village-chip${era === x.id ? ' on' : ''}`}>
              <input type="radio" name="era" value={x.id} checked={era === x.id} onChange={() => setEra(x.id)} /> {x.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label style={field}>세계관 설명<textarea style={{ ...input, minHeight: 70 }} maxLength={LIMITS.worldview} value={worldview} onChange={e => setWorldview(e.target.value)} placeholder="마을의 분위기, 규칙, 배경 이야기" /></label>
      <label style={field}>주요 장소 (한 줄에 하나, 최대 {LIMITS.places}곳 — 이름에 따라 건물 모양이 정해집니다: 카페·학교·바다·숲·탑·밭 등)
        <textarea style={{ ...input, minHeight: 70 }} value={placesText} onChange={e => setPlacesText(e.target.value)} />
      </label>
      <label style={field}>자관(페어)에서 캐릭터 불러오기
        <select style={input} value={relId} onChange={e => pickRel(e.target.value)}>
          <option value="">자관을 고르지 않음</option>
          {rels.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, display: 'grid', gap: 8 }}>
        <legend>캐릭터 ({Object.keys(picked).length}/{LIMITS.actors})</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {usable.map(c => (
            <label key={c.id} className={`village-chip${picked[c.id] ? ' on' : ''}`}>
              <input type="checkbox" checked={!!picked[c.id]} onChange={() => toggle(c.id)} disabled={!picked[c.id] && Object.keys(picked).length >= LIMITS.actors} />
              <span style={{ width: 9, height: 9, borderRadius: 9, background: c.color || '#999', display: 'inline-block' }} /> {c.name}
            </label>
          ))}
          {!usable.length && <small>불러올 캐릭터가 없습니다. 캐릭터 메뉴에서 먼저 만들어 주세요.</small>}
        </div>
        {hiddenPrivate > 0 && <small className="village-muted">나만보기 캐릭터 {hiddenPrivate}명은 마을에 넣을 수 없어 목록에서 뺐어요(공개 범위를 전체·멤버로 바꾸면 고를 수 있어요).</small>}
        {Object.entries(picked).map(([id, cfg]) => {
          const ch = chars.find(c => c.id === id);
          const set = (patch: Partial<CharCfg>) => setPicked(p => ({ ...p, [id]: { ...p[id], ...patch } }));
          const holders = [...new Set((ch?.grants ?? []).filter(g => g.level === 'play' || g.level === 'edit').map(g => g.userId))];
          return (
            <div key={id} style={{ display: 'grid', gap: 6, borderTop: '1px dashed var(--line)', paddingTop: 8 }}>
              <b>{ch?.name ?? id}</b>
              <div className="village-2col">
                {personalitySelect({ label: `${ch?.name ?? id} 성격`, value: cfg.personality, onChange: v => set({ personality: v }) })}
                {homeSelect({ label: `${ch?.name ?? id} 집`, value: cfg.home, onChange: v => set({ home: v }) })}
              </div>
              <textarea aria-label={`${ch?.name ?? id} 대사`} style={{ ...input, minHeight: 54 }} value={cfg.lines} onChange={e => set({ lines: e.target.value })} placeholder={`혼자 돌아다닐 때 할 대사 (한 줄에 하나, 최대 ${LIMITS.lines}개)`} />
              {holders.length > 0 && (
                <div style={{ display: 'grid', gap: 4 }}>
                  <small>이 캐릭터의 권한을 받은 회원 중, 이 방에서 조작해도 되는 사람을 골라 주세요(고르지 않으면 작성자와 관리자만 조작합니다).</small>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {holders.map(uid => (
                      <label key={uid} className={`village-chip${cfg.allow.includes(uid) ? ' on' : ''}`}>
                        <input type="checkbox" checked={cfg.allow.includes(uid)}
                          onChange={() => set({ allow: cfg.allow.includes(uid) ? cfg.allow.filter(u => u !== uid) : [...cfg.allow, uid] })} />
                        {memberName(uid)} 조작 허용
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {(ch as { locked?: boolean } | undefined)?.locked && <small className="village-muted">잠긴 캐릭터 — 관리자가 정한 권한 회원이 조작합니다.</small>}
            </div>
          );
        })}
      </fieldset>
      <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, display: 'grid', gap: 8 }}>
        <legend>NPC ({npcs.length}/{LIMITS.npcs})</legend>
        {npcs.map((n, i) => {
          const set = (patch: Partial<NpcCfg>) => setNpcs(list => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} style={{ display: 'grid', gap: 6, borderBottom: '1px dashed var(--line)', paddingBottom: 8 }}>
              <div className="village-2col">
                <input aria-label={`NPC ${i + 1} 이름`} style={input} maxLength={LIMITS.name} value={n.name} onChange={e => set({ name: e.target.value })} placeholder="이름" />
                <input aria-label={`NPC ${i + 1} 역할`} style={input} maxLength={LIMITS.role} value={n.role} onChange={e => set({ role: e.target.value })} placeholder="역할 (예: 우체부)" />
              </div>
              <div className="village-2col">
                {personalitySelect({ label: `NPC ${i + 1} 성격`, value: n.personality, onChange: v => set({ personality: v }) })}
                {homeSelect({ label: `NPC ${i + 1} 집`, value: n.home, onChange: v => set({ home: v }) })}
              </div>
              <textarea aria-label={`NPC ${i + 1} 대사`} style={{ ...input, minHeight: 48 }} value={n.lines} onChange={e => set({ lines: e.target.value })} placeholder="대사 (한 줄에 하나)" />
              <button type="button" className="btn btn-ghost" onClick={() => setNpcs(list => list.filter((_, j) => j !== i))}>이 NPC 빼기</button>
            </div>
          );
        })}
        {npcs.length < LIMITS.npcs && <button type="button" className="btn btn-ghost" onClick={() => setNpcs(l => [...l, { name: '', role: '', personality: 'curious', home: '', lines: '' }])}>＋ NPC 추가</button>}
      </fieldset>
      <label style={field}>방 비밀번호 ({LIMITS.passwordMin}~{LIMITS.passwordMax}자 — 들어오는 사람 모두 이 비밀번호가 필요합니다)
        <input style={input} type="password" autoComplete="new-password" required minLength={LIMITS.passwordMin} maxLength={LIMITS.passwordMax} value={password} onChange={e => setPassword(e.target.value)} />
      </label>
      {error && <p role="alert" style={{ color: 'var(--accent)', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-dark" disabled={busy}>{busy ? '만드는 중…' : '마을 만들기'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>취소</button>
      </div>
    </form>
  );
}
