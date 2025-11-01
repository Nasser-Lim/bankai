import * as admin from 'firebase-admin';
import { NewsItem } from '../models/news.model';
import { logger } from '../utils/logger';
import { FIRESTORE_COLLECTION, TTL_DAYS } from '../config/constants';

export class FirestoreService {
  private db: admin.firestore.Firestore;
  private collection: admin.firestore.CollectionReference;

  constructor() {
    // Firebase Admin 초기화
    if (!admin.apps.length) {
      // Cloud Functions에서는 Application Default Credentials 사용
      // Service Account 환경 변수 문제 우회
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'bankai-474816',
      });
    }

    this.db = admin.firestore();
    this.collection = this.db.collection(FIRESTORE_COLLECTION);
  }

  /**
   * Firestore에 저장되지 않은 새로운 뉴스만 필터링
   * 제목을 기준으로 중복 체크
   * TTL 정책: 30일 이상 지난 뉴스 자동 삭제
   */
  async filterNewNews(news: NewsItem[]): Promise<NewsItem[]> {
    if (news.length === 0) {
      return [];
    }

    // 먼저 TTL 정책 실행 (30일 지난 데이터 삭제)
    try {
      await this.cleanupOldNews();
    } catch (error) {
      logger.error(`TTL 정책 실행 실패, 계속 진행: ${error}`);
    }

    logger.info(`중복 체크 시작: ${news.length}개 뉴스`);

    try {
      // 모든 뉴스 제목 추출
      const titles = news.map(item => item.title);

      // Firestore에서 제목으로 기존 뉴스 조회
      // Firestore의 'in' 쿼리는 최대 30개까지만 지원하므로 배치 처리
      const batchSize = 30;
      const existingTitles = new Set<string>();

      for (let i = 0; i < titles.length; i += batchSize) {
        const batch = titles.slice(i, i + batchSize);
        const snapshot = await this.collection
          .where('title', 'in', batch)
          .select('title')
          .get();

        snapshot.docs.forEach(doc => {
          existingTitles.add(doc.data().title);
        });
      }

      // 기존에 없는 뉴스만 필터링
      const newNews = news.filter(item => {
        const isNew = !existingTitles.has(item.title);
        if (!isNew) {
          logger.debug(`중복 제목 발견: ${item.title}`);
        }
        return isNew;
      });

      const duplicateCount = news.length - newNews.length;
      logger.info(`중복 체크 완료: ${duplicateCount}개 중복, ${newNews.length}개 신규`);

      return newNews;

    } catch (error) {
      logger.error(`중복 체크 중 오류 발생: ${error}`);
      throw error;
    }
  }

  /**
   * 뉴스 아이템들을 Firestore에 저장
   */
  async saveNews(news: NewsItem[]): Promise<void> {
    if (news.length === 0) {
      logger.info('저장할 뉴스가 없습니다.');
      return;
    }

    logger.info(`Firestore 저장 시작: ${news.length}개 뉴스`);

    try {
      // Firestore 배치 쓰기 (최대 500개)
      const batchSize = 500;
      let savedCount = 0;

      for (let i = 0; i < news.length; i += batchSize) {
        const batch = this.db.batch();
        const currentBatch = news.slice(i, i + batchSize);

        currentBatch.forEach(item => {
          const docRef = this.collection.doc();
          batch.set(docRef, {
            title: item.title,
            url: item.url,
            publisher: item.publisher,
            publishedAt: admin.firestore.Timestamp.fromDate(item.publishedAt),
            thumbnail: item.thumbnail || null,
            summary: item.summary || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });

        await batch.commit();
        savedCount += currentBatch.length;
        logger.debug(`${savedCount}/${news.length}개 저장 완료`);
      }

      logger.success(`Firestore 저장 완료: ${savedCount}개 뉴스`);

    } catch (error) {
      logger.error(`Firestore 저장 중 오류 발생: ${error}`);
      throw error;
    }
  }

  /**
   * 컬렉션의 전체 문서 수 조회
   */
  async getCount(): Promise<number> {
    try {
      const snapshot = await this.collection.count().get();
      return snapshot.data().count;
    } catch (error) {
      logger.error(`문서 수 조회 중 오류 발생: ${error}`);
      return 0;
    }
  }

  /**
   * 특정 제목의 뉴스가 존재하는지 확인
   */
  async exists(title: string): Promise<boolean> {
    try {
      const snapshot = await this.collection
        .where('title', '==', title)
        .limit(1)
        .get();

      return !snapshot.empty;
    } catch (error) {
      logger.error(`존재 여부 확인 중 오류 발생: ${error}`);
      return false;
    }
  }

  /**
   * 셀렉터를 Firestore에 저장
   */
  async saveSelectors(selectors: Record<string, string>): Promise<void> {
    try {
      logger.info('Firestore에 셀렉터 저장 중...');

      const configCollection = this.db.collection('config');
      await configCollection.doc('selectors').set({
        selectors: selectors,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      logger.success('셀렉터 저장 완료');
    } catch (error) {
      logger.error(`셀렉터 저장 중 오류: ${error}`);
      throw error;
    }
  }

  /**
   * Firestore에서 셀렉터 조회
   */
  async getSelectors(): Promise<Record<string, string> | null> {
    try {
      const configCollection = this.db.collection('config');
      const doc = await configCollection.doc('selectors').get();

      if (!doc.exists) {
        logger.info('Firestore에 저장된 셀렉터가 없습니다.');
        return null;
      }

      const data = doc.data();
      return data?.selectors || null;
    } catch (error) {
      logger.error(`셀렉터 조회 중 오류: ${error}`);
      return null;
    }
  }

  /**
   * 크롤링 실패 횟수 저장
   */
  async saveFailureCount(count: number): Promise<void> {
    try {
      const configCollection = this.db.collection('config');
      await configCollection.doc('scraping-status').set({
        failureCount: count,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      logger.error(`실패 횟수 저장 중 오류: ${error}`);
    }
  }

  /**
   * 크롤링 실패 횟수 조회
   */
  async getFailureCount(): Promise<number> {
    try {
      const configCollection = this.db.collection('config');
      const doc = await configCollection.doc('scraping-status').get();

      if (!doc.exists) {
        return 0;
      }

      const data = doc.data();
      return data?.failureCount || 0;
    } catch (error) {
      logger.error(`실패 횟수 조회 중 오류: ${error}`);
      return 0;
    }
  }

  /**
   * TTL 정책: 30일 이상 지난 뉴스 자동 삭제
   */
  async cleanupOldNews(): Promise<number> {
    try {
      logger.info(`TTL 정책 실행: ${TTL_DAYS}일 이상 지난 뉴스 삭제 시작`);

      // TTL_DAYS일 전 날짜 계산
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - TTL_DAYS);
      const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffDate);

      // 오래된 뉴스 조회 (createdAt 기준)
      const snapshot = await this.collection
        .where('createdAt', '<', cutoffTimestamp)
        .get();

      if (snapshot.empty) {
        logger.info('삭제할 오래된 뉴스가 없습니다.');
        return 0;
      }

      // 배치 삭제 (최대 500개)
      const batchSize = 500;
      let deletedCount = 0;
      const docs = snapshot.docs;

      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = this.db.batch();
        const currentBatch = docs.slice(i, i + batchSize);

        currentBatch.forEach(doc => {
          batch.delete(doc.ref);
        });

        await batch.commit();
        deletedCount += currentBatch.length;
        logger.debug(`${deletedCount}/${docs.length}개 삭제 완료`);
      }

      logger.success(`TTL 정책 완료: ${deletedCount}개 뉴스 삭제`);
      return deletedCount;

    } catch (error) {
      logger.error(`TTL 정책 실행 중 오류 발생: ${error}`);
      throw error;
    }
  }
}
