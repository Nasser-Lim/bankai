import { WEEKDAY_HOLIDAYS } from '../config/constants';

/**
 * 오늘이 주말인지 판단 (토요일 또는 일요일)
 */
export function isWeekend(date: Date = new Date()): boolean {
  const day = date.getDay(); // 0 = 일요일, 6 = 토요일
  return day === 0 || day === 6;
}

/**
 * 오늘이 평일 중 공휴일인지 판단
 */
export function isWeekdayHoliday(date: Date = new Date()): boolean {
  const dateString = formatDateToYYYYMMDD(date);
  return WEEKDAY_HOLIDAYS.includes(dateString);
}

/**
 * 오늘이 주말 또는 공휴일인지 판단 (크롤링 주기 결정용)
 * @returns true면 주말/공휴일 (3시간 주기), false면 평일 (30분 주기)
 */
export function isWeekendOrHoliday(date: Date = new Date()): boolean {
  return isWeekend(date) || isWeekdayHoliday(date);
}

/**
 * Date를 'YYYY-MM-DD' 형식으로 변환
 */
function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 현재 날짜 정보를 사람이 읽기 쉬운 형식으로 반환
 */
export function getDateInfo(date: Date = new Date()): string {
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  const dayName = dayNames[date.getDay()];
  const dateString = formatDateToYYYYMMDD(date);
  const isHoliday = isWeekdayHoliday(date);
  const isWeekendDay = isWeekend(date);

  let type = '';
  if (isWeekendDay) {
    type = '주말';
  } else if (isHoliday) {
    type = '평일 공휴일';
  } else {
    type = '평일';
  }

  return `${dateString} (${dayName}, ${type})`;
}
