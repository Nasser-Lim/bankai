import axios from 'axios';
import { logger } from '../utils/logger';
import { RankedNews } from './news-ranker.service';
import { formatKST } from '../utils/time-parser';

/**
 * 관리자 알림 서비스
 * - 크롤링 실패 시 관리자에게 DM 전송
 * - AI 랭킹 결과를 관리자에게 DM 전송
 */
export class AdminAlertService {
  private botToken: string;
  private adminChatId: string;
  private baseUrl: string;

  constructor() {
    this.botToken = process.env.ADMIN_BOT_TOKEN || '';
    this.adminChatId = process.env.ADMIN_CHAT_ID || '';

    if (!this.botToken) {
      throw new Error('ADMIN_BOT_TOKEN이 설정되지 않았습니다.');
    }

    if (!this.adminChatId) {
      throw new Error('ADMIN_CHAT_ID가 설정되지 않았습니다.');
    }

    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * 크롤링 실패 알림 (0개 결과)
   */
  async alertScrapingFailure(): Promise<void> {
    const message = `
🚨 <b>반까이: 크롤링 실패 경고</b>

크롤링 결과가 0개입니다.
가능한 원인:
- 네이버 HTML 구조 변경
- 셀렉터 업데이트 필요
- 최근 [단독] 뉴스 없음

시간: ${formatKST(new Date())}
`.trim();

    await this.sendMessage(message);
  }

  /**
   * AI 랭킹 결과 보고 (전체, 필요시 여러 메시지로 분할)
   */
  async reportRankingResults(rankedNews: RankedNews[]): Promise<void> {
    if (rankedNews.length === 0) {
      const message = `
📊 <b>AI 랭킹 보고</b>

랭킹할 뉴스가 없습니다.

시간: ${formatKST(new Date())}
`.trim();

      await this.sendMessage(message);
      return;
    }

    const timestamp = formatKST(new Date());
    const TELEGRAM_MAX_LENGTH = 4096; // 텔레그램 메시지 최대 길이
    const SAFE_MARGIN = 200; // 헤더/푸터용 여유 공간

    // 각 뉴스를 개별 문자열로 변환
    const newsItems = rankedNews.map((item, index) => {
      const title = this.escapeHtml(item.news.title);
      const publisher = this.escapeHtml(item.news.publisher);
      const reason = this.escapeHtml(item.reason);
      const url = this.escapeHtml(item.news.url);

      return `${index + 1}. <b>${title}</b>
   점수: ${item.score}/10
   언론사: ${publisher}
   이유: ${reason}
   🔗 <a href="${url}">기사 링크</a>`;
    });

    // 메시지를 여러 개로 분할
    const messages: string[] = [];
    let currentMessage = '';
    let currentCount = 0;
    let startIndex = 1;

    for (let i = 0; i < newsItems.length; i++) {
      const item = newsItems[i];
      const testMessage = currentMessage + (currentMessage ? '\n\n' : '') + item;

      // 헤더 + 현재 메시지 + 아이템 + 푸터 길이 체크
      const headerFooter = `📊 <b>AI 랭킹 보고</b> (${startIndex}~${i + 1}/${rankedNews.length})\n\n`;
      const footer = `\n\n시간: ${timestamp}`;
      const totalLength = headerFooter.length + testMessage.length + footer.length;

      if (totalLength > TELEGRAM_MAX_LENGTH - SAFE_MARGIN && currentMessage) {
        // 현재 메시지 저장하고 새로 시작
        const header = `📊 <b>AI 랭킹 보고</b> (${startIndex}~${startIndex + currentCount - 1}/${rankedNews.length})\n\n`;
        messages.push(header + currentMessage + footer);

        currentMessage = item;
        currentCount = 1;
        startIndex = i + 1;
      } else {
        currentMessage = testMessage;
        currentCount++;
      }
    }

    // 마지막 메시지 추가
    if (currentMessage) {
      const header = rankedNews.length === currentCount
        ? `📊 <b>AI 랭킹 보고</b>\n\n총 ${rankedNews.length}개 뉴스 분석 완료\n\n`
        : `📊 <b>AI 랭킹 보고</b> (${startIndex}~${rankedNews.length}/${rankedNews.length})\n\n`;

      messages.push(header + currentMessage + `\n\n시간: ${timestamp}`);
    }

    // 모든 메시지 전송
    logger.info(`AI 랭킹 보고: ${messages.length}개 메시지로 분할 전송`);
    for (const message of messages) {
      await this.sendMessage(message);
      // 메시지 간 짧은 지연 (Rate limit 방지)
      if (messages.length > 1) {
        await this.sleep(1000); // 1초 대기
      }
    }
  }

  /**
   * 지연 함수
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 셀렉터 자동 찾기 결과 알림
   */
  async alertSelectorFinderResult(result: {
    success: boolean;
    selectors: any;
    error?: string;
    changes?: string[];
  }): Promise<void> {
    if (result.success) {
      const changesText = result.changes && result.changes.length > 0
        ? result.changes.join('\n')
        : '변경 사항 없음';

      const message = `
🔍 <b>셀렉터 자동 탐지 완료</b>

✅ 새로운 셀렉터를 성공적으로 탐지했습니다.

<b>변경 사항:</b>
${this.escapeHtml(changesText)}

셀렉터가 Firestore에 저장되었으며,
다음 크롤링부터 새 셀렉터를 사용합니다.

시간: ${formatKST(new Date())}
`.trim();

      await this.sendMessage(message);
    } else {
      const message = `
❌ <b>셀렉터 자동 탐지 실패</b>

셀렉터 탐지 중 오류가 발생했습니다.

오류: ${this.escapeHtml(result.error || '알 수 없는 오류')}

수동으로 셀렉터를 확인해주세요:
1. npm run selector:find 실행
2. src/config/constants.ts 수정
3. 재배포

시간: ${formatKST(new Date())}
`.trim();

      await this.sendMessage(message);
    }
  }

  /**
   * 자동 복구 시작 알림
   */
  async alertAutoRecoveryStarted(failureCount: number): Promise<void> {
    const message = `
🔧 <b>반까이: 자동 복구 모드 시작</b>

크롤링이 ${failureCount}회 연속 실패하여
자동 셀렉터 탐지를 시작합니다.

예상 소요 시간: 약 30초

시간: ${formatKST(new Date())}
`.trim();

    await this.sendMessage(message);
  }

  /**
   * 자동 복구 성공 알림
   */
  async alertAutoRecoverySuccess(): Promise<void> {
    const message = `
✅ <b>반까이: 자동 복구 성공</b>

새로운 셀렉터로 크롤링에 성공했습니다.
시스템이 정상적으로 복구되었습니다.

시간: ${formatKST(new Date())}
`.trim();

    await this.sendMessage(message);
  }

  /**
   * 일반 알림 메시지 전송
   */
  async sendAlert(message: string): Promise<void> {
    await this.sendMessage(message);
  }

  /**
   * Telegram 메시지 전송 (HTML 포맷)
   */
  private async sendMessage(message: string): Promise<void> {
    try {
      logger.info('관리자 알림 전송 중...');

      const response = await axios.post(`${this.baseUrl}/sendMessage`, {
        chat_id: this.adminChatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });

      if (response.data.ok) {
        logger.success('관리자 알림 전송 성공');
      } else {
        logger.error(`관리자 알림 전송 실패: ${JSON.stringify(response.data)}`);
      }

    } catch (error) {
      logger.error(`관리자 알림 전송 중 오류: ${error}`);

      if (axios.isAxiosError(error)) {
        logger.error(`Telegram API error: ${JSON.stringify(error.response?.data)}`);
      }
    }
  }

  /**
   * HTML 특수문자 이스케이프
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
