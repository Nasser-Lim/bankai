# CLAUDE.md - 프로젝트 기술 문서

이 문서는 AI 어시스턴트 또는 개발자가 프로젝트를 빠르게 이해하고 작업할 수 있도록 작성되었습니다.

## 프로젝트 개요

**Bankai**는 네이버 뉴스에서 [단독] 보도를 자동으로 크롤링하여 텔레그램으로 실시간 알림을 보내는 서버리스 자동화 시스템입니다.

### 핵심 목표

1. 네이버 뉴스에서 [단독] 태그가 붙은 뉴스를 실시간 모니터링
2. AI 기반 뉴스 랭킹 및 핵심 요약 (Claude 3.5 Haiku)
3. **자동 복구 시스템**: 크롤링 실패 시 AI가 자동으로 셀렉터 탐지 및 복구
4. 블랙리스트 필터링으로 원하지 않는 언론사/키워드 제외
5. Firestore 기반 중복 제거 및 자동 TTL 정책
6. 텔레그램 채널/그룹으로 자동 알림
7. Google Cloud Functions로 서버리스 운영 (비용 최소화)

## 기술 스택

### Runtime & Language
- **Node.js**: 20.x (Google Cloud Functions Gen2)
- **TypeScript**: 5.3.x
  - Strict 모드 활성화
  - ES2022 타겟
  - CommonJS 모듈

### Cloud Infrastructure
- **Google Cloud Functions Gen2**: 서버리스 실행 환경
  - 리전: `asia-northeast3` (서울)
  - 메모리: 512MB
  - 타임아웃: 540s (9분)
  - HTTP 트리거 (unauthenticated)

- **Google Cloud Firestore**: NoSQL 데이터베이스
  - Native 모드 (Datastore 아님)
  - 컬렉션: `news`
  - 인덱스: 자동 생성 (title, publishedAt)

- **Google Cloud Scheduler**: Cron 스케줄러
  - 낮 시간대 (08:00-22:00): 30분 간격
  - 밤 시간대 (23:00-07:00): 1시간 간격

### 외부 API & 라이브러리
- **Claude AI API (Anthropic)**: AI 뉴스 랭킹 및 요약
  - 모델: `claude-haiku-4-5-20251001`
  - 뉴스 중요도 평가 (1-10점)
  - 핵심 요약 생성 (80자 이내)

- **Telegram Bot API**: 메시지 전송
  - Parse mode: HTML
  - 썸네일 이미지 포함

- **Axios**: HTTP 클라이언트
  - User-Agent 설정으로 크롤링 차단 우회

- **Cheerio**: HTML 파싱
  - jQuery 스타일 셀렉터
  - 서버 사이드 DOM 조작

### 인증
- **Application Default Credentials (ADC)**: Cloud Functions 환경
  - 자동으로 서비스 계정 인증
  - Private Key 환경 변수 불필요

- **Service Account JSON**: 로컬 개발 환경
  - Firestore 접근용

## 아키텍처

### 디렉토리 구조

```
src/
├── config/
│   └── constants.ts               # 중앙 설정 파일
├── models/
│   └── news.model.ts              # 데이터 모델 정의
├── services/
│   ├── naver-scraper.service.ts   # 크롤링 로직 (동적 URL 선택)
│   ├── filter.service.ts          # 필터링 로직
│   ├── firestore.service.ts       # DB 로직 (셀렉터 관리, 실패 추적 포함)
│   ├── telegram.service.ts        # 메시징 로직 (메인 채널)
│   ├── news-ranker.service.ts     # AI 기반 뉴스 랭킹 & 요약
│   ├── selector-finder.service.ts # AI 기반 셀렉터 자동 탐지
│   └── admin-alert.service.ts     # 관리자 알림 (별도 봇)
├── utils/
│   ├── logger.ts                  # 컬러 로거
│   ├── time-parser.ts             # 시간 변환 유틸
│   └── date-helper.ts             # 요일/공휴일 판단 유틸
├── index.ts                       # Cloud Functions 엔트리포인트
├── local.ts                       # 로컬 테스트 스크립트
└── local-selector-finder.ts       # 셀렉터 자동 탐지 도구
```

### 데이터 흐름

