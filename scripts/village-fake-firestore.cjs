// 마을 서버 시험용 메모리 Firestore — Java(에뮬레이터)가 없는 PC에서도 server.ts의 흐름(생성·입장·조작·깨우기)을
// 돌려 보기 위한 최소 구현이다. (v2.0 사용자 제보 — '캐릭터 선택 불가'를 운영 데이터 모양 그대로 재현하려고 만듦)
// 보안 규칙·동시성 충돌은 흉내 내지 않는다. 그 검사는 여전히 scripts/test-village-emulator.cjs(실제 에뮬레이터) 몫이다.
'use strict';

let autoN = 0;
const autoId = () => {
  autoN++;
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0, n = autoN * 7919 + 12345; i < 20; i++, n = Math.floor(n / 3) + i * 31) s += abc[(n + i * 17) % abc.length];
  return s;
};
const clone = v => (v === undefined ? undefined : structuredClone(v));

function applyTransforms(prev, data) {
  // FieldValue.increment 같은 변환만 지원(bumpRoomFails)
  const out = { ...data };
  for (const [k, v] of Object.entries(out)) {
    if (v && typeof v === 'object' && v.constructor && v.constructor.name === 'NumericIncrementTransform') out[k] = (Number(prev?.[k]) || 0) + v.operand;
  }
  return out;
}

class Snap {
  constructor(ref, entry) { this.ref = ref; this.id = ref.id; this._e = entry; }
  get exists() { return !!this._e; }
  get createTime() { return this._e ? this._e.createTime : undefined; }
  data() { return this._e ? clone(this._e.data) : undefined; }
}
class QuerySnap {
  constructor(docs) { this.docs = docs; }
  get empty() { return this.docs.length === 0; }
  get size() { return this.docs.length; }
}

class DocRef {
  constructor(db, path) { this._db = db; this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new Query(this._db, `${this.path}/${name}`); }
  async get() { return new Snap(this, this._db._docs.get(this.path)); }
  async set(data) { this._db._write(this.path, data, 'set'); }
  async create(data) { this._db._write(this.path, data, 'create'); }
  async update(data) { this._db._write(this.path, data, 'update'); }
  async delete() { this._db._docs.delete(this.path); }
}

class Query {
  constructor(db, coll, filters = [], order = null, lim = Infinity) { this._db = db; this._coll = coll; this._f = filters; this._o = order; this._l = lim; this.id = coll.split('/').pop(); }
  doc(id) { return new DocRef(this._db, `${this._coll}/${id ?? autoId()}`); }
  where(field, op, value) { return new Query(this._db, this._coll, [...this._f, [field, op, value]], this._o, this._l); }
  orderBy(field, dir = 'asc') { return new Query(this._db, this._coll, this._f, [field, dir], this._l); }
  limit(n) { return new Query(this._db, this._coll, this._f, this._o, n); }
  async get() { return this._run(); }
  _run() {
    const depth = this._coll.split('/').length + 1;
    let rows = [...this._db._docs.entries()].filter(([p]) => p.startsWith(`${this._coll}/`) && p.split('/').length === depth);
    for (const [f, op, v] of this._f) {
      rows = rows.filter(([, e]) => {
        const x = e.data[f];
        return op === '==' ? x === v : op === '>' ? x > v : op === '<' ? x < v : op === '>=' ? x >= v : op === '<=' ? x <= v : false;
      });
    }
    if (this._o) {
      const [f, dir] = this._o;
      rows.sort((a, b) => (a[1].data[f] > b[1].data[f] ? 1 : a[1].data[f] < b[1].data[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    rows = rows.slice(0, this._l);
    return new QuerySnap(rows.map(([p, e]) => new Snap(new DocRef(this._db, p), e)));
  }
}

class FakeFirestore {
  constructor() { this._docs = new Map(); this._clock = 1_700_000_000; }
  collection(name) { return new Query(this, name); }
  /** 시험 데이터 심기 — createTime을 정해 줄 수 있다(운영 문서의 생성 시각 재현) */
  seed(path, data, createTime) {
    this._docs.set(path, { data: clone(data), createTime: createTime ?? { seconds: this._clock++, nanoseconds: 0 } });
  }
  _write(path, data, mode) {
    const prev = this._docs.get(path);
    if (mode === 'create' && prev) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 });
    if (mode === 'update' && !prev) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
    const next = mode === 'update' ? { ...prev.data, ...applyTransforms(prev.data, data) } : applyTransforms(prev?.data, data);
    this._docs.set(path, { data: clone(next), createTime: prev ? prev.createTime : { seconds: this._clock++, nanoseconds: 0 } });
  }
  async getAll(...refs) { return refs.map(r => new Snap(r, this._docs.get(r.path))); }
  async runTransaction(fn) {
    const ops = [];
    const tx = {
      get: async target => (target instanceof DocRef ? new Snap(target, this._docs.get(target.path)) : target._run()),
      set: (ref, data) => { ops.push(() => this._write(ref.path, data, 'set')); return tx; },
      create: (ref, data) => { ops.push(() => this._write(ref.path, data, 'create')); return tx; },
      update: (ref, data) => { ops.push(() => this._write(ref.path, data, 'update')); return tx; },
      delete: ref => { ops.push(() => this._docs.delete(ref.path)); return tx; },
    };
    const out = await fn(tx);
    for (const op of ops) op();   // 성공한 트랜잭션만 한꺼번에 반영
    return out;
  }
  batch() {
    const ops = [];
    return { delete: ref => ops.push(() => this._docs.delete(ref.path)), commit: async () => ops.forEach(o => o()) };
  }
  async recursiveDelete(ref) { for (const p of [...this._docs.keys()]) if (p === ref.path || p.startsWith(`${ref.path}/`)) this._docs.delete(p); }
}

module.exports = { FakeFirestore };
