'use client';
import React, {useState} from 'react';
import type {Character} from '@/lib/charStore';
import {backend} from '@/lib/backend';
import {openCharacter} from '@/lib/charLockClient';
import {CroppedBlobImg} from '@/components/ui/CropEditor';
import {PageTitle} from '@/components/ui/PageText';

export function CharLockGate({character}: {character: Character}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <section className="page"><div className="page-head"><PageTitle>CHARACTERS</PageTitle><p>잠긴 캐릭터</p></div>
    <div className="panel" style={{maxWidth: 420, margin: '0 auto', padding: 22}}>
      <div className="char-card"><div className="thumb"><CroppedBlobImg fileRef={character.thumbId} crop={character.thumbCrop} ph={character.thumbClass} label="LOCKED" /></div><div className="nm"><b>{character.name}</b><span>🔒</span></div></div>
      <form onSubmit={async e => {e.preventDefault(); if (busy) return; setBusy(true); setError(''); const token = await backend()?.authToken?.().catch(() => null); const r = await openCharacter(character.id, password, token); setBusy(false); if (!r.ok) setError(r.error); else setPassword('');}} style={{display:'grid', gap: 10, marginTop: 12}}>
        <input className="k-input" type="password" aria-label="캐릭터 비밀번호" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
        {error && <small role="alert">{error}</small>}
        <button className="btn btn-dark" type="submit" disabled={busy}>{busy ? '확인 중…' : '열기'}</button>
      </form>
    </div></section>;
}
