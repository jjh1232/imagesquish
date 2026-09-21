/**
 * 화면 배선과 처리 흐름.
 *
 * 실제 리사이즈·변환은 squish.worker.js 가 한다. 이 파일은 그쪽에 한 장씩 넘기고
 * 결과를 받아 화면을 갱신하는 일만 한다.
 *
 * 흐름은 한 방향이다:  파일 수집 → 설정 읽기 → 한 장씩 변환 → 모아서 zip
 */

// Worker 를 못 쓰는 브라우저에서는 이 자리에서 직접 부른다. 자세한 건 squishOne 주석.
import { squish } from './squish.js';
import { pickStrings } from './i18n.js';

/* ── 요소 ────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const dropEl = $('drop');
const fileEl = $('file');
const filesEl = $('files');
const manyNoteEl = $('manyNote');

const sizeModeEl = $('sizeMode');
const sizeValueEl = $('sizeValue');
const sizeNumEl = $('sizeNum');
const sizeUnitEl = $('sizeUnit');
const sizeWHEl = $('sizeWH');
const sizeWEl = $('sizeW');
const sizeHEl = $('sizeH');
const fitModeEl = $('fitMode');
const upscaleRowEl = $('upscaleRow');
const upscaleEl = $('upscale');
const sizeNoteEl = $('sizeNote');
const formatEl = $('format');
const qualityEl = $('quality');
const qvalEl = $('qval');
const qnoteEl = $('qnote');

const runEl = $('run');
const stopEl = $('stop');
const progressEl = $('progress');
const progressFillEl = $('progressFill');
const statusEl = $('status');
const summaryEl = $('summary');
const warnEl = $('sumWarn');
const zipEl = $('zip');

/* ── 상태 ────────────────────────────────────────── */
/**
 * 화면에 보이는 목록이 곧 이 배열이다.
 *
 * `blob` 은 변환 결과다. **dataURL 로 갖고 있지 않는다** — base64 는 같은 그림을
 * 33% 더 큰 문자열로 만들어서, 장수가 늘면 그것만으로 메모리가 터진다 (기획서 §4).
 */
const items = [];
let nextId = 1;

/** 처리 중인지. 중단 버튼과 설정 잠금이 이 값을 본다. */
let running = false;

/** 중단이 눌렸는지. 루프가 다음 장으로 넘어가기 전에 이걸 본다. */
let aborted = false;

/** 재사용하는 Worker. 중단할 때는 terminate 하고 null 로 되돌린다. */
let worker = null;

/**
 * 마지막으로 돌린 설정.
 *
 * 결과가 커졌을 때 "왜" 를 말하려면 무슨 설정으로 돌렸는지 알아야 한다.
 * 지금 화면의 설정을 읽으면 안 된다 — 변환이 끝난 뒤에 사람이 값을 바꿔 놓으면
 * 결과와 상관없는 이유를 대게 된다.
 */
let lastSettings = null;

/**
 * 첫 장의 썸네일 objectURL. 하나만 만든다.
 *
 * 품질 확인에는 한 장이면 충분한데(기획서 §7), 100장 전부 만들면 디코딩된 비트맵이
 * 그만큼 메모리에 남는다 — 순차 처리로 아껴둔 것을 썸네일이 도로 까먹는 꼴이다.
 * 다시 돌릴 때 revoke 한다.
 */
let thumbUrl = null;

/**
 * 이 언어판의 문구. HTML 에 처음부터 적힌 글자 말고, JS 가 나중에 만들어 내는 것들이다.
 * 세 언어 모두 src/i18n.js 에 있다. (그쪽 파일 머리말 참고)
 */
const T = pickStrings(document.documentElement.lang);

/** zip 버튼의 원래 글자. 「만드는 중」으로 바꿨다가 되돌릴 때 쓴다. */
const zipLabel = zipEl.textContent;

