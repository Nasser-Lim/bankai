# Bankai 🗞️

네이버 뉴스 [단독] 보도 자동 크롤링 및 텔레그램 실시간 알림 시스템

Google Cloud Functions + Firestore + Telegram Bot + **AI 랭킹**을 활용한 서버리스 뉴스 모니터링 자동화 솔루션

## 주요 기능

- 🤖 **AI 기반 뉴스 랭킹**: Claude 3.5 Haiku로 중요도 자동 평가 및 선별
- 📊 **최대 6개 선택**: 중요한 뉴스만 엄선하여 전송 (피로도 감소)
- ✍️ **AI 핵심 요약**: Claude API로 뉴스 요약을 80자 이내로 간결하게 재작성
- 🔧 **자동 복구 시스템**: 크롤링 2회 연속 실패 시 AI가 자동으로 셀렉터 탐지 및 복구
- ✅ **네이버 뉴스 자동 크롤링**: [단독] 키워드 실시간 모니터링
- ✅ **스마트 필터링**: 언론사/키워드 블랙리스트 기반 필터링
- ✅ **중복 제거**: Firestore 기반 중복 체크 및 자동 TTL 정책 (14일)
- ✅ **텔레그램 알림**: 신규 뉴스 자동 전송 (이미지, 링크 포함)
- ✅ **서버리스 배포**: Google Cloud Functions Gen2 자동 스케줄링
- ✅ **동적 검색 범위**: 시간대별 자동 조정 (오전 6시: 6시간 / 평일: 1시간 / 주말·공휴일: 3시간)
- ✅ **한국 시간 지원**: KST(UTC+9) 기준 시간 표시
- 💰 **저비용 운영**: 256MB 메모리, 월 $1-2 예상

## 기술 스택

- **Runtime**: Node.js 20
- **Language**: TypeScript 5.3
- **Cloud Platform**: Google Cloud Functions Gen2
- **Database**: Google Cloud Firestore (Native mode)
- **Scheduler**: Google Cloud Scheduler
- **Messaging**: Telegram Bot API
- **Web Scraping**: Axios + Cheerio
- **Authentication**: Application Default Credentials (ADC)

## 설치

```bash
npm install
```

## 환경 설정

### 로컬 개발용 `.env` 파일

```bash
# Google Cloud Firestore (로컬 테스트용 - Service Account 필요)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"

# Telegram Bot (메인 채널)
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=@your_channel_name

# 관리자 알림 (선택사항)
ADMIN_BOT_TOKEN=987654321:ZYXwvu...
ADMIN_CHAT_ID=123456789

# Claude AI
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### Cloud Functions 배포용 `env.yaml`

```yaml
TELEGRAM_BOT_TOKEN: "123456789:ABCdef..."
TELEGRAM_CHAT_ID: "@your_channel"
FIREBASE_PROJECT_ID: "your-project-id"
ANTHROPIC_API_KEY: "sk-ant-api03-..."
# 관리자 알림 (선택사항)
ADMIN_BOT_TOKEN: "987654321:ZYXwvu..."
ADMIN_CHAT_ID: "123456789"
# 참고: Cloud Functions는 ADC를 사용하므로 FIREBASE_PRIVATE_KEY 불필요
```

## 설정 가이드

### 1. Google Cloud Firestore 설정

#### Firestore 데이터베이스 생성

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 프로젝트 선택 또는 새 프로젝트 생성
3. 좌측 메뉴에서 **Firestore** 선택
4. **데이터베이스 만들기** 클릭
5. **Native 모드** 선택 (Datastore 모드 아님!)
6. 리전: `asia-northeast3` (서울) 선택
7. **만들기** 클릭

#### 서비스 계정 생성 (로컬 테스트용)

1. **IAM 및 관리자** > **서비스 계정** 선택
2. **서비스 계정 만들기** 클릭
3. 서비스 계정 이름: `bankai-firestore`
4. 역할: **Cloud Datastore 사용자** 선택
5. **키 추가** > **새 키 만들기** > **JSON** 선택
6. JSON 파일 다운로드 후 `.env`에 값 입력

### 2. Telegram Bot 설정

#### 봇 생성

1. Telegram에서 [@BotFather](https://t.me/BotFather) 검색
2. `/newbot` 명령어 입력
3. 봇 이름: `Bankai News Bot`
4. 봇 username: `bankai_news_bot` (반드시 `bot`으로 끝나야 함)
5. 받은 토큰을 `TELEGRAM_BOT_TOKEN`에 입력

#### 채널 Chat ID 설정

**공개 채널:**
1. Telegram에서 채널 생성
2. 봇을 채널 관리자로 추가
3. 채널 username을 `@channel_name` 형식으로 사용

**비공개 채널/그룹:**
1. 봇을 채널/그룹에 추가
2. 아무 메시지 전송
3. `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` 접속
4. `"chat":{"id":-1001234567890}` 형식의 ID 복사하여 사용

### 3. Claude AI API 키 설정

1. [Anthropic Console](https://console.anthropic.com/) 접속
2. API Keys 메뉴에서 새 API 키 생성
3. 생성된 키를 `ANTHROPIC_API_KEY`에 입력

### 4. 블랙리스트 설정

[src/config/constants.ts](src/config/constants.ts)에서 필터링 설정:

```typescript
// 차단할 언론사 목록
export const BANNED_PUBLISHERS: string[] = [
  'bnt뉴스',
  // 추가 언론사...
];

