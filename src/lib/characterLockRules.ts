// Read-only Firebase Rules API verification. A release lookup is not atomic with
// Firestore writes; operational IAM must prevent rules changes while locks are used.
type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
type Options = { projectId: string; databaseId: string; token: string; expectedRules: string; fetcher: Fetcher; now?: number };
const WAIT_MS = 15 * 60 * 1000; // Conservative settling interval; not a propagation guarantee.
const clean = (s: string) => s.replace(/\r\n/g, '\n').trim();
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export async function assertCharacterRulesReady({projectId, databaseId, token, expectedRules, fetcher, now = Date.now()}: Options): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectId) || !/^(?:\(default\)|[A-Za-z0-9_-]{1,63})$/.test(databaseId) || !token || !expectedRules.trim()) throw new Error('rules configuration invalid');
  const prefix = `projects/${projectId}`;
  const release = `${prefix}/releases/cloud.firestore${databaseId === '(default)' ? '' : '/' + encodeURIComponent(databaseId)}`;
  const get = async (name: string) => {
    const r = await fetcher(`https://firebaserules.googleapis.com/v1/${name}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!r.ok) throw new Error('rules lookup failed');
    return r.json();
  };
  const current = await get(release);
  if (!obj(current) || typeof current.rulesetName !== 'string' || !current.rulesetName.startsWith(`${prefix}/rulesets/`) || !/^[A-Za-z0-9_-]+$/.test(current.rulesetName.slice(`${prefix}/rulesets/`.length))) throw new Error('rules release invalid');
  const updated = typeof current.updateTime === 'string' ? Date.parse(current.updateTime) : NaN;
  if (!Number.isFinite(updated) || now - updated < WAIT_MS) throw new Error('rules release not settled');
  const ruleset = await get(current.rulesetName);
  if (!obj(ruleset) || !obj(ruleset.source) || !Array.isArray(ruleset.source.files) || ruleset.source.files.length !== 1 || !obj(ruleset.source.files[0]) || typeof ruleset.source.files[0].content !== 'string' || clean(ruleset.source.files[0].content) !== clean(expectedRules)) throw new Error('rules source mismatch');
}