```
┌─────────────────┐
│  Cloud Scheduler │
│  (Cron Trigger)  │
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│ Cloud Functions │
│  scrapeAndNotify│
└────────┬─────────┘
         │
         ├─────► [0] 초기화
         │           - Firestore에 셀렉터 초기 업로드 (최초 1회)
         │
         ├─────► [1] NaverScraperService
         │           - 시간/요일/공휴일 판단 (date-helper.ts)
         │           - 동적 URL 선택 (오전 6시: 최근 6시간 / 월요일 0시·주말·공휴일: 최근 3시간 / 나머지: 최근 1시간)
         │           - HTTP GET 요청
         │           - Cheerio 파싱
         │           - NewsItem[] 반환
         │           │
         │           ├─► 0개 시: 자동 복구 로직 (index.ts)
         │           │   1. 실패 횟수 증가 (Firestore)
         │           │   2. 2회 연속 실패?
         │           │      ├─► No: 다음 실행 시 재시도
         │           │      └─► Yes: 자동 복구 시작
         │           │          ├─► AdminAlertService (복구 시작 알림)
         │           │          ├─► SelectorFinderService
         │           │          │   - Claude Sonnet 4.5로 셀렉터 탐지
         │           │          │   - 새 셀렉터 반환
         │           │          ├─► NaverScraperService (재시도)
         │           │          ├─► 성공?
         │           │          │   ├─► Yes:
         │           │          │   │   - Firestore에 새 셀렉터 저장
         │           │          │   │   - 실패 횟수 초기화
         │           │          │   │   - AdminAlertService (성공 알림)
         │           │          │   │   - 정상 파이프라인 진행
         │           │          │   └─► No:
         │           │          │       - 실패 횟수 초기화
         │           │          │       - AdminAlertService (실패 알림)
         │           │          │       - 종료
         │           │
         │           └─► 성공 시: 실패 횟수 초기화
         │
         ├─────► [2] FirestoreService
         │           - TTL 정책 실행 (14일 삭제)
         │           - 제목 기반 중복 체크
         │           - 신규 NewsItem[] 반환
         │
         ├─────► [3] FilterService
         │           - 블랙리스트 언론사 제외
         │           - 블랙리스트 키워드 제외
         │           - NewsItem[] 반환
         │
         ├─────► [4] NewsRankerService.rankNews()
         │           - Claude AI 기반 뉴스 랭킹
         │           - 점수 및 이유 생성
         │           - RankedNews[] 반환
         │           └─► AdminAlertService (AI 랭킹 보고)
         │
         ├─────► [5] 점수 필터링 & 개수 제한
         │           - MIN_SCORE_CUTOFF(5점) 이상만 선택
         │           - MAX_NEWS_TO_SEND(6개) 제한
         │           - RankedNews[] 반환
         │
         ├─────► [6] NewsRankerService.summarizeNews()
         │           - Claude AI 핵심 요약 생성
         │           - 80자 이내 요약
         │           - 명사형 종결어미 ('했음', '있음' 등)
         │           - NewsItem[] 반환
         │
         ├─────► [7] TelegramService
         │           - HTML 포맷 메시지 생성
         │           - 1위 썸네일 이미지 + 캡션 전송
         │
         └─────► [8] FirestoreService
                     - 배치 저장 (500개씩)
                     - publishedAt, createdAt 타임스탬프
```

### 실행 모드

1. **Full 모드** (기본, 프로덕션): 전체 파이프라인 실행
2. **Scraper 모드**: 크롤링만 실행 (테스트용)
3. **Filter 모드**: 크롤링 + 필터링만 실행 (테스트용)

## 핵심 컴포넌트

### 1. NaverScraperService

**파일**: [src/services/naver-scraper.service.ts](src/services/naver-scraper.service.ts)

**역할**: 네이버 뉴스 검색 결과 HTML을 파싱하여 NewsItem 배열 생성

**주요 메서드**:
- `getSearchUrl()`: 현재 시간과 날짜에 따라 적절한 검색 URL 반환 (NEW)
  - 매일 오전 6시: 최근 6시간 검색 범위 (`pd=12`)
  - 매주 월요일 0시 또는 주말/공휴일: 최근 3시간 검색 범위 (`pd=9`)
  - 나머지: 최근 1시간 검색 범위 (`pd=7`)
- `scrape()`: 메인 크롤링 메서드
- `parseHtml(html: string)`: Cheerio로 HTML 파싱
- `normalizeUrl(url: string)`: 상대 경로를 절대 경로로 변환

**중요 포인트**:
- **동적 URL 선택**: 시간/요일/공휴일에 따라 자동으로 적절한 크롤링 URL 사용
  - 오전 6시: 야간 뉴스를 포괄하기 위해 6시간 검색 범위
  - 월요일 0시: 주말 뉴스를 포괄하기 위해 3시간 검색 범위
  - 평일/주말: 크롤링 주기에 맞춰 검색 범위 자동 조정
- **공휴일 관리**: constants.ts의 `WEEKDAY_HOLIDAYS` 배열에서 평일 공휴일 설정
- User-Agent 헤더 필수 (크롤링 차단 우회)
- `[단독]` 태그 필터링
- 중복 URL 제거 (Set 자료구조)
- 상대 시간 → 절대 시간 변환 (`parseRelativeTime`)

