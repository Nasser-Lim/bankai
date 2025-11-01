/**
 * 상대 시간 문자열을 절대 시간(Date)으로 변환
 * 예: "8분 전" → 현재 시간 - 8분
 * 예: "2시간 전" → 현재 시간 - 2시간
 */
export function parseRelativeTime(relativeTimeStr: string): Date {
  // 현재 시간 (KST)
  const now = new Date();

  // 숫자 추출
  const numberMatch = relativeTimeStr.match(/\d+/);
  if (!numberMatch) {
    // 파싱 실패 시 현재 시간 반환
    return now;
  }

  const value = parseInt(numberMatch[0], 10);

  // 단위 추출
  if (relativeTimeStr.includes('초')) {
    return new Date(now.getTime() - value * 1000);
  } else if (relativeTimeStr.includes('분')) {
    return new Date(now.getTime() - value * 60 * 1000);
  } else if (relativeTimeStr.includes('시간')) {
    return new Date(now.getTime() - value * 60 * 60 * 1000);
  } else if (relativeTimeStr.includes('일')) {
    return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
  } else if (relativeTimeStr.includes('주')) {
    return new Date(now.getTime() - value * 7 * 24 * 60 * 60 * 1000);
  } else if (relativeTimeStr.includes('개월') || relativeTimeStr.includes('달')) {
    return new Date(now.getTime() - value * 30 * 24 * 60 * 60 * 1000);
  } else if (relativeTimeStr.includes('년')) {
    return new Date(now.getTime() - value * 365 * 24 * 60 * 60 * 1000);
  }

  // 알 수 없는 형식이면 현재 시간 반환
  return now;
}

/**
 * Date 객체를 KST 기준 읽기 쉬운 형식으로 포맷
 * 예: "2025-10-12 14:35:22 KST"
 */
export function formatKST(date: Date): string {
  // KST는 UTC+9
  const kstOffset = 9 * 60; // 분 단위
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  const kstDate = new Date(utc + (kstOffset * 60000));

  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, '0');
  const day = String(kstDate.getDate()).padStart(2, '0');
  const hours = String(kstDate.getHours()).padStart(2, '0');
  const minutes = String(kstDate.getMinutes()).padStart(2, '0');
  const seconds = String(kstDate.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} KST`;
}
