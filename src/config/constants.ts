// 블랙리스트 언론사
export const BANNED_PUBLISHERS: string[] = [
  'bnt뉴스',
];

// 블랙리스트 키워드
export const BANNED_KEYWORDS: string[] = [
  // '캄보디아',  // 예시: 특정 키워드 차단
];

// Firestore 설정
export const FIRESTORE_COLLECTION = 'news';
export const TTL_DAYS = 14;

// 뉴스 랭킹 설정
export const MAX_NEWS_TO_SEND = 6; // 텔레그램으로 전송할 최대 뉴스 개수
export const MIN_SCORE_CUTOFF = 5; // AI 랭킹 점수 커트라인 (이 점수 이상만 전송)

// 네이버 검색 셀렉터 (HTML 파싱용)
export const SELECTORS = {
  newsContainer: '.fds-news-item-list-tab',
  newsItem: '.vs1RfKE1eTzMZ5RqnhIv',
  mainContent: '.RnP2vJw672aZIyWK1kIZ',
  title: '.sds-comps-text-type-headline1',
  url: 'a.VVZqvAlvnADQu8BVMc2n',
  publisher: '.sds-comps-profile-info-title .sds-comps-text-weight-sm',
  thumbnail: 'a[data-heatmap-target=".img"] img',
  summary: '.sds-comps-text-type-body1',
  publishedTime: '.sds-comps-profile-info-subtext .U1zN1wdZWj0pyvj9oyR0'
};

// 네이버 도메인
export const NAVER_NEWS_DOMAIN = 'https://n.news.naver.com';

// 네이버 검색 URL (시간대별)
// pd=7: 최근 1시간 검색 범위 (평일용)
// pd=9: 최근 3시간 검색 범위 (주말/공휴일용)
// pd=12: 최근 6시간 검색 범위 (오전 6시 전용)
export const NAVER_SEARCH_URL_WEEKDAY = 'https://search.naver.com/search.naver?ssc=tab.news.all&query=%EB%8B%A8%EB%8F%85&sm=tab_opt&sort=0&photo=0&field=0&pd=7&ds=&de=&docid=&related=0&mynews=0&office_type=0&office_section_code=0&news_office_checked=&nso=so%3Ar%2Cp%3Aall&is_sug_officeid=0&office_category=0&service_area=0';
export const NAVER_SEARCH_URL_WEEKEND = 'https://search.naver.com/search.naver?ssc=tab.news.all&query=%EB%8B%A8%EB%8F%85&sm=tab_opt&sort=0&photo=0&field=0&pd=9&ds=&de=&docid=&related=0&mynews=0&office_type=0&office_section_code=0&news_office_checked=&nso=so%3Ar%2Cp%3Aall&is_sug_officeid=0&office_category=0&service_area=0';
export const NAVER_SEARCH_URL_MORNING = 'https://search.naver.com/search.naver?ssc=tab.news.all&query=%EB%8B%A8%EB%8F%85&sm=tab_opt&sort=0&photo=0&field=0&pd=12&ds=&de=&docid=&related=0&mynews=0&office_type=0&office_section_code=0&news_office_checked=&nso=so%3Ar%2Cp%3Aall&is_sug_officeid=0&office_category=0&service_area=0';

// 평일 중 공휴일 (주말처럼 취급)
// 형식: 'YYYY-MM-DD' (예: '2025-01-01', '2025-03-01')
export const WEEKDAY_HOLIDAYS: string[] = [
  // 2025년 공휴일 예시
  // '2025-01-01',  // 신정
  // '2025-03-01',  // 삼일절
  // '2025-05-05',  // 어린이날
  // '2025-06-06',  // 현충일
  // '2025-08-15',  // 광복절
  // '2025-10-03',  // 개천절
  // '2025-10-09',  // 한글날
  // '2025-12-25',  // 크리스마스
];
