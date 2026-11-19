// Pure resolver shared by the server adapter and isolated configuration tests.
type Config = {kind?: string; projectId?: string; databaseId?: string} | null;
export function resolveCharacterDatabase(env: Record<string, string | undefined>, config: Config): string | undefined {
  if (config && config.kind && config.kind !== 'firebase') throw new Error('Firebase 데이터베이스 설정이 아닙니다');
  const publicId = config ? config.databaseId : env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  const norm = (v?: string) => v?.trim() && v.trim() !== '(default)' ? v.trim() : undefined;
  const chosen = norm(publicId);
  if (env.FIREBASE_DATABASE_ID !== undefined && norm(env.FIREBASE_DATABASE_ID) !== chosen) {
    throw new Error('서버와 공개 Firebase 데이터베이스 설정이 다릅니다');
  }
  return chosen;
}