/* ── 자잘한 도구 ─────────────────────────────────── */

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * GA 는 Worker 가 주입한다. 로컬(file://·npm run serve)에는 없으므로 있을 때만 부른다.
 *
 * `tool` 을 항상 붙인다 — mojibake·race 도 같은 값을 붙이고 있어서, 이것 하나로
 * 도구별 「방문 대비 실제 사용률」을 한 보고서에서 비교할 수 있다.
 *
 * ⚠ 이미지나 파일 이름은 절대 보내지 않는다. 이 도구의 약속이 "기기 밖으로 안 나간다" 라
 *   계측이 그걸 깨면 도구 전체가 거짓말이 된다. 개수·용량 합계·설정값만 보낸다.
 */
function track(name, params) {
  if (typeof window.gtag === 'function') {
    window.gtag('event', name, { tool: 'imagesquish', ...params });
  }
}

const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** 확장자를 결과 포맷에 맞춰 갈아 끼운다. 같은 이름이 겹치면 zip 안에서 하나가 사라진다. */
function outName(name, type, used) {
  const base = name.replace(/\.[^.]+$/, '');
  const ext = EXT[type] || (name.match(/\.([^.]+)$/) || [, 'bin'])[1];
  let out = `${base}.${ext}`;
  let n = 2;
  while (used.has(out)) out = `${base}-${n++}.${ext}`;
  used.add(out);
  return out;
}

/* ── 설정 읽기 ───────────────────────────────────── */

/** 세그먼트에서 켜져 있는 버튼의 data 값. 라벨 문자열은 읽지 않는다 — 언어판에서 깨진다. */
function segValue(el, key) {
  return el.querySelector('button.on').dataset[key];
}

function readSettings() {
  const mode = segValue(sizeModeEl, 'mode');
  const type = segValue(formatEl, 'fmt');
  return {
    mode,
    // 긴 변 · 퍼센트는 값 하나, 가로×세로는 둘. 빈칸은 null 로 넘겨 "제한 없음" 이 된다.
    long: mode === 'long' ? Number(sizeNumEl.value) || null : null,
    pct: mode === 'pct' ? Number(sizeNumEl.value) || null : null,
    w: mode === 'wh' ? Number(sizeWEl.value) || null : null,
    h: mode === 'wh' ? Number(sizeHEl.value) || null : null,
    fit: segValue(fitModeEl, 'fit'),
    up: upscaleEl.checked,
    type,
    quality: Number(qualityEl.value),
  };
}

/* ── 설정 UI ─────────────────────────────────────── */

/** 세그먼트 한 줄. 누른 것만 .on 이 되고 나머지는 꺼진다. */
function wireSeg(el, after) {
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || running) return;
    el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    after();
  });
}

function syncSizeUI() {
  const mode = segValue(sizeModeEl, 'mode');
  sizeValueEl.hidden = mode !== 'long' && mode !== 'pct';
  sizeWHEl.hidden = mode !== 'wh';
  // 자르느냐 마느냐는 상자가 있을 때만 뜻이 있다. 긴 변·퍼센트에는 고를 것이 없다.
  fitModeEl.hidden = mode !== 'wh';
  // 「원본 유지」에는 크기 자체가 없으니 확대할 것도 없다.
  upscaleRowEl.hidden = mode === 'keep';

  // 안내 문구는 세 갈래다 — 상자를 채우느냐(cover), 상자에 넣느냐(contain),
  // 아니면 상자가 아예 없느냐(긴 변·퍼센트). 확대 허용이 각각을 한 번 더 가른다.
  sizeNoteEl.hidden = mode === 'keep';
  const up = upscaleEl.checked;
  const fit = mode === 'wh' ? segValue(fitModeEl, 'fit') : 'scale';
  const w = Number(sizeWEl.value) || null;
  const h = Number(sizeHEl.value) || null;

  if (fit === 'cover') {
    // 한쪽이 비면 상자 비율이 없어서 조용히 「상자에 맞추기」처럼 동작한다.
    // 그걸 말해주지 않으면 "정확히" 를 골랐는데 안 되는 화면이 된다.
    sizeNoteEl.textContent = w && h
      ? (up ? T.noteCoverUp(w, h) : T.noteCover(w, h))
      : T.noteCoverNeedBoth;
  } else if (fit === 'contain') {
    sizeNoteEl.textContent = up ? T.noteContainUp : T.noteContain;
  } else {
    sizeNoteEl.textContent = up ? T.noteScaleUp : T.noteScale;
  }
  if (mode === 'long' || mode === 'pct') {
    sizeUnitEl.textContent = mode === 'pct' ? '%' : 'px';
    // 퍼센트로 옮겼는데 1920 이 남아 있으면 19배로 읽힌다. 모드에 맞는 값으로 갈아준다.
    if (mode === 'pct' && Number(sizeNumEl.value) > 100) sizeNumEl.value = 50;
    if (mode === 'long' && Number(sizeNumEl.value) <= 100) sizeNumEl.value = 1920;
    sizeNumEl.max = mode === 'pct' ? 100 : 20000;
  }
}

