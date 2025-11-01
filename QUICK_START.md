# 빠른 시작 가이드 - 로컬 테스트

## 1️⃣ 테스트용 텔레그램 봇 만들기 (5분)

1. 텔레그램에서 [@BotFather](https://t.me/botfather) 검색
2. `/newbot` 입력 → 봇 이름 입력 → 사용자명 입력
3. **Bot Token** 복사 (예: `1234567890:ABCdef...`)
4. 봇과 1:1 채팅 시작하고 `/start` 입력

## 2️⃣ Chat ID 확인하기 (2분)

브라우저에서 다음 URL 접속 (YOUR_BOT_TOKEN을 실제 토큰으로 변경):
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```

결과에서 `"id"` 값 찾기:
```json
{
  "chat": {
    "id": 987654321  // <- 이 숫자가 Chat ID
  }
}
```

## 3️⃣ .env 파일 수정 (1분)

프로젝트의 `.env` 파일을 열어서 다음 두 줄만 **임시로** 변경:

```bash
# 기존 (프로덕션)
TELEGRAM_BOT_TOKEN=8312154442:AAHMhmuUcPJDRjEl_wLJHL1esKtrRe7wCsM
TELEGRAM_CHAT_ID=@bankai_kr

# 변경 (테스트)
TELEGRAM_BOT_TOKEN=1234567890:ABCdef...  # 2단계에서 받은 토큰
TELEGRAM_CHAT_ID=987654321               # 3단계에서 확인한 ID

# ANTHROPIC_API_KEY도 실제 키로 변경
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx...
```

## 4️⃣ 테스트 실행 (1분)

### 옵션 A: 일반 테스트
```bash
npm run local:test
```

- ✅ 네이버에서 뉴스 크롤링
- ✅ 필터링 및 중복 체크
- ✅ Claude AI로 랭킹
- ✅ 텔레그램으로 전송 (구분선 포함)
- ✅ **Firestore에는 저장 안함** (중요!)

### 옵션 B: AI 랭킹 집중 테스트 🔥 추천
```bash
npm run local:test-ranking
```

- ✅ 중복 체크 **건너뛰기** (크롤링된 모든 뉴스를 AI에 전달)
- ✅ AI 랭킹 알고리즘 제대로 테스트 가능
- ✅ Firestore 저장 안함 (안전)

## 5️⃣ 결과 확인

텔레그램 봇과의 채팅에서 다음을 확인:
- 구분선 (`━━━━━━━━━━━━━━━━━━━━━━`)
- 뉴스 내용
- 최대 8개까지만 전송됨

## 6️⃣ .env 파일 복원 (30초)

테스트 완료 후 `.env` 파일을 원래대로 되돌리기:

```bash
# 프로덕션 설정으로 복원
TELEGRAM_BOT_TOKEN=8312154442:AAHMhmuUcPJDRjEl_wLJHL1esKtrRe7wCsM
TELEGRAM_CHAT_ID=@bankai_kr
```

## 7️⃣ 프로덕션 배포

```bash
# 1. env.yaml에 ANTHROPIC_API_KEY 추가
# 2. 빌드
npm run build

# 3. 배포 (256MB 메모리 - 권장)
npm run deploy

# 메모리 부족 시에만 512MB로 배포
# npm run deploy:512mb

# 4. Cloud Scheduler 업데이트 (1시간 간격)
gcloud scheduler jobs update http bankai-scraper \
  --location=asia-northeast3 \
  --schedule="0 * * * *"
```

### 💡 메모리 설정
- **256MB** (기본): 비용 효율적, 현재 프로젝트에 충분 ✅
- **512MB**: 메모리 부족 오류 발생 시에만 사용 (비용 2배)

---

## 🆘 문제 해결

### "ANTHROPIC_API_KEY must be set"
→ `.env` 파일에 실제 Anthropic API 키 입력

### 텔레그램 메시지가 안 옴
→ Chat ID가 정확한지 확인 (getUpdates API로 재확인)

### "Cannot find module"
→ `npm install` 실행

---

## 📚 더 자세한 가이드

- [LOCAL_TEST_GUIDE.md](LOCAL_TEST_GUIDE.md) - 상세한 로컬 테스트 가이드
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - 배포 및 Cloud Scheduler 설정
- [CLAUDE.md](CLAUDE.md) - 전체 프로젝트 문서

---

**소요 시간**: 총 10분
**안전성**: Firestore 저장 안함으로 프로덕션 데이터 보호
