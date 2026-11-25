// 마을 상점 카탈로그 — 순수 데이터(가져오기 없음). 서버는 가격·해금 레벨을 여기서만 읽고 클라이언트가 보낸 값은 믿지 않는다.
// (v3 사용자 요청 — 선물과 집 꾸미기 아이템은 재화로 산다) 숫자는 docs/village-gdd.md 3·5장을 따른다.
//  · 시대별 선물 12종: 15/30/60/100/150 가격대, 레벨 1·3·6·10 단계로 4+3+3+2종.
//  · 시대별 가구 24종: 같은 자리(모양)를 시대 이름·팔레트·형태로 다시 그린다(render.ts furnitureArt).
//    1단계 8, 3단계 +6, 6단계 +6, 10단계 시대 대표 4종(600). 레벨 20 황금 액자는 칭호 보상이라 따로 둔다.
//  · 바닥재·벽지: 시대 기본(무료) + 상품 2종씩. 레벨 5에 무늬 바닥재·벽지가 열린다.
//  · 집 확장: 2단계 800(레벨 5), 3단계 2,000(레벨 10).

export type CatEra = 'past' | 'modern' | 'sf';
export interface GiftItem { id: string; label: string; icon: string; price: number; level: number }
export interface FurnitureItem {
  id: string; label: string; icon: string; price: number; level: number;
  /** 회전 전 크기(칸) */ w: number; h: number;
  /** 그림 모양(render.ts) */ shape: string;
  /** 위를 걸어 다닐 수 있는 깔개(러그·방석) — 실내 길 막힘 검사에서 바닥으로 센다 */ walk?: boolean;
}
export interface StyleItem { id: string; label: string; kind: 'floor' | 'wall'; price: number; level: number }

const g = (id: string, label: string, icon: string, price: number, level: number): GiftItem => ({ id, label, icon, price, level });
/** 기존 방의 선물 id(flower·tea·coffee… 5종)는 그대로 두어 예전 소식 기록이 계속 보인다 */
export const GIFT_CATALOG: Record<CatEra, GiftItem[]> = {
  past: [
    g('flower', '들꽃 다발', '🌼', 15, 1), g('tea', '찻잎', '🍵', 15, 1), g('rice-cake', '떡', '🍡', 30, 1), g('book', '낡은 책', '📖', 30, 1),
    g('yakgwa', '약과', '🍪', 30, 3), g('hairpin', '비녀', '📍', 60, 3), g('norigae', '노리개', '🎐', 60, 3),
    g('fan', '태극선 부채', '🪭', 60, 6), g('silk', '비단 한 필', '🧣', 100, 6), g('ginseng', '산삼', '🌿', 100, 6),
    g('jade-ring', '옥가락지', '💍', 150, 10), g('porcelain', '백자 연적', '🏺', 150, 10),
  ],
  modern: [
    g('coffee', '커피', '☕', 15, 1), g('candy', '사탕 한 봉지', '🍬', 15, 1), g('cake', '조각 케이크', '🍰', 30, 1), g('bouquet', '꽃다발', '💐', 30, 1),
    g('ticket', '영화표', '🎟️', 30, 3), g('plush', '인형', '🧸', 60, 3), g('candle', '향초', '🕯️', 60, 3),
    g('headphones', '헤드폰', '🎧', 60, 6), g('perfume', '향수', '🧴', 100, 6), g('console', '게임기', '🎮', 100, 6),
    g('necklace', '목걸이', '📿', 150, 10), g('camera', '필름 카메라', '📷', 150, 10),
  ],
  sf: [
    g('ration', '우주 식량', '🥫', 15, 1), g('battery', '에너지 셀', '🔋', 15, 1), g('chip', '데이터 칩', '💾', 30, 1), g('jelly', '별빛 젤리', '🍮', 30, 1),
    g('holocard', '홀로 엽서', '🌌', 30, 3), g('drone', '소형 드론', '🛸', 60, 3), g('orb', '중력 구슬', '🔮', 60, 3),
    g('crystal', '성간 크리스탈', '💎', 60, 6), g('robopet', '로봇 펫', '🤖', 100, 6), g('nanoflower', '나노 꽃', '🌺', 100, 6),
    g('starmap', '별자리 지도', '🗺️', 150, 10), g('planet', '행성 모형', '🪐', 150, 10),
  ],
};

