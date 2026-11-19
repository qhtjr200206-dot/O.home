// Run against a local Firestore emulator with @firebase/rules-unit-testing.
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc } = require(require.resolve('firebase/firestore', {paths: [require.resolve('@firebase/rules-unit-testing')]}));
const projectId = 'demo-ohome-rel-secret';
const root = path.join(__dirname, '..');
async function run(rulesFile, installation) {
  const env = await initializeTestEnvironment({ projectId, firestore: {rules: fs.readFileSync(path.join(root, rulesFile), 'utf8')} });
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async c => {
      const db = c.firestore();
      await setDoc(doc(db, 'meta/owner'), {uid: 'admin', admins: []});
      await setDoc(doc(db, 'rel_secrets/existing'), {authorId: 'author', visibility: 'private', data: {body: 'example'}});
      await setDoc(doc(db, 'rel_secrets/legacy-public'), {authorId: 'author', visibility: 'public', data: {body: 'example'}});
    });
    const anon = env.unauthenticatedContext().firestore();
    const author = env.authenticatedContext('author').firestore();
    const other = env.authenticatedContext('other').firestore();
    const admin = env.authenticatedContext('admin').firestore();
    const ref = (db, id) => doc(db, 'rel_secrets', id);
    const own = {authorId: 'author', visibility: 'private', data: {body: 'example'}};
    await assertFails(getDoc(ref(anon, 'existing')));
    await assertFails(getDoc(ref(other, 'existing')));
    await assertFails(getDoc(ref(anon, 'legacy-public')));
    await assertFails(getDoc(ref(other, 'legacy-public')));
    await assertSucceeds(getDoc(ref(admin, 'existing')));
    if (installation) {
      await assertSucceeds(getDoc(ref(author, 'existing')));
      // A legacy public-tagged secret is visible only to its owner, never to the public.
      await assertSucceeds(getDoc(ref(author, 'legacy-public')));
      await assertSucceeds(getDocs(query(collection(author, 'rel_secrets'), where('authorId', '==', 'author'))));
      await assertFails(getDocs(query(collection(author, 'rel_secrets'), where('visibility', '==', 'public'))));
      await assertSucceeds(setDoc(ref(author, 'created'), own));
      await assertSucceeds(updateDoc(ref(author, 'created'), {'data.body': 'updated'}));
      await assertFails(setDoc(ref(anon, 'anonymous'), own));
      await assertFails(setDoc(ref(other, 'forged'), own));
      await assertFails(setDoc(ref(author, 'public'), {...own, visibility: 'public'}));
      await assertFails(updateDoc(ref(author, 'created'), {authorId: 'other'}));
      await assertFails(updateDoc(ref(author, 'created'), {visibility: 'public'}));
      await assertFails(updateDoc(ref(other, 'created'), {'data.body': 'overwrite'}));
      await assertFails(deleteDoc(ref(other, 'created')));
      await assertSucceeds(deleteDoc(ref(author, 'created')));
      await assertSucceeds(updateDoc(ref(admin, 'existing'), {'data.body': 'admin edit'}));
      const adminUpdated = await assertSucceeds(getDoc(ref(admin, 'existing')));
      if (adminUpdated.data().authorId !== 'author') throw new Error('admin edit changed original author');
      await assertFails(updateDoc(ref(admin, 'existing'), {authorId: 'admin'}));
      await assertSucceeds(setDoc(ref(admin, 'admin-created'), own));
      await assertFails(updateDoc(ref(admin, 'admin-created'), {authorId: 'other'}));
      await assertFails(updateDoc(ref(admin, 'admin-created'), {visibility: 'public'}));
      await assertSucceeds(deleteDoc(ref(admin, 'admin-created')));
    } else {
      await assertFails(getDoc(ref(author, 'existing')));
      await assertFails(setDoc(ref(author, 'created'), own));
      await assertSucceeds(setDoc(ref(admin, 'created'), own));
      await assertSucceeds(deleteDoc(ref(admin, 'created')));
    }
    console.log(`${rulesFile}: Firestore authorization cases passed`);
  } finally { await env.cleanup(); }
}
(async () => { await run('firebase/firestore.rules', true); await run('firebase/firestore.production.rules', false); })().catch(e => { console.error(e); process.exitCode = 1; });
