# 도트 캐릭터(PixelAvatar) 참고자료·오픈소스 조사

작성: 2026-11-20 · 대상: `src/components/chars/pixelAvatarArt.ts`, `PixelAvatar.tsx`

## 결론 요약

- 외부 아트·코드를 **복사하거나 설치하지 않았다.** 128×128 원본 격자의 모든 파츠(머리 24, 표정 24, 몸 24)는 이 저장소에서 도형 래스터라이저로 직접 그렸다. 따라서 별도 저작권 고지 파일(`public/licenses/`)은 필요 없다.
- 이유
  1. 요구 조건(원본 100×100 이상, 레이어 교체형, 각 요소 20종 이상, 색 자유 변경)에 맞는 **라이선스가 명확한 레이어형 에셋이 없다.** 공개 레이어형 캐릭터 시스템은 대부분 64×64 이하(LPC 64×64, Mana Seed 64×64, Kenney·Ninja Adventure 16~18px)이다. 이를 128로 쓰려면 확대가 되어, 사용자가 불합격 처리한 "확대 재사용"과 같아진다.
  2. 가장 큰 레이어형 자유 에셋인 LPC는 **CC-BY-SA 3.0 / GPL 3.0** 이라 파생 아트 전체에 동일 라이선스·저작자 표기 의무가 전염된다(사이트 내 사용자 캐릭터 이미지 포함). 개인 사이트에서 관리 부담이 크고, 128 격자와 맞지 않는다.
  3. 상용 에셋(Mana Seed 등)은 **재배포 금지** 조건이 있어 오픈 저장소에 커밋할 수 없다.
  4. CC0 에셋(Kenney, Ninja Adventure 등)은 라이선스는 이상적이지만 해상도·화풍·파츠 구성이 맞지 않는다.
- 대신 아래 자료의 **기법**(선택적 외곽선, 색조 이동 램프, 좌상단 광원 셀 셰이딩, 1px 외곽선 규칙, 필로우 셰이딩/밴딩 회피, 치비 비율)을 참고해 구현했다. 기법·아이디어는 저작물 복사가 아니다.

## 오픈소스 / 에셋 평가

| 자료 | 링크 | 해상도·구성 | 코드 라이선스 | 아트 라이선스 | 상업 사용 / 표기 의무 | 판단 |
|---|---|---|---|---|---|---|
| Universal LPC Spritesheet Character Generator | https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator , 데모 https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/ | 64×64 프레임, 몸·머리·옷 레이어 다수, 걷기/공격 애니메이션 | GPL-3.0 | 파츠별 CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0 등 혼재, 생성기가 크레딧 CSV 제공 | 가능하나 **모든 기여자 표기 + 동일 라이선스(SA) 공유 의무** | 배제: 64px(128로는 확대), SA·GPL 전염, 파츠별 라이선스 추적 부담. 레이어 구조(같은 앵커에 맞춘 시트)는 설계 참고 |
| LPC 스타일 가이드 | https://lpc.opengameart.org/static/LPC-Style-Guide/build/styleguide.html | 문서 | – | 문서(아트 사용권 아님) | – | 참고만: 광원 방향·팔레트 통일 원칙 |
| Kenney (Modular Characters 등) | https://kenney.nl/assets/modular-characters , https://kenney.nl/assets | 저해상도 픽셀/벡터, 모듈식 | – | **CC0 1.0** | 상업 가능, 표기 불필요 | 배제: 화풍·해상도 불일치(128 치비 커스터마이저용 레이어 없음). 라이선스 면에선 가장 안전 |
| Ninja Adventure Asset Pack (pixel-boy) | https://pixel-boy.itch.io/ninja-adventure-asset-pack , https://github.com/pixel-boy/NinjaAdventure | 16×16 캐릭터 50+ | – | CC0 (itch 페이지 기준) | 상업 가능, 표기 불필요 | 배제: 16px 고정 캐릭터, 파츠 교체 불가 |
| OpenGameArt "Pixel Art Character" | https://opengameart.org/content/pixel-art-character | 64×64 단일 캐릭터 애니메이션 | – | CC0 | 상업 가능 | 배제: 단일 캐릭터, 커스터마이즈 불가 |
| OpenGameArt CC0 Character Customization 컬렉션 | https://opengameart.org/content/cc0-character-customization | 주로 3D/저해상도 | – | 항목별 CC0 표기(개별 확인 필요) | – | 배제: 2D 128 레이어 파츠 없음 |
| Mana Seed Character Base (Seliel the Shaper) | https://seliel-the-shaper.itch.io/character-base | 64×64 페이퍼돌 레이어 | – | 상용 사용자 라이선스(구매자 사용 가능, **원본 재배포 금지**) | 구매 필요 | 배제: 유료, 오픈 저장소 커밋 불가, 64px |
| pixel-sprite-generator (zfedoran) | https://github.com/zfedoran/pixel-sprite-generator | 마스크 무작위 생성(우주선/몬스터) | MIT | 생성물 | 상업 가능, MIT 고지 | 배제: 인물 치비 생성에 부적합. "마스크 → 외곽선 → 명암" 파이프라인 아이디어만 참고(코드 미사용) |
| Character Sprite Generator (ilomon10/csg) | https://github.com/ilomon10/csg | 레이어 조합 | MIT | 일부 에셋 출처 불명 | – | 배제(이전 조사): 기능 다수 미완, 에셋 출처 확인 불가 → 복사 금지 원칙 |

