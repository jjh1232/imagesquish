'use strict';
/*
 * 배포 후 라이브 검증.
 *
 * `check:links` 는 배포 **전에** 파일을 본다. 이 파일은 배포 **후에** 실제 주소를 찔러본다.
 * 둘은 다른 것을 잡는다 — 파일이 멀쩡해도 라우트가 안 걸리거나, 접두사가 안 붙거나,
 * 엣지가 404 를 캐시해 두는 일이 있다.
 *
 * 왜 status code 만 보면 안 되는가 — 헌법이 기록한 사고 두 가지가 여기 들어 있다:
 *   · 리다이렉트의 Location 에 접두사가 빠지면 도구 밖으로 튕긴다. 200/301 만 봐서는 모른다.
 *   · 루트의 언어 302 는 `Cache-Control: no-store` 가 없으면 첫 방문자의 언어가
 *     뒤따라오는 전원에게 나간다. 이것도 상태 코드로는 안 보인다.
 * 그리고 **허브(/ko)도 같이 찍는다.** 도구 라우트가 잘못 겹치면 허브가 먼저 죽는다.
 *
 * 쓰기:  npm run verify          (배포 직후)
 *        npm run verify -- --wait 20    자산 전파를 기다렸다가
 */
const TOOL = 'imagesquish';
const ORIGIN = 'https://prelaps.com';
const LANGS = ['ko', 'en', 'ja'];
const XDEFAULT = 'en';

/** 도구 안에서 실제로 있어야 하는 자산. 하나라도 404 면 화면이 조용히 깨진다. */
const ASSETS = [
  'styles.css',
  'src/main.js',
  'src/i18n.js',
  'src/squish.js',
  'src/squish.worker.js',
  'vendor/client-zip.js',
  'sitemap.xml',
  'og.png',
];

let fails = 0;
const rows = [];
const ok = (name, detail) => rows.push(['ok ', name, detail]);
const bad = (name, detail) => { fails++; rows.push(['✗  ', name, detail]); };

/** 엣지 캐시를 피한다. 방금 올린 것을 보려는 것이지 캐시를 보려는 게 아니다. */
const bust = (u) => u + (u.includes('?') ? '&' : '?') + 'cb=' + Math.random().toString(36).slice(2);

async function head(url, headers = {}) {
  const res = await fetch(bust(url), { method: 'GET', redirect: 'manual', headers });
  return {
    status: res.status,
    location: res.headers.get('location'),
    cache: res.headers.get('cache-control'),
    type: res.headers.get('content-type') || '',
    text: () => res.text(),
  };
}