**셀렉터** (constants.ts에 정의):
```typescript
newsContainer: '.fds-news-item-list-tab'
newsItem: '.vs1RfKE1eTzMZ5RqnhIv'
mainContent: '.RnP2vJw672aZIyWK1kIZ'
title: '.sds-comps-text-type-headline1'
url: 'a.VVZqvAlvnADQu8BVMc2n'
publisher: '.sds-comps-profile-info-title .sds-comps-text-weight-sm'
thumbnail: 'a[data-heatmap-target=".img"] img'
summary: '.sds-comps-text-type-body1'
publishedTime: '.sds-comps-profile-info-subtext .U1zN1wdZWj0pyvj9oyR0'
```

**네이버 HTML 구조 변경 시 대응**:
1. `npm run selector:find` 실행하여 셀렉터 자동 탐지
2. 자동으로 `constants.ts`의 `SELECTORS` 업데이트
3. 로컬 테스트 후 재배포
4. 또는 수동: Chrome DevTools로 새 구조 분석 후 직접 수정

---

### 2. FilterService

**파일**: [src/services/filter.service.ts](src/services/filter.service.ts)

**역할**: 블랙리스트 기반 필터링

**필터링 기준**:
1. **언론사 블랙리스트**: `BANNED_PUBLISHERS` 배열
2. **키워드 블랙리스트**: `BANNED_KEYWORDS` 배열 (제목 + 요약 검색)

**주요 메서드**:
- `filter(news: NewsItem[])`: 필터링 실행

**중요 포인트**:
- 대소문자 구분 없음
- 공백 무시 (`trim()`)
- 디버그 로그로 제외된 뉴스 출력

**설정 위치**: [src/config/constants.ts](src/config/constants.ts)
```typescript
export const BANNED_PUBLISHERS: string[] = [
  'bnt뉴스',
];

export const BANNED_KEYWORDS: string[] = [
  // '캄보디아',  // 예시
];
```

---

### 3. FirestoreService

**파일**: [src/services/firestore.service.ts](src/services/firestore.service.ts)

**역할**: Firestore 데이터베이스 CRUD 및 중복 체크, TTL 정책

**주요 메서드**:

**뉴스 관리**:

1. **`filterNewNews(news: NewsItem[])`**: 중복 체크
   - TTL 정책 먼저 실행 (`cleanupOldNews`)
   - 제목 기반 중복 검사 (배치 쿼리, 30개씩)
   - Firestore `in` 연산자 제약: 최대 30개

2. **`cleanupOldNews()`**: TTL 정책
   - `publishedAt < (현재 - 30일)` 조건 쿼리
   - 배치 삭제 (500개씩)

3. **`saveNews(news: NewsItem[])`**: 뉴스 저장
   - 배치 쓰기 (500개씩)
   - 타임스탬프 자동 추가 (`createdAt`)

**셀렉터 관리** (자동 복구 시스템):

4. **`saveSelectors(selectors: Record<string, string>)`**: 셀렉터 저장
   - Firestore `config/selectors` 문서에 저장
   - 자동 복구 성공 시 새 셀렉터 업데이트
   - `updatedAt` 타임스탬프 자동 추가

5. **`getSelectors()`**: 셀렉터 조회
   - Firestore에서 저장된 셀렉터 불러오기
   - 없으면 `null` 반환

**실패 추적** (자동 복구 시스템):

6. **`saveFailureCount(count: number)`**: 실패 횟수 저장
   - Firestore `config/scraping-status` 문서에 저장
   - 크롤링 성공 시 0으로 초기화
   - 실패 시 증가

7. **`getFailureCount()`**: 실패 횟수 조회
   - 현재 연속 실패 횟수 반환
   - 없으면 0 반환

**Firestore 문서 구조**:

**`news` 컬렉션** (뉴스 저장):
```typescript
{
  title: string,
  url: string,
  publisher: string,
  publishedAt: Timestamp,      // 뉴스 발행 시각 (KST)
  createdAt: Timestamp,         // Firestore 저장 시각
  thumbnail?: string,
  summary?: string
}
```

**`config/selectors` 문서** (셀렉터 저장):
```typescript
{
  selectors: {
    newsContainer: string,
    newsItem: string,
    mainContent: string,
    title: string,
    url: string,
    publisher: string,
    thumbnail: string,
    summary: string,
    publishedTime: string
  },
  updatedAt: Timestamp
}
```

**`config/scraping-status` 문서** (실패 추적):
```typescript
{
  failureCount: number,         // 연속 실패 횟수
  lastUpdated: Timestamp        // 마지막 업데이트 시각
}
```

**인덱스**:
- `publishedAt` (DESC): TTL 쿼리용
- `title` (ASC): 중복 체크용 (자동 생성)

**ADC 인증**:
```typescript
// Cloud Functions에서 자동 인증
admin.initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID || 'bankai-123456',
});
```

---

### 4. NewsRankerService

**파일**: [src/services/news-ranker.service.ts](src/services/news-ranker.service.ts)

**역할**: AI 기반 뉴스 랭킹 및 핵심 요약

**주요 메서드**:

1. **`rankNews(news: NewsItem[])`**: 뉴스 랭킹
   - Claude 3.5 Haiku로 각 뉴스의 중요도 평가 (1-10점)
   - 평가 기준:
     - 높은 중요도 (8-10점): 대통령/수사/유명인 관련, 투자 빅딜, 파급력 큰 뉴스
     - 중간 중요도 (4-7점): 일반 사건사고, 정책 발표, 대기업 뉴스
     - 낮은 중요도 (1-3점): 통계 표현 포함, 지방 뉴스, 전문적/지엽적 내용
   - RankedNews[] 반환 (점수 순 정렬)

2. **`summarizeNews(news: NewsItem[])`**: 핵심 요약 생성
   - Claude 3.5 Haiku로 기존 요약을 80자 이내로 재작성
   - 명사형 종결어미 사용 ('했음', '있음', '됨', '밝힘' 등)
   - 불필요한 수식어 제거
   - NewsItem[] 반환

3. **`filterByScoreAndLimit()`**: 점수 필터링 및 개수 제한
   - `MIN_SCORE_CUTOFF` 이상만 선택
   - `MAX_NEWS_TO_SEND` 개수 제한

**중요 포인트**:
- API 오류 시 모든 뉴스에 기본 점수(5점) 부여
- 요약 오류 시 원본 요약 유지

---

### 5. TelegramService

**파일**: [src/services/telegram.service.ts](src/services/telegram.service.ts)

**역할**: 텔레그램 메시지 전송

**주요 메서드**:

1. **`sendNews(rankedNews: RankedNews[])`**: 뉴스 배열 전송
   - 1위 뉴스 썸네일 이미지 + 전체 뉴스 목록 전송
   - 썸네일 전송 실패 시 텍스트만 전송

2. **`formatNewsListMessage(rankedNews: RankedNews[])`**: HTML 포맷 생성
   - 특수문자 이스케이프 (`escapeHtml`)
   - URL `&` → `&amp;` 변환
   - 요약 72자로 슬라이스

**메시지 포맷**:
```html
⚡ 이 시각 단독 알림 (14시 31분)

<a href="url">1. <b>뉴스 제목</b> (언론사)</a>
✍️  핵심 요약 내용 (80자 이내)...

<a href="url">2. <b>다른 뉴스 제목</b> (언론사)</a>
✍️  핵심 요약 내용...
```

**HTML 이스케이프**:
```typescript
& → &amp;
< → &lt;
> → &gt;
" → &quot;
```

**KST 시간 변환**:
```typescript
// UTC → KST (UTC+9)
const kstOffset = 9 * 60; // 분 단위
const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
const kstDate = new Date(utc + (kstOffset * 60000));
```

---

### 6. AdminAlertService

**파일**: [src/services/admin-alert.service.ts](src/services/admin-alert.service.ts)

**역할**: 관리자에게 시스템 상태 및 AI 랭킹 결과를 별도 텔레그램 봇으로 DM 전송

**주요 메서드**:

1. **`alertScrapingFailure()`**: 크롤링 실패 알림 (0개 결과)
   - 네이버 HTML 구조 변경 가능성 경고
   - 셀렉터 업데이트 필요성 알림

2. **`reportRankingResults(rankedNews: RankedNews[])`**: AI 랭킹 결과 보고
   - 상위 3개 뉴스 표시
   - 점수, 언론사, 이유 포함

3. **`sendAlert(message: string)`**: 일반 알림 메시지 전송

**환경 변수**:
```bash
ADMIN_BOT_TOKEN=987654321:ZYXwvuTSRqpONMlkjIHGfedCBA
ADMIN_CHAT_ID=123456789  # 관리자의 Telegram User ID
```

**알림 포맷 (크롤링 실패)**:
```
🚨 크롤링 실패 경고

크롤링 결과가 0개입니다.
가능한 원인:
- 네이버 HTML 구조 변경
- 셀렉터 업데이트 필요
- 최근 [단독] 뉴스 없음

시간: 2025-10-16 14:30:00 KST
```

**알림 포맷 (AI 랭킹 보고)**:
```
📊 AI 랭킹 보고

총 6개 뉴스 분석 완료

상위 3개 뉴스:

1. [단독] 뉴스 제목...
   점수: 9/10
   언론사: 연합뉴스
   이유: 사회적 파급력이 큰 독점 보도

2. [단독] 다른 뉴스...
   점수: 8/10
   ...

시간: 2025-10-16 14:30:00 KST
```

**중요 포인트**:
- 메인 봇과 별도의 봇 사용 (ADMIN_BOT_TOKEN)
- 환경 변수 미설정 시 알림 기능 자동 비활성화
- 크롤링 0개 시 즉시 알림
- AI 랭킹 완료 시마다 결과 보고
- 자동 복구 시작/성공/실패 알림

---

### 6. SelectorFinderService

**파일**: [src/services/selector-finder.service.ts](src/services/selector-finder.service.ts)

