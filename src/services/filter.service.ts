import { NewsItem } from '../models/news.model';
import { BANNED_PUBLISHERS, BANNED_KEYWORDS } from '../config/constants';
import { logger } from '../utils/logger';

export class FilterService {
  /**
   * 필터링 적용 (블랙리스트 언론사 + 블랙리스트 키워드)
   */
  apply(news: NewsItem[]): NewsItem[] {
    logger.info(`필터링 시작: ${news.length}개 뉴스`);

    let filtered = news;

    // 1. 블랙리스트 언론사 필터
    filtered = this.filterByBannedPublisher(filtered);

    // 2. 블랙리스트 키워드 필터
    filtered = this.filterByBannedKeywords(filtered);

    logger.success(`필터링 완료: ${filtered.length}개 통과`);

    return filtered;
  }

  /**
   * 블랙리스트 언론사 필터
   */
  private filterByBannedPublisher(news: NewsItem[]): NewsItem[] {
    const before = news.length;

    logger.info(`블랙리스트 언론사 목록: [${BANNED_PUBLISHERS.join(', ')}]`);

    const filtered = news.filter(item => {
      const matches = BANNED_PUBLISHERS.includes(item.publisher);
      logger.debug(`언론사 체크: "${item.publisher}" -> ${matches ? '차단' : '통과'}`);

      if (matches) {
        logger.debug(`블랙리스트 언론사 제외: ${item.publisher} - ${item.title}`);
        return false;
      }
      return true;
    });

    const removed = before - filtered.length;
    if (removed > 0) {
      logger.info(`블랙리스트 언론사 필터: ${removed}개 제외`);
    } else {
      logger.info(`블랙리스트 언론사 필터: 제외된 뉴스 없음`);
    }

    return filtered;
  }

  /**
   * 블랙리스트 키워드 필터
   */
  private filterByBannedKeywords(news: NewsItem[]): NewsItem[] {
    const before = news.length;

    logger.info(`블랙리스트 키워드 목록: [${BANNED_KEYWORDS.join(', ')}]`);

    const filtered = news.filter(item => {
      // 제목과 요약에서 키워드 검색
      const searchText = `${item.title} ${item.summary || ''}`;

      for (const keyword of BANNED_KEYWORDS) {
        if (searchText.includes(keyword)) {
          logger.debug(`블랙리스트 키워드 제외: "${keyword}" - ${item.title}`);
          return false;
        }
      }

      return true;
    });

    const removed = before - filtered.length;
    if (removed > 0) {
      logger.info(`블랙리스트 키워드 필터: ${removed}개 제외`);
    } else {
      logger.info(`블랙리스트 키워드 필터: 제외된 뉴스 없음`);
    }

    return filtered;
  }
}
