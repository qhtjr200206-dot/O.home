// Firebase-specific adapter. Configuration stays server-side; never log credentials.
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { changeCharacterLock, openCharacter } from './characterLockServer';
import { createCharacterLockHandlers } from './characterLockHttp';

function app(): App {
  const existing = getApps().find(a => a.name === '[DEFAULT]');
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Firebase server configuration missing');
  return initializeApp({ credential: cert(JSON.parse(raw)) });
}
function db() {
  const a = app();
  const id = process.env.FIREBASE_DATABASE_ID?.trim();
  return id && id !== '(default)' ? getFirestore(a, id) : getFirestore(a);
}
export const characterLockHandlers = createCharacterLockHandlers({
  verify: async token => (await getAuth(app()).verifyIdToken(token, true)).uid,
  change: (uid, id, action, password) => changeCharacterLock(db(), uid, id, action, password),
  open: (id, password, authenticated, client) => openCharacter(db(), id, password, authenticated, client),
});
