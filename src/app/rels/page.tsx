'use client';
// EditableDesc 주입
// 자관 리스트 (4.5) — 4:3 가로 썸네일 · 공개범위 3단계 · 멤버 색 점
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLocalList } from '@/lib/postStore';
import { Relation, REL_SEED, Character, CHAR_SEED, relPath } from '@/lib/charStore';
import { SearchBar } from '@/components/ui/Kit';
import { useToast } from '@/components/ui/Toast';
import { CroppedBlobImg } from '@/components/ui/CropEditor';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';
import { useMainStore } from '@/lib/mainStore';
import { useCardSort, mergeOrder } from '@/lib/cardSort';
import { needsUnlock } from '@/lib/relLock';

export default function RelsPage() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const { editOn } = useMainStore();
  const [rels, setRels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const [q, setQ] = useState('');

  const colorOf = (id: string) => chars.find(c => c.id === id)?.color ?? '#666';
  const visible = rels
    .filter(r => isAdmin || r.visibility !== 'private')
    .filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()));

  // 편집모드 카드 드래그 정렬 (v1.9)
  const sort = useCardSort(visible, next => setRels(mergeOrder(rels, next)), editOn && isAdmin);

  return (
    <section className="page">
      <div className="page-head">
        <PageTitle>RELATIONS</PageTitle>
        <EditableDesc k="rels-desc" def="자관 목록 · 4:3 가로 썸네일 · 공개범위: 전체공개/멤버공개/나만보기" />
        <div className="head-actions">
          <SearchBar onSearch={setQ} />
          <button className="btn btn-ghost" onClick={() => router.push('/village')} title="자관 캐릭터들이 사는 도트 마을">🏡 마을</button>
          {isAdmin && <button className="btn btn-dark" onClick={() => router.push('/rels/new')}>＋ ADD RELATION</button>}
        </div>
      </div>
      <div className="g3 rels-grid">
        {visible.map((r, i) => {
          const memberLocked = r.visibility === 'member' && !user;
          const priv = r.visibility === 'private';
          // 비공개(잠금) 자관 — 목록에는 그대로 두고 커버·제목만. 잠긴 동안은 캐치프레이즈·인원·
          // 멤버 색을 그리지 않는다(서버 모드에서는 애초에 받지도 않는다). 열면 상세에서 비밀번호를 묻는다
          const lockedStub = needsUnlock(r, isAdmin);
          const sp = sort(i) as { style?: React.CSSProperties };
          return (
            <div key={r.id} className="rel-card" {...sort(i)}
              style={{ ...(priv ? { opacity: .45 } : undefined), ...sp.style }}
              onClick={() => {
                if (editOn) return;
                if (memberLocked) { toast('멤버공개 — 로그인 후 열람할 수 있습니다'); return; }
                router.push(relPath(r));
              }}>
              <div className="thumb" style={{ position: 'relative' }}>
                <CroppedBlobImg fileRef={r.thumbId} crop={r.thumbCrop} ph={r.thumbClass}
                  label={priv ? '나만보기' : memberLocked ? '멤버공개' : '4:3'} />
              </div>
              <div className="nm">
                {/* 리스트에서는 기본 폰트로 통일 — 개별 이름 폰트는 상세에서만 */}
                <b>
                  {r.name}
                  {r.visibility === 'member' && <span className="pill" style={{ marginLeft: 6 }}>멤버</span>}
                  {r.locked && <span className="pill" style={{ marginLeft: 6 }} aria-label="비밀번호 잠금">🔒</span>}
                </b>
                <span>
                  {priv ? '관리자에게만 표시됨'
                    : memberLocked ? '로그인 시 열람 가능'
                    : lockedStub ? '비밀번호를 입력해야 볼 수 있습니다'
                    : `${r.catchphrase.replace(/ /g, '')} · ${r.members.length}인`}
                </span>
                {!lockedStub && r.members.length > 0 && (
                  <div className="who">
                    {r.members.map(m => <i key={m.charId} style={{ background: colorOf(m.charId) }} />)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
