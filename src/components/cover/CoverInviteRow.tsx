'use client';
// 커버 메이커 초대 코드 설정 — 환경설정 > 회원/보안 행, 그리고 스튜디오 머리줄 모달에서 같이 쓴다.
import React, { useEffect, useState } from 'react';
import { onSettingChange } from '@/lib/settingStore';
import { COVER_INVITE_KEY, coverInvite, setCoverInvite } from '@/lib/cover/gate';
import { KInput } from '@/components/ui/Kit';

/** 현재 상태 문구 — 해시만 저장하므로 코드 자체는 보여 줄 수 없다 */
export function useCoverInviteStatus(): string {
  const [s, setS] = useState('');
  useEffect(() => {
    const read = () => {
      const v = coverInvite();
      setS(v ? `설정됨 · ${v.at.slice(0, 10)} 변경` : '미설정 — 지금은 관리자만 들어갈 수 있음');
    };
    read();
    return onSettingChange(k => { if (k === COVER_INVITE_KEY) read(); });
  }, []);
  return s;
}

/** 환경설정 회원/보안 탭의 한 줄 (사이트 공용 .set-row 모양) */
export function CoverInviteRow({ toast }: { toast: (t: string) => void }) {
  const status = useCoverInviteStatus();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await setCoverInvite(code);
      setCode('');
      toast('커버 메이커 초대 코드가 변경되었습니다 — 이미 들어온 사람도 새 코드를 다시 입력해야 합니다');
    } catch (e) {
      toast((e as Error).message || '저장하지 못했습니다');
    } finally { setBusy(false); }
  };
  return (
    <div className="set-row" style={{ flexWrap: 'wrap' }}>
      <div className="l"><b>커버 메이커 초대코드</b><small>/cover 입장 코드 (가입코드와 별개) · {status}</small></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <KInput value={code} onChange={e => setCode(e.target.value)} placeholder="새 코드 (4자 이상)"
          style={{ width: 220 }} autoComplete="off" maxLength={64} />
        <button className="btn btn-dark" disabled={busy || code.trim().length < 4} onClick={save}>SAVE</button>
      </div>
    </div>
  );
}
