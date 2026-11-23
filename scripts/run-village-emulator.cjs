// 마을 에뮬레이터 시험 실행기 — Firestore·Auth 에뮬레이터(127.0.0.1, demo 프로젝트)를 띄우고
// scripts/test-village-emulator.cjs 를 실행한다. 운영 프로젝트에는 연결하지 않는다.
// 필요: firebase CLI, Java 11+ (JAVA_HOME 또는 PATH). 선택: FIREBASE_EMULATORS_PATH(에뮬레이터 jar 캐시)
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'village-emu-'));
const config = path.join(dir, 'firebase.json');
fs.writeFileSync(config, JSON.stringify({
  firestore: { rules: path.join(root, 'firebase', 'firestore.production.rules').replace(/\\/g, '/') },
  emulators: { firestore: { host: '127.0.0.1', port: Number(process.env.VILLAGE_EMU_FS_PORT) || 18294 }, auth: { host: '127.0.0.1', port: Number(process.env.VILLAGE_EMU_AUTH_PORT) || 19209 }, ui: { enabled: false }, singleProjectMode: false },
}));
const env = { ...process.env };
delete env.GOOGLE_APPLICATION_CREDENTIALS;
delete env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (env.JAVA_HOME) env.PATH = `${path.join(env.JAVA_HOME, 'bin')}${path.delimiter}${env.PATH}`;
const script = path.join(root, 'scripts', 'test-village-emulator.cjs').replace(/\\/g, '/');
const cmd = `firebase emulators:exec --only firestore,auth --project demo-ohome-village --config "${config}" "node \\"${script}\\""`;
const r = spawnSync(cmd, { cwd: dir, env, stdio: 'inherit', shell: true });   // 에뮬레이터 로그는 임시 폴더에
fs.rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);
