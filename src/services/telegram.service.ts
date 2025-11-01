import axios from 'axios';
import { RankedNews } from './news-ranker.service';
import { logger } from '../utils/logger';

export class TelegramService {
  private botToken: string;
  private chatId: string;
  private baseUrl: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';

    if (!this.botToken || !this.chatId) {
      throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env');
    }

    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * 뉴스 목록을 텔레그램으로 전송 (1위 썸네일 + 텍스트 포맷)
   */
  async sendNews(rankedNews: RankedNews[]): Promise<void> {
    if (rankedNews.length === 0) {
      logger.info('전송할 뉴스가 없습니다.');
      return;
    }

    logger.info(`텔레그램 전송 시작: ${rankedNews.length}개 뉴스`);

    try {
      const message = this.formatNewsListMessage(rankedNews);
      const firstThumbnail = rankedNews[0]?.news.thumbnail;

      // 1위 뉴스에 썸네일이 있으면 사진과 함께 전송
      if (firstThumbnail) {
        await this.sendPhoto(firstThumbnail, message);
      } else {
        // 썸네일이 없으면 텍스트만 전송
        await this.sendMessage(message);
      }

      logger.success(`텔레그램 전송 완료: ${rankedNews.length}개 뉴스`);

    } catch (error) {
      // 사진 전송 실패 시 텍스트만 전송 시도
      if (rankedNews[0]?.news.thumbnail) {
        logger.info(`사진 전송 실패, 텍스트만 전송 시도`);
        const message = this.formatNewsListMessage(rankedNews);
        await this.sendMessage(message);
      } else {
        logger.error(`텔레그램 전송 중 오류 발생: ${error}`);
        throw error;
      }
    }
  }

  /**
   * 뉴스 목록을 텍스트 포맷으로 변환
   */
  private formatNewsListMessage(rankedNews: RankedNews[]): string {
    // 현재 시간 (KST)
    const now = new Date();
    const kstDate = this.toKST(now);
    const hour = kstDate.getHours();
    const minute = kstDate.getMinutes();

    // 헤더
    let message = `⚡ 이 시각 단독 알림 (${hour}시 ${minute}분)\n\n`;

    // 각 뉴스 아이템
    rankedNews.forEach((item, index) => {
      const title = this.escapeHtml(item.news.title);
      const publisher = this.escapeHtml(item.news.publisher);
      const url = item.news.url.replace(/&/g, '&amp;');

      // 요약을 72자까지 슬라이스하고 말줄임표 추가
      let summary = '';
      if (item.news.summary) {
        const truncated = item.news.summary.slice(0, 72);
        summary = this.escapeHtml(truncated) + (item.news.summary.length > 72 ? '...' : '');
      }

      // 발행 시간 포맷 (14시 31분 출고)
      const pubKst = this.toKST(item.news.publishedAt);
      const pubHour = pubKst.getHours();
      const pubMinute = pubKst.getMinutes();

      message += `<a href="${url}">${index + 1}. <b>${title}</b> (${publisher})</a>\n`;
      //message += `📰 ${publisher}  | 🕐 ${pubHour}시 ${pubMinute}분 | <a href="${url}">📎 링크</a>\n`;
      if (summary) {
        message += `✍️  ${summary}\n\n`;
      }
      
      // 마지막 아이템이 아니면 줄바꿈 추가
      if (index < rankedNews.length - 1) {
        message += '\n';
      }
    });

    return message;
  }

  /**
   * UTC Date를 KST Date로 변환
   */
  private toKST(date: Date): Date {
    const kstOffset = 9 * 60; // 분 단위
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (kstOffset * 60000));
  }

  /**
   * 텍스트 메시지 전송
   */
  private async sendMessage(text: string): Promise<void> {
    const url = `${this.baseUrl}/sendMessage`;

    try {
      await axios.post(url, {
        chat_id: this.chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      });
    } catch (error: any) {
      // 텔레그램 API 에러 상세 정보 로깅
      if (error.response?.data) {
        logger.error(`Telegram API error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * 사진과 함께 메시지 전송
   */
  private async sendPhoto(photoUrl: string, caption: string): Promise<void> {
    const url = `${this.baseUrl}/sendPhoto`;

    try {
      await axios.post(url, {
        chat_id: this.chatId,
        photo: photoUrl,
        caption: caption,
        parse_mode: 'HTML',
      });
    } catch (error: any) {
      // 텔레그램 API 에러 상세 정보 로깅
      if (error.response?.data) {
        logger.error(`Telegram API error: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * HTML 특수문자 이스케이프
   * 텔레그램 HTML 모드에서 필수로 이스케이프해야 하는 문자들
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 봇 정보 조회 (연결 테스트용)
   */
  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/getMe`;
      const response = await axios.get(url);

      if (response.data.ok) {
        logger.success(`텔레그램 봇 연결 성공: @${response.data.result.username}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`텔레그램 봇 연결 실패: ${error}`);
      return false;
    }
  }
}
