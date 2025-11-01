import 'dotenv/config';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import { SELECTORS, NAVER_SEARCH_URL_WEEKDAY } from './config/constants';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 네이버 뉴스 셀렉터 자동 탐지 도구
 * HTML에서 셀렉터를 자동으로 찾아 constants.ts를 업데이트
 */

const ANCHOR_SELECTOR = '<div class="group_news">';
const SLICE_SIZE = 9999; // 바이트

interface SelectorResult {
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

async function main() {
  console.log('\n=== 네이버 뉴스 셀렉터 자동 탐지 ===\n');

  try {
    // 1. HTML 가져오기
    console.log('[1. HTML 가져오기]\n');
    const html = await fetchNaverNewsHtml();
    console.log(`✓ HTML 다운로드 완료 (${html.length.toLocaleString()} bytes)\n`);

    // 2. 앵커 기준으로 슬라이스
    console.log('[2. HTML 슬라이스]\n');
    const slicedHtml = sliceHtmlFromAnchor(html, ANCHOR_SELECTOR, SLICE_SIZE);

    if (!slicedHtml) {
      console.error(`❌ 앵커 "${ANCHOR_SELECTOR}"를 찾을 수 없습니다.`);
      process.exit(1);
    }

    console.log(`✓ 앵커 발견: "${ANCHOR_SELECTOR}"`);
    console.log(`✓ 슬라이스 완료: ${slicedHtml.length.toLocaleString()} bytes\n`);

    // 디버그: 슬라이스된 HTML을 파일로 저장
    fs.writeFileSync(
      path.join(__dirname, '../debug-sliced.html'),
      slicedHtml,
      'utf-8'
    );
    console.log('📄 슬라이스된 HTML 저장: debug-sliced.html\n');

    // 3. Claude API로 셀렉터 찾기
    console.log('[3. Claude API로 셀렉터 탐지]\n');
    const detectedSelectors = await detectSelectorsWithClaude(slicedHtml);
    console.log('✓ 셀렉터 탐지 완료\n');

    // 4. 현재 셀렉터와 비교
    console.log('[4. 현재 셀렉터와 비교]\n');
    const hasChanges = compareSelectors(SELECTORS, detectedSelectors);

    if (!hasChanges) {
      console.log('✅ 셀렉터 변경 없음. constants.ts 업데이트 불필요\n');
      console.log('=== 완료 ===\n');
      return;
    }

    // 5. constants.ts 업데이트
    console.log('\n[5. constants.ts 업데이트]\n');
    updateConstantsFile(detectedSelectors);
    console.log('✅ constants.ts 업데이트 완료\n');

    console.log('=== 완료 ===\n');
    console.log('⚠️  변경사항을 검토한 후 다음 명령어로 배포하세요:');
    console.log('   npm run build');
    console.log('   npm run deploy\n');

  } catch (error) {
    console.error(`\n❌ 오류 발생: ${error}`);
    if (error instanceof Error) {
      console.error(`상세: ${error.message}`);
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * 네이버 뉴스 HTML 가져오기
 */
async function fetchNaverNewsHtml(): Promise<string> {
  const response = await axios.get(NAVER_SEARCH_URL_WEEKDAY, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (response.status !== 200) {
    throw new Error(`HTTP 요청 실패: ${response.status}`);
  }

  return response.data;
}

/**
 * 앵커 기준으로 HTML 슬라이스
 */
function sliceHtmlFromAnchor(html: string, anchor: string, sliceSize: number): string | null {
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
async function detectSelectorsWithClaude(htmlSlice: string): Promise<SelectorResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY must be set in .env');
  }

  const anthropic = new Anthropic({ apiKey });

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

  console.log('Claude API 호출 중...');

  const message = await anthropic.messages.create({
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

  console.log('\nClaude API 응답:');
  console.log(responseText);
  console.log('');

  // JSON 파싱
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON 형식을 찾을 수 없습니다.');
    }
    return JSON.parse(jsonMatch[0]);
  } catch (parseError) {
    console.error(`JSON 파싱 오류: ${parseError}`);
    console.error(`응답 내용: ${responseText}`);
    throw new Error('Claude API 응답을 파싱할 수 없습니다.');
  }
}

/**
 * 현재 셀렉터와 탐지된 셀렉터 비교
 */
function compareSelectors(current: any, detected: SelectorResult): boolean {
  let hasChanges = false;

  console.log('셀렉터 비교:\n');

  for (const key of Object.keys(detected)) {
    const currentValue = current[key];
    const detectedValue = detected[key as keyof SelectorResult];

    if (currentValue !== detectedValue) {
      console.log(`🔄 ${key}:`);
      console.log(`   현재: ${currentValue}`);
      console.log(`   탐지: ${detectedValue}`);
      hasChanges = true;
    } else {
      console.log(`✓ ${key}: ${currentValue} (변경 없음)`);
    }
  }

  return hasChanges;
}

/**
 * constants.ts 파일 업데이트
 */
function updateConstantsFile(newSelectors: SelectorResult): void {
  const constantsPath = path.join(__dirname, 'config', 'constants.ts');
  let content = fs.readFileSync(constantsPath, 'utf-8');

  // SELECTORS 객체 찾아서 교체
  const selectorsPattern = /export const SELECTORS = \{[\s\S]*?\};/;

  const newSelectorsCode = `export const SELECTORS = {
  newsContainer: '${newSelectors.newsContainer}',
  newsItem: '${newSelectors.newsItem}',
  mainContent: '${newSelectors.mainContent}',
  title: '${newSelectors.title}',
  url: '${newSelectors.url}',
  publisher: '${newSelectors.publisher}',
  thumbnail: '${newSelectors.thumbnail}',
  summary: '${newSelectors.summary}',
  publishedTime: '${newSelectors.publishedTime}'
};`;

  content = content.replace(selectorsPattern, newSelectorsCode);

  // 백업 생성
  const backupPath = constantsPath + `.backup-${Date.now()}`;
  fs.copyFileSync(constantsPath, backupPath);
  console.log(`✓ 백업 생성: ${path.basename(backupPath)}`);

  // 파일 저장
  fs.writeFileSync(constantsPath, content, 'utf-8');
  console.log(`✓ constants.ts 업데이트 완료`);
}

main();
