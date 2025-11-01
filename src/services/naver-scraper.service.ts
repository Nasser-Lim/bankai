import axios from 'axios';
import * as cheerio from 'cheerio';
import { NewsItem } from '../models/news.model';
import { SELECTORS, NAVER_NEWS_DOMAIN, NAVER_SEARCH_URL_WEEKDAY, NAVER_SEARCH_URL_WEEKEND, NAVER_SEARCH_URL_MORNING } from '../config/constants';
import { logger } from '../utils/logger';
import { parseRelativeTime } from '../utils/time-parser';
import { isWeekendOrHoliday, getDateInfo } from '../utils/date-helper';

export class NaverScraperService {
  /**
   * 현재 날짜와 시간에 따라 적절한 검색 URL 반환
   * 1. 매일 오전 6시: 최근 6시간 검색 범위 (pd=12)
   * 2. 매주 월요일 0시 또는 주말/공휴일: 최근 3시간 검색 범위 (pd=9)
   * 3. 나머지: 최근 1시간 검색 범위 (pd=7)
   */
  private getSearchUrl(): string {
    // UTC 시간을 KST(한국 시간, UTC+9)로 변환
    const now = new Date();
    const kstOffset = 9 * 60; // 9시간을 분으로 변환
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kstTime = new Date(utcTime + (kstOffset * 60000));

    const currentHour = kstTime.getHours();
    const currentDay = kstTime.getDay(); // 0 = 일요일, 1 = 월요일, ...

    // 1. 오전 6시인 경우 6시간 검색 범위 사용
    if (currentHour === 6) {
      logger.info(`📅 ${getDateInfo(kstTime)} - 오전 6시 모드 (최근 6시간 검색)`);
      return NAVER_SEARCH_URL_MORNING;
    }

    // 2. 월요일 0시 또는 주말/공휴일인 경우 3시간 검색 범위 사용
    const isMondayMidnight = currentDay === 1 && currentHour === 0;
    const isHoliday = isWeekendOrHoliday(kstTime);

    if (isMondayMidnight || isHoliday) {
      if (isMondayMidnight) {
        logger.info(`📅 ${getDateInfo(kstTime)} - 월요일 0시 모드 (최근 3시간 검색)`);
      } else {
        logger.info(`📅 ${getDateInfo(kstTime)} - 주말/공휴일 모드 (최근 3시간 검색)`);
      }
      return NAVER_SEARCH_URL_WEEKEND;
    }

    // 3. 나머지: 평일 1시간 검색 범위 사용
    logger.info(`📅 ${getDateInfo(kstTime)} - 평일 모드 (최근 1시간 검색)`);
    return NAVER_SEARCH_URL_WEEKDAY;
  }

  async scrape(): Promise<NewsItem[]> {
    try {
      const searchUrl = this.getSearchUrl();

      logger.info('네이버 뉴스 검색 크롤링 시작...');
      logger.debug(`검색 URL: ${searchUrl}`);

      // HTTP 요청
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (response.status !== 200) {
        throw new Error(`HTTP 요청 실패: ${response.status}`);
      }

      logger.success('HTML 응답 수신 완료');

      // HTML 파싱
      const news = this.parseHtml(response.data);

      logger.success(`총 ${news.length}개 뉴스 발견`);

      return news;

    } catch (error) {
      logger.error(`크롤링 중 오류 발생: ${error}`);
      throw error;
    }
  }

  private parseHtml(html: string): NewsItem[] {
    const $ = cheerio.load(html);
    const newsItems: NewsItem[] = [];
    const seenUrls = new Set<string>(); // 중복 URL 체크용

    // 뉴스 아이템 찾기
    const $newsItems = $(SELECTORS.newsItem);
    if ($newsItems.length === 0) {
      logger.error('⚠️ 뉴스 아이템을 찾을 수 없습니다. 셀렉터를 확인해주세요.');
      return [];
    }

    logger.debug(`${$newsItems.length}개 뉴스 아이템 컨테이너 발견`);

    // 뉴스 아이템 추출
    $newsItems.each((index: number, element: any) => {
      try {
        const $element = $(element);

        // 메인 콘텐츠 영역만 선택 (관련 뉴스 제외)
        const $mainContent = $element.find(SELECTORS.mainContent).first();
        if ($mainContent.length === 0) return; // 메인 콘텐츠 없으면 스킵

        // 제목 추출 (메인 콘텐츠에서만)
        const title = $mainContent.find(SELECTORS.title).first().text().trim();

        // URL 추출 (메인 콘텐츠에서만)
        const rawUrl = $mainContent.find(SELECTORS.url).first().attr('href') || '';
        const url = this.normalizeUrl(rawUrl);

        // 중복 URL 체크
        if (!url || seenUrls.has(url)) {
          logger.debug(`중복 URL 스킵: ${url}`);
          return;
        }

        // 언론사 추출 (프로필 영역에서 첫 번째만)
        const publisher = $element.find(SELECTORS.publisher).first().text().trim();

        // 썸네일 추출 (메인 콘텐츠에서만)
        const thumbnail = $mainContent.find(SELECTORS.thumbnail).first().attr('src') || '';

        // 요약 추출 (메인 콘텐츠에서만)
        const summary = $mainContent.find(SELECTORS.summary).first().text().trim();

        // 발행 시간 추출 및 변환 (프로필 영역에서 첫 번째만)
        const relativeTime = $element.find(SELECTORS.publishedTime).first().text().trim();
        const publishedAt = parseRelativeTime(relativeTime);

        // [단독] 태그 필터링
        if (!title.includes('[단독]')) {
          logger.debug(`[단독] 태그 없음 - 스킵: ${title}`);
          return;
        }

        // 필수 필드 검증
        if (title && url && publisher) {
          seenUrls.add(url); // URL 중복 방지

          newsItems.push({
            title,
            url,
            publisher,
            publishedAt,
            thumbnail: thumbnail || undefined,
            summary: summary || undefined
          });

          logger.debug(`[${newsItems.length}] ${title} - ${publisher} (${relativeTime})`);
        }

      } catch (error) {
        logger.debug(`아이템 파싱 중 오류 (인덱스 ${index}): ${error}`);
      }
    });

    return newsItems;
  }

  private normalizeUrl(url: string): string {
    // 이미 절대경로인 경우
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    // 상대경로인 경우 네이버 뉴스 도메인 추가
    if (url.startsWith('/')) {
      return NAVER_NEWS_DOMAIN + url;
    }

    // 기타 경우 그대로 반환
    return url;
  }
}