**역할**: Claude AI를 사용하여 네이버 HTML 구조 변경 시 자동으로 새 셀렉터 탐지

**주요 메서드**:

1. **`findSelectors()`**: 자동 셀렉터 탐지 메인 메서드
   - HTML 다운로드
   - 앵커 기준으로 슬라이스
   - Claude API로 셀렉터 탐지
   - 변경 사항 로깅

2. **`fetchNaverNewsHtml()`**: 네이버 뉴스 HTML 다운로드
   - User-Agent 헤더 설정
   - 30초 타임아웃

3. **`sliceHtmlFromAnchor(html, anchor, size)`**: HTML 슬라이스

4. **`detectSelectorsWithClaude(htmlSlice)`**: Claude API 호출
   - Temperature: 0 (일관성)
   - JSON 응답 파싱

**SelectorResult 인터페이스**:
```typescript
export interface SelectorResult {
  newsContainer: string;   // 전체 뉴스 목록 컨테이너
  newsItem: string;        // 개별 뉴스 아이템
  mainContent: string;     // 메인 콘텐츠 영역
  title: string;           // 제목
  url: string;             // URL (a 태그)
  publisher: string;       // 언론사
  thumbnail: string;       // 썸네일 이미지
  summary: string;         // 요약
  publishedTime: string;   // 발행 시간
}
```

**Claude 프롬프트 구조**:
```typescript
- 현재 사용 중인 셀렉터 제공
- 요구사항 명시 (9개 셀렉터)
- [단독] 태그 필터링 조건
- CSS 셀렉터 문법 준수
- JSON 형식으로만 응답
```

**중요 포인트**:
- 네이버 HTML 구조 변경 시 자동 대응
- 앵커 기준 슬라이스로 API 토큰 절약
- JSON 파싱 실패 시 에러 처리
- 변경 사항 로깅으로 추적 용이
- 자동 복구 시스템에서 2회 연속 실패 시 자동 호출

**사용 시나리오**:
1. 크롤링 2회 연속 실패 (0개 결과)
2. `handleScrapingFailure()`에서 자동 호출
3. 새 셀렉터 탐지 성공 시 Firestore에 저장
4. 다음 크롤링부터 새 셀렉터 사용

---

### 7. Utils

#### logger.ts

**역할**: 컬러 로그 출력

**메서드**:
- `logger.info(msg)`: 일반 정보 (파란색)
- `logger.success(msg)`: 성공 (초록색)
- `logger.error(msg)`: 에러 (빨간색)
- `logger.debug(msg)`: 디버그 (회색, DEBUG=true 시에만)

**사용 예**:
```typescript
logger.info('크롤링 시작...');
logger.success(`총 ${count}개 뉴스 발견`);
logger.error(`오류 발생: ${error}`);
```

#### time-parser.ts

**역할**: 네이버의 상대 시간을 절대 시간으로 변환

**메서드**:
- `parseRelativeTime(relativeTimeStr: string)`: "3시간 전" → Date 객체
- `formatKST(date: Date)`: Date → "2025-10-12 14:35:22 KST"

**지원 단위**:
- 초, 분, 시간, 일, 주, 개월/달, 년

**중요**: 현재 시간 기준으로 역산하므로 **Cloud Functions 실행 시간**이 기준

#### date-helper.ts

**파일**: [src/utils/date-helper.ts](src/utils/date-helper.ts)

**역할**: 요일 및 공휴일 판단 유틸리티

**주요 메서드**:
- `isWeekend(date?: Date)`: 주말(토,일) 여부 판단
- `isWeekdayHoliday(date?: Date)`: 평일 중 공휴일 여부 판단
- `isWeekendOrHoliday(date?: Date)`: 주말 또는 공휴일 여부 판단 (크롤링 주기 결정용)
- `getDateInfo(date?: Date)`: 날짜 정보를 사람이 읽기 쉬운 형식으로 반환

**사용 예**:
```typescript
// 오늘이 주말/공휴일인지 확인
if (isWeekendOrHoliday()) {
  // 주말/공휴일 로직
}

// 날짜 정보 출력
console.log(getDateInfo()); // "2025-10-17 (목요일, 평일)"
```

**공휴일 설정**:
- constants.ts의 `WEEKDAY_HOLIDAYS` 배열에서 관리
- 형식: `'YYYY-MM-DD'` (예: `'2025-01-01'`)

---

## 환경 변수

### 로컬 개발 (.env)

