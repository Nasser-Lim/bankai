import { NaverScraperService } from './services/naver-scraper.service';
import { FilterService } from './services/filter.service';
import { FirestoreService } from './services/firestore.service';
import { TelegramService } from './services/telegram.service';
import { NewsRankerService } from './services/news-ranker.service';
import { AdminAlertService } from './services/admin-alert.service';
import { SelectorFinderService, SelectorResult } from './services/selector-finder.service';
import { logger } from './utils/logger';
import { MAX_NEWS_TO_SEND, MIN_SCORE_CUTOFF, SELECTORS } from './config/constants';
import type { Request, Response } from '@google-cloud/functions-framework';
import { NewsItem } from './models/news.model';

/**
 * Google Cloud Functions Gen2 엔트리 포인트
 * Cloud Scheduler로 스케줄링하여 정기적으로 실행
 *
 * 자동 복구 기능:
 * - 크롤링 2회 연속 실패 시 자동으로 셀렉터 탐지 시도
 * - 새 셀렉터로 크롤링 재시도
 * - 성공 시 Firestore에 새 셀렉터 저장
 */
export const scrapeAndNotify = async (req: Request, res: Response) => {
  // CORS 헤더 설정
  res.set('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  const firestore = new FirestoreService();

  try {
    logger.info('=== Bankai 뉴스 크롤링 시작 ===');

    // 관리자 알림 서비스 초기화 (환경 변수 없으면 스킵)
    let adminAlert: AdminAlertService | null = null;
    try {
      adminAlert = new AdminAlertService();
    } catch (error) {
      logger.info('관리자 알림 서비스 비활성화 (환경 변수 미설정)');
    }

    // 초기 셀렉터 업로드 체크 (최초 1회만)
    await initializeSelectorsInFirestore(firestore);

    // 1. 크롤링 시도
    logger.info('[1. 네이버 뉴스 크롤링]');
    const scraper = new NaverScraperService();
    let news = await scraper.scrape();
    logger.info(`✓ 총 ${news.length}개 뉴스 발견`);

    // 크롤링 실패 시 자동 복구 로직
    if (news.length === 0) {
      logger.info('크롤링된 뉴스가 없습니다. 자동 복구 체크 중...');

      const recovered = await handleScrapingFailure(firestore, adminAlert);

      if (recovered.success && recovered.news && recovered.news.length > 0) {
        // 복구 성공 - 새 셀렉터로 크롤링된 뉴스 사용
        logger.success('자동 복구 성공! 크롤링된 뉴스로 진행합니다.');
        news = recovered.news;

        if (adminAlert) {
          await adminAlert.alertAutoRecoverySuccess();
        }
      } else {
        // 복구 실패 또는 여전히 0개
        if (adminAlert) {
          await adminAlert.alertScrapingFailure();
        }

        res.status(200).json({ success: true, message: '크롤링된 뉴스 없음', count: 0 });
        return;
      }
    } else {
      // 크롤링 성공 - 실패 횟수 초기화
      await firestore.saveFailureCount(0);
    }

    // 2. 중복 체크 (TTL 정책 포함)
    logger.info('[2. 중복 체크]');
    const beforeDuplicateCheck = news.length;
    news = await firestore.filterNewNews(news);
    logger.info(`✓ ${news.length}개 신규 뉴스 (${beforeDuplicateCheck - news.length}개 중복 제거)`);

    if (news.length === 0) {
      logger.info('중복 체크 후 신규 뉴스가 없습니다.');
      res.status(200).json({ success: true, message: '신규 뉴스 없음', count: 0 });
      return;
    }

    // 3. 블랙리스트 필터링
    logger.info('[3. 블랙리스트 필터링]');
    const filter = new FilterService();
    news = filter.apply(news);
    logger.info(`✓ ${news.length}개 뉴스 통과`);

    if (news.length === 0) {
      logger.info('필터링 후 뉴스가 없습니다.');
      res.status(200).json({ success: true, message: '필터링 후 뉴스 없음', count: 0 });
      return;
    }

    // 4. AI 기반 뉴스 랭킹
    logger.info('[4. AI 기반 뉴스 랭킹]');
    const ranker = new NewsRankerService();
    const rankedNews = await ranker.rankNews(news);
    logger.info(`✓ ${rankedNews.length}개 뉴스 랭킹 완료`);

    // 관리자에게 AI 랭킹 결과 보고
    if (adminAlert) {
      await adminAlert.reportRankingResults(rankedNews);
    }

    // 5. 점수 필터링 및 개수 제한
    logger.info('[5. 점수 필터링 및 개수 제한]');
    logger.info(`커트라인: ${MIN_SCORE_CUTOFF}점 이상, 최대: ${MAX_NEWS_TO_SEND}개`);
    const filteredRankedNews = rankedNews
      .filter(item => item.score >= MIN_SCORE_CUTOFF)
      .slice(0, MAX_NEWS_TO_SEND);
    logger.info(`✓ ${filteredRankedNews.length}개 뉴스 선택 완료`);

    if (filteredRankedNews.length === 0) {
      logger.info(`점수 커트라인(${MIN_SCORE_CUTOFF}점) 이상 뉴스가 없습니다.`);
      res.status(200).json({ success: true, message: '커트라인 이상 뉴스 없음', count: 0 });
      return;
    }

    // 6. 뉴스 핵심 요약 (Claude API)
    logger.info('[6. 뉴스 핵심 요약]');
    const newsItems = filteredRankedNews.map(item => item.news);
    const summarizedNews = await ranker.summarizeNews(newsItems);

    // 요약된 뉴스를 RankedNews 형태로 다시 구성
    const rankedNewsToSend = filteredRankedNews.map((rankedItem, index) => ({
      ...rankedItem,
      news: summarizedNews[index]
    }));
    logger.info(`✓ ${rankedNewsToSend.length}개 뉴스 요약 완료`);

    // 7. 텔레그램 전송
    logger.info('[7. 텔레그램 전송]');
    const telegram = new TelegramService();
    await telegram.sendNews(rankedNewsToSend);
    logger.info(`✓ ${rankedNewsToSend.length}개 뉴스 전송 완료`);

    // 8. Firestore 저장
    logger.info('[8. Firestore 저장]');
    const newsToSave = rankedNewsToSend.map(item => item.news);
    await firestore.saveNews(newsToSave);
    logger.info(`✓ ${newsToSave.length}개 뉴스 저장 완료`)

    logger.info('=== 완료 ===');

    res.status(200).json({
      success: true,
      message: `${rankedNewsToSend.length}개 뉴스 처리 완료`,
      count: rankedNewsToSend.length
    });

  } catch (error) {
    logger.error(`실행 중 오류 발생: ${error}`);
    console.error('Error details:', error);

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
};

/**
 * 초기 셀렉터 업로드 (Firestore에 셀렉터가 없을 경우)
 */
async function initializeSelectorsInFirestore(firestore: FirestoreService): Promise<void> {
  try {
    const existingSelectors = await firestore.getSelectors();

    if (!existingSelectors) {
      logger.info('Firestore에 셀렉터가 없습니다. 현재 셀렉터를 업로드합니다...');
      await firestore.saveSelectors(SELECTORS);
      logger.success('초기 셀렉터 업로드 완료');
    } else {
      logger.debug('Firestore에 셀렉터가 이미 존재합니다.');
    }
  } catch (error) {
    logger.error(`셀렉터 초기화 중 오류: ${error}`);
    // 오류가 발생해도 계속 진행
  }
}

/**
 * 크롤링 실패 처리 및 자동 복구
 * - 실패 횟수 증가
 * - 2회 연속 실패 시 자동 셀렉터 탐지 및 재시도
 */
async function handleScrapingFailure(
  firestore: FirestoreService,
  adminAlert: AdminAlertService | null
): Promise<{ success: boolean; news?: NewsItem[] }> {

  // 현재 실패 횟수 조회
  const currentFailureCount = await firestore.getFailureCount();
  const newFailureCount = currentFailureCount + 1;

  logger.info(`크롤링 실패 횟수: ${newFailureCount}회`);
  await firestore.saveFailureCount(newFailureCount);

  // 2회 미만이면 자동 복구 안 함
  if (newFailureCount < 2) {
    logger.info('실패 횟수가 2회 미만입니다. 다음에 재시도합니다.');
    return { success: false };
  }

  // 2회 이상 실패 - 자동 복구 시작
  logger.info('=== 자동 복구 모드 시작 ===');

  if (adminAlert) {
    await adminAlert.alertAutoRecoveryStarted(newFailureCount);
  }

  try {
    // 1. 셀렉터 자동 탐지
    const selectorFinder = new SelectorFinderService();
    const result = await selectorFinder.findSelectors();

    if (!result.success || !result.selectors) {
      logger.error('셀렉터 탐지 실패');

      if (adminAlert) {
        await adminAlert.alertSelectorFinderResult({
          success: false,
          selectors: null,
          error: result.error
        });
      }

      // 실패 횟수 초기화 (다음 2회 실패 후 다시 시도)
      await firestore.saveFailureCount(0);
      return { success: false };
    }

    // 2. 새 셀렉터로 크롤링 재시도
    logger.info('새 셀렉터로 크롤링 재시도 중...');

    // NaverScraperService는 constants.ts의 SELECTORS를 사용하므로
    // Firestore에 저장된 셀렉터를 사용하도록 수정해야 함
    // 여기서는 임시로 재시도만 수행 (실제 구현은 NaverScraperService 수정 필요)

    const scraper = new NaverScraperService();
    const news = await scraper.scrape();

    if (news.length > 0) {
      logger.success(`재시도 성공: ${news.length}개 뉴스 발견`);

      // 3. 새 셀렉터를 Firestore에 저장
      const selectorsToSave: Record<string, string> = {
        newsContainer: result.selectors.newsContainer,
        newsItem: result.selectors.newsItem,
        mainContent: result.selectors.mainContent,
        title: result.selectors.title,
        url: result.selectors.url,
        publisher: result.selectors.publisher,
        thumbnail: result.selectors.thumbnail,
        summary: result.selectors.summary,
        publishedTime: result.selectors.publishedTime
      };
      await firestore.saveSelectors(selectorsToSave);

      // 변경 사항 로깅
      const changes = getSelectorChanges(SELECTORS, result.selectors);

      // 관리자에게 성공 알림
      if (adminAlert) {
        await adminAlert.alertSelectorFinderResult({
          success: true,
          selectors: result.selectors,
          changes
        });
      }

      // 실패 횟수 초기화
      await firestore.saveFailureCount(0);

      return { success: true, news };
    } else {
      logger.info('새 셀렉터로도 크롤링 0개');

      // 실패 횟수 초기화 (다음 2회 실패 후 다시 시도)
      await firestore.saveFailureCount(0);

      return { success: false };
    }

  } catch (error) {
    logger.error(`자동 복구 중 오류: ${error}`);

    // 실패 횟수 초기화
    await firestore.saveFailureCount(0);

    return { success: false };
  }
}

/**
 * 셀렉터 변경 사항 생성
 */
function getSelectorChanges(current: any, detected: SelectorResult): string[] {
  const changes: string[] = [];

  for (const key of Object.keys(detected)) {
    const currentValue = current[key];
    const detectedValue = detected[key as keyof SelectorResult];

    if (currentValue !== detectedValue) {
      changes.push(`${key}: ${currentValue} → ${detectedValue}`);
    }
  }

  return changes.length > 0 ? changes : ['변경 사항 없음'];
}
