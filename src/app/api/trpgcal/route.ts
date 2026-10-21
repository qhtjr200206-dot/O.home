// TRPG 캘린더(trpg-calendar.com) 공유 일정 중계 — 스케줄러의 「TRPG 캘린더 동기화」가 부른다.
//
// 그 사이트는 공유 링크의 데이터를 /api/share/<id> 로 주지만 CORS 허용 헤더가 없어서 브라우저가
// 직접 못 가져간다. 여기서 서버가 대신 받아 **일정에 필요한 필드만** 골라 돌려준다
// (프로필·연락처 등 나머지는 넘기지 않는다).
//
// 아무 주소나 대신 받아 주는 통로가 되지 않게 호스트는 고정, 받는 건 공유 id 하나뿐이다.
import type { TrpgCalSession } from '@/lib/trpgCalSync';

const ORIGIN = 'https://trpg-calendar.com';
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

const s = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!ID_RE.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
  let data: { sessions?: unknown[]; profile?: { displayName?: unknown } };
  try {
    const res = await fetch(`${ORIGIN}/api/share/${id}`, {
      cache: 'no-store',
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (O.home scheduler sync)' },
    });
    if (res.status === 404) return Response.json({ error: 'not found' }, { status: 404 });
    if (!res.ok) return Response.json({ error: `upstream ${res.status}` }, { status: 502 });
    data = await res.json();
  } catch {
    return Response.json({ error: 'fetch failed' }, { status: 502 });
  }
  const sessions: TrpgCalSession[] = (Array.isArray(data.sessions) ? data.sessions : [])
    .map(raw => {
      const r = (raw ?? {}) as Record<string, unknown>;
      return {
        id: s(r.id, 80) ?? '',
        date: s(r.date, 10) ?? '',
        endDate: s(r.endDate, 10),
        time: s(r.time, 5),
        endTime: s(r.endTime, 5),
        title: s(r.title, 200) ?? '',
        role: s(r.role, 10),
        rule: s(r.rule, 100),
        gm: s(r.gm, 100),
        pls: Array.isArray(r.pls) ? r.pls.filter((p): p is string => typeof p === 'string').slice(0, 20) : undefined,
        pcNames: s(r.pcNames, 200),
        note: s(r.note, 1000),
        color: /^#[0-9a-fA-F]{6}$/.test(String(r.color ?? '')) ? String(r.color) : undefined,
      };
    })
    .filter(x => x.id && DATE_RE.test(x.date));
  return Response.json(
    { name: s(data.profile?.displayName, 100) ?? '', sessions },
    { headers: { 'cache-control': 'no-store' } },
  );
}