```bash
# Firebase/Firestore
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# 텔레그램 (메인 채널)
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CHAT_ID=@channel_name

# 관리자 알림 (선택사항)
ADMIN_BOT_TOKEN=987654321:ZYXwvu...
ADMIN_CHAT_ID=123456789

# Claude AI
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### Cloud Functions (env.yaml)

```yaml
TELEGRAM_BOT_TOKEN: "123456789:ABCdef..."
TELEGRAM_CHAT_ID: "@channel_name"
FIREBASE_PROJECT_ID: "your-project-id"
ANTHROPIC_API_KEY: "sk-ant-api03-..."
# 관리자 알림 (선택사항)
ADMIN_BOT_TOKEN: "987654321:ZYXwvu..."
ADMIN_CHAT_ID: "123456789"
# FIREBASE_PRIVATE_KEY 불필요 (ADC 사용)
```

**주요 변경사항**:
- ⚠️ **NAVER_SEARCH_URL 제거**: 요일/공휴일에 따라 자동으로 URL 선택 (constants.ts에서 관리)
- 평일 URL: `pd=7` (최근 1시간 검색 범위)
- 주말/공휴일 URL: `pd=9` (최근 3시간 검색 범위)

---

## 데이터 모델

### NewsItem

**파일**: [src/models/news.model.ts](src/models/news.model.ts)

```typescript
export interface NewsItem {
  title: string;           // 뉴스 제목
  url: string;             // 뉴스 URL
  publisher: string;       // 언론사
  publishedAt: Date;       // 발행 시각 (KST)
  thumbnail?: string;      // 썸네일 이미지 URL (선택)
  summary?: string;        // 요약 (선택)
}
```

**필수 필드**: `title`, `url`, `publisher`, `publishedAt`
**선택 필드**: `thumbnail`, `summary`

---

## 배포 프로세스

### 빌드 & 배포 명령어

```bash
# 1. TypeScript 컴파일
npm run build

# 2. Cloud Functions 배포
npm run deploy
```

### package.json 스크립트

```json
{
  "scripts": {
    "build": "tsc",
    "local": "tsx src/local.ts",
    "deploy": "gcloud functions deploy scrapeAndNotify --gen2 --runtime nodejs20 --trigger-http --allow-unauthenticated --entry-point scrapeAndNotify --region asia-northeast3 --timeout 540s --memory 512MB --env-vars-file env.yaml"
  }
}
```

### .gcloudignore

배포에서 제외되는 파일:
```
.env          # 로컬 환경 변수
.git          # Git 히스토리
node_modules  # 의존성 (Cloud에서 재설치)
src/local.ts  # 로컬 테스트 스크립트
dist/         # 빌드 결과 (Cloud에서 재빌드)
*.md          # 문서
```

**포함되는 파일**:
- `src/` (TypeScript 소스)
- `package.json`, `package-lock.json`
- `tsconfig.json`
- `env.yaml` (환경 변수)

---

## 테스트 & 디버깅

### 로컬 테스트

```bash
# 전체 파이프라인
npm run local

# 크롤링만
npm run local scraper

# 크롤링 + 필터링
npm run local filter

# 디버그 모드
DEBUG=true npm run local
```

### Cloud Functions 로그

```bash
# 최근 50개 로그
gcloud functions logs read scrapeAndNotify --gen2 --region asia-northeast3 --limit 50

# 실시간 스트리밍
gcloud functions logs tail scrapeAndNotify --gen2 --region asia-northeast3

# 특정 시간대
gcloud functions logs read scrapeAndNotify --gen2 --region asia-northeast3 --start-time "2025-10-12T00:00:00Z"
```

### 로그 구조

```
[1. 네이버 뉴스 크롤링]
✓ HTML 응답 수신 완료
✓ 총 6개 뉴스 발견

[2. 필터링]
ℹ 블랙리스트 언론사 목록: [bnt뉴스]
ℹ 블랙리스트 키워드 목록: []
✓ 필터링 완료: 6개 통과

[3. 중복 체크]
ℹ TTL 정책 실행: 30일 이상 지난 뉴스 삭제 시작
ℹ 삭제할 오래된 뉴스가 없습니다.
ℹ 중복 체크 완료: 0개 중복, 6개 신규

[4. 텔레그램 전송]
ℹ 텔레그램 전송 시작: 6개 뉴스
✓ 텔레그램 전송 완료: 6개 성공, 0개 실패

[5. Firestore 저장]
ℹ Firestore 저장 시작: 6개 뉴스
✓ Firestore 저장 완료: 6개 뉴스

