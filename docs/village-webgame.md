# 마을(웹게임) · 도트 캐릭터 — 설계·조사·검증 기록

상태와 결과는 이 문서 끝의 「검증 기록」에 실제 실행 결과만 적는다.

## 1. 사용자 요구 → 구현 위치

| 요구(4_webgame.md) | 구현 |
| --- | --- |
| (1) 도트 머리/표정/몸 파츠 커스텀, 캐릭터 프로필 연결 | `src/components/chars/PixelAvatar.tsx`·`pixelAvatarArt.ts`(128×128 원본 격자, 각 24종, 머리·눈·피부·옷 색 picker+HEX). 캐릭터 편집(`CharEditForm`)에서 저장 → 상세 표시 → 마을 스프라이트 |
| (2) 자관별 마을맵: 캐릭터·주요 장소·NPC·세계관 입력 → 랜덤 맵 | `CreateRoomForm`(자관 선택 시 멤버 자동 선택), `map.ts`(시드·시대·장소 이름 → 건물/물가/숲/밭, 세계관 설명의 낱말 → 지형 성격(물가·숲·황무지·꽃), 길 연결 보장) |
| (3) 시간대별 자율 이동·상호작용 | `sim.ts` — 한국 시각 6구간(새벽·아침·점심·오후·저녁·밤), 10분마다 목적지, 같은 장소에 모이면 짝지어 어울림, 밤엔 집에서 잠. 자는 캐릭터는 초상 카드·'마을 사람들'의 ⏰로 깨울 수 있음(조작 가능한 내 캐릭터가 깨움, 30분 깨어 있음; 서버가 같은 시뮬레이션으로 자는지 확인, `wake` 하위 문서·소식 기록) |
| (4) 권한자 조작: 이동·미니게임·선물·무전/편지/폰 | `VillageGame` — 맵 탭/클릭·방향키·한 칸 버튼 이동, 별 줍기·짝 맞추기(서버가 입력을 재생해 점수 계산, `games.ts`), 시대별 선물 5종, SF 무전·과거 편지·현대 폰 UI. 캐릭터 도트는 원본 캐릭터 문서를 매번 다시 읽어 기존 방에도 바로 반영, 고른 캐릭터의 128px 초상 카드. 지도·'마을 사람들'에서 캐릭터를 눌러도 조작 대상으로 고르고, 들어오면 조작 가능한 첫 캐릭터를 미리 고른다 |
| (5) 방 독립·배타, 비밀번호 | 서버 전용 저장(`village_*`), 비밀번호 scrypt + 시도 제한, 방 세션 토큰 |
| (6) 관리자 무제한, 가입자 제한 | 사용자 확정(room_policy_decision.md): 가입자 동시 1개, 삭제하면 재생성. 트랜잭션으로 강제 |
| (7) 비조작 시 설정값대로 이동 + 입력한 대사 출력 | 성격 5종·집·대사(최대 8줄) — `sim.ts`가 말풍선 출력 빈도와 동선 결정, 조작 후 5분 지나면 자율 복귀 |
| chuuns.com 하위 연결 | log.chuuns.com/village + 자관 목록의 「🏡 마을」 버튼 + 메뉴 기능 목록(`menu.ts`). chuuns.com/village 는 허브(Vercel 정적 프로젝트 chuuns-hub)에 리다이렉트로 연결 |

## 2. 구조 판단

- 렌더링: Canvas 2D 직접 구현. Phaser(MIT)·PixiJS(MIT)를 검토했으나 타일 28×20·캐릭터 20명 규모에 비해 번들(수백 KB)과 학습 비용이 커서 채택하지 않았다. 새 런타임 의존성 없음.
- 동기화: 자율 행동은 시드·시각으로 모든 클라이언트가 같은 결과를 계산(서버 쓰기 없음). 조작·이벤트만 서버에 쓰고 3초 폴링(탭이 숨으면 10초). Firestore 실시간 구독은 클라이언트 직접 접근을 열어야 하므로 쓰지 않았다.
- 백엔드: 운영은 Firebase. Supabase 연결에서는 마을을 열지 않는다(안내만).
- 보안 설계: `src/lib/village/SECURITY.md`.

## 3. 도구·오픈소스 조사(웹게임)

| 대상 | 출처·라이선스 | 판단 |
| --- | --- | --- |
| Firebase Local Emulator Suite (firebase-tools) | Google, MIT | 채택 — 실제 Firestore/Auth 동작으로 공격·경합 시험. 운영과 분리된 demo 프로젝트만 사용 |
| @firebase/rules-unit-testing 5.0.2 | Google, Apache-2.0 | 채택(이미 devDependency) — 운영·설치 규칙에서 클라이언트 직접 접근 거부 검증 |
| Phaser / PixiJS | MIT | 미채택 — 위 2번 이유 |
| LPC 캐릭터 생성기 등 도트 에셋 | GPL/CC-BY-SA 혼합, 64px | 미채택 — 상세는 `docs/pixel-avatar-research.md` |

설치 전 확인: firebase-tools는 이미 전역 설치(15.24.0)되어 있었고, 에뮬레이터 JAR·JRE는 저장소 밖 Hermes 스크래치 폴더에 두었다. 운영 자격 증명은 시험 프로세스에서 제거한다(`run-village-emulator.cjs`).

## 4. 선행 플레이리스트(/cover) 작업 경로 조사

