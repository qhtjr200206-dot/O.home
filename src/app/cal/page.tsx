'use client';
// 스케줄러 (4.12) — 월간 캘린더(정사각 블록) + 우측 D-day/투두(메인 위젯 데이터 공유) + 카테고리
// 일정: 제목·기간·카테고리·색·메모·공개범위·매년 반복 · 일정 → D-day 승격 · 등록 권한 옵션
import React, { Suspense, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useMainStore } from '@/lib/mainStore';
import { useSched, SchedEvent, eventColor, eventOnDate } from '@/lib/schedStore';
import { DdayWidget, TodoWidget } from '@/components/main/widgets';
import { Modal, useConfirmDelete } from '@/components/ui/Modal';
import { KInput, KTextarea, KSelect, KCheck, KDate, KToggle } from '@/components/ui/Kit';
import { ColorField } from '@/components/ui/ColorField';
import { DragList } from '@/components/ui/DragList';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';
import { useToast } from '@/components/ui/Toast';
import { useMenuSettings } from '@/lib/menuStore';
import { useSectionParam } from '@/lib/sectionStore';
import { fetchTrpgCal, parseShareId } from '@/lib/trpgCalSync';

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const fmt = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function CalInner() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  // 여러 개로 만든 스케줄러 (v2.0 사용자 요청) — 주소의 ?s= 가 가리키는 것만.
  // 카테고리도 그 스케줄러 것을 쓴다(정한 적 없으면 기본 스케줄러 것).
  const sec = useSectionParam('sched');
  const {
    st, loaded, addEvent, updateEvent, removeEvent,
    patchCat, addCat, removeCat, setCats, setAllowMember, reorderOn,
    trpgCal, setTrpgCalLink, syncTrpgCal,
  } = useSched(sec.id);
  const { state: mainState, updateWidget } = useMainStore();
  const del = useConfirmDelete();
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  // 오른쪽 카드가 보여 줄 날짜 (v2.0) — 처음에는 오늘
  const [picked, setPicked] = useState(() => fmt(now.getFullYear(), now.getMonth(), now.getDate()));
  const [menuSet] = useMenuSettings();   // 달 표기 방식 (v1.9 — 메뉴 관리의 스케줄러 행)
  const [catMng, setCatMng] = useState(false);
  // 일정 등록/수정 모달
  const [evOpen, setEvOpen] = useState(false);
  const [evId, setEvId] = useState<string | null>(null);   // null = 신규
  const [f, setF] = useState({
    title: '', start: '', end: '', catId: '', color: '', useCatColor: true,
    memo: '', visibility: 'public' as SchedEvent['visibility'], yearly: false,
  });

  // TRPG 캘린더 동기화 — 공유 링크 설정 창 / 진행 중 표시
  const [tcOpen, setTcOpen] = useState(false);
  const [tcInput, setTcInput] = useState('');
  const [tcVis, setTcVis] = useState<SchedEvent['visibility']>('public');
  const [tcBusy, setTcBusy] = useState(false);

  if (!loaded) return <section className="page" />;

  const runTrpgSync = async (shareId: string) => {
    setTcBusy(true);
    try {
      const sessions = await fetchTrpgCal(shareId);
      // 받아온 게 0개이거나 절반 이상이 사라지면 지우기 전에 확인 — 공유 설정 변경 등으로 날아가는 것 방지
      const r = syncTrpgCal(sessions, (removed, remote) => window.confirm(remote === 0
        ? `TRPG 캘린더에서 받아온 일정이 0개입니다.
공유 설정에서 일정을 숨겼을 수도 있어요.

동기화된 일정 ${removed}개를 정말 모두 지울까요?
(취소하면 지우지 않고 그대로 둡니다)`
        : `TRPG 캘린더에서 동기화된 일정 ${removed}개가 한꺼번에 사라졌습니다.

정말 지울까요?
(취소하면 지우지 않고 추가·변경만 반영합니다)`));
      toast(r.added + r.updated + r.removed === 0
        ? `TRPG 캘린더와 이미 같습니다 (${sessions.length}개)`
        : `TRPG 캘린더 동기화 — 추가 ${r.added} · 변경 ${r.updated} · 삭제 ${r.removed}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : '동기화에 실패했습니다');
    } finally {
      setTcBusy(false);
    }
  };
  const openTrpgSettings = () => {
    setTcInput(trpgCal ? `https://trpg-calendar.com/share/${trpgCal.shareId}` : '');
    setTcVis(trpgCal?.visibility ?? 'public');
    setTcOpen(true);
  };
  const saveTrpgSettings = () => {
    const id = parseShareId(tcInput);
    if (!id) { toast('TRPG 캘린더 공유 링크를 확인해 주세요'); return; }
    setTrpgCalLink({ shareId: id, visibility: tcVis, lastSync: trpgCal?.lastSync });
    setTcOpen(false);
    // 링크를 저장한 직후 바로 받아온다 — 저장 상태가 반영된 다음 틱에 실행
    setTimeout(() => runTrpgSync(id), 0);
  };

  const canWrite = isAdmin || (st.allowMember && !!user);
  const canSee = (e: SchedEvent) =>
    isAdmin || e.visibility === 'public' || (e.visibility === 'member' && !!user);

  const todayStr = fmt(now.getFullYear(), now.getMonth(), now.getDate());
  const firstDow = new Date(view.y, view.m, 1).getDay();
  const dim = new Date(view.y, view.m + 1, 0).getDate();
  const prevDim = new Date(view.y, view.m, 0).getDate();
  const cells: { y: number; m: number; d: number; dimmed: boolean }[] = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    const m = view.m === 0 ? 11 : view.m - 1;
    cells.push({ y: view.m === 0 ? view.y - 1 : view.y, m, d: prevDim - i, dimmed: true });
  }
  for (let d = 1; d <= dim; d++) cells.push({ y: view.y, m: view.m, d, dimmed: false });
  while (cells.length % 7 !== 0) {
    const idx = cells.length - (firstDow + dim) + 1;
    const m = view.m === 11 ? 0 : view.m + 1;
    cells.push({ y: view.m === 11 ? view.y + 1 : view.y, m, d: idx, dimmed: true });
  }

  const eventsOn = (date: string) => st.events.filter(e => canSee(e) && eventOnDate(e, date));
  // 오른쪽 카드가 보여 줄 날짜 — 달력 칸을 누르면 바뀐다 (v2.0)
  const pickedEvents = eventsOn(picked);

  const openNew = (date: string) => {
    if (!canWrite) return;
    setEvId(null);
    setF({ title: '', start: date, end: '', catId: st.cats[0]?.id ?? '', color: '', useCatColor: true, memo: '', visibility: 'public', yearly: false });
    setEvOpen(true);
  };
  const openEdit = (e: SchedEvent) => {
    if (!canWrite) return;
    setEvId(e.id);
    setF({
      title: e.title, start: e.start, end: e.end ?? '', catId: e.catId,
      color: e.color ?? '', useCatColor: !e.color, memo: e.memo ?? '',
      visibility: e.visibility, yearly: e.repeat === 'yearly',
    });
    setEvOpen(true);
  };
  const saveEvent = () => {
    if (!f.title.trim()) { toast('일정 제목을 입력해 주세요'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start)) { toast('시작 날짜를 선택해 주세요'); return; }
    const ev = {
      title: f.title.trim(), start: f.start, end: f.end || undefined,
      catId: f.catId, color: f.useCatColor ? undefined : f.color || undefined,
      memo: f.memo.trim() || undefined, visibility: f.visibility,
      repeat: (f.yearly ? 'yearly' : 'none') as SchedEvent['repeat'],
    };
    if (evId) updateEvent(evId, ev); else addEvent(ev);
    setEvOpen(false);
    toast('저장되었습니다');
  };
  // 일정 → D-day 승격 (4.12) — 메인 D-DAY 위젯 항목으로 추가
  const promoteDday = () => {
    const w = mainState.widgets.find(x => x.type === 'dday');
    if (!w) return;
    const items = (w.settings.items as { title: string; date: string }[]) ?? [];
    updateWidget(w.id, { settings: { ...w.settings, items: [...items, { title: f.title.trim(), date: f.start }] } }, { persist: true });
    toast('D-day로 등록되었습니다 — 메인 위젯에 표시됩니다');
  };

  const ddayConf = mainState.widgets.find(w => w.type === 'dday');
  const todoConf = mainState.widgets.find(w => w.type === 'todo');

  return (
    <section className="page">
      <div className="page-head">
        <PageTitle>{sec.id === 'main' ? 'SCHEDULER' : sec.name}</PageTitle>
        <EditableDesc k="cal-desc" def="월간 캘린더 + 투두 + D-day" />
        {isAdmin && (
          <div className="head-actions">
            {trpgCal?.lastSync && (
              <small style={{ color: 'var(--faint)', fontSize: 10.5, whiteSpace: 'nowrap' }}>
                마지막 동기화 {new Date(trpgCal.lastSync).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </small>
            )}
            <button className="btn btn-dark" style={{ whiteSpace: 'nowrap' }} disabled={tcBusy}
              onClick={() => (trpgCal ? runTrpgSync(trpgCal.shareId) : openTrpgSettings())}>
              {tcBusy ? '동기화 중…' : '⟳ TRPG 캘린더 동기화'}
            </button>
            <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap' }} onClick={openTrpgSettings}
              data-tip="공유 링크 · 새 일정 공개범위">⚙</button>
          </div>
        )}
      </div>

      <div className="cal-layout">
        {/* 모바일 전용 — 달력 대신 다가오는 일정 단순 나열, 최대 10개 (v1.9 사용자 확정) */}
        <div className="panel cal-mlist" style={{ padding: '6px 18px' }}>
          {(() => {
            const today = fmt(now.getFullYear(), now.getMonth(), now.getDate());
            const list = st.events
              .filter(canSee)
              .map(e => {
                let d = e.start;
                if (e.repeat === 'yearly') {
                  const thisYear = `${now.getFullYear()}-${e.start.slice(5)}`;
                  d = thisYear >= today ? thisYear : `${now.getFullYear() + 1}-${e.start.slice(5)}`;
                }
                return { e, d };
              })
              .filter(x => x.d >= today || (x.e.end && x.e.end >= today))
              .sort((a, b) => a.d.localeCompare(b.d))
              .slice(0, 10);
            return (
              <>
                {list.map(({ e, d }) => (
                  <div key={e.id} className="ev-row" onClick={() => openEdit(e)}>
                    <span className="dt">{d.slice(5).replace('-', '.')}{e.end ? ` ~ ${e.end.slice(5).replace('-', '.')}` : ''}</span>
                    <span className="tt">{e.title}</span>
                    <i style={{ background: eventColor(e, st.cats) }} />
                  </div>
                ))}
                {list.length === 0 && <p className="hint" style={{ padding: '10px 0' }}>다가오는 일정이 없습니다</p>}
              </>
            );
          })()}
        </div>
        {/* 좌: 월간 캘린더 */}
        <div className="panel cal">
          <div className="cal-head">
            <button className="btn btn-ghost" style={{ padding: '6px 12px' }}
              onClick={() => setView(v => ({ y: v.m === 0 ? v.y - 1 : v.y, m: (v.m + 11) % 12 }))}>‹</button>
            {/* 표기 방식은 환경설정 > 메뉴 관리의 스케줄러 행에서 (v1.9) */}
            <b>{(menuSet.calTitle ?? 'en') === 'num'
              ? `${view.y}.${String(view.m + 1).padStart(2, '0')}`
              : `${MONTHS[view.m]} ${view.y}`}</b>
            <button className="btn btn-ghost" style={{ padding: '6px 12px' }}
              onClick={() => setView(v => ({ y: v.m === 11 ? v.y + 1 : v.y, m: (v.m + 1) % 12 }))}>›</button>
          </div>
          <div className="cal-grid">
            {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(w => <div key={w} className="dow">{w}</div>)}
            {cells.map((c, i) => {
              const date = fmt(c.y, c.m, c.d);
              const evs = eventsOn(date);
              return (
                <div key={i}
                  className={`cal-cell ${c.dimmed ? 'dim' : ''} ${date === todayStr ? 'today' : ''} ${date === picked ? 'picked' : ''}`}
                  /* 칸을 누르면 등록창이 아니라 그 날짜를 고른다 — 등록·순서는 오른쪽 카드에서 (v2.0) */
                  onClick={() => setPicked(date)}>
                  {c.d}
                  {/* 칸에는 위에서 3개까지만 — 나머지는 오른쪽 카드에서 본다 */}
                  {evs.slice(0, 3).map(e => (
                    <div key={e.id} className="ev" style={{ background: `${eventColor(e, st.cats)}22`, color: eventColor(e, st.cats) }}
                      data-tip={`${e.title}${e.memo ? ` — ${e.memo}` : ''}`}
                      onClick={ev => { ev.stopPropagation(); setPicked(date); openEdit(e); }}>
                      {e.title}
                    </div>
                  ))}
                  {evs.length > 3 && <div className="ev more">＋{evs.length - 3}</div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* 우: 고른 날짜의 일정 / D-day / 투두(메인 위젯 데이터 공유) / 카테고리 */}
        <div className="cal-side" style={{ display: 'grid', alignContent: 'start' }}>
          {/* 고른 날짜의 일정 (v2.0 사용자 확정) — 여기서 추가·순서 변경, 달력에는 위 3개만 */}
          <div className="panel widget">
            <h4>
              {picked.slice(5).replace('-', '월 ')}일 일정
              {canWrite && <span className="more" onClick={() => openNew(picked)}>＋ 추가</span>}
            </h4>
            {pickedEvents.length > 0 ? (
              <DragList items={pickedEvents} keyOf={e => e.id} disabled={!canWrite}
                onReorder={next => reorderOn(next.map(e => e.id))}
                render={e => (
                  /* 제목은 왼쪽, 카테고리 색은 맨 오른쪽.
                     클릭은 제목에만 건다 — 손잡이를 끌다 놓았을 때 수정창이 열리던 것 방지 (v2.0) */
                  <div className="dday-row" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    {canWrite && <span className="drag-h">⠿</span>}
                    <span style={{
                      flex: 1, minWidth: 0, textAlign: 'left',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      cursor: canWrite ? 'var(--cur-pointer,pointer)' : undefined,
                    }} onClick={() => openEdit(e)}>{e.title}</span>
                    <i style={{
                      width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                      background: eventColor(e, st.cats), fontStyle: 'normal',
                    }} />
                  </div>
                )} />
            ) : (
              <p className="hint" style={{ margin: '6px 0 0' }}>
                이 날짜에 일정이 없습니다{canWrite ? ' — [＋ 추가]로 등록' : ''}
              </p>
            )}
          </div>
          {ddayConf && <DdayWidget conf={ddayConf} />}
          {todoConf && <TodoWidget conf={todoConf} />}
          <div className="panel widget">
            <h4>카테고리 {isAdmin && <span className="more" onClick={() => setCatMng(true)}>관리 ›</span>}</h4>
            {st.cats.map(c => (
              <div key={c.id} className="dday-row">
                <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c.color, marginRight: 7, fontStyle: 'normal' }} />{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 일정 등록/수정 모달 */}
      <Modal open={evOpen} onClose={() => setEvOpen(false)} title={evId ? '일정 수정' : '일정 등록'}
        dirty={!!f.title}
        actions={<>
          {evId && (
            <button className="btn btn-ghost" onClick={() =>
              del.ask(`일정 「${f.title}」을 삭제하시겠습니까?`, () => { removeEvent(evId); setEvOpen(false); })}>DELETE</button>
          )}
          <button className="btn btn-ghost" onClick={() => setEvOpen(false)}>CANCEL</button>
          <button className="btn btn-dark" onClick={saveEvent}>{evId ? 'SAVE' : 'ADD'}</button>
        </>}>
        <div style={{ display: 'grid', gap: 9 }}>
          <KInput placeholder="일정 제목" value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <KDate value={f.start} onChange={v => setF(s => ({ ...s, start: v }))} style={{ flex: 1 }} />
            <span style={{ color: 'var(--faint)', fontSize: 11 }}>→</span>
            <KDate value={f.end} onChange={v => setF(s => ({ ...s, end: v }))} style={{ flex: 1 }} placeholder="종료일 (선택)" />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <KSelect minWidth={130} value={f.catId} onChange={v => setF(s => ({ ...s, catId: v }))}
              options={st.cats.map(c => ({ value: c.id, label: c.label }))} />
            <KCheck label="카테고리 색 사용" checked={f.useCatColor}
              onChange={v => setF(s => ({ ...s, useCatColor: v }))} />
            {!f.useCatColor && <ColorField value={f.color || '#8a8f98'} onChange={hex => setF(s => ({ ...s, color: hex }))} />}
          </div>
          <KTextarea placeholder="메모 (선택)" value={f.memo} onChange={e => setF(s => ({ ...s, memo: e.target.value }))} />
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <KSelect minWidth={120} value={f.visibility} onChange={v => setF(s => ({ ...s, visibility: v as SchedEvent['visibility'] }))}
              options={[
                { value: 'public', label: '전체공개' },
                { value: 'member', label: '멤버공개' },
                { value: 'private', label: '나만보기' },
              ]} />
            <KCheck label="매년 반복" checked={f.yearly} onChange={v => setF(s => ({ ...s, yearly: v }))} />
            {isAdmin && f.title.trim() && f.start && (
              <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 10.5, marginLeft: 'auto' }}
                onClick={promoteDday}>D-day 등록</button>
            )}
          </div>
        </div>
      </Modal>

      {/* 카테고리 관리 모달 (관리자) */}
      <Modal open={catMng} onClose={() => setCatMng(false)} small title="카테고리 관리"
        desc="이름 · 색 · ⠿ 순서 — 일정 등록 시 선택"
        actions={<button className="btn btn-dark" onClick={() => setCatMng(false)}>CLOSE</button>}>
        <DragList items={st.cats} keyOf={c => c.id} onReorder={setCats}
          render={c => (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px dashed var(--line)', width: '100%' }}>
              <span className="drag-h">⠿</span>
              <KInput value={c.label} onChange={e => patchCat(c.id, { label: e.target.value })} />
              <ColorField value={c.color} onChange={hex => patchCat(c.id, { color: hex })} />
              <button className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 10.5, whiteSpace: 'nowrap' }}
                onClick={() => del.ask(`카테고리 「${c.label}」를 삭제하시겠습니까?`, () => removeCat(c.id),
                  '이 카테고리의 일정은 유지되며 기본색으로 표시됩니다.')}>DELETE</button>
            </div>
          )} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={addCat}>＋ ADD</button>
          <KToggle label="회원도 일정 등록 허용" checked={st.allowMember} onChange={setAllowMember} />
        </div>
      </Modal>

      {/* TRPG 캘린더 동기화 설정 (관리자) */}
      <Modal open={tcOpen} onClose={() => setTcOpen(false)} small title="TRPG 캘린더 동기화"
        desc="trpg-calendar.com 의 [설정 → 공유]에서 만든 공유 링크를 붙여 넣으세요"
        actions={<>
          {trpgCal && (
            <button className="btn btn-ghost" onClick={() => { setTrpgCalLink(null); setTcOpen(false); toast('연결을 해제했습니다 — 받아온 일정은 그대로 남습니다'); }}>연결 해제</button>
          )}
          <button className="btn btn-ghost" onClick={() => setTcOpen(false)}>CANCEL</button>
          <button className="btn btn-dark" onClick={saveTrpgSettings}>저장하고 동기화</button>
        </>}>
        <div style={{ display: 'grid', gap: 9 }}>
          <KInput placeholder="https://trpg-calendar.com/share/…" value={tcInput} onChange={e => setTcInput(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="cp-lb">새 일정 공개범위</span>
            <KSelect minWidth={120} value={tcVis} onChange={v => setTcVis(v as SchedEvent['visibility'])}
              options={[
                { value: 'public', label: '전체공개' },
                { value: 'member', label: '멤버공개' },
                { value: 'private', label: '나만보기' },
              ]} />
          </div>
          <p className="hint" style={{ margin: 0 }}>
            받아온 일정은 동기화할 때마다 TRPG 캘린더에 맞춰 추가·변경·삭제됩니다. 직접 등록한 일정은 건드리지 않습니다.
            제목·날짜·색은 TRPG 캘린더 쪽이 기준이라 여기서 고쳐도 다음 동기화 때 되돌아가고, 공개범위·카테고리는 여기서 바꾼 대로 유지됩니다.
          </p>
        </div>
      </Modal>

      {del.element}
    </section>
  );
}

export default function CalPage() {
  // useSearchParams는 Suspense 경계 필요 (Next App Router)
  return <Suspense fallback={<section className="page" />}><CalInner /></Suspense>;
}