=== 완료 ===
```

---

## 주요 설정 파일

### constants.ts

**위치**: [src/config/constants.ts](src/config/constants.ts)

**설정 항목**:

1. **블랙리스트**:
   ```typescript
   export const BANNED_PUBLISHERS: string[] = ['bnt뉴스'];
   export const BANNED_KEYWORDS: string[] = [];
   ```

2. **Firestore 설정**:
   ```typescript
   export const FIRESTORE_COLLECTION = 'news';
   export const TTL_DAYS = 14; // 14일 후 자동 삭제
   ```

3. **뉴스 랭킹 설정**:
   ```typescript
   export const MAX_NEWS_TO_SEND = 6; // 텔레그램 전송 최대 개수
   export const MIN_SCORE_CUTOFF = 5; // AI 랭킹 점수 커트라인
   ```

4. **HTML 셀렉터**:
   ```typescript
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
   ```

5. **네이버 도메인 및 검색 URL** (NEW):
   ```typescript
   export const NAVER_NEWS_DOMAIN = 'https://n.news.naver.com';

   // 평일 검색 URL (pd=7, 최근 1시간 검색 범위)
   export const NAVER_SEARCH_URL_WEEKDAY = 'https://search.naver.com/...&pd=7&...';

   // 주말/공휴일 검색 URL (pd=9, 최근 3시간 검색 범위)
   export const NAVER_SEARCH_URL_WEEKEND = 'https://search.naver.com/...&pd=9&...';

   // 오전 6시 검색 URL (pd=12, 최근 6시간 검색 범위)
   export const NAVER_SEARCH_URL_MORNING = 'https://search.naver.com/...&pd=12&...';
   ```

6. **평일 공휴일 설정** (NEW):
   ```typescript
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
   ```

---

## 일반적인 문제 해결

### 1. 크롤링 0개 결과

**원인**:
- 네이버 HTML 구조 변경
- 최근 검색 범위 내 [단독] 뉴스 없음
  - 매일 오전 6시: 최근 6시간 이내
  - 월요일 0시 또는 주말/공휴일: 최근 3시간 이내
  - 나머지: 최근 1시간 이내

**해결**:
1. `npm run selector:find` 실행하여 셀렉터 자동 탐지
2. 자동으로 `constants.ts`의 `SELECTORS` 업데이트
3. 로컬 테스트: `npm run local scraper`
4. 필요시 검색 범위 조정: `NAVER_SEARCH_URL_WEEKDAY/WEEKEND/MORNING`의 `pd` 파라미터 변경

### 2. 텔레그램 400 에러

**원인**:
- 환경 변수 누락 (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
- HTML 포맷 에러 (특수문자 이스케이프 누락)
- 봇이 채널 관리자가 아님

**해결**:
1. `env.yaml` 확인
2. 봇을 채널 관리자로 추가
3. 로그에서 "Telegram API error" 메시지 확인

### 3. Firestore 인증 오류

**원인**:
- ADC 미설정 (Cloud Functions)
- Service Account 키 오류 (로컬)

**해결**:
- **Cloud Functions**: `FIREBASE_PROJECT_ID` 확인
- **로컬**: `.env`의 `FIREBASE_PRIVATE_KEY` 확인

### 4. 시간 오류 (UTC vs KST)

**원인**:
- Cloud Functions는 UTC 타임존에서 실행

**해결**:
- `formatKoreanTime` 함수가 UTC+9 변환 처리
- Firestore에는 UTC로 저장, 텔레그램 표시만 KST

---

## 성능 최적화

### 배치 처리

- **Firestore 쿼리**: 30개씩 (in 연산자 제약)
- **Firestore 쓰기**: 500개씩
- **Firestore 삭제**: 500개씩

### Rate Limiting

- **텔레그램**: 1분당 1개 메시지
- **네이버 크롤링**: User-Agent 설정으로 차단 우회

### 메모리 사용

- **현재**: 512MB
- **최적화 가능**: 256MB (뉴스가 적을 경우)

---

## 확장 가능성

### 추가 기능 아이디어

1. **다양한 키워드 지원**: 단독 외 속보, 특종 등
2. **여러 언론사 크롤링**: 다른 포털 추가
3. **AI 요약**: OpenAI API로 뉴스 요약 생성
4. **Discord/Slack 통합**: 추가 메시징 플랫폼
5. **웹 대시보드**: 크롤링 통계 시각화

### 코드 수정 가이드

#### 새로운 필터링 조건 추가

[src/services/filter.service.ts](src/services/filter.service.ts) 수정:
```typescript
filter(news: NewsItem[]): NewsItem[] {
  // 기존 필터링...

  // 새 조건 추가
  const afterCustomFilter = filtered.filter(item => {
    // 커스텀 로직
    return condition;
  });

  return afterCustomFilter;
}
```

#### 새로운 데이터 필드 추가

1. [src/models/news.model.ts](src/models/news.model.ts) 수정:
   ```typescript
   export interface NewsItem {
     // 기존 필드...
     category?: string;  // 새 필드
   }
   ```

2. [src/services/naver-scraper.service.ts](src/services/naver-scraper.service.ts) 파싱 로직 추가

3. [src/services/telegram.service.ts](src/services/telegram.service.ts) 포맷 업데이트

---

## 보안 고려사항

### 환경 변수

- `.env` 파일은 `.gitignore`에 포함 (절대 커밋 금지)
- `env.yaml`도 민감 정보 포함 시 `.gitignore` 추가
- Telegram 토큰은 노출 시 즉시 재발급

### Firestore 보안 규칙

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /news/{document} {
      // Cloud Functions만 읽기/쓰기 가능
      allow read, write: if request.auth != null;
    }
  }
}
```

### Cloud Functions 권한

