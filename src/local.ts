import 'dotenv/config';
import { NaverScraperService } from './services/naver-scraper.service';
import { FilterService } from './services/filter.service';
import { FirestoreService } from './services/firestore.service';
import { TelegramService } from './services/telegram.service';
import { NewsRankerService } from './services/news-ranker.service';
import { AdminAlertService } from './services/admin-alert.service';
import { NewsItem } from './models/news.model';
import { logger } from './utils/logger';
import { formatKST } from './utils/time-parser';
import { MAX_NEWS_TO_SEND, MIN_SCORE_CUTOFF } from './config/constants';

async function main() {
  console.log('\n=== Bankai 로컬 테스트 ===\n');

  // CLI 인자 파싱
  const args = process.argv.slice(2);
  const mode = args.length > 0 ? args : ['full'];

  // 옵션 플래그 체크
  const skipSave = args.includes('--no-save') || args.includes('--skip-save');
  const skipDuplicateCheck = args.includes('--no-duplicate-check') || args.includes('--skip-duplicate');

  if (skipSave) {
    console.log('⚠️  Firestore 저장 건너뛰기 모드 활성화');
  }
  if (skipDuplicateCheck) {
    console.log('⚠️  중복 체크 건너뛰기 모드 활성화 (AI 랭킹 테스트용)');
  }
  if (skipSave || skipDuplicateCheck) {
    console.log('');
  }

  try {
    let news: NewsItem[] = [];

    // 관리자 알림 서비스 초기화 (환경 변수 없으면 스킵)
    let adminAlert: AdminAlertService | null = null;
    try {
      adminAlert = new AdminAlertService();
      console.log('✓ 관리자 알림 서비스 활성화\n');
    } catch (error) {
      console.log('⚠️  관리자 알림 서비스 비활성화 (환경 변수 미설정)\n');
    }

    // 1. 크롤링
    if (mode.includes('scraper') || mode.includes('filter') || mode.includes('full')) {
      console.log('[1. 네이버 뉴스 크롤링]\n');

      const scraper = new NaverScraperService();
      news = await scraper.scrape();

      console.log(`\n✓ 총 ${news.length}개 뉴스 발견\n`);

      // 크롤링 0개인 경우 관리자 알림
      if (news.length === 0 && adminAlert) {
        console.log('⚠️  크롤링 0개 - 관리자에게 알림 전송 중...\n');
        await adminAlert.alertScrapingFailure();
        console.log('✓ 관리자 알림 전송 완료\n');
      }
    }

    // 2. 중복 체크
    if (mode.includes('full') && news.length > 0 && !skipDuplicateCheck) {
      console.log('[2. 중복 체크]\n');

      const firestore = new FirestoreService();
      const beforeCount = news.length;
      news = await firestore.filterNewNews(news);

      console.log(`\n✓ ${news.length}개 신규 뉴스 (${beforeCount - news.length}개 중복 제거)\n`);
    } else if (mode.includes('full') && news.length > 0 && skipDuplicateCheck) {
      console.log('[2. 중복 체크]\n');
      console.log('⚠️  --no-duplicate-check 옵션으로 인해 중복 체크를 건너뜁니다.\n');
      console.log(`✓ ${news.length}개 뉴스를 다음 단계로 전달\n`);
    }

    // 3. 블랙리스트 필터링
    if (mode.includes('filter') || mode.includes('full')) {
      console.log('[3. 블랙리스트 필터링]\n');

      const filter = new FilterService();
      news = filter.apply(news);

      console.log(`\n✓ ${news.length}개 뉴스 통과\n`);
    }

    // 4. AI 기반 뉴스 랭킹
    if (mode.includes('full') && news.length > 0) {
      console.log('[4. AI 기반 뉴스 랭킹]\n');

      const ranker = new NewsRankerService();
      const rankedNews = await ranker.rankNews(news);

      console.log(`\n✓ ${rankedNews.length}개 뉴스 랭킹 완료\n`);

      // 관리자에게 AI 랭킹 결과 보고
      if (adminAlert) {
        console.log('📊 관리자에게 AI 랭킹 결과 보고 중...\n');
        await adminAlert.reportRankingResults(rankedNews);
        console.log('✓ AI 랭킹 보고 완료\n');
      }

      // 5. 점수 필터링 및 개수 제한
      console.log('[5. 점수 필터링 및 개수 제한]\n');
      console.log(`커트라인: ${MIN_SCORE_CUTOFF}점 이상, 최대: ${MAX_NEWS_TO_SEND}개\n`);

      const filteredRankedNews = rankedNews
        .filter(item => item.score >= MIN_SCORE_CUTOFF)
        .slice(0, MAX_NEWS_TO_SEND);

      console.log(`\n✓ ${filteredRankedNews.length}개 뉴스 선택 완료\n`);

      // 6. 뉴스 핵심 요약 (Claude API)
      let rankedNewsToSend = filteredRankedNews;

      if (filteredRankedNews.length > 0) {
        console.log('[6. 뉴스 핵심 요약]\n');

        const newsItems = filteredRankedNews.map(item => item.news);
        const summarizedNews = await ranker.summarizeNews(newsItems);

        // 요약된 뉴스를 RankedNews 형태로 다시 구성
        rankedNewsToSend = filteredRankedNews.map((rankedItem, index) => ({
          ...rankedItem,
          news: summarizedNews[index]
        }));

        console.log(`\n✓ ${rankedNewsToSend.length}개 뉴스 요약 완료\n`);
      }

      // 7. 텔레그램 전송
      if (rankedNewsToSend.length > 0) {
        console.log('[7. 텔레그램 전송]\n');

        const telegram = new TelegramService();
        await telegram.sendNews(rankedNewsToSend);

        console.log(`\n✓ ${rankedNewsToSend.length}개 뉴스 전송 완료\n`);
      }

      // 8. Firestore 저장
      if (rankedNewsToSend.length > 0 && !skipSave) {
        console.log('[8. Firestore 저장]\n');

        const firestore = new FirestoreService();
        const newsToSave = rankedNewsToSend.map(item => item.news);
        await firestore.saveNews(newsToSave);

        console.log(`\n✓ ${newsToSave.length}개 뉴스 저장 완료\n`);
      } else if (rankedNewsToSend.length > 0 && skipSave) {
        console.log('[8. Firestore 저장]\n');
        console.log('⚠️  --no-save 옵션으로 인해 Firestore 저장을 건너뜁니다.\n');
      }

      // 최종 선택된 뉴스로 업데이트
      news = rankedNewsToSend.map(item => item.news);
    }

    // 결과 출력
    if (news.length > 0) {
      console.log('=== 최종 결과 ===\n');
      news.forEach((item, index) => {
        console.log(`${index + 1}. ${item.title}`);
        console.log(`   언론사: ${item.publisher}`);
        console.log(`   URL: ${item.url}`);
        console.log(`   발행시간: ${formatKST(item.publishedAt)}`);
        if (item.thumbnail) {
          console.log(`   썸네일: ${item.thumbnail.substring(0, 60)}...`);
        }
        if (item.summary) {
          console.log(`   요약: ${item.summary.substring(0, 80)}...`);
        }
        console.log('');
      });
    }

    console.log('=== 완료 ===\n');

  } catch (error) {
    logger.error(`실행 중 오류 발생: ${error}`);
    process.exit(1);
  }
}

main();