function syncQualityUI() {
  // PNG 는 무손실이라 convertToBlob 이 quality 를 무시한다 (기획서 §5-3).
  const png = segValue(formatEl, 'fmt') === 'image/png';
  qualityEl.disabled = png;
  qnoteEl.hidden = !png;
  qvalEl.textContent = Number(qualityEl.value).toFixed(2);
}

wireSeg(sizeModeEl, syncSizeUI);

/**
 * 「정확히 이 크기」를 고르면 확대 허용도 같이 켠다.
 *
 * 둘 중 하나만 켜면 목적을 못 이룬다 — 자르기만 켜면 상자보다 작은 원본이 작은 채로
 * 남아서 결과 크기가 여전히 들쭉날쭉하다. 「정확히」를 고른 사람이 원하는 건 예외 없이
 * 같은 크기이므로 한 번에 거기까지 간다. 체크박스는 그대로 보이니 되돌릴 수 있다.
 *
 * 반대로 「상자에 맞추기」로 돌아올 때는 건드리지 않는다. 일부러 켜 둔 값을 뺏는 셈이 된다.
 */
wireSeg(fitModeEl, () => {
  if (segValue(fitModeEl, 'fit') === 'cover') upscaleEl.checked = true;
  syncSizeUI();
});
wireSeg(formatEl, syncQualityUI);
qualityEl.addEventListener('input', syncQualityUI);
upscaleEl.addEventListener('change', syncSizeUI);
// 안내 문구가 입력한 숫자를 그대로 되읽어 주므로 값이 바뀔 때마다 다시 그린다.
sizeWEl.addEventListener('input', syncSizeUI);
sizeHEl.addEventListener('input', syncSizeUI);

/* ── 파일 받기 ───────────────────────────────────── */

function addFiles(list) {
  const before = items.length;
  for (const file of list) {
    if (!file.type.startsWith('image/')) continue;
    items.push({ id: nextId++, file, name: file.name || `image-${nextId}`, status: 'queued' });
  }
  if (items.length === before) return;

  // 파일이 들어오면 드롭 영역은 자리를 목록에 넘긴다.
  dropEl.classList.add('slim');
  // 하드 리밋을 걸지 않는다. 되는데 느린 것이므로 금지가 아니라 사실을 알린다 (기획서 §6).
  // ⚠ 이 숫자는 감으로 쓴 값이다. 배포 전 실측해서 바꿀 것.
  manyNoteEl.hidden = items.length < 100;
  if (!manyNoteEl.hidden) manyNoteEl.textContent = T.manyFiles(items.length);
  render();
  updateRun();
}

// **preventDefault 를 빼면 드롭이 아예 안 먹는다.** 가장 흔한 실수다 (기획서 §5-2).
dropEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropEl.classList.add('over');
});
dropEl.addEventListener('dragleave', () => dropEl.classList.remove('over'));
dropEl.addEventListener('drop', (e) => {
  e.preventDefault();
  dropEl.classList.remove('over');
  addFiles(e.dataTransfer.files);
});