/** 시대 공통 가구 자리 — [id, 모양, w, h, 가격, 레벨, 깔개?, [과거, 현대, SF 이름], 아이콘] */
type Slot = [string, string, number, number, number, number, boolean, [string, string, string], string];
const SLOTS: Slot[] = [
  // 레벨 1 (8종): 소품 30 · 의자·러그 80 · 탁자·침대 150
  ['f-plant', 'plant', 1, 1, 30, 1, false, ['분재', '화분', '발광 식물'], '🪴'],
  ['f-lamp', 'lamp', 1, 1, 30, 1, false, ['호롱불', '스탠드', '홀로 램프'], '💡'],
  ['f-cushion', 'cushion', 1, 1, 30, 1, true, ['방석', '쿠션', '중력 쿠션'], '🟫'],
  ['f-chair', 'chair', 1, 1, 80, 1, false, ['나무 걸상', '의자', '부유 의자'], '🪑'],
  ['f-rug', 'rug', 2, 1, 80, 1, true, ['꽃자리', '러그', '빛 매트'], '🧶'],
  ['f-chest', 'chest', 1, 1, 80, 1, false, ['반닫이', '수납 상자', '보관 캡슐'], '🧰'],
  ['f-table', 'table', 2, 1, 150, 1, false, ['소반', '탁자', '홀로 탁자'], '🪵'],
  ['f-bed', 'bed', 1, 2, 150, 1, false, ['이부자리', '침대', '수면 포드'], '🛏️'],
  // 레벨 3 (+6종)
  ['f-clock', 'clock', 1, 1, 80, 3, false, ['향로', '괘종시계', '시간 표시기'], '🕰️'],
  ['f-mirror', 'mirror', 1, 1, 80, 3, false, ['경대', '전신 거울', '홀로 거울'], '🪞'],
  ['f-desk', 'desk', 2, 1, 150, 3, false, ['서안', '책상', '콘솔 책상'], '🖋️'],
  ['f-sofa', 'sofa', 2, 1, 150, 3, false, ['평상', '소파', '라운지 소파'], '🛋️'],
  ['f-shelf', 'shelf', 2, 1, 300, 3, false, ['책장', '책장', '데이터 서가'], '📚'],
  ['f-stove', 'stove', 2, 1, 300, 3, false, ['부뚜막', '주방 조리대', '합성 조리기'], '🍳'],
  // 레벨 6 (+6종)
  ['f-lantern', 'lantern', 1, 1, 80, 6, false, ['청사초롱', '플로어 조명', '플라스마 기둥'], '🏮'],
  ['f-bigplant', 'bigplant', 1, 1, 150, 6, false, ['매화 화분', '몬스테라', '외계 덩굴'], '🌿'],
  ['f-jar', 'jar', 1, 1, 150, 6, false, ['물항아리', '어항', '배양 수조'], '🫙'],
  ['f-screen', 'screen', 2, 1, 150, 6, false, ['대나무 발', '파티션', '에너지 장막'], '🎋'],
  ['f-wardrobe', 'wardrobe', 2, 1, 300, 6, false, ['장롱', '옷장', '보관 벽장'], '🚪'],
  ['f-dining', 'dining', 2, 2, 300, 6, false, ['교자상', '식탁 세트', '회의 테이블'], '🍽️'],
];
/** 레벨 10 시대 대표 가구(600) — 시대마다 모양이 전혀 다르다 */
const SIGNATURE: Record<CatEra, [string, string, number, number, string][]> = {
  past: [['f-byeongpung', '십장생 병풍', 2, 1, '🖼️'], ['f-gayageum', '가야금', 2, 1, '🎶'], ['f-jagae', '자개장', 2, 1, '🗄️'], ['f-moonjar', '달항아리', 1, 1, '🏺']],
  modern: [['f-piano', '업라이트 피아노', 2, 1, '🎹'], ['f-tv', '대형 TV', 2, 1, '📺'], ['f-arcade', '오락기', 1, 1, '🕹️'], ['f-massage', '안마의자', 1, 1, '💺']],
  sf: [['f-holotable', '홀로그램 작전대', 2, 1, '🛰️'], ['f-cryopod', '냉동 수면 캡슐', 1, 2, '🧊'], ['f-robot', '로봇 집사', 1, 1, '🤖'], ['f-planetarium', '별자리 투영기', 1, 1, '🌠']],
};
/** 레벨 20 칭호 '마을의 전설' 보상 */
const GOLD_FRAME = (era: CatEra): FurnitureItem => ({
  id: 'f-goldframe', label: era === 'sf' ? '황금 홀로 액자' : '황금 액자', icon: '🖼️', price: 600, level: 20, w: 1, h: 1, shape: 'goldframe',
});

