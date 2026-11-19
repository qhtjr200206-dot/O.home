'use client';
import React, {useState} from 'react';
import {serverConfigSource} from '@/lib/serverConfig';
import {backend, isServerMode} from '@/lib/backend';
import {clearOpenedCharacters} from '@/lib/charLockClient';

export function CharLockPanel({id, locked, onDone}: {id: string; locked: boolean; onDone: () => void}) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState(false);
  const save = async (action: 'lock' | 'unlock' | 'changePassword') => {
    if (busy) return;
    if (action !== 'unlock' && (pw.trim().length < 4 || pw.trim() !== confirm.trim())) {setError('비밀번호는 4자 이상이며 확인과 일치해야 합니다.'); return;}
    setBusy(true); setError('');
    try {
      const token = await backend()?.authToken?.();
      if (!token) throw new Error('관리자 Firebase 로그인 후 다시 시도해 주세요.');
      const res = await fetch('/api/chars/lock', {method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify({id, action, ...(action !== 'unlock' ? {password:pw.trim()} : {})})});
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : '저장하지 못했습니다.');
      clearOpenedCharacters(); onDone();
    } catch (e) {setError(e instanceof Error ? e.message : '저장하지 못했습니다.');}
    finally {setBusy(false); setPw(''); setConfirm('');}
  };
  return <div className="panel" style={{padding:18, marginBottom:18, display:'grid', gap:10}}>
    <b>캐릭터 비밀번호 잠금 {locked ? '🔒 켜짐' : '꺼짐'}</b>
    <small className="hint">목록에는 커버와 이름만 표시됩니다. 잠금은 Firebase 서버와 보안 규칙이 올바르게 설치된 경우에만 서버에서 적용됩니다. 기존에 공유된 사진 URL은 보호되지 않으며 자관·역극에 별도로 저장된 내용도 보호되지 않습니다. 잠금 중에는 수정·삭제할 수 없으므로 먼저 해제해 주세요.</small>
    {!isServerMode() ? <small>잠금 설정은 Firebase 서버 연결이 필요합니다.</small> : serverConfigSource() === 'local' ? <small role="alert">이 브라우저에만 연결 설정이 있습니다. 서버와 다른 데이터베이스를 조작할 수 있어 잠금 설정을 중단했습니다. 공개 설정 파일 또는 서버 환경 설정을 먼저 맞춰 주세요.</small> : <>
      <input className="k-input" type="password" autoComplete="new-password" placeholder="비밀번호 (4자 이상)" aria-label="새 캐릭터 비밀번호" value={pw} onChange={e => setPw(e.target.value)} disabled={busy}/>
      <input className="k-input" type="password" autoComplete="new-password" placeholder="비밀번호 확인" aria-label="캐릭터 비밀번호 확인" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy}/>
      <div><button type="button" className="btn btn-dark" disabled={busy} onClick={() => void save(locked ? 'changePassword' : 'lock')}>{locked ? '비밀번호 변경' : '잠금 적용'}</button>{' '}
      {locked && (!ask ? <button type="button" className="btn" disabled={busy} onClick={() => setAsk(true)}>잠금 해제</button> : <><button type="button" className="btn" disabled={busy} onClick={() => void save('unlock')}>정말 해제 (내용 공개)</button><button type="button" className="btn" onClick={() => setAsk(false)}>취소</button></>)}</div>
    </>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
