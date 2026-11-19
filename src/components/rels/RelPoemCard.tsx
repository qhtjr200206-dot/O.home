'use client';
/**
 * 오늘의 시 카드 (사용자 요청) — 자관(페어) 상세에서 Gemini가 고른 실존 시의 짧은 구절·제목·시인을
 * 보여 주고, 함께 추천받은 색을 카드 강조색으로 쓴다. 호출은 서버(/api/rels/poem)만 한다.
 *
 *  · 이 카드는 상세 화면의 열람 분기(공개범위·비밀번호) **뒤에서만** 그려진다 — 잠금 자관은 풀기 전에
 *    요청 자체가 없다. 잠금 자관의 시는 브라우저 저장소에도 남기지 않는다(새로고침하면 다시 잠기므로)
 *  · 같은 날 다시 들어오면 브라우저에 남겨 둔 것(일반 자관)이나 서버 캐시를 쓴다 — 하루 한 편
 *  · 키가 설정되지 않았으면 방문자에게는 아무것도 안 보이고, 관리자에게만 「설정 필요」 한 줄
 *  · AI가 고른 구절이라 실제 원문과 다를 수 있다는 안내와 원문 확인 링크를 늘 붙인다
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { Character, Relation } from '@/lib/charStore';
import { backend } from '@/lib/backend';
import { withAlpha } from '@/lib/color';
import { buildPoemContext, contextIsEmpty, kstDate, type PoemResponse, type RelPoem } from '@/lib/relPoem';

const LS_KEY = 'ohome.poem.v1';

/** 짧은 문자열 해시 (FNV-1a) — 브라우저 캐시 키용 */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

function readLs(): Record<string, RelPoem> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function writeLs(key: string, poem: RelPoem) {
  try {
    const today = kstDate();
    const all = readLs();
    // 오늘 것만 남긴다 — 날짜가 지난 시는 쓸모가 없다
    const keep = Object.fromEntries(Object.entries(all).filter(([, v]) => v?.date === today));
    keep[key] = poem;
    localStorage.setItem(LS_KEY, JSON.stringify(keep));
  } catch { /* 저장소가 막혀 있으면 그냥 넘어간다 */ }
}

type View =
  | { s: 'idle' } | { s: 'loading' } | { s: 'disabled' }
  | { s: 'ok'; poem: RelPoem } | { s: 'error'; error: string };