const eraIndex: Record<CatEra, number> = { past: 0, modern: 1, sf: 2 };
export const FURNITURE_CATALOG: Record<CatEra, FurnitureItem[]> = Object.fromEntries((['past', 'modern', 'sf'] as CatEra[]).map(era => [era, [
  ...SLOTS.map(([id, shape, w, h, price, level, walk, names, icon]) => ({ id, label: names[eraIndex[era]], icon, price, level, w, h, shape, ...(walk ? { walk } : {}) })),
  ...SIGNATURE[era].map(([id, label, w, h, icon]) => ({ id, label, icon, price: 600, level: 10, w, h, shape: id.slice(2) })),
  GOLD_FRAME(era),
]])) as Record<CatEra, FurnitureItem[]>;

const s = (id: string, label: string, kind: 'floor' | 'wall', price: number, level: number): StyleItem => ({ id, label, kind, price, level });
/** 바닥재·벽지 — 가격 0은 시대 기본(처음부터 가진 것) */
export const STYLE_CATALOG: Record<CatEra, StyleItem[]> = {
  past: [
    s('floor-ondol', '노란 장판', 'floor', 0, 1), s('floor-maru', '대청마루', 'floor', 80, 1), s('floor-mat', '꽃돗자리 무늬', 'floor', 150, 5),
    s('wall-mud', '흙벽', 'wall', 0, 1), s('wall-hanji', '한지 벽', 'wall', 80, 1), s('wall-dancheong', '단청 무늬 벽', 'wall', 150, 5),
  ],
  modern: [
    s('floor-wood', '원목 마루', 'floor', 0, 1), s('floor-tile', '체크 타일', 'floor', 80, 1), s('floor-herring', '헤링본 무늬', 'floor', 150, 5),
    s('wall-white', '흰 벽', 'wall', 0, 1), s('wall-stripe', '줄무늬 벽지', 'wall', 80, 1), s('wall-flower', '꽃무늬 벽지', 'wall', 150, 5),
  ],
  sf: [
    s('floor-deck', '금속 갑판', 'floor', 0, 1), s('floor-grid', '발광 격자', 'floor', 80, 1), s('floor-hex', '육각 패널 무늬', 'floor', 150, 5),
    s('wall-panel', '선체 패널', 'wall', 0, 1), s('wall-neon', '네온 띠 벽', 'wall', 80, 1), s('wall-star', '별빛 창 벽', 'wall', 150, 5),
  ],
};
export const defaultStyle = (era: CatEra, kind: 'floor' | 'wall') => STYLE_CATALOG[era].find(x => x.kind === kind && x.price === 0)!.id;

/** 집 확장 — 다음 단계 → 가격·필요 레벨 */
export const HOUSE_UPGRADE: Record<2 | 3, { price: number; level: number }> = { 2: { price: 800, level: 5 }, 3: { price: 2000, level: 10 } };

export type CatalogHit =
  | { type: 'gift'; item: GiftItem }
  | { type: 'furniture'; item: FurnitureItem }
  | { type: 'style'; item: StyleItem };
/** 시대 카탈로그에서 상품 찾기(없으면 null) */
export function findItem(era: CatEra, id: unknown): CatalogHit | null {
  if (typeof id !== 'string' || !GIFT_CATALOG[era]) return null;
  const gi = GIFT_CATALOG[era].find(x => x.id === id);
  if (gi) return { type: 'gift', item: gi };
  const fu = FURNITURE_CATALOG[era].find(x => x.id === id);
  if (fu) return { type: 'furniture', item: fu };
  const st = STYLE_CATALOG[era].find(x => x.id === id);
  return st ? { type: 'style', item: st } : null;
}
export const furnitureOf = (era: CatEra, id: string) => FURNITURE_CATALOG[era]?.find(x => x.id === id);

/** 인플레이션 점검용 — 가구 한 세트 + 꾸미기(바닥·벽) + 집 확장 총액 */
export function catalogSinkTotal(era: CatEra): { furniture: number; styles: number; upgrades: number; total: number } {
  const furniture = FURNITURE_CATALOG[era].reduce((a, x) => a + x.price, 0);
  const styles = STYLE_CATALOG[era].reduce((a, x) => a + x.price, 0);
  const upgrades = HOUSE_UPGRADE[2].price + HOUSE_UPGRADE[3].price;
  return { furniture, styles, upgrades, total: furniture + styles + upgrades };
}
