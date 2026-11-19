// Character lock data boundary. This helper is not yet connected to storage or UI;
// it must not be presented as a working security feature until server and rules exist.
import type { Character } from './charStore';

export type LockableCharacter = Character & {
  locked?: boolean;
  lockStub?: boolean;
  lockHash?: string;
  lockSalt?: string;
  lockIter?: number;
};

type Secret = {
  id: string;
  keep?: boolean;
  visibility?: 'private';
  character?: Character;
  lockHash?: string;
  lockSalt?: string;
  lockIter?: number;
};

/** Only an explicit allowlist may be persisted to the publicly readable document. */
export function splitCharacters(items: LockableCharacter[]): { pub: Partial<LockableCharacter>[]; sec: Secret[] } {
  const pub: Partial<LockableCharacter>[] = [];
  const sec: Secret[] = [];
  for (const c of items) {
    if (!c.locked) { pub.push(c); continue; }
    pub.push({
      id: c.id, name: c.name, own: c.own, visibility: c.visibility,
      ...(c.slug ? { slug: c.slug } : {}),
      ...(c.secId ? { secId: c.secId } : {}),
      ...(c.thumbId ? { thumbId: c.thumbId } : {}),
      ...(c.thumbCrop ? { thumbCrop: c.thumbCrop } : {}),
      thumbClass: c.thumbClass,
      locked: true, lockStub: true,
    });
    if (c.lockHash && c.lockSalt && !c.lockStub) {
      const { locked: _l, lockStub: _s, lockHash, lockSalt, lockIter, ...character } = c;
      void _l; void _s;
      sec.push({ id: c.id, visibility: 'private', character, lockHash, lockSalt, lockIter });
    } else {
      sec.push({ id: c.id, keep: true });
    }
  }
  return { pub, sec };
}