dropEl.addEventListener('click', (e) => {
  // 안쪽 "파일 선택" 버튼이 자기 몫으로 한 번 더 열지 않도록 여기서만 연다.
  if (e.target.closest('button') && e.target.id !== 'pick') return;
  fileEl.click();
});
dropEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileEl.click();
  }
});
fileEl.addEventListener('change', () => {
  addFiles(fileEl.files);
  // 같은 파일을 두 번 고를 수 있어야 한다. 안 비우면 change 가 안 뜬다.
  fileEl.value = '';
});

// 스크린샷을 바로 붙여넣는 사용자가 은근히 많다 (기획서 §7).
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});

/* ── 그리기 ──────────────────────────────────────── */

function render() {
  filesEl.replaceChildren(...items.map(row));
}

function row(it) {
  const li = document.createElement('li');
  li.className = `file ${it.status}`;

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (it.thumb) thumb.style.backgroundImage = `url("${it.thumb}")`;

  const meta = document.createElement('div');
  meta.className = 'fmeta';
  const name = document.createElement('span');
  name.className = 'fname';
  name.textContent = it.name;
  const dim = document.createElement('span');
  dim.className = it.status === 'failed' ? 'fdim err' : 'fdim';
  // GIF 는 createImageBitmap 이 첫 프레임만 준다. 움직이던 그림이 조용히 정지 화면이
  // 되어 나가는 것이라, 알리지 않으면 받아본 뒤에야 알게 된다.
  const gif = it.file.type === 'image/gif' ? ` · ${T.gifFrame}` : '';
  dim.textContent =
    it.status === 'failed' ? it.error
      : it.status === 'busy' ? T.busy
        : it.status === 'done' ? `${it.ow} × ${it.oh} → ${it.w} × ${it.h}${gif}`
          : '';
  meta.append(name, dim);

  const size = document.createElement('div');
  size.className = 'fsize';
  const before = document.createElement('span');
  before.className = 'before';
  before.textContent = fmtBytes(it.file.size);
  size.append(before);
  if (it.status === 'done') {
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    const after = document.createElement('span');
    after.className = 'after';
    after.textContent = fmtBytes(it.blob.size);
    const cut = document.createElement('span');
    // 커지는 경우가 있다. 이미 손실 압축된 JPEG·WebP 를 무손실인 PNG 로 바꾸면 그렇다.
    // + 로 보여주는 것만으로는 모자란다 — 초록으로 두면 나쁜 소식이 좋은 소식처럼 읽힌다.
    const pct = Math.round((1 - it.blob.size / it.file.size) * 100);
    cut.className = pct >= 0 ? 'cut' : 'cut up';
    cut.textContent = pct >= 0 ? `-${pct}%` : `+${-pct}%`;
    size.append(arrow, after, cut);
  }

  const dl = document.createElement('button');
  dl.className = 'sm dl';
  dl.type = 'button';
  dl.textContent = T.download;
  dl.disabled = it.status !== 'done';
  dl.addEventListener('click', () => saveOne(it));

  li.append(thumb, meta, size, dl);
  return li;
}

function updateRun() {
  runEl.disabled = running || items.length === 0;
}

/**
 * 왜 커졌는지. 구체적으로 짚을 수 있는 원인부터 순서대로 본다.
 *
 * 「크기를 안 줄여서」는 항상 참이지만 대개 진짜 이유가 아니다. QR 코드를 WebP 로 바꾸면
 * 크기를 줄여도 커진다 — 원인은 크기가 아니라 그림의 종류다. 그래서 크기 얘기는 맨 뒤다.
 */
