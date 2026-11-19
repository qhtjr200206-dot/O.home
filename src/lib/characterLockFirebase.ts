// Firebase-specific adapter. Configuration stays server-side; never log credentials.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCharacterDatabase } from './characterLockConfig';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { changeCharacterLock, openCharacter, CharacterLockError } from './characterLockServer';
import { assertCharacterRulesReady } from './characterLockRules';
import { createCharacterLockHandlers } from './characterLockHttp';

function app(): App {
  const existing = getApps().find(a => a.name === 'ohome-character-lock');
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Firebase server configuration missing');
  const service = JSON.parse(raw) as ServiceAccount & {project_id?: string};
  if (!service.project_id) throw new Error('Firebase server project missing');
  return initializeApp({ credential: cert(service), projectId: service.project_id }, 'ohome-character-lock');
}
function context() {
  let config: {kind?: string; projectId?: string; databaseId?: string} | null = null;
  try {
    config = JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'ohome.config.json'), 'utf8'));
    if (!config || typeof config !== 'object' || typeof config.projectId !== 'string') throw new Error('Invalid public config');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('공개 Firebase 설정을 읽지 못했습니다');
  }
  const projectId = config?.projectId ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const a = app();
  if (!projectId || a.options.projectId !== projectId) throw new Error('서버와 공개 Firebase 프로젝트 설정이 다릅니다');
  const id = resolveCharacterDatabase(process.env, config);
  return { firestore: id ? getFirestore(a, id) : getFirestore(a), databaseId: id || '(default)', projectId, app: a };
}
async function changeProtected(ctx: ReturnType<typeof context>, uid: string, id: string, action: 'lock' | 'changePassword', password?: string) {
  try {
    const rulesFile = ctx.projectId === 'trpg-9b961' ? 'firestore.production.rules' : 'firestore.rules';
    const expectedRules = readFileSync(path.join(process.cwd(), 'firebase', rulesFile), 'utf8');
    const token = await ctx.app.options.credential?.getAccessToken();
    if (!token?.access_token) throw new Error('rules access unavailable');
    await assertCharacterRulesReady({ projectId: ctx.projectId, databaseId: ctx.databaseId, token: token.access_token, expectedRules, fetcher: fetch });
  } catch {
    throw new CharacterLockError('보안 규칙을 확인할 수 없습니다. 규칙 배포와 서버 권한을 확인해 주세요.', 503);
  }
  await changeCharacterLock(ctx.firestore, uid, id, action, password);
}
export const characterLockHandlers = createCharacterLockHandlers({
  verify: async token => (await getAuth(app()).verifyIdToken(token, true)).uid,
  change: (uid, id, action, password) => {
    const ctx = context();
    return action === 'unlock' ? changeCharacterLock(ctx.firestore, uid, id, action, password) : changeProtected(ctx, uid, id, action, password);
  },
  open: (id, password, authenticated, client) => openCharacter(context().firestore, id, password, authenticated, client),
});