// 차단할 키워드 목록
export const BANNED_KEYWORDS: string[] = [
  // '캄보디아',  // 예시
  // 추가 키워드...
];
```

### 5. 뉴스 랭킹 설정

[src/config/constants.ts](src/config/constants.ts)에서 AI 랭킹 설정:

```typescript
// 텔레그램으로 전송할 최대 뉴스 개수
export const MAX_NEWS_TO_SEND = 6;

// AI 랭킹 점수 커트라인 (이 점수 이상만 전송)
export const MIN_SCORE_CUTOFF = 5;
```

## 사용법

### 로컬 테스트

```bash
# 전체 파이프라인 실행 (크롤링 → 중복 체크 → 필터링 → AI 랭킹 → AI 요약 → 텔레그램 → 저장)
npm run local

# 크롤링만 테스트
npm run local scraper

# 크롤링 + 필터링만 테스트
npm run local filter

# AI 랭킹 테스트 (저장 안함, 중복 체크 건너뛰기)
npm run local:test-ranking

# 셀렉터 자동 탐지 (네이버 HTML 구조 변경 시)
npm run selector:find

# 디버그 모드
DEBUG=true npm run local
```

### Cloud Functions 배포

```bash
# 1. 빌드
npm run build

# 2. 배포 (env.yaml 사용)
npm run deploy

# 3. 배포 확인
gcloud functions list
gcloud functions describe scrapeAndNotify --gen2 --region asia-northeast3

# 4. 로그 확인
gcloud functions logs read scrapeAndNotify --gen2 --region asia-northeast3 --limit 50
```

### Cloud Scheduler 설정 (자동 실행)

#### 스케줄러 작업 생성

먼저 함수 URL 확인:
```bash
gcloud functions describe scrapeAndNotify --gen2 --region asia-northeast3 --format="value(serviceConfig.uri)"
```

**낮 시간 스케줄 (08:00-22:00, 30분 간격):**
```bash
gcloud scheduler jobs create http bankai-daytime \
  --location asia-northeast3 \
  --schedule "0,30 8-22 * * *" \
  --uri "[함수_URL]" \
  --http-method POST \
  --time-zone "Asia/Seoul" \
  --description "08시~22시: 30분 간격 뉴스 크롤링"