function growHint(grewItems) {
  if (!lastSettings) return T.grewElse;

  // 손실 압축은 사진용이다. 선·글자·단색이 넓은 그림은 PNG 가 이긴다.
  // 원본이 PNG·GIF 였다는 것을 그런 그림이라는 신호로 쓴다 — 사진을 PNG 로 갖고 있는
  // 사람도 있지만, 커졌다는 결과와 겹쳐 보면 대개 맞는다.
  const lossy = lastSettings.type === 'image/webp' || lastSettings.type === 'image/jpeg';
  const flat = grewItems.filter((it) => /^image\/(png|gif|bmp)$/.test(it.file.type)).length;
  if (lossy && flat * 2 >= grewItems.length) return T.grewFlat;

  if (lastSettings.type === 'image/png') return T.grewPng;
  if (lastSettings.mode === 'keep') return T.grewKeep;
  return T.grewElse;
}

function updateSummary() {
  const done = items.filter((it) => it.status === 'done');
  summaryEl.hidden = done.length === 0;
  if (!done.length) {
    // 다시 돌릴 때 지난번 경고가 남지 않게 여기서 같이 지운다.
    warnEl.hidden = true;
    summaryEl.classList.remove('up');
    return;
  }

  const before = done.reduce((s, it) => s + it.file.size, 0);
  const after = done.reduce((s, it) => s + it.blob.size, 0);
  const pct = Math.round((1 - after / before) * 100);
  summaryEl.querySelector('.sum-before').textContent = fmtBytes(before);
  summaryEl.querySelector('.sum-after').textContent = fmtBytes(after);
  const cutEl = summaryEl.querySelector('.sum-cut');
  cutEl.classList.toggle('up', pct < 0);
  cutEl.textContent = T.summaryCut(pct, done.length);

  // 총합이 늘면 패널 전체를 뒤집는다. 총합은 줄었어도 몇 장만 커진 경우가 흔해서
  // (이미 최적화된 파일이 섞여 있으면) 그때는 덜 센 문구로 알린다.
  const grewItems = done.filter((it) => it.blob.size > it.file.size);
  summaryEl.classList.toggle('up', pct < 0);
  warnEl.hidden = pct >= 0 && grewItems.length === 0;
  if (pct < 0) warnEl.textContent = `${T.grew} ${growHint(grewItems)}`;
  else if (grewItems.length) warnEl.textContent = T.grewSome(grewItems.length);
}

/* ── 변환 ────────────────────────────────────────── */

/**
 * Worker 를 만든다.
 *
 * ★ `new URL(..., import.meta.url)` 이 반드시 필요하다. 문자열 인자는 **문서 기준**으로
 *   풀리는데, 이 도구는 문서가 /imagesquish/ko/ 에 있고 스크립트는 /imagesquish/src/ 에
 *   있다. './squish.worker.js' 라고 쓰면 /imagesquish/ko/squish.worker.js 를 찾아 404 다.
 *   언어판마다 문서 위치가 달라서, 틀리면 한 언어에서만 조용히 깨진다. (기획서 §10-1)
 */
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./squish.worker.js', import.meta.url), { type: 'module' });
  }
  return worker;
}

/** Worker 를 쓸 수 있는지. 한 번 실패하면 접고 메인 스레드로 돌아선다. */
let useWorker = true;

/**
 * 기다리고 있는 응답의 resolve.
 *
 * 중단은 Worker 를 terminate 하는데, 그러면 보낸 메시지의 답이 **영영 안 온다.**
 * 이걸 안 잡아두면 run() 이 await 에서 멈춘 채로 남아서, 화면은 처리 중인데
 * 아무 일도 일어나지 않고 다시 시작할 수도 없는 상태가 된다.
 * stop() 이 여기를 직접 깨운다.
 */
let pendingResolve = null;

/** 한 장을 Worker 에 넘기고 결과를 기다린다. 한 번에 한 장만 오간다. */
function viaWorker(it, settings) {
  return new Promise((resolve) => {
    const w = getWorker();
    pendingResolve = resolve;
    const onMessage = (e) => {
      if (e.data.id !== it.id) return;
      w.removeEventListener('message', onMessage);
      pendingResolve = null;
      resolve(e.data);
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id: it.id, file: it.file, ...settings });
  });
}

