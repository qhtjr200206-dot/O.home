'use client';
// 커버 메이커 입장 게이트 — 관리자는 바로, 나머지는 초대 코드(이 기기에 기억).
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { onSettingChange } from '@/lib/settingStore';
import { COVER_INVITE_KEY, checkCoverCode, coverPassValid, hasCoverInvite } from '@/lib/cover/gate';
import css from './cover.module.css';

export function CoverGate({ children }: { children: React.ReactNode }) {
  const { isAdmin, ready } = useAuth();
  // 렌더 중 localStorage를 읽으면 서버 HTML과 어긋나므로 마운트 뒤 판정
  const [state, setState] = useState<'wait' | 'pass' | 'ask' | 'closed'>('wait');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const judge = () => {
      if (isAdmin) return setState('pass');
      if (!hasCoverInvite()) return setState('closed');
      void coverPassValid().then(ok => { if (alive) setState(ok ? 'pass' : 'ask'); });
    };
    judge();
    // 관리자가 다른 화면에서 코드를 바꾸면 바로 반영
    const off = onSettingChange(k => { if (k === COVER_INVITE_KEY) judge(); });
    return () => { alive = false; off(); };
  }, [ready, isAdmin]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true); setErr('');
    // 연속 실패 시 조금씩 늦춘다 (마구 넣어 보기 방지)
    if (fails >= 3) await new Promise(r => setTimeout(r, Math.min(4000, 600 * (fails - 2))));
    const ok = await checkCoverCode(code).catch(() => false);
    setBusy(false);
    if (ok) { setState('pass'); return; }
    setFails(n => n + 1);
    setErr('초대 코드가 맞지 않습니다');
  };

  if (state === 'pass') return <>{children}</>;
  return (
    <div className={css.root}>
      <div className={css.gate}>
        {state === 'wait' ? null : (
          <div className={css.gateCard}>
            <div className={css.gateDisc} aria-hidden />
            <h1 className={css.gateTitle}>커버 메이커</h1>
            {state === 'closed' ? (
              <p className={css.gateText}>초대받은 사람만 쓸 수 있는 곳입니다.<br />관리자가 아직 초대 코드를 정하지 않았습니다.</p>
            ) : (
              <>
                <p className={css.gateText}>초대받은 사람만 쓸 수 있는 곳입니다.<br />받은 초대 코드를 입력해 주세요.</p>
                <form className={css.gateForm} onSubmit={submit}>
                  <input
                    className={`${css.input} ${css.gateInput}`} value={code} onChange={e => { setCode(e.target.value); setErr(''); }}
                    placeholder="초대 코드" aria-label="초대 코드" autoComplete="off" autoFocus maxLength={64}
                  />
                  <button className={`${css.btn} ${css.btnPrimary}`} disabled={busy || !code.trim()}>{busy ? '확인 중…' : '들어가기'}</button>
                  {err && <div className={css.err} role="alert">{err}</div>}
                </form>
                <p className={css.hint}>한 번 들어오면 이 기기에서는 다시 묻지 않습니다 (코드가 바뀌면 다시 입력).</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