```

**밤 시간 스케줄 (23:00-07:00, 1시간 간격):**
```bash
gcloud scheduler jobs create http bankai-nighttime \
  --location asia-northeast3 \
  --schedule "0 23,0-7 * * *" \
  --uri "[함수_URL]" \
  --http-method POST \
  --time-zone "Asia/Seoul" \
  --description "23시~07시: 1시간 간격 뉴스 크롤링"
```

#### 스케줄러 관리

```bash
# 목록 확인
gcloud scheduler jobs list --location asia-northeast3

# 수동 실행 (테스트)
gcloud scheduler jobs run bankai-daytime --location asia-northeast3

# 일시 중지/재개
gcloud scheduler jobs pause bankai-daytime --location asia-northeast3
gcloud scheduler jobs resume bankai-daytime --location asia-northeast3

# 삭제
gcloud scheduler jobs delete bankai-daytime --location asia-northeast3
```

## 프로젝트 구조

```
bankai/
├── src/
│   ├── config/
│   │   └── constants.ts                # 설정 (블랙리스트, Firestore, 셀렉터, URL)
│   ├── models/
│   │   └── news.model.ts               # NewsItem 데이터 모델
│   ├── services/
│   │   ├── naver-scraper.service.ts    # 네이버 뉴스 크롤링 (동적 URL 선택)
│   │   ├── filter.service.ts           # 블랙리스트 필터링
│   │   ├── firestore.service.ts        # Firestore 저장/중복 체크/TTL/셀렉터 관리
│   │   ├── telegram.service.ts         # 텔레그램 메시지 전송
│   │   ├── news-ranker.service.ts      # AI 기반 뉴스 랭킹 & 요약
│   │   ├── selector-finder.service.ts  # AI 기반 셀렉터 자동 탐지
│   │   └── admin-alert.service.ts      # 관리자 알림 (별도 봇)
│   ├── utils/
│   │   ├── logger.ts                   # 컬러 로거
│   │   ├── time-parser.ts              # 상대 시간 → 절대 시간 변환
│   │   └── date-helper.ts              # 요일/공휴일 판단 유틸
│   ├── index.ts                        # Cloud Functions 진입점
│   ├── local.ts                        # 로컬 테스트 스크립트
│   └── local-selector-finder.ts        # 셀렉터 자동 탐지 도구
├── dist/                               # 컴파일된 JavaScript (자동 생성)
├── .env                                # 로컬 환경 변수 (gitignore)
├── env.yaml                            # Cloud Functions 환경 변수
├── .gcloudignore                       # Cloud 배포 제외 파일
├── package.json                        # 의존성 및 스크립트
├── tsconfig.json                       # TypeScript 설정
├── DEPLOYMENT.md                       # 배포 가이드
├── ADC_MIGRATION.md                    # ADC 마이그레이션 가이드
├── LOCAL_TEST_GUIDE.md                 # 로컬 테스트 가이드
├── CLAUDE.md                           # 프로젝트 기술 스택 및 구조 상세
└── README.md                           # 프로젝트 문서
```

## 실행 흐름

```
[1. 네이버 크롤링] → [2. 중복 체크] → [3. 블랙리스트 필터링] → [4. AI 랭킹] → [5. 점수 필터링] → [6. AI 요약] → [7. 텔레그램 전송] → [8. Firestore 저장]
```

### 각 단계 상세

1. **네이버 뉴스 크롤링 (자동 복구 포함)**
   - 시간대별 동적 URL 선택 (오전 6시: pd=12 / 평일: pd=7 / 주말·공휴일: pd=9)
   - Cheerio로 HTML 파싱 (제목, URL, 언론사, 발행시간, 썸네일, 요약)
   - `[단독]` 태그 필터링
   - 상대 시간 → KST 절대 시간 변환
   - **자동 복구**: 2회 연속 실패 시 AI가 자동으로 셀렉터 탐지 및 재시도
   - 크롤링 0개 시 관리자 알림

2. **중복 체크 및 TTL 정책**
   - **TTL 정책**: 14일 이상 지난 뉴스 자동 삭제
   - Firestore에서 제목 기반 중복 체크 (배치 쿼리, 30개씩)
   - 신규 뉴스만 다음 단계로 전달

3. **블랙리스트 필터링**
   - `BANNED_PUBLISHERS`: 특정 언론사 제외
   - `BANNED_KEYWORDS`: 특정 키워드 포함 뉴스 제외

4. **AI 기반 뉴스 랭킹**
   - Claude 3.5 Haiku로 각 뉴스의 중요도 평가 (1-10점)
   - 점수와 평가 이유 생성
   - 관리자에게 랭킹 결과 보고

5. **점수 필터링 및 개수 제한**
   - `MIN_SCORE_CUTOFF` (5점) 이상만 선택
   - `MAX_NEWS_TO_SEND` (6개) 개수 제한

6. **AI 핵심 요약**
   - Claude 3.5 Haiku로 뉴스 요약을 80자 이내로 재작성
   - 명사형 종결어미 사용 ('했음', '있음', '됨' 등)

7. **텔레그램 전송**
   - HTML 포맷: 제목(링크), 요약
   - 1위 뉴스 썸네일 이미지 포함 (실패 시 텍스트만 전송)

8. **Firestore 저장**
   - 전송 성공한 뉴스를 Firestore에 저장 (배치 저장, 500개씩)
   - 다음 실행 시 중복 방지

## 주요 기능 상세

### TTL 정책 (자동 삭제)

- **실행 시점**: 중복 체크 전
- **삭제 조건**: `publishedAt` 기준 14일 이상 지난 뉴스
- **배치 처리**: 500개씩 삭제
- **설정**: [src/config/constants.ts](src/config/constants.ts)의 `TTL_DAYS` 변경 가능

### 자동 복구 시스템 🔧

네이버가 HTML 구조를 변경해도 **완전 자동으로 복구**됩니다:

**작동 방식:**
1. 크롤링 결과 0개 발생 시 실패 횟수 추적
2. 2회 연속 실패 시 자동 복구 모드 시작
3. Claude Sonnet 4.5가 HTML을 분석하여 새 셀렉터 탐지
4. 새 셀렉터로 크롤링 재시도
5. 성공 시:
   - Firestore에 새 셀렉터 자동 저장
   - 실패 횟수 초기화
   - 관리자에게 복구 성공 알림 (변경사항 포함)
   - 정상 파이프라인으로 진행
6. 실패 시:
   - 실패 횟수 초기화
   - 다음 2회 실패 후 재시도

**관리자 알림:**
- 자동 복구 시작 알림
- 셀렉터 탐지 결과 (성공/실패)
- 복구 성공 시 변경된 셀렉터 목록

**수동 개입 불필요**: 대부분의 경우 자동으로 복구되며, 수동 개입 없이 시스템이 지속적으로 작동합니다.

### 동적 검색 범위

시간대와 요일에 따라 네이버 검색 URL이 자동으로 변경됩니다:

- **오전 6시**: `pd=12` (최근 6시간) - 야간 뉴스 포괄
- **월요일 0시 / 주말 / 공휴일**: `pd=9` (최근 3시간)
- **나머지 평일**: `pd=7` (최근 1시간)

공휴일 설정은 [src/config/constants.ts](src/config/constants.ts)의 `WEEKDAY_HOLIDAYS` 배열에서 관리합니다.

### 텔레그램 메시지 포맷

```
⚡ 이 시각 단독 알림 (14시 31분)

