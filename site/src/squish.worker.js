/**
 * 변환을 메인 스레드 밖에서 돌린다.
 *
 * 이 파일 자체는 얇다 — 실제 변환은 squish.js 가 하고, 여기는 메시지를 받아 넘기고
 * 결과를 돌려주는 일만 한다. 같은 로직을 메인 스레드도 폴백으로 쓰기 때문이다.
 *
 * 한 번에 한 장만 오간다. 여러 장을 한꺼번에 넘기지 않는 이유는 메모리다 —
 * 동시에 살아 있는 비트맵이 하나뿐이라야 장수와 메모리가 무관해진다. (기획서 §4)
 */

import { hasOffscreen, squish } from './squish.js';

self.addEventListener('message', async (e) => {
  const { id, file, ...settings } = e.data;

  // 사파리 16.4 아래는 Worker 안에 캔버스가 없다. 여기서는 손쓸 방법이 없고
  // (DOM 이 없어서 <canvas> 로도 못 간다) 메인 스레드가 대신 해야 한다.
  // 첫 장에서 이걸 받으면 main.js 가 Worker 를 접고 직접 처리로 돌아선다.
  if (!hasOffscreen) {
    self.postMessage({ id, ok: false, code: 'no-offscreen' });
    return;
  }

  try {
    const { blob, w, h, ow, oh } = await squish(file, settings);
    self.postMessage({ id, ok: true, blob, w, h, ow, oh });
  } catch (err) {
    // 사람이 읽을 문구는 화면 쪽이 언어에 맞춰 고른다. 여기서는 코드만 넘긴다.
    self.postMessage({ id, ok: false, code: err.code || 'decode' });
  }
});
