/**
 * 실제 변환. 한 장을 받아 줄이고 포맷을 바꾼다.
 *
 * **Worker 와 메인 스레드가 같이 쓴다.** 사파리 16.4 아래에는 Worker 안에
 * OffscreenCanvas 가 없는데, 그 안에는 DOM 도 없어서 `document.createElement('canvas')`
 * 로 넘어갈 수도 없다. 그래서 폴백은 메인 스레드에서 일어나야 하고, 같은 변환 로직이
 * 두 군데 있으면 한쪽만 고치는 사고가 난다. 여기 한 곳에 둔다.
 *
 * 사람이 읽을 문구는 이 파일에 없다. 실패는 코드(`'heic'` 등)로만 알리고
 * 문구는 화면 쪽이 언어에 맞춰 고른다.
 */

/** Worker 안에서도 캔버스를 쓸 수 있는지. 사파리 16.4 부터 참이 된다. */
export const hasOffscreen =
  typeof OffscreenCanvas !== 'undefined' &&
  typeof OffscreenCanvas.prototype.convertToBlob === 'function';

/** 우리가 인코딩할 수 있는 포맷. 「원본 유지」가 이 밖으로 나가면 안 된다. */
const ENCODABLE = new Set(['image/webp', 'image/jpeg', 'image/png']);

export class SquishError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * 줄일 배율. 1 보다 커지지 않는다.
 *
 * 마지막 `1` 이 업스케일 방지다. 800px 짜리에 1920 을 넣으면 흐려지면서 용량이
 * **오히려 커진다** — 용량 줄이는 도구에서 그건 배신이라 원본 크기에서 멈춘다.
 *
 * 가로×세로는 한쪽이 비어 있으면(null) 그쪽에 제한이 없다. 둘 다 있으면 작은 쪽이
 * 이겨서 그 상자 안에 들어간다. 자르지 않는다 — 1920×1080 에 4:3 사진을 넣으면
 * 1440×1080 이 나온다. (자르기는 v2)
 */
export function fitScale({ mode, long, pct, w, h, up }, ow, oh) {
  // 기본은 1 에서 멈춘다(업스케일 방지). `up` 이 켜지면 그 뚜껑을 연다 —
  // 규격을 정확히 맞추는 게 화질보다 중요한 경우가 있다.
  const cap = up ? Infinity : 1;

  if (mode === 'pct') return pct ? Math.min(pct / 100, cap) : 1;
  if (mode === 'long') return long ? Math.min(long / Math.max(ow, oh), cap) : 1;
  if (mode === 'wh') {
    const s = Math.min(w ? w / ow : Infinity, h ? h / oh : Infinity, cap);
    // 두 칸이 다 비어 있고 뚜껑도 열려 있으면 Infinity 가 된다. 그건 "제한 없음" 이지 확대가 아니다.
    return Number.isFinite(s) ? s : 1;
  }
  return 1; // keep
}

/**
 * 원본의 어느 부분을 어느 크기로 그릴지.
 *
 * 「맞춰 넣기」는 상자 **안에** 통째로 들어간다. 아무것도 안 잘리는 대신 한 변이 남는다 —
 * 1909×915 를 100×20 에 넣으면 42×20 이 나온다. 가로를 100 까지 늘리려면 가로만
 * 2.4 배 잡아늘려야 해서 사람이 홀쭉해진다. 그래서 여기서 멈춘다.
 *
 * 「잘라서 채우기」는 정확히 그 크기로 만든다. 가운데에서 상자와 같은 비율로 오려낸 뒤
 * 줄인다 — 위 예에서는 1909×382 띠를 잘라 100×20 으로. 대신 위아래가 사라진다.
 *
 * 어느 쪽이든 원본보다 크게 만들지 않는다. 잘라낸 조각이 상자보다 작으면 상자 비율은
 * 지키되 조각 크기까지만 간다.
 */
