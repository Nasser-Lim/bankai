import Anthropic from '@anthropic-ai/sdk';
import { NewsItem } from '../models/news.model';
import { logger } from '../utils/logger';
import { MIN_SCORE_CUTOFF } from '../config/constants';

export interface RankedNews {
  news: NewsItem;
  score: number;
  reason: string;
}

export class NewsRankerService {
  private anthropic: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY || '';

    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY must be set in environment variables');
    }

    this.anthropic = new Anthropic({
      apiKey: apiKey,
    });
  }

  /**
   * 뉴스 목록을 중요도 순으로 랭킹하고 점수와 함께 반환
   */
  async rankNews(news: NewsItem[]): Promise<RankedNews[]> {
    if (news.length === 0) {
      logger.info('랭킹할 뉴스가 없습니다.');
      return [];
    }

    logger.info(`총 ${news.length}개 뉴스를 Claude API로 랭킹 중...`);

    try {
      // Claude API를 사용하여 뉴스 랭킹
      const rankedNews = await this.rankNewsWithClaude(news);

      logger.success(`뉴스 랭킹 완료`);

      // 디버그: 모든 뉴스와 점수 로깅
      if (process.env.DEBUG === 'true') {
        rankedNews.forEach((item, index) => {
          logger.debug(`${index + 1}. [${item.score}점] ${item.news.title} - ${item.reason}`);
        });
      }

      return rankedNews;

    } catch (error) {
      logger.error(`뉴스 랭킹 중 오류 발생: ${error}`);
      // 오류 발생 시 모든 뉴스에 중간 점수 부여
      logger.info('오류로 인해 모든 뉴스에 기본 점수(5점) 부여');
      return news.map(item => ({
        news: item,
        score: 5,
        reason: 'API 오류로 인한 기본 점수'
      }));
    }
  }

  /**
   * 랭킹된 뉴스를 점수 기준으로 필터링하여 상위 N개 반환
   */
  filterByScoreAndLimit(rankedNews: RankedNews[], minScore: number, maxCount: number): NewsItem[] {
    // 1. 점수 커트라인 이상만 필터링
    const filtered = rankedNews.filter(item => item.score >= minScore);

    logger.info(`점수 ${minScore}점 이상: ${filtered.length}개 뉴스`);

    if (filtered.length === 0) {
      logger.info(`커트라인(${minScore}점) 이상 뉴스가 없습니다.`);
      return [];
    }

    // 2. 최대 개수 제한
    const limited = filtered.slice(0, maxCount);

    if (filtered.length > maxCount) {
      logger.info(`최대 개수(${maxCount}개) 제한 적용: ${limited.length}개 선택`);
    }

    // 디버그: 최종 선택된 뉴스 로깅
    if (process.env.DEBUG === 'true') {
      limited.forEach((item, index) => {
        logger.debug(`✓ ${index + 1}. [${item.score}점] ${item.news.title}`);
      });
    }

    return limited.map(item => item.news);
  }

  /**
   * 뉴스 목록의 요약을 Claude API로 핵심 요약
   * 기존 요약을 간결하게 재작성 ('했음', '있음' 종결 어미 사용)
   */
  async summarizeNews(news: NewsItem[]): Promise<NewsItem[]> {
    if (news.length === 0) {
      logger.info('요약할 뉴스가 없습니다.');
      return [];
    }

    logger.info(`총 ${news.length}개 뉴스를 Claude API로 핵심 요약 중...`);

    const summarizedNews: NewsItem[] = [];

    for (let i = 0; i < news.length; i++) {
      const item = news[i];

      try {
        logger.debug(`[${i + 1}/${news.length}] 요약 중: ${item.title}`);

        // 요약이 없으면 스킵
        if (!item.summary || item.summary.trim() === '') {
          logger.debug(`요약 없음 - 건너뜀`);
          summarizedNews.push(item);
          continue;
        }

        const coreSummary = await this.summarizeSingleNews(item.title, item.summary);

        summarizedNews.push({
          ...item,
          summary: coreSummary
        });

        logger.debug(`요약 완료: ${coreSummary}`);

      } catch (error) {
        logger.error(`뉴스 요약 중 오류 (${item.title}): ${error}`);
        // 오류 시 원본 유지
        summarizedNews.push(item);
      }
    }

    logger.success(`뉴스 핵심 요약 완료`);
    return summarizedNews;
  }

  /**
   * 단일 뉴스의 핵심 요약 생성
   */
  private async summarizeSingleNews(title: string, summary: string): Promise<string> {
    const prompt = `다음 뉴스의 핵심을 1-2문장으로 요약해주세요.

제목: ${title}

기존 요약:
${summary}

요구사항:
- 한글로 80자 이내
- 기사의 핵심 내용만 간결하게 작성
- 완성된 문장 형태로 작성
- 종결 어미: '했음', '있음', '됨', '밝힘' 등 명사형 종결어미 사용
- 불필요한 수식어 제거

핵심 요약만 응답해주세요:`;

    const message = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = message.content[0].type === 'text'
      ? message.content[0].text.trim()
      : summary; // 응답 실패 시 원본 반환

    return responseText;
  }

  /**
   * Claude API를 사용하여 뉴스를 중요도 순으로 랭킹
   */
  private async rankNewsWithClaude(news: NewsItem[]): Promise<RankedNews[]> {
    // 뉴스 목록을 Claude가 이해하기 쉬운 형식으로 변환
    const newsListText = news.map((item, index) => {
      return `[${index}] 제목: ${item.title}
언론사: ${item.publisher}
요약: ${item.summary || '없음'}`;
    }).join('\n\n');

    const prompt = `다음은 '단독' 보도 뉴스 목록입니다. 각 뉴스의 중요도를 평가하여 순위를 매겨주세요.

평가 기준:
- 높은 중요도 (8-10점): 대통령 관련 보도, 수사/조사, 유명인/정치인/고위층의 인사이동/의혹/논란 보도, 내부 고발, 투자 빅딜, 파급력이 큰 경제/기업/외교 뉴스, 흥미로운 사회적 이슈, 독자의 관심을 끌 만한 내용
- 중간 중요도 (4-7점): 일반적인 사건사고, 국가 정책 발표, 소비자 뉴스, 대기업이나 재벌 관련한 일반 뉴스
- 낮은 중요도 (1-3점): [중요!] 뉴스 제목에 통계 표현 (예시 30%, 절반가량, 3분의1)이 포함된 보도, 지방/지자체 뉴스, 지나치게 전문적이거나 지엽적인 내용, 연예계 일반 소식

뉴스 목록:
${newsListText}

다음 JSON 형식으로만 응답해주세요 (다른 설명 없이):
[
  {"index": 0, "score": 9, "reason": "수사 관련 중요 이슈"},
  {"index": 1, "score": 7, "reason": "사회적 관심사"},
  ...
]`;

    const message = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Claude의 응답 파싱
    const responseText = message.content[0].type === 'text'
      ? message.content[0].text
      : '';

    logger.debug(`Claude API 응답: ${responseText}`);

    // JSON 파싱
    let rankings: Array<{ index: number; score: number; reason: string }>;
    try {
      // JSON 부분만 추출 (```json ``` 등의 마크다운 제거)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('JSON 형식을 찾을 수 없습니다.');
      }
      rankings = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      logger.error(`JSON 파싱 오류: ${parseError}`);
      logger.error(`응답 내용: ${responseText}`);
      throw new Error('Claude API 응답을 파싱할 수 없습니다.');
    }

    // 점수 순으로 정렬하여 반환
    const rankedNews: RankedNews[] = rankings
      .sort((a, b) => b.score - a.score)
      .map(item => ({
        news: news[item.index],
        score: item.score,
        reason: item.reason
      }));

    return rankedNews;
  }
}