/** 같은 일을 이 스레드에서. 그리는 동안 화면이 잠깐 굳는 대신, 되기는 된다. */
async function viaMain(it, settings) {
  try {
    return { ok: true, ...(await squish(it.file, settings)) };
  } catch (err) {
    return { ok: false, code: err.code || 'decode' };
  }
}

/**
 * 한 장.
 *
 * 기본은 Worker 인데 두 가지로 실패할 수 있고 둘 다 사파리다:
 *   · Worker 생성 자체가 안 됨      — 모듈 Worker 를 모르는 오래된 브라우저
 *   · 'no-offscreen' 응답            — 사파리 16.4 아래. Worker 안에 캔버스가 없다
 * 어느 쪽이든 Worker 를 접고 메인 스레드로 돌아선다. 한 번 접으면 그 세션 내내 유지된다 —
 * 장마다 다시 시도하면 실패 비용만 100번 낸다.
 */
async function squishOne(it, settings) {
  if (useWorker) {
    let res = null;
    try {
      res = await viaWorker(it, settings);
    } catch {
      res = { ok: false, code: 'no-offscreen' };
    }
    if (res.ok || res.code !== 'no-offscreen') return res;

    useWorker = false;
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }
  return viaMain(it, settings);
}

async function run() {
  if (running) return;
  running = true;
  aborted = false;
  updateRun();
  stopEl.hidden = false;
  progressEl.hidden = false;

  const settings = readSettings();
  lastSettings = settings;
  // 두 벌을 보낸다. `tool_use` 는 도구 셋이 공유하는 이름이라 「방문 대비 사용률」을
  // 한 보고서에서 비교하는 용도이고, `convert_start` 는 이 도구 안에서만 쓰는 세부다.
  // 이름을 하나로 합치면 둘 중 하나를 잃는다.
  track('tool_use', { format: settings.type, size_mode: settings.mode, count: items.length });
  track('convert_start', { count: items.length, format: settings.type, size_mode: settings.mode });

  // 다시 돌릴 수 있어야 한다 — 설정만 바꿔 재적용하는 게 흔한 사용법이다 (기획서 §7).
  // 이전 결과와 썸네일을 여기서 버린다.
  if (thumbUrl) {
    URL.revokeObjectURL(thumbUrl);
    thumbUrl = null;
  }
  for (const it of items) {
    it.status = 'queued';
    it.blob = null;
    it.error = null;
    it.thumb = null;
  }
  updateSummary();
  progressFillEl.style.width = '0%';

  let doneCount = 0;
  for (const it of items) {
    if (aborted) break;

    it.status = 'busy';
    render();
    statusEl.textContent = T.progress(doneCount + 1, items.length);

    const res = await squishOne(it, settings);

    // 중단이 눌리면 Worker 를 terminate 하므로 응답이 아예 안 온다.
    // 이 검사는 응답이 온 직후에 눌린 경우를 위한 것이다.
    if (aborted) break;

    if (res.ok) {
      it.status = 'done';
      it.blob = res.blob;
      it.w = res.w;
      it.h = res.h;
      it.ow = res.ow;
      it.oh = res.oh;
      // 썸네일은 첫 성공 한 장만. 이유는 thumbUrl 선언부 주석 참고.
      if (!thumbUrl) {
        thumbUrl = URL.createObjectURL(res.blob);
        it.thumb = thumbUrl;
      }
    } else {
      // 한 장이 실패해도 멈추지 않는다. 거기까지 된 것만이라도 받을 수 있어야 한다 (기획서 §6).
      it.status = 'failed';
      it.error = T[res.code] || T.decode;
    }

    doneCount++;
    progressFillEl.style.width = `${(doneCount / items.length) * 100}%`;
    render();
    updateSummary();
  }

  running = false;
  stopEl.hidden = true;

  // 중단하면 처리 중이던 한 장이 'busy' 로 남는다. 그대로 두면 목록에 「처리 중…」이
  // 영원히 떠 있게 되므로 줄 세우기 상태로 되돌린다.
  for (const it of items) if (it.status === 'busy') it.status = 'queued';
  render();
  updateRun();

  const ok = items.filter((it) => it.status === 'done');
  if (aborted) {
    statusEl.textContent = T.aborted(ok.length);
    track('convert_abort', { done: ok.length, total: items.length });
  } else {
    const failed = items.filter((it) => it.status === 'failed').length;
    statusEl.textContent = failed ? T.doneFailed(failed) : T.done;
    track('convert_complete', {
      count: ok.length,
      failed,
      format: settings.type,
      bytes_before: ok.reduce((s, it) => s + it.file.size, 0),
      bytes_after: ok.reduce((s, it) => s + it.blob.size, 0),
    });
  }
}