async function main() {
  const waitArg = process.argv.indexOf('--wait');
  if (waitArg > -1) {
    const sec = Number(process.argv[waitArg + 1]) || 15;
    console.log(`자산 전파를 ${sec}초 기다린다…`);
    await new Promise((r) => setTimeout(r, sec * 1000));
  }

  // ── 끝 슬래시 없는 진입 — 라우터 몫 ──────────────────────
  // 도구의 라우트는 /<도구>/* 라 이 주소에 안 걸린다. prelaps-router 의 TOOLS 가 받는다.
  // 여기서 실패하면 라우터를 안 올렸거나 TOOLS 에 줄을 안 넣은 것이다.
  {
    const r = await head(`${ORIGIN}/${TOOL}`);
    const to = (r.location || '').replace(/\?cb=[^&]*/, '');
    if (r.status === 301 && to.endsWith(`/${TOOL}/`)) ok(`/${TOOL}`, `301 → ${to}`);
    else bad(`/${TOOL}`, `${r.status} ${to} — 라우터의 TOOLS 에 '/${TOOL}' 이 있는가`);
  }

  // ── 루트의 언어 분기 ─────────────────────────────────────
  for (const [header, want] of [...LANGS.map((l) => [l, l]), ['de', XDEFAULT]]) {
    const r = await head(`${ORIGIN}/${TOOL}/`, { 'accept-language': header });
    const to = (r.location || '').replace(/\?cb=[^&]*/, '');
    const name = `/${TOOL}/  (Accept-Language: ${header})`;

    if (r.status !== 302) {
      // 301 이면 브라우저가 영구 캐시해서 방문자가 언어를 되돌릴 수 없다.
      bad(name, `${r.status} — 302 여야 한다 (301 은 브라우저가 영구 캐시한다)`);
    } else if (!to.endsWith(`/${TOOL}/${want}/`)) {
      bad(name, `→ ${to} — /${TOOL}/${want}/ 여야 한다`);
    } else if (!/no-store/.test(r.cache || '')) {
      // 엣지는 Accept-Encoding 외의 Vary 를 무시한다. no-store 가 없으면
      // 첫 방문자의 언어가 뒤따라오는 전원에게 나간다.
      bad(name, `→ ${to} 인데 Cache-Control 이 '${r.cache}' 다 — no-store 여야 한다`);
    } else {
      ok(name, `302 → ${to}`);
    }
  }

  // ── 언어판 ───────────────────────────────────────────────
  for (const lang of LANGS) {
    const url = `${ORIGIN}/${TOOL}/${lang}/`;
    const r = await head(url);
    if (r.status !== 200) { bad(`/${TOOL}/${lang}/`, `${r.status}`); continue; }

    const html = await r.text();
    const canon = (html.match(/rel="canonical" href="([^"]+)"/) || [])[1];
    if (canon !== url) bad(`/${TOOL}/${lang}/`, `canonical 이 ${canon} 다`);
    else if (!new RegExp(`<html lang="${lang}"`).test(html)) bad(`/${TOOL}/${lang}/`, `<html lang> 이 ${lang} 이 아니다`);
    else ok(`/${TOOL}/${lang}/`, '200 · canonical 자기 자신');
  }

  // ── 자산 층 리다이렉트에 접두사가 다시 붙는지 ────────────
  // 빠지면 Location 이 /ko/ 로 나가 허브로 이탈한다. 내부 링크가 상대 경로라
  // 홈 버튼 한 번에 도구 밖으로 터진다. (헌법 §3)
  for (const lang of LANGS) {
    const r = await head(`${ORIGIN}/${TOOL}/${lang}/index.html`);
    const to = (r.location || '').replace(/\?cb=[^&]*/, '');
    const name = `접두사 재부착  ${lang}/index.html`;
    if (!r.location) ok(name, `${r.status} (리다이렉트 없음)`);
    else if (to.startsWith(`/${TOOL}/`) || to.startsWith(`${ORIGIN}/${TOOL}/`)) ok(name, `→ ${to}`);
    else bad(name, `→ ${to} — 접두사가 빠져 도구 밖으로 나간다`);
  }

  // ── 자산 ─────────────────────────────────────────────────
  for (const a of ASSETS) {
    const r = await head(`${ORIGIN}/${TOOL}/${a}`);
    if (r.status === 200) ok(`/${TOOL}/${a}`, '200');
    else bad(`/${TOOL}/${a}`, `${r.status}`);
  }

  // ── 없는 주소는 404 여야 한다 ────────────────────────────
  // 200 이면 soft 404 다. 없는 주소가 전부 정상 페이지로 색인되는데
  // 화면상 아무 표시가 없어 눈으로는 못 잡는다.
  {
    const r = await head(`${ORIGIN}/${TOOL}/this-does-not-exist`);
    if (r.status === 404) ok(`/${TOOL}/없는주소`, '404');
    else bad(`/${TOOL}/없는주소`, `${r.status} — soft 404 다. wrangler 의 not_found_handling 을 볼 것`);
  }

  // ── 허브와 이웃 도구가 안 죽었는지 ───────────────────────
  // 라우트가 잘못 겹치면 여기가 먼저 죽는다. 도구만 보고 끝내면 못 잡는다.
  for (const p of [...LANGS.map((l) => `/${l}`), '/robots.txt', '/mojibake/', '/race/ko/']) {
    const r = await head(ORIGIN + p);
    if (r.status === 200) ok(`(이웃) ${p}`, '200');
    else bad(`(이웃) ${p}`, `${r.status} — 라우트가 겹쳤나`);
  }

  // ── 허브 robots.txt 가 이 사이트맵을 가리키는지 ──────────
  {
    const r = await head(`${ORIGIN}/robots.txt`);
    const txt = await r.text();
    const want = `${ORIGIN}/${TOOL}/sitemap.xml`;
    if (txt.includes(want)) ok('robots.txt → sitemap', want);
    else bad('robots.txt → sitemap', `${want} 이 없다 — 허브 public/robots.txt 에 한 줄`);
  }

  // ── 출력 ─────────────────────────────────────────────────
  const w = Math.max(...rows.map((r) => r[1].length));
  console.log('');
  for (const [mark, name, detail] of rows) console.log(`  ${mark} ${name.padEnd(w)}  ${detail}`);
  console.log('');
  if (fails) {
    console.log(`실패 ${fails}건`);
    process.exit(1);
  }
  console.log(`라이브 검증 통과 — ${rows.length}개 항목`);
}

main().catch((err) => {
  console.error('검증을 돌리지 못했다:', err.message);
  process.exit(1);
});