export function drawPlan(settings, ow, oh) {
  const { mode, w: W, h: H, fit, up } = settings;

  // 잘라서 채우기는 상자가 온전히 정해져야 뜻이 선다. 한쪽이 비어 있으면 비율이 없다.
  if (mode === 'wh' && fit === 'cover' && W && H) {
    const box = W / H;
    // 원본이 상자보다 넓적하면 위아래를 다 쓰고 좌우를 자른다. 반대면 그 반대.
    const sw = ow / oh > box ? oh * box : ow;
    const sh = ow / oh > box ? oh : ow / box;
    // 뚜껑이 닫혀 있으면 오려낸 조각 크기까지만 간다 — 상자 비율은 지키되 800×600 을
    // 달라고 해도 500×375 가 나올 수 있다. 열면 상자 크기를 그대로 준다.
    const w = Math.max(1, up ? W : Math.min(W, Math.round(sw)));
    return {
      w,
      h: Math.max(1, Math.round(w / box)),
      sx: (ow - sw) / 2,
      sy: (oh - sh) / 2,
      sw,
      sh,
    };
  }

  const scale = fitScale(settings, ow, oh);
  return {
    // 0.5px 짜리 그림은 없다. 아무리 줄여도 1px 은 남긴다.
    w: Math.max(1, Math.round(ow * scale)),
    h: Math.max(1, Math.round(oh * scale)),
    sx: 0,
    sy: 0,
    sw: ow,
    sh: oh,
  };
}

/**
 * 결과 포맷.
 *
 * 「원본 유지」인데 원본이 HEIC 처럼 우리가 못 만드는 포맷이면 그대로 둘 수가 없다.
 * WebP 로 보낸다 — 셋 중 제일 작고 투명도도 살린다. (PNG 로 보내면 사진이 몇 배로 커진다)
 */
export function outputType(type, fileType) {
  if (type !== 'keep') return type;
  return ENCODABLE.has(fileType) ? fileType : 'image/webp';
}

/**
 * 파일을 비트맵으로.
 *
 * ★ `imageOrientation: 'from-image'` 가 이 도구에서 제일 중요한 한 줄이다.
 *   캔버스를 거치면 EXIF 가 지워지는데, **회전 정보까지 같이 날아가서 세로 사진이 눕는다.**
 *   아이폰 사진에서 특히 자주 난다. 이 옵션이 눕기 전에 미리 돌려서 그려준다. (기획서 §5-1)
 *
 * 옵션 인자 자체를 모르는 오래된 브라우저가 있어서, 거부당하면 옵션 없이 한 번 더 해본다.
 * 그때는 회전이 안 맞을 수 있지만, 아예 안 되는 것보다는 낫다.
 */
export async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      // 이 브라우저가 못 여는 포맷이다. HEIC 가 압도적으로 흔해서 따로 알려준다.
      const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
      throw new SquishError(heic ? 'heic' : 'decode');
    }
  }
}

/** 캔버스 하나. Worker 안이면 OffscreenCanvas, 메인 스레드면 <canvas>. */
function makeCanvas(w, h) {
  if (hasOffscreen) return new OffscreenCanvas(w, h);
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  return el;
}

/** 캔버스를 blob 으로. OffscreenCanvas 는 promise, <canvas> 는 콜백이라 둘을 맞춘다. */
function toBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new SquishError('encode'))),
      type,
      quality,
    );
  });
}

/**
 * 한 장을 끝까지 처리한다.
 *
 * 비트맵은 반드시 close() 한다. 안 하면 순차 처리를 해도 디코딩된 원본이 계속 쌓여서
 * 장수와 함께 메모리가 늘어난다 — 순차로 도는 이유가 사라진다. (기획서 §4)
 */
export async function squish(file, settings) {
  const bitmap = await decode(file);
  const ow = bitmap.width;
  const oh = bitmap.height;

  try {
    const { w, h, sx, sy, sw, sh } = drawPlan(settings, ow, oh);
    const type = outputType(settings.type, file.type);

    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new SquishError('encode');

    // JPEG 는 투명도가 없다. 투명 PNG 를 그냥 그리면 투명한 자리가 **검게** 나온다.
    // 흰색으로 먼저 깔고 그 위에 그린다. (기획서 §5-4)
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }

    // 많이 줄일 때 계단이 지지 않도록 브라우저의 좋은 쪽 보간을 쓴다.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // 9인자 형태다 — 원본의 (sx,sy,sw,sh) 만 잘라내어 캔버스 전체에 그린다.
    // 「맞춰 넣기」에서는 sx·sy 가 0 이고 sw·sh 가 원본 전체라 자르는 일이 없다.
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);

    // PNG 는 무손실이라 quality 가 무시된다. 넘겨도 해는 없지만 안 넘기는 게 분명하다.
    const blob = await toBlob(canvas, type, type === 'image/png' ? undefined : settings.quality);
    if (!blob) throw new SquishError('encode');

    return { blob, w, h, ow, oh };
  } finally {
    bitmap.close();
  }
}
