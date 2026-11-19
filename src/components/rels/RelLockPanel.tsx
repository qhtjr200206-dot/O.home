'use client';
// 비공개(잠금) 자관 설정 — 자관 수정 화면(원본 편집일 때만)에 붙는다. 관리자 전용.
//
// 다른 폼 값과 따로 바로 저장한다: 잠금은 「공개 문서를 껍데기로 바꾸고 내용을 비공개 문서로 옮기는」
// 일이라 순서가 중요하다 — 자관 저장이 서버에서 확인된 뒤에야 문답 답변도 비공개로 돌린다.
// 비밀번호는 여기서 salt + 반복 해시로만 바꿔 저장한다(평문은 어디에도 남지 않는다).
import React, { useState } from 'react';
import { Relation, QaAnswerRow } from '@/lib/charStore';
import { isServerMode } from '@/lib/supabase';
import { syncList } from '@/lib/db';
import { currentUserId } from '@/lib/currentUser';
import { explainDbError } from '@/lib/dbError';
import { notifyRelLockChanged } from '@/lib/relLock';
import { newLockSalt, relLockHash, normLockPw, REL_LOCK_ITER } from '@/lib/relLockHash';
import { KInput, KCheck } from '@/components/ui/Kit';
import { useToast } from '@/components/ui/Toast';

export function RelLockPanel({ rel, rels, setRels, qaRows, setQaRows, onDone }: {
  rel: Relation;
  rels: Relation[];
  setRels: (next: Relation[]) => void;
  qaRows: QaAnswerRow[];
  setQaRows: (next: QaAnswerRow[]) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [want, setWant] = useState(!!rel.locked);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [offAsk, setOffAsk] = useState(false);

  /** 자관 → 답변 순서로 저장. 서버 모드에서는 각 단계가 확정된 뒤 다음으로 넘어간다 */
  const save = async (next: Relation, answersPrivate: boolean) => {
    const nextRels = rels.map(r => (r.id === rel.id ? next : r));
    const nextQa = qaRows.map(q => {
      if (q.relId !== rel.id) return q;
      if (answersPrivate) return { ...q, visibility: 'private' as const };
      const { visibility: _v, ...rest } = q; void _v;
      return rest as QaAnswerRow;
    });
    if (!isServerMode()) { setRels(nextRels); setQaRows(nextQa); return true; }
    const uid = currentUserId();
    try {
      await syncList('relations', rels as never, nextRels as never, uid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(`잠금 설정을 저장하지 못했습니다 — ${explainDbError(msg)}`);
      return false;
    }
    try {
      await syncList('qa_answers', qaRows as never, nextQa as never, uid);
    } catch {
      toast(answersPrivate
        ? '자관은 잠갔지만 문답 답변을 비공개로 돌리지 못했습니다 — 이 화면에서 다시 [잠금 적용]을 눌러 주세요'
        : '잠금은 풀었지만 문답 답변 공개범위를 되돌리지 못했습니다 — 다시 시도해 주세요');
    }
    notifyRelLockChanged();   // 열려 있는 목록들이 서버 값을 다시 읽게
    return true;
  };

  const applyLock = async () => {
    const p = normLockPw(pw);
    if (p.length < 4) { toast('비밀번호는 4자 이상으로 정해 주세요'); return; }
    if (p !== normLockPw(pw2)) { toast('비밀번호 확인이 일치하지 않습니다'); return; }
    setBusy(true);
    const salt = newLockSalt();
    const hash = await relLockHash(p, salt, REL_LOCK_ITER);
    const ok = await save({ ...rel, locked: true, lockStub: undefined, lockHash: hash, lockSalt: salt, lockIter: REL_LOCK_ITER }, true);
    setBusy(false);
    if (!ok) return;
    setPw(''); setPw2('');
    toast(rel.locked ? '비밀번호를 바꿨습니다' : '비공개(잠금) 자관으로 바꿨습니다');
    onDone();
  };

  const removeLock = async () => {
    setBusy(true);
    const { locked: _l, lockStub: _s, lockHash: _h, lockSalt: _a, lockIter: _i, ...rest } = rel;
    void _l; void _s; void _h; void _a; void _i;
    const ok = await save(rest as Relation, false);
    setBusy(false);
    setOffAsk(false);
    if (!ok) return;
    toast('잠금을 풀었습니다 — 이제 누구나(공개범위에 맞게) 내용을 볼 수 있습니다');
    onDone();
  };

  if (rel.lockStub) {
    return (
      <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
        <b>비공개(잠금) 자관</b>
        <p className="hint" style={{ marginTop: 6 }}>
          잠금 자관의 내용을 서버에서 읽지 못했습니다 — 새로고침한 뒤 다시 시도해 주세요.
          (보안 규칙/설치 SQL이 최신이 아니면 이렇게 보일 수 있습니다)
        </p>
      </div>
    );
  }

  return (
    <div className="panel" style={{ padding: 18, marginBottom: 18, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b>비공개(잠금) 자관</b>
        <span className="pill">{rel.locked ? '🔒 잠금 켜짐' : '잠금 꺼짐'}</span>
      </div>
      <small className="hint">
        목록에는 다른 자관과 똑같이 보이고, 커버를 누르면 비밀번호를 물어봅니다. 잠긴 동안 서버는 커버(대표 썸네일)와
        제목만 내주고 캐치프레이즈·멤버·일러·타임라인·문답 등은 비밀번호를 맞힌 요청에만 내줍니다.
        관리자 계정에는 비밀번호 없이 열립니다. 비밀번호는 해시로만 저장되므로 잊으면 새로 정해야 합니다.
      </small>
      {!rel.locked && <KCheck label="비밀번호로 잠그기" checked={want} onChange={setWant} />}
      {(want || rel.locked) && (
        <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
          <KInput type="password" placeholder={rel.locked ? '새 비밀번호 (바꿀 때만)' : '비밀번호 (4자 이상)'}
            value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" disabled={busy} />
          <KInput type="password" placeholder="비밀번호 확인" value={pw2}
            onChange={e => setPw2(e.target.value)} autoComplete="new-password" disabled={busy} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-dark" disabled={busy || !pw} onClick={() => void applyLock()}>
              {busy ? '저장 중…' : rel.locked ? '비밀번호 변경' : '잠금 적용'}
            </button>
            {rel.locked && !offAsk && (
              <button type="button" className="btn" disabled={busy} onClick={() => setOffAsk(true)}>잠금 해제</button>
            )}
            {rel.locked && offAsk && (
              <>
                <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void removeLock()}>
                  정말 해제 (내용 공개)
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setOffAsk(false)}>취소</button>
              </>
            )}
          </div>
        </div>
      )}
      <small className="hint">
        한계: 이미지 파일은 저장소의 공개 주소라, 잠그기 전에 주소를 받아 둔 사람은 그 주소로 계속 볼 수 있습니다.
        캐릭터 페이지에 따로 저장된 이 자관의 AU 캐릭터 프로필은 캐릭터 쪽 공개범위를 따릅니다.
      </small>
    </div>
  );
}
