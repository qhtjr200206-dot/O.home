'use client';
// 비공개(잠금) 자관 — 비밀번호 화면 (relLock.ts 참조).
// 잠긴 동안에는 커버(목록 썸네일)와 제목만 보여 준다. 그 외의 내용은 서버가 애초에 내주지 않으므로
// 이 화면이 그릴 수 있는 것도 커버·제목뿐이다. 비밀번호 확인은 서버가 한다.
import React, { useState } from 'react';
import { Relation } from '@/lib/charStore';
import { unlockRel } from '@/lib/relLock';
import { KInput } from '@/components/ui/Kit';
import { CroppedBlobImg } from '@/components/ui/CropEditor';
import { PageTitle } from '@/components/ui/PageText';

export function RelLockGate({ rel, onUnlocked }: { rel: Relation; onUnlocked: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const tryOpen = async () => {
    if (busy) return;
    if (!pw.trim()) { setErr('비밀번호를 입력해 주세요'); return; }
    setBusy(true); setErr('');
    const r = await unlockRel(rel, pw);
    setBusy(false);
    if (r.ok) { setPw(''); onUnlocked(); return; }
    setErr(r.error);
  };

  return (
    <section className="page">
      <div className="page-head"><PageTitle>RELATIONS</PageTitle><p>비공개 자관 — 비밀번호를 입력하면 열람할 수 있습니다</p></div>
      <div className="panel" style={{ maxWidth: 420, margin: '0 auto', padding: 22, display: 'grid', gap: 12 }}>
        <div className="rel-card" style={{ cursor: 'default', transform: 'none', boxShadow: 'none' }}>
          <div className="thumb" style={{ position: 'relative' }}>
            <CroppedBlobImg fileRef={rel.thumbId} crop={rel.thumbCrop} ph={rel.thumbClass} label="LOCKED" alt="" />
          </div>
          <div className="nm"><b>{rel.name}</b><span>🔒 비밀번호가 걸린 자관입니다</span></div>
        </div>
        <form onSubmit={e => { e.preventDefault(); void tryOpen(); }} style={{ display: 'grid', gap: 10 }}>
          <KInput type="password" placeholder="비밀번호" value={pw} autoComplete="off" autoFocus
            onChange={e => setPw(e.target.value)} disabled={busy} aria-label="자관 비밀번호" />
          {err && <small style={{ color: 'var(--accent, #c55)' }}>{err}</small>}
          <button type="submit" className="btn btn-dark" style={{ justifyContent: 'center', padding: 9 }} disabled={busy}>
            {busy ? '확인 중…' : '열기'}
          </button>
        </form>
      </div>
    </section>
  );
}