- 근거: 커밋 `2292dfa`(스튜디오·초대 게이트), `401f6aa`(테마·폰트 OFL), `99aa641`(렌더·오디오·내보내기 엔진), 같은 날 19:45 연속 커밋. 당시 지시문 `hobby/cache/scratch/lead-brief-20261118*.md`, `cover-*.md`.
- 확인된 절차: 팀장 세션이 설계·통합·검증·커밋·배포를 맡고 design/fe/media/qa/review 역할을 `delegate_task`로 나눔, `claude-design`·`popular-web-designs` 스킬 참고, qa가 dev 서버에서 실제 업로드·내보내기·ffprobe 확인, `npm run build` 후 `git push origin main` → Vercel 자동 배포를 `vercel ls o-home`로 확인 → 운영 URL 응답 확인.
- 확인되지 않은 것: 당시 각 역할의 실제 모델명. 커밋 통계만으로 단정하지 않는다.
- 이번 작업은 같은 경로(팀장 통합 + 역할별 독립 세션 + 실제 브라우저 QA + 빌드 + push 자동 배포 확인)를 따르되, delegate 한도를 피하려고 역할 세션을 `hermes -p hobby chat --oneshot` 별도 프로세스로 띄웠다.

## 5. 역할·세션 기록(실제)

모든 세션은 hobby 프로필, 런타임 표기 모델 `claude-opus-5-5`(provider anthropic). 서로 다른 모델이 아니며, 같은 모델의 독립 세션으로 역할만 분리했다. 회사 계정·자격 증명은 쓰지 않았다.

| 역할 | 세션 | 산출 |
| --- | --- | --- |
| 팀장(설계·서버·게임 구현·통합) | 이 문서를 쓴 상위 세션 | village 전체, 에뮬레이터 시험, 브라우저 확인 |
| 도트 구현·조사 | `hermes -p hobby` oneshot, session local-70ea9cc0… | PixelAvatar 재설계, 시험, `docs/pixel-avatar-research.md` |
| 독립 QA(기능·시각·모바일) | 별도 oneshot, 17_qa | 아래 검증 기록 |
| 독립 보안 리뷰 | 별도 oneshot, 18_security | 아래 검증 기록 |

이전 재시도 세션들(gpt-6.1-terra 표기)의 기록은 `docs/village-*-review*.md`, `docs/village-security-plan.md`에 남아 있다.

## 6. 검증 기록

### v3 실제 검증 (2026-11-24)

- `npx tsc --noEmit -p tsconfig.json`, `npx next build`: 성공. `node scripts/test-village-{map,games,password,wake,economy}.cjs` 각각 통과. 맵은 1,500개 시드의 지형과 길 연결을 검사했다.
- `node scripts/run-village-emulator.cjs`: demo Firestore/Auth 50/50 통과. 선물 재고 차감과 방 삭제 시 econ·houses·bonds 삭제 포함. 기존 규칙의 authorId 위조 허용은 기존 사이트 보안 한계로 시험에서 재현됐다.
- 브라우저: 메모리 DB와 읽기 전용 운영 스냅샷으로 집 입장·퇴장, 가구 배치·회전·회수·문 막기 거부, 상점 구매·집 확장·바닥/벽, 채집, 출석 레벨업, 바다 해안, 모바일 390px 시트를 확인했다. 운영 데이터 쓰기는 하지 않았다.
- 레벨 점검: 상점/집/채집 아이콘과 보상 안내 확인, 광장과 장소 간 연결은 1,500개 시드 검사, 문 및 문 앞 차단과 BFS 접근성은 서버 테스트로 거부 확인. 모바일 화면 가로 넘침은 없었다. 실제 사용자 대상 장기 플레이 관찰은 아직 없다.
- 경제 30일 시뮬레이션: 가끔 L8(1,827 EXP, 수입 2,240, 가구 11, 집 2), 보통 L13(4,638, 5,151, 16, 집 2), 최대 L17(7,647, 8,250, 22, 집 3). 현대 가구·바닥·벽·집 확장 총액 9,080 > 최대 수입 8,250.


## 그래픽 (render.ts)
- 시대별 건물 도트를 코드로 직접 그린다: 과거(초가집·주막·서당·누각·우물·당산나무·허수아비), 현대(박공지붕 주택·차양 카페·벽돌 학교·유리 빌딩·분수·벤치 공원·비닐하우스), SF(거주 돔·네온 상점·아카데미·관제탑·냉각수 펌프·거대 수정·수경 돔).
- 도트 원칙: 정수 격자, 재질별 색조 이동 램프(`src/lib/village/pixelRamp.ts`), 셀프컬러 외곽선, 왼쪽 위 광원. 건물·나무·가로등은 소품으로 캐릭터와 y순 정렬.
- 지형: 잡음 얼룩 풀·풀포기, 시대별 길(흙길·보도블록·금속 갑판+유도선)과 광장(박석·벽돌·격자판), 깊이 있는 물과 물가선, 밭 고랑, 두 장 번갈아 그리는 물결.
- 조명: 시간대 곱하기 색 + 어둠 층에서 창문·가로등·간판 불빛 자리를 도려내고 더하기로 번지게 한다.
- 캐릭터 스프라이트는 32×32 원본(`pixelAvatarGrid`)을 정수 배율로만 키운다.
- 시험: `node scripts/test-village-wake.cjs`(깨우기 시뮬레이션·서버 검증, 메모리 Firestore `scripts/village-fake-firestore.cjs`).