- **현재**: `--allow-unauthenticated` (공개 호출 가능)
- **권장 (프로덕션)**: Cloud Scheduler만 호출 가능하도록 제한

```bash
# 인증 필요로 변경
gcloud functions deploy scrapeAndNotify --gen2 --region asia-northeast3 --no-allow-unauthenticated

# Cloud Scheduler에 권한 부여
gcloud functions add-iam-policy-binding scrapeAndNotify \
  --region asia-northeast3 \
  --member serviceAccount:PROJECT_ID@appspot.gserviceaccount.com \
  --role roles/cloudfunctions.invoker
```

---

## 참고 자료

- [TypeScript 문서](https://www.typescriptlang.org/docs/)
- [Google Cloud Functions Gen2](https://cloud.google.com/functions/docs/2nd-gen/overview)
- [Firestore 데이터 모델](https://firebase.google.com/docs/firestore/data-model)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Cheerio 문서](https://cheerio.js.org/)
- [Axios 문서](https://axios-http.com/docs/intro)

---

## 버전 히스토리

### v1.3 (2025-10-31)
- ✅ **자동 복구 시스템 추가**
  - 크롤링 2회 연속 실패 시 자동 셀렉터 탐지 실행
  - 새 셀렉터로 크롤링 재시도
  - 성공 시 Firestore에 셀렉터 자동 저장
  - 실패 시 카운터 초기화 후 재시도 대기
- ✅ **Firestore 셀렉터 관리**
  - 초기 배포 시 셀렉터 자동 업로드
  - 자동 복구 성공 시 셀렉터 업데이트
  - `config/selectors` 문서로 중앙 관리
- ✅ **실패 추적 시스템**
  - Firestore 기반 연속 실패 횟수 추적
  - `config/scraping-status` 문서로 상태 관리
  - 크롤링 성공 시 자동 초기화
- ✅ **관리자 알림 확장**
  - 자동 복구 시작 알림
  - 셀렉터 탐지 결과 알림 (성공/실패, 변경사항)
  - 자동 복구 성공 알림
- ✅ **SelectorFinderService 통합**
  - 자동 복구 시스템에서 직접 호출
  - Claude Sonnet 4.5 기반 셀렉터 자동 탐지
  - 변경사항 자동 로깅 및 알림

### v1.2 (2025-10-31)
- ✅ **AI 핵심 요약 기능 추가**
  - Claude 3.5 Haiku로 뉴스 요약을 80자 이내로 재작성
  - 명사형 종결어미 사용 ('했음', '있음', '됨' 등)
- ✅ **셀렉터 자동 탐지 도구 추가**
  - `npm run selector:find` 명령어로 네이버 HTML 구조 변경 시 자동 대응
  - Claude Sonnet 4.5를 사용한 셀렉터 자동 추출
  - 자동 백업 및 변경사항 비교 기능
- ✅ **텔레그램 메시지 포맷 개선**
  - 1위 뉴스 썸네일 이미지 + 전체 목록 전송
  - 제목에 하이퍼링크 적용
  - 요약 72자로 슬라이스
- ✅ **현재 셀렉터 업데이트**
  - 네이버 HTML 구조 변경에 따른 셀렉터 갱신

### v1.1 (2025-10-18)
- ✅ **시간대별 동적 크롤링 URL 선택 기능 추가**
  - 매일 오전 6시: 최근 6시간 검색 범위 (`pd=12`) - 야간 뉴스 포괄
  - 매주 월요일 0시 또는 주말/공휴일: 최근 3시간 검색 범위 (`pd=9`)
  - 나머지: 최근 1시간 검색 범위 (`pd=7`)
- ✅ **공휴일 관리 시스템 추가**
  - `WEEKDAY_HOLIDAYS` 배열로 평일 공휴일 설정 가능
  - 평일 공휴일은 주말처럼 취급
- ✅ **date-helper.ts 유틸리티 추가**
  - 요일/공휴일 판단 함수
  - 날짜 정보 포맷팅 함수
- ⚠️ **환경 변수 변경**
  - `NAVER_SEARCH_URL` 제거 (코드에서 동적 선택)

### v1.0 (2025-10-12)
- ✅ 네이버 뉴스 크롤링
- ✅ 블랙리스트 필터링
- ✅ Firestore 중복 체크 및 저장
- ✅ TTL 정책 (14일 자동 삭제)
- ✅ 텔레그램 알림
- ✅ Cloud Functions 배포
- ✅ Cloud Scheduler 자동 실행
- ✅ ADC 인증 (FIREBASE_PRIVATE_KEY 문제 해결)
- ✅ KST 시간 표시 (UTC+9 변환)
- ✅ AI 기반 뉴스 랭킹 시스템
- ✅ 관리자 알림 시스템

---

## 라이선스

ISC License

---

**문서 버전**: 1.3
**최종 업데이트**: 2025-10-31
**작성자**: AI Assistant (Claude)