1. [단독] 뉴스 제목 (연합뉴스)
✍️  핵심 요약 내용 (80자 이내)...

2. [단독] 다른 뉴스 제목 (조선일보)
✍️  핵심 요약 내용...
```

- 1위 뉴스 썸네일 이미지 포함
- 제목 클릭 시 기사 페이지로 이동

### 시간 처리

- **크롤링 시**: 상대 시간("3시간 전") → KST 절대 시간으로 변환
- **URL 선택**: Cloud Functions는 UTC 환경이므로 KST 변환 후 시간 판단
- **Firestore 저장**: UTC 타임스탬프로 저장
- **텔레그램 표시**: KST(UTC+9) 기준 "HH시 MM분"

### Firestore 인증 방식

- **로컬 개발**: Service Account JSON 키 사용
- **Cloud Functions**: Application Default Credentials (ADC) 자동 사용
  - Private Key 환경 변수 불필요
  - Cloud Functions의 기본 서비스 계정 자동 인증

## 문제 해결

### 1. 크롤링이 안 될 때

- 네이버가 HTML 구조를 변경했을 가능성
  - `npm run selector:find` 실행하여 셀렉터 자동 탐지
  - 또는 수동으로 [constants.ts](src/config/constants.ts)의 `SELECTORS` 확인
- 크롤링 0개 시 관리자에게 자동 알림 전송
- 로그에서 "0개 뉴스 발견" 확인

### 2. 텔레그램 전송 실패

- `TELEGRAM_BOT_TOKEN` 확인
- `TELEGRAM_CHAT_ID` 확인 (@채널명 또는 숫자 ID)
- 봇이 채널 관리자로 등록되어 있는지 확인
- 로그에서 "Telegram API error" 확인

### 3. Firestore 연결 오류

- **로컬**: Service Account JSON 키 올바른지 확인
- **Cloud Functions**: 프로젝트 ID 확인 (`FIREBASE_PROJECT_ID`)
- Firestore Native 모드 활성화 확인

### 4. 환경 변수 문제

- Cloud Functions 배포 시 `env.yaml` 파일 사용
- URL의 `&` 기호는 YAML 파일에서 따옴표로 감싸기
- 환경 변수 확인:
  ```bash
  gcloud functions describe scrapeAndNotify --gen2 --region asia-northeast3 --format="json"
  ```

## 업데이트 및 관리

### 코드 수정 후 재배포

```bash
npm run build
npm run deploy
```

### 환경 변수만 업데이트

```bash
# env.yaml 수정 후
npm run deploy