/**
 * 중단.
 *
 * 깃발만 세우고 현재 장이 끝나기를 기다리면, 20MB 짜리를 처리하던 중에는 몇 초를 더 기다린다.
 * 통제권이 있다는 인상이 이 도구의 「장수 제한 없음」을 지탱하는 부분이라(기획서 §6)
 * Worker 를 죽여서 그 자리에서 멈춘다. 다음 실행 때 새로 만들어진다.
 */
function stop() {
  aborted = true;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  // terminate 한 Worker 는 답을 보내지 않는다. 기다리던 쪽을 여기서 직접 깨워야
  // run() 이 await 에서 풀려난다. (pendingResolve 선언부 주석)
  if (pendingResolve) {
    pendingResolve({ ok: false, code: 'aborted' });
    pendingResolve = null;
  }
}

runEl.addEventListener('click', run);
stopEl.addEventListener('click', stop);

/* ── 내려받기 ────────────────────────────────────── */

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // 즉시 revoke 하면 저장이 시작되기 전에 사라지는 브라우저가 있다. 한 박자 뒤에 푼다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function saveOne(it) {
  saveBlob(it.blob, outName(it.name, it.blob.type, new Set()));
}

zipEl.addEventListener('click', async () => {
  const done = items.filter((it) => it.status === 'done');
  if (!done.length) return;

  zipEl.disabled = true;
  zipEl.textContent = T.zipBuilding;
  try {
    // 여기서야 처음 받는다. 개별로만 받고 나가는 사람은 이 2KB 도 안 내려받는다.
    const { downloadZip } = await import('../vendor/client-zip.js');

    const used = new Set();
    const entries = done.map((it) => ({
      name: outName(it.name, it.blob.type, used),
      input: it.blob,
      lastModified: new Date(it.file.lastModified || Date.now()),
    }));

    const res = downloadZip(entries);

    // 순차 처리로 아껴도 zip 으로 묶는 순간 결과물 전부가 메모리에 있어야 한다 —
    // v1 의 유일한 진짜 병목이다 (기획서 §5-5).
    //
    // showSaveFilePicker 가 있으면(크로미움) 흘려보내면서 바로 디스크에 쓴다.
    // 없으면(사파리·파이어폭스) 방법이 없다 — 받으려면 Blob 이 있어야 하므로 통째로 만든다.
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'images.zip',
        types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
      });
      await res.body.pipeTo(await handle.createWritable());
    } else {
      saveBlob(await res.blob(), 'images.zip');
    }
  } catch (err) {
    // 저장창에서 취소한 것은 실패가 아니다.
    if (err.name !== 'AbortError') statusEl.textContent = T.zipFailed(err.message);
  } finally {
    zipEl.disabled = false;
    // 원래 글자는 HTML 에 있다. 여기서 문자열을 다시 적으면 언어판마다 어긋난다.
    zipEl.textContent = zipLabel;
  }
});

/* ── 시작 상태 ───────────────────────────────────── */
// 목업으로 열어 둔 것들을 여기서 닫는다. 자바스크립트가 없으면 HTML 그대로 보이고,
// 실제 상태 관리는 전부 이 파일이 한다.
filesEl.replaceChildren();
summaryEl.hidden = true;
progressEl.hidden = true;
stopEl.hidden = true;
manyNoteEl.hidden = true;
syncSizeUI();
syncQualityUI();
updateRun();
