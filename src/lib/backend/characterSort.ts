// Locked public stubs cannot be updated by non-admins, even just their sort.
// Preserve the existing ranks when only editing or deleting rows: reindexing
// would risk denied writes or collisions with immutable locked sort values.
type Move = { id: string; sort: number };
type CharacterLike = { id: string; locked?: unknown };
export function filterLockedCharacterMoves<T extends Move>(
  coll: string, moves: T[], next: CharacterLike[], isAdmin: boolean, prev: CharacterLike[],
): T[] {
  if (coll !== 'characters' || isAdmin) return moves;
  if (!next.some(item => item.locked === true)) return moves;
  const nextIds = new Set(next.map(item => item.id));
  const survivors = prev.filter(item => nextIds.has(item.id));
  const sameOrder = survivors.length === next.length && next.length <= prev.length
    && survivors.every((item, i) => item.id === next[i].id);
  if (sameOrder) return [];
  throw new Error('잠긴 캐릭터가 포함된 순서 변경은 관리자만 할 수 있습니다');
}
