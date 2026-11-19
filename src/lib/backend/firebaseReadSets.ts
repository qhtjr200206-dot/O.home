// Firestore rejects a query if its possible results violate rules, even when
// the actual documents would be private. Secret collections need an author query.
export async function firebaseReadSets<T>(
  coll: string,
  uid: string | null,
  isAdmin: () => Promise<boolean>,
  where: (field: string, op: '==' | 'in', value: string | string[]) => T,
): Promise<T[][]> {
  if (coll === 'rel_secrets' && !uid) return [];
  if (!uid) return [[where('visibility', '==', 'public')]];
  if (await isAdmin()) return [[]];
  if (coll === 'rel_secrets') return [[where('authorId', '==', uid)]];
  return [[where('visibility', 'in', ['public', 'member'])], [where('authorId', '==', uid)]];
}

/** Update secret content without replacing its immutable top-level authorId. */
export function firebaseSecretUpdate<T>(
  coll: string, existing: boolean, item: T,
  meta: { visibility: string; editorIds: string[] }, sort: number, updatedAt: number,
) {
  if (coll !== 'rel_secrets' || !existing) return null;
  return { data: item, visibility: meta.visibility, editorIds: meta.editorIds, sort, updatedAt };
}
