export interface NewsItem {
  title: string;           // 뉴스 제목
  url: string;             // 뉴스 URL (절대경로)
  publisher: string;       // 언론사명
  thumbnail?: string;      // 썸네일 이미지 URL
  summary?: string;        // 요약
  publishedAt: Date;       // 발행 시간 (절대 시간, KST 기준)
  createdAt?: Date;        // Firestore 저장 시간
  expiresAt?: Date;        // TTL 만료 시간
}
