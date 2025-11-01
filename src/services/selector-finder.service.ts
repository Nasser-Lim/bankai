import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { SELECTORS, NAVER_SEARCH_URL_WEEKDAY } from '../config/constants';
import { logger } from '../utils/logger';

/**
 * 셀렉터 자동 탐지 서비스
 * 네이버 HTML 구조 변경 시 자동으로 새 셀렉터를 찾아냄
 */

const ANCHOR_SELECTOR = '<div class="group_news">';
const SLICE_SIZE = 9999; // 바이트

export interface SelectorResult {
  newsContainer: string;
  newsItem: string;
  mainContent: string;
  title: string;
  url: string;
  publisher: string;
  thumbnail: string;
  summary: string;
  publishedTime: string;
}

export class SelectorFinderService {
  private anthropic: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY || '';

    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY must be set in environment variables');
    }

    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * 자동으로 셀렉터를 찾아서 반환
   */
  async findSelectors(): Promise<{
    success: boolean;
    selectors: SelectorResult | null;
    error?: string;
  }> {
    try {
      logger.info('=== 셀렉터 자동 탐지 시작 ===');

      // 1. HTML 가져오기
      logger.info('[1/3] HTML 가져오기');
      const html = await this.fetchNaverNewsHtml();
      logger.success(`HTML 다운로드 완료 (${html.length.toLocaleString()} bytes)`);

      // 2. 앵커 기준으로 슬라이스
      logger.info('[2/3] HTML 슬라이스');
      const slicedHtml = this.sliceHtmlFromAnchor(html, ANCHOR_SELECTOR, SLICE_SIZE);

      if (!slicedHtml) {
        const error = `앵커 "${ANCHOR_SELECTOR}"를 찾을 수 없습니다.`;
        logger.error(error);
        return { success: false, selectors: null, error };
      }

      logger.success(`앵커 발견 및 슬라이스 완료 (${slicedHtml.length.toLocaleString()} bytes)`);

      // 3. Claude API로 셀렉터 찾기
      logger.info('[3/3] Claude API로 셀렉터 탐지');
      const detectedSelectors = await this.detectSelectorsWithClaude(slicedHtml);
      logger.success('셀렉터 탐지 완료');

      // 변경 사항 로깅
      this.logSelectorChanges(SELECTORS, detectedSelectors);

      logger.info('=== 셀렉터 자동 탐지 완료 ===');

      return {
        success: true,
        selectors: detectedSelectors
      };

    } catch (error) {
      logger.error(`셀렉터 탐지 중 오류 발생: ${error}`);
      return {
        success: false,
        selectors: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 네이버 뉴스 HTML 가져오기
   */
  private async fetchNaverNewsHtml(): Promise<string> {
    const response = await axios.get(NAVER_SEARCH_URL_WEEKDAY, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000
    });

    if (response.status !== 200) {
      throw new Error(`HTTP 요청 실패: ${response.status}`);
    }

    return response.data;
  }

  /**
   * 앵커 기준으로 HTML 슬라이스
   */
  private sliceHtmlFromAnchor(html: string, anchor: string, sliceSize: number): string | null {
    const anchorIndex = html.indexOf(anchor);

    if (anchorIndex === -1) {
      return null;
    }

    // 앵커부터 sliceSize만큼 슬라이스
    const endIndex = Math.min(anchorIndex + sliceSize, html.length);
    return html.slice(anchorIndex, endIndex);
  }

  /**
   * Claude API를 사용하여 셀렉터 탐지
   */
  private async detectSelectorsWithClaude(htmlSlice: string): Promise<SelectorResult> {
    const prompt = `다음은 네이버 뉴스 검색 결과 HTML의 일부입니다. 이 HTML에서 뉴스 아이템을 파싱하기 위한 CSS 셀렉터를 찾아주세요.

현재 사용 중인 셀렉터:
${JSON.stringify(SELECTORS, null, 2)}

요구사항:
1. **newsContainer**: 전체 뉴스 목록을 감싸는 컨테이너 (class 셀렉터)
2. **newsItem**: 개별 뉴스 아이템 (class 셀렉터)
3. **mainContent**: 뉴스 아이템 내 메인 콘텐츠 영역 (class 셀렉터)
4. **title**: 뉴스 제목 (class 또는 요소 셀렉터)
5. **url**: 뉴스 링크 (a 태그 셀렉터)
6. **publisher**: 언론사 이름 (class 또는 요소 셀렉터)
7. **thumbnail**: 썸네일 이미지 (img 태그 셀렉터)
8. **summary**: 뉴스 요약 (class 또는 요소 셀렉터)
9. **publishedTime**: 발행 시간 (class 또는 요소 셀렉터)

중요:
- [단독] 태그가 포함된 뉴스 아이템을 정확히 선택할 수 있어야 합니다
- 셀렉터는 CSS 셀렉터 문법을 따라야 합니다
- 가능한 한 구체적이고 안정적인 셀렉터를 선택하세요
- 동적으로 변경되지 않는 클래스명을 우선 선택하세요

HTML:
${htmlSlice}

다음 JSON 형식으로만 응답해주세요 (다른 설명 없이):
{
  "newsContainer": ".class-name",
  "newsItem": ".class-name",
  "mainContent": ".class-name",
  "title": ".class-name",
  "url": "a.class-name",
  "publisher": ".class-name .nested-class",
  "thumbnail": "a[data-attr] img",
  "summary": ".class-name",
  "publishedTime": ".class-name .nested-class"
}`;

    logger.debug('Claude API 호출 중...');

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1000,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = message.content[0].type === 'text'
      ? message.content[0].text
      : '';

    logger.debug(`Claude API 응답 수신 (${responseText.length} bytes)`);

    // JSON 파싱
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSON 형식을 찾을 수 없습니다.');
      }
      return JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      logger.error(`JSON 파싱 오류: ${parseError}`);
      logger.error(`응답 내용: ${responseText}`);
      throw new Error('Claude API 응답을 파싱할 수 없습니다.');
    }
  }

  /**
   * 셀렉터 변경 사항 로깅
   */
  private logSelectorChanges(current: any, detected: SelectorResult): void {
    logger.info('셀렉터 비교:');

    let hasChanges = false;
    for (const key of Object.keys(detected)) {
      const currentValue = current[key];
      const detectedValue = detected[key as keyof SelectorResult];

      if (currentValue !== detectedValue) {
        logger.info(`  🔄 ${key}:`);
        logger.info(`     현재: ${currentValue}`);
        logger.info(`     탐지: ${detectedValue}`);
        hasChanges = true;
      } else {
        logger.debug(`  ✓ ${key}: ${currentValue} (변경 없음)`);
      }
    }

    if (!hasChanges) {
      logger.info('  ✅ 모든 셀렉터가 동일합니다.');
    }
  }
}