라이선스 확인 방법: 각 프로젝트 공식 페이지/README의 라이선스 문구를 2026-11-20에 웹 검색 결과로 확인했다. 실제 다운로드·사용을 하지 않았으므로 파일 단위 LICENSE 검증은 하지 않았다. 향후 외부 아트를 도입할 경우 원본 LICENSE 파일을 `public/licenses/`에 함께 커밋해야 한다.

## 디자인 참고자료(기법)

| 자료 | 링크 | 적용한 내용 |
|---|---|---|
| Derek Yu, Pixel Art Tutorial: Basics | https://derekyu.com/makegames/pixelart.html | 선택적 외곽선(selout), 3단계 이상 명암 |
| Lospec, Pixel Art Outlines (1·2부) | https://lospec.com/articles/pixel-art-outlines , https://lospec.com/articles/pixel-art-outlines-part-2-using-color | 1px 외곽선은 대각선으로만 이어지게(레이어 내부 경계 4-이웃 판정으로 자동 생성), 외곽선은 검정 대신 각 재질의 가장 어두운 램프색 |
| Pixor, What is selout | https://pixor.art/learn/selout/ | 광원 쪽(좌상단) 외곽선은 한 단계 밝게, 그림자 쪽은 가장 어둡게 유지 → `render()`의 `r && d ? 4 : 5` |
| the-pixel.art, Hue Shifting | https://the-pixel.art/articles/hue-shifting-pixel-art-shading/ | 하이라이트는 노랑 쪽, 그림자는 파랑/보라 쪽으로 색조 이동, 피부는 붉은 쪽으로 약하게(피부 램프 `soft = 0.72`), 순검정 외곽선 지양 |
| 셰이딩 튜토리얼(필로우 셰이딩·밴딩) | https://youtube.com/watch?v=2Tuf2Uk2E34 | 모든 가장자리를 어둡게 하는 필로우 셰이딩 대신 광원 반대편(우하단)에만 그림자 오프셋, 디더링 사용 안 함(스터블 표현 2곳 제외) |
| klad pixel skill 문서 | https://raw.githubusercontent.com/klad-app/klad/main/docs/skill/pixel/SKILL.md | "그림자는 형태의 먼 쪽과 돌출부 아래" → 앞머리가 이마에 드리우는 그림자, 턱 아래 목 그림자(cast) |

## 구현 방식(직접 제작)

- `pixelAvatarArt.ts`: DOM 없는 순수 래스터라이저. 128×128 레이어 마스크에 타원·다각형·가변 두께 베지어 획(머리카락 다발)·캡슐을 픽셀 중심 샘플링으로 채움.
- 레이어마다 자동 1px 셀프 컬러 외곽선(재질 램프의 outline 색, 광원 쪽은 deep 색) → 우하단 오프셋 그림자 → 선택적 하이라이트 → 명시적 톤(주름, 머리 결, 엔젤링).
- 입력 HEX → HSL 5단계 램프(하이라이트/기본/그림자/깊은 그림자/외곽선). 명도를 0.17~0.86으로 클램프해 검정·흰색에서도 명암과 외곽선이 남는다.
- 공통 앵커: 머리 중심 (64,45), 턱 y69, 목 x59–68, 어깨 y76, 허리 y100, 발 y116–124. 머리+헤어 ≈ 전체 높이의 50%(치비).
- 단계 순서: back(긴 머리·망토·후드) → legs → feet → neck → torso → over(옷 위 장식) → arms → hands → head → face → hair → hat → top(안경·땀·반창고).

## 남은 한계

- 정면 정지 포즈 1프레임만 있다. 걷기 애니메이션·방향 전환은 없다(LPC 수준의 게임 애니메이션 미지원).
- 셀 셰이딩은 오프셋 마스크 기반 자동 처리라 손으로 찍은 도트보다 형태감이 단순하다. 안티에일리어싱은 넣지 않았다.
- 표정은 얼굴 영역(약 50×30px)만 바뀌므로 스타일 간 최소 차이 픽셀이 머리·몸보다 작다(테스트 기준 180px).
