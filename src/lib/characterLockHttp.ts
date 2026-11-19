// HTTP contract, separated from Firebase initialization for local behavioral tests.
import { CharacterLockError, validCharacterId, validPassword, type OpenResult } from './characterLockServer';

type Action = 'lock' | 'unlock' | 'changePassword';
type Dependencies = {
  verify(token: string): Promise<string>;
  change(uid: string, id: string, action: Action, password?: string): Promise<void>;
  open(id: string, password: string, authenticated: boolean, client: string): Promise<OpenResult>;
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const bearer = (req: Request) => /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 4096) return null;
    const text = await req.text();
    if (text.length > 4096) return null;
    const obj: unknown = JSON.parse(text);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj as Record<string, unknown> : null;
  } catch { return null; }
}
export function createCharacterLockHandlers(deps: Dependencies) {
  return {
    lock: async (req: Request): Promise<Response> => {
      const token = bearer(req);
      if (!token) return json({ error: '로그인이 필요합니다' }, 401);
      let uid: string;
      try { uid = await deps.verify(token); } catch { return json({ error: '인증에 실패했습니다' }, 401); }
      const body = await bodyOf(req);
      if (!body || !validCharacterId(body.id) || !['lock', 'unlock', 'changePassword'].includes(String(body.action)) || (body.action !== 'unlock' && !validPassword(body.password))) return json({ error: '잘못된 요청입니다' }, 400);
      try {
        await deps.change(uid, body.id, body.action as Action, typeof body.password === 'string' ? body.password : undefined);
        return json({ ok: true });
      } catch (e) {
        if (e instanceof CharacterLockError) return json({ error: e.message }, e.status);
        return json({ error: '서버에서 처리하지 못했습니다' }, 500);
      }
    },
    unlock: async (req: Request): Promise<Response> => {
      const body = await bodyOf(req);
      if (!body || !validCharacterId(body.id) || typeof body.password !== 'string' || !body.password.trim() || body.password.length > 200) return json({ error: '잘못된 요청입니다' }, 400);
      const token = bearer(req);
      let authenticated = false;
      if (token) {
        try { authenticated = !!(await deps.verify(token)); } catch { return json({ error: '인증에 실패했습니다' }, 401); }
      }
      // This header is trustworthy only when the deployment proxy strips client-supplied values.
      const client = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim().slice(0, 100) || 'unknown';
      try {
        const result = await deps.open(body.id, body.password, authenticated, client);
        return result.ok ? json({ char: result.character }) : json({ error: result.error }, result.status);
      } catch { return json({ error: '서버에서 처리하지 못했습니다' }, 500); }
    },
  };
}
