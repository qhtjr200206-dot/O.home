// 오늘의 시 — 자관(페어) 정보로 Gemini에게 어울리는 실존 시 구절·제목·시인·색을 받아 온다.
// 서버 전용 로직은 src/lib/relPoemServer.ts, 화면 쪽 타입·정리 함수는 src/lib/relPoem.ts.
//
// 요청: POST { id, context, force?, avoid? }  (force = 다시 뽑기, Authorization: Bearer <로그인 토큰> 필요)
// 응답: { status: 'ok', poem, cached } | { status: 'disabled' } | { status: 'error', error }
//
//  · GEMINI_API_KEY가 없으면 { status: 'disabled' } — 화면은 조용히 숨는다(관리자에게만 안내)
//  · 캐시 키 = sha256(자관 id | 한국 날짜 | 페어 정보 다이제스트). 페어 내용을 아는 사람만 같은 키를
//    만들 수 있으므로, 잠금 자관의 시는 비밀번호를 풀어 내용을 받은 화면에서만 요청·조회된다.
//    누가 아무 내용이나 보내도 그 사람 몫의 새 키가 생길 뿐 다른 방문자가 보는 시는 바뀌지 않는다.
//  · 횟수 제한(캐시에 없을 때만 셈): IP당 시간 10회 · 다시 뽑기 IP당 하루 8회 · 사이트 전체 하루
//    GEMINI_DAILY_LIMIT회(기본 200). 다시 뽑기는 관리자·작성자만(서버에서 토큰 검증).
import { NextRequest, NextResponse } from 'next/server';
import { contextIsEmpty, kstDate, normalizeContext } from '@/lib/relPoem';
import {
  canReroll, GeminiError, generatePoem, geminiEnabled, poemStore, publicConfig, relExists, sha256,
} from '@/lib/relPoemServer';
import type { RelPoem } from '@/lib/relPoem';

export const runtime = 'nodejs';
export const maxDuration = 60;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
const fail = (error: string, status: number) => json({ status: 'error', error }, status);

/** 같은 키를 동시에 여러 번 만들지 않게 (같은 인스턴스 안) */
const inflight = new Map<string, Promise<RelPoem>>();
/** 키 오류(503)·Gemini 한도(429)가 나면 잠시 쉬어 간다 — 방문할 때마다 실패할 호출을 거듭하지 않게 */
let cooldown: { until: number; error: GeminiError } | null = null;

export async function POST(req: NextRequest) {
  try { return await handle(req); } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status === 400 ? 502 : e.status);
    console.error('[rels/poem] 실패', (e as Error)?.message);
    return fail('잠시 뒤 다시 시도해 주세요', 500);
  }
}

async function handle(req: NextRequest) {
  if (!geminiEnabled()) return json({ status: 'disabled' });

  let payload: { id?: unknown; context?: unknown; force?: unknown; avoid?: unknown };
  try { payload = await req.json(); } catch { return fail('잘못된 요청입니다', 400); }
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id || id.length > 200 || id.includes('/') || id === '.' || id === '..' || /^__.*__$/.test(id)) {
    return fail('잘못된 요청입니다', 400);
  }
  const ctx = normalizeContext(payload.context);
  if (contextIsEmpty(ctx)) return fail('페어 정보가 비어 있습니다', 400);
  const force = payload.force === true;
  const avoid = typeof payload.avoid === 'string' ? payload.avoid.slice(0, 60) : undefined;

  const date = kstDate();
  const key = sha256(`${id}|${date}|${sha256(JSON.stringify(ctx))}`);
  const cfg = await publicConfig(req.nextUrl.origin);
  const { store, db } = await poemStore(cfg);

  if (force) {
    const h = req.headers.get('authorization');
    const token = h?.startsWith('Bearer ') ? h.slice(7) : null;
    if (!(await canReroll(cfg, db, token, id))) return fail('다시 뽑기는 관리자만 할 수 있습니다', 403);
  } else {
    const hit = await store.get(key).catch(() => null);
    if (hit) return json({ status: 'ok', poem: hit, cached: true });
    const running = inflight.get(key);
    if (running) return json({ status: 'ok', poem: await running, cached: true });
  }

  if (cooldown && cooldown.until > Date.now()) throw cooldown.error;
  if (!(await relExists(db, id))) return fail('자관을 찾을 수 없습니다', 404);

  // 횟수 제한 — IP는 해시로만 다룬다
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipKey = sha256(`poem|${ip}`);
  const dailyCap = Math.max(1, Number(process.env.GEMINI_DAILY_LIMIT) || 200);
  const ok = await store.hit(`ip:${ipKey}`, 10, 3600_000)
    && (!force || await store.hit(`force:${ipKey}`, 8, 86400_000))
    && await store.hit(`global:${date}`, dailyCap, 86400_000);
  if (!ok) return fail('오늘의 시 요청이 너무 많습니다 — 잠시 뒤 다시 시도해 주세요', 429);

  const job = generatePoem(ctx, date, force ? avoid : undefined);
  inflight.set(key, job);
  try {
    const poem = await job;
    await store.set(key, poem, id).catch(e => console.error('[rels/poem] 캐시 저장 실패', (e as Error)?.message));
    return json({ status: 'ok', poem, cached: false });
  } catch (e) {
    if (e instanceof GeminiError && (e.status === 503 || e.status === 429)) {
      cooldown = { until: Date.now() + 5 * 60_000, error: e };
    }
    throw e;
  } finally {
    inflight.delete(key);
  }
}