# 또는 특정 변수만 업데이트
gcloud functions deploy scrapeAndNotify --gen2 --region asia-northeast3 --update-env-vars TELEGRAM_CHAT_ID=@new_channel
```

### 로그 모니터링

```bash
# 최근 50개 로그
gcloud functions logs read scrapeAndNotify --gen2 --region asia-northeast3 --limit 50

# 실시간 로그 스트리밍
gcloud functions logs tail scrapeAndNotify --gen2 --region asia-northeast3
```

## 비용 최적화

- **메모리**: 512MB (필요 시 256MB로 축소 가능)
- **타임아웃**: 540s (9분, 크롤링 및 전송 시간 고려)
- **리전**: asia-northeast3 (서울, Firestore와 동일)
- **실행 빈도**: Cloud Scheduler로 조절
  - 낮: 30분 간격 (14시간 × 2회 = 28회/일)
  - 밤: 1시간 간격 (10시간 × 1회 = 10회/일)
  - 총: **38회/일** (무료 할당량 200만 호출/월 내)

## 라이선스

ISC

## 참고 문서

- [DEPLOYMENT.md](DEPLOYMENT.md) - 상세 배포 가이드
- [ADC_MIGRATION.md](ADC_MIGRATION.md) - ADC 마이그레이션 가이드
- [CLAUDE.md](CLAUDE.md) - 프로젝트 기술 스택 및 구조 상세
- [Google Cloud Functions 문서](https://cloud.google.com/functions/docs)
- [Cloud Scheduler 문서](https://cloud.google.com/scheduler/docs)
- [Firestore 문서](https://firebase.google.com/docs/firestore)
- [Telegram Bot API 문서](https://core.telegram.org/bots/api)