export function RelPoemCard({ rel, chars, isAdmin, fontFamily }: {
  rel: Relation; chars: Character[]; isAdmin: boolean; fontFamily?: string;
}) {
  const ctx = useMemo(() => buildPoemContext(rel, chars), [rel, chars]);
  const ctxStr = JSON.stringify(ctx);
  const today = kstDate();
  const lsKey = `${rel.id}|${today}|${fnv(ctxStr)}`;
  const persist = !rel.locked;   // 잠금 자관은 브라우저에 남기지 않는다
  const [view, setView] = useState<View>({ s: 'idle' });
  const [busy, setBusy] = useState(false);

  const request = async (force: boolean, avoid?: string): Promise<View> => {
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (force) {
        const token = await backend()?.authToken?.().catch(() => null);
        if (token) headers.authorization = `Bearer ${token}`;
      }
      const res = await fetch('/api/rels/poem', {
        method: 'POST', headers, cache: 'no-store',
        body: JSON.stringify({ id: rel.id, context: JSON.parse(ctxStr), force, avoid }),
      });
      const r = await res.json().catch(() => null) as PoemResponse | null;
      if (r?.status === 'disabled') return { s: 'disabled' };
      if (r?.status === 'ok' && r.poem) {
        if (persist) writeLs(lsKey, r.poem);
        return { s: 'ok', poem: r.poem };
      }
      return { s: 'error', error: (r && 'error' in r && r.error) || '오늘의 시를 불러오지 못했습니다' };
    } catch {
      return { s: 'error', error: '서버에 연결하지 못했습니다' };
    }
  };

  useEffect(() => {
    if (contextIsEmpty(JSON.parse(ctxStr))) { setView({ s: 'idle' }); return; }
    const saved = persist ? readLs()[lsKey] : undefined;
    if (saved?.date === today) { setView({ s: 'ok', poem: saved }); return; }
    let alive = true;
    setView({ s: 'loading' });
    void request(false).then(v => { if (alive) setView(v); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lsKey, persist]);

  const [err, setErr] = useState('');
  const reroll = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    const v = await request(true, view.s === 'ok' ? view.poem.title : undefined);
    setBusy(false);
    // 다시 뽑기가 실패하면 보던 시는 그대로 두고 오류만 잠깐 알린다
    if (v.s === 'ok') { setView(v); return; }
    setErr(v.s === 'error' ? v.error : '다시 뽑지 못했습니다');
    setTimeout(() => setErr(''), 5000);
  };

  if (view.s === 'idle') return null;
  // 키 미설정·오류는 방문자에게는 조용히 숨기고, 관리자에게만 한 줄로 알린다
  if (view.s === 'disabled' || view.s === 'error') {
    if (!isAdmin) return null;
    return (
      <div className="rel-poem rel-poem-note">
        <b>TODAY&apos;S POEM</b>
        <span>{view.s === 'disabled'
          ? '오늘의 시 — 서버에 GEMINI_API_KEY가 설정되지 않아 꺼져 있습니다 (관리자에게만 보이는 안내)'
          : `오늘의 시 — ${view.error}`}</span>
        {view.s === 'error' && <button className="btn btn-ghost" onClick={() => {
          setView({ s: 'loading' }); void request(false).then(setView);
        }}>다시 시도</button>}
      </div>
    );
  }

  const poem = view.s === 'ok' ? view.poem : null;
  const c = poem?.color ?? '#8a7f70';
  const verify = poem
    ? `https://www.google.com/search?q=${encodeURIComponent(`"${poem.title}" ${poem.poet} 시`)}`
    : '';

  return (
    <section className={`rel-poem ${poem ? '' : 'loading'}`} aria-label="오늘의 시" style={{
      ['--poem-c' as string]: c,
      ['--poem-tint' as string]: withAlpha(c, 0.1),
      ['--poem-soft' as string]: withAlpha(c, 0.35),
      fontFamily,
    } as React.CSSProperties}>
      <header>
        <span className="rel-poem-tag">TODAY&apos;S POEM <small>{today.replace(/-/g, '.')}</small></span>
        {isAdmin && poem && (
          <button className="btn btn-ghost rel-poem-re" onClick={() => void reroll()} disabled={busy}
            data-tip="다른 시로 다시 뽑기 (관리자)">{busy ? '고르는 중…' : '↻ 다시 뽑기'}</button>
        )}
      </header>
      {!poem ? (
        <p className="rel-poem-wait">오늘 이 페어에 어울리는 시를 고르는 중…</p>
      ) : (
        <>
          <blockquote>{poem.line}</blockquote>
          <p className="rel-poem-by">
            — {poem.poet}, 「{poem.title}」{poem.translated ? ' (번역)' : ''}
            {poem.colorName && <span className="rel-poem-chip" data-tip={c}><i />{poem.colorName}</span>}
          </p>
          {poem.reason && <p className="rel-poem-why">{poem.reason}</p>}
          <p className="rel-poem-src">
            Gemini가 고른 구절입니다 — 실제 원문과 다를 수 있어요.{' '}
            <a href={verify} target="_blank" rel="noopener noreferrer">원문 찾아보기</a>
            {poem.sources?.map((s, i) => (
              <React.Fragment key={s.url}>{' · '}
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">출처 {i + 1}</a>
              </React.Fragment>
            ))}
          </p>
          {err && <p className="rel-poem-err">{err}</p>}
        </>
      )}
    </section>
  );
}
