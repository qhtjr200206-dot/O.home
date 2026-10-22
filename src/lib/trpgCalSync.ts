// TRPG 캘린더(trpg-calendar.com) → 스케줄러 동기화
// 공유 링크의 일정을 /api/trpgcal 로 받아 스케줄러 일정으로 바꾼다.
// 받아온 일정에는 extId('trpgcal:<세션 id>')가 붙어, 다시 동기화하면
// 새 것은 추가 · 바뀐 것은 갱신 · 그쪽에서 지운 것은 삭제한다. 직접 만든 일정(extId 없음)은 건드리지 않는다.
import type { Visibility } from './charStore';
import type { SchedEvent } from './schedStore';

export type TrpgCalSession = {
  id: string;
  date: string;        // YYYY-MM-DD
  endDate?: string;
  time?: string;       // HH:MM
  endTime?: string;
  title: string;
  role?: string;       // GM / PL
  rule?: string;
  gm?: string;
  pls?: string[];
  pcNames?: string;
  note?: string;
  color?: string;
};

/** 스케줄러별로 기억해 두는 동기화 설정 */
export type TrpgCalLink = { shareId: string; visibility: Visibility; lastSync?: number };

export const EXT_PREFIX = 'trpgcal:';

/** 공유 링크 전체를 붙여 넣어도, id만 넣어도 받는다 */
export function parseShareId(input: string): string | null {
  const t = input.trim();
  const m = t.match(/\/share\/([A-Za-z0-9_-]{6,64})/) ?? t.match(/^([A-Za-z0-9_-]{6,64})$/);
  return m ? m[1] : null;
}

export async function fetchTrpgCal(shareId: string): Promise<TrpgCalSession[]> {
  const res = await fetch(`/api/trpgcal?id=${encodeURIComponent(shareId)}`, { cache: 'no-store' });
  if (res.status === 404) throw new Error('공유 링크를 찾을 수 없습니다 — 링크가 바뀌었는지 확인해 주세요');
  if (!res.ok) throw new Error('TRPG 캘린더에서 일정을 받아오지 못했습니다');
  const j = await res.json() as { sessions?: TrpgCalSession[] };
  return j.sessions ?? [];
}

const range = (a?: string, b?: string) => (a && b ? `${a}~${b}` : a || (b ? `~${b}` : ''));

const nextDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/** 끝나는 날 — 20:00~00:00 처럼 다음 날 새벽(06시 전)에 끝나는 세션은 하루짜리로 본다 */
function endOf(x: TrpgCalSession): string | undefined {
  if (!x.endDate || x.endDate <= x.date) return undefined;
  if (x.endDate === nextDay(x.date) && x.endTime && x.endTime < '06:00') return undefined;
  return x.endDate;
}

/** 세션 하나 → 스케줄러 일정에서 동기화가 책임지는 필드 */
function toFields(x: TrpgCalSession): Pick<SchedEvent, 'title' | 'start' | 'end' | 'color' | 'memo'> {
  const memo = [
    [range(x.time, x.endTime), x.role].filter(Boolean).join(' '),
    x.rule,
    x.gm && `GM ${x.gm}`,
    x.pls?.length ? `PL ${x.pls.join(', ')}` : '',
    x.pcNames && `PC ${x.pcNames}`,
    x.note,
  ].filter(Boolean).join(' · ');
  return {
    title: x.title || '(제목 없음)',
    start: x.date,
    end: endOf(x),
    color: x.color,
    memo: memo || undefined,
  };
}

export type SyncStats = { added: number; updated: number; removed: number };

/**
 * 이 스케줄러(secEvents)의 일정 목록과 받아온 세션을 합친다.
 * 공개범위·카테고리·반복은 처음 넣을 때만 정하고, 이후엔 이쪽에서 바꾼 값을 그대로 둔다.
 * keepMissing 이면 저쪽에서 사라진 일정도 지우지 않는다(대량 삭제를 사용자가 거절한 경우).
 */
export function mergeTrpgCal(
  secEvents: SchedEvent[], sessions: TrpgCalSession[],
  defaults: { catId: string; visibility: Visibility },
  newId: () => string,
  keepMissing = false,
): { next: SchedEvent[]; stats: SyncStats } {
  const remote = new Map(sessions.map(x => [EXT_PREFIX + x.id, x]));
  const stats: SyncStats = { added: 0, updated: 0, removed: 0 };
  const next: SchedEvent[] = [];
  for (const e of secEvents) {
    if (!e.extId?.startsWith(EXT_PREFIX)) { next.push(e); continue; }
    const x = remote.get(e.extId);
    if (!x) {
      if (keepMissing) next.push(e); else stats.removed++;
      continue;
    }
    remote.delete(e.extId);
    const f = toFields(x);
    const changed = (Object.keys(f) as (keyof typeof f)[]).some(k => (e[k] ?? undefined) !== (f[k] ?? undefined));
    if (changed) stats.updated++;
    next.push(changed ? { ...e, ...f } : e);
  }
  for (const [extId, x] of remote) {
    stats.added++;
    next.push({
      id: newId(), extId, ...toFields(x),
      catId: defaults.catId, visibility: defaults.visibility, repeat: 'none',
    });
  }
  return { next, stats };
}

/**
 * 삭제를 그냥 진행하기엔 위험한 결과인가 — 받아온 일정이 0개이거나(공유 범위를 바꿔 숨긴 경우 등),
 * 동기화된 일정의 절반 이상(3개 이상)이 한꺼번에 사라지는 경우.
 */
export function isMassRemoval(stats: SyncStats, syncedBefore: number, remoteCount: number): boolean {
  if (stats.removed === 0) return false;
  return remoteCount === 0 || (stats.removed >= 3 && stats.removed * 2 >= syncedBefore);
}
