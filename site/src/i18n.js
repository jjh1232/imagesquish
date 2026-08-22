/**
 * 자바스크립트가 만들어 내는 문구.
 *
 * HTML 에 처음부터 적혀 있는 글자는 각 언어판 index.html 이 갖는다. 여기 있는 것은
 * 상태에 따라 나중에 생기는 것들뿐이다 — 진행률, 실패 사유, 설정 안내.
 * 변환 쪽(squish.js·squish.worker.js)에는 사람이 읽을 문구가 한 줄도 없다.
 * 거기는 코드(`'heic'` 등)만 넘기고 언어는 여기서 고른다.
 *
 * 세 언어를 파일 하나에 담았다. 언어별 파일로 쪼개면 요청이 하나 늘고,
 * 없는 언어를 부를 때 통째로 죽는 실패 경로가 생긴다. 전부 합쳐도 몇 KB 다.
 *
 * ⚠ 언어를 늘릴 때 같이 움직이는 것: worker 의 LANGS · 각 페이지의 hreflang 전체 목록 ·
 *   sitemap.xml · 허브 tools.ts. 여기만 늘리면 아무 데서도 안 쓰인다.
 */

export const STRINGS = {
  ko: {
    busy: '처리 중…',
    download: '받기',
    done: '완료',
    doneFailed: (n) => `완료 · ${n}장 실패`,
    progress: (i, n) => `${i} / ${n} 처리 중`,
    aborted: (n) => `중단했습니다. ${n}장은 받을 수 있어요.`,
    // ⚠ 이 숫자는 감으로 쓴 값이다. 배포 전 실측해서 바꿀 것 (기획서 §6).
    manyFiles: (n) => `${n}장입니다. 100장이 넘으면 처리에 시간이 걸릴 수 있어요.`,
    zipBuilding: 'zip 만드는 중…',
    zipFailed: (msg) => `zip 을 만들지 못했습니다: ${msg}`,
    summaryCut: (pct, n) => `${pct >= 0 ? `${pct}% 감소` : `${-pct}% 증가`} · ${n}장`,

    heic: '이 브라우저는 HEIC 를 열지 못합니다',
    decode: '읽을 수 없는 이미지라 건너뛰었습니다',
    encode: '변환하지 못했습니다',
    gifFrame: 'GIF 는 첫 프레임만 변환됩니다',

    // 「상자에 맞추기」의 안내는 "무엇을 하는지" 만으로는 모자란다. 800×600 을 넣은 사람은
    // 800×600 이 나올 거라고 읽는데, 실제로는 한 변만 닿고 나머지는 비율이 정한다 —
    // 세로 사진은 571×600, 가로 사진은 800×383 이 되어 **한 장도 800×600 이 아니다.**
    noteContain:
      '상자 안에 들어가게 줄입니다 — 한 변만 상자에 닿고 나머지는 비율대로 정해집니다. '
      + '모두 정확히 같은 크기로 만들려면 「정확히 이 크기」.',
    noteContainUp:
      '상자 안에 들어가게 맞춥니다 — 한 변만 상자에 닿습니다. '
      + '작은 원본은 늘리므로 흐려지고 용량도 커집니다.',
    // 숫자를 문구에 그대로 넣는다. "그 크기" 보다 "800×600" 이 훨씬 분명하고,
    // 입력칸에 넣은 값이 되돌아오는 것 자체가 제대로 읽혔다는 확인이 된다.
    noteCover: (w, h) =>
      `가운데를 잘라 정확히 ${w}×${h} 로 만듭니다. 상자 밖으로 나가는 부분은 사라지고, `
      + `${w}×${h} 보다 작은 원본은 작은 채로 남습니다.`,
    noteCoverUp: (w, h) =>
      `가운데를 잘라 예외 없이 ${w}×${h} 로 만듭니다. 상자 밖은 잘리고, `
      + '작은 원본은 늘려서 채우므로 그 장들은 흐려집니다.',
    noteCoverNeedBoth: '가로와 세로를 모두 채워야 합니다 — 한쪽이 비면 자를 비율이 없습니다.',
    noteScale: '비율은 유지되고, 원본보다 크게 만들지 않습니다.',
    noteScaleUp: '원본보다 크게도 만듭니다. 없던 픽셀을 지어내는 것이라 흐려지고 용량도 커집니다.',

    grew: '설정한 대로 변환했지만 용량이 늘었습니다.',
    grewPng: 'PNG 는 무손실이라 사진을 담으면 커집니다. 사진에는 WebP 를 권합니다.',
    grewFlat:
      '선·글자·단색이 넓게 깔린 그림(스크린샷·로고·QR)은 PNG 가 가장 작습니다. '
      + 'WebP·JPEG 는 사진용이라 이런 그림은 오히려 커지고 가장자리도 지저분해집니다.',
    grewKeep: '크기가 「원본 유지」라 줄어들 여지가 없었습니다. 긴 변을 1920 쯤으로 잡아 보세요.',
    grewElse: '원본이 이미 잘 압축돼 있으면 다시 저장하는 것만으로는 줄지 않습니다.',
    grewSome: (n) => `${n}장이 원본보다 커졌습니다. 그 파일들은 원본을 쓰는 편이 낫습니다.`,
  },

  en: {
    busy: 'Working…',
    download: 'Save',
    done: 'Done',
    doneFailed: (n) => `Done · ${n} failed`,
    progress: (i, n) => `${i} / ${n} processing`,
    aborted: (n) => `Stopped. ${n} ${n === 1 ? 'image is' : 'images are'} ready to save.`,
    manyFiles: (n) => `${n} images. Above 100 this can take a while.`,
    zipBuilding: 'Building zip…',
    zipFailed: (msg) => `Could not build the zip: ${msg}`,
    summaryCut: (pct, n) =>
      `${pct >= 0 ? `${pct}% smaller` : `${-pct}% larger`} · ${n} ${n === 1 ? 'image' : 'images'}`,

    heic: 'This browser cannot open HEIC',
    decode: 'Skipped — this image could not be read',
    encode: 'Could not convert this image',
    gifFrame: 'only the first frame of a GIF is converted',

    noteContain:
      'Scales down to fit inside the box — one side touches it, the other follows the aspect '
      + 'ratio. For identical sizes every time, pick “Exactly this size”.',
    noteContainUp:
      'Fits inside the box — only one side touches it. '
      + 'Smaller originals are stretched, so they blur and grow.',
    noteCover: (w, h) =>
      `Crops from the centre to exactly ${w}×${h}. Anything outside the box is lost, and `
      + `originals smaller than ${w}×${h} stay smaller.`,
    noteCoverUp: (w, h) =>
      `Crops from the centre so every image is exactly ${w}×${h}. Edges are cut, and `
      + 'originals smaller than the box are stretched, so those blur.',
    noteCoverNeedBoth: 'Fill in both width and height — with one empty there is no ratio to crop to.',
    noteScale: 'Keeps the aspect ratio and never enlarges past the original.',
    noteScaleUp: 'Enlarges past the original too. Invented pixels blur and add weight.',

    grew: 'Converted as asked, but the files got bigger.',
    grewPng: 'PNG is lossless, so photos grow in it. Use WebP for photos.',
    grewFlat:
      'Images built from lines, text and flat colour (screenshots, logos, QR codes) are '
      + 'smallest as PNG. WebP and JPEG are built for photographs and make these bigger '
      + 'and messier at the edges.',
    grewKeep:
      'Size was set to “Keep original”, so there was nothing to shrink. '
      + 'Try a long edge of around 1920.',
    grewElse: 'If the original is already well compressed, re-saving it alone will not shrink it.',
    grewSome: (n) =>
      `${n} ${n === 1 ? 'image' : 'images'} ended up larger than the original. `
      + 'Those are better kept as they were.',
  },

  ja: {
    busy: '処理中…',
    download: '保存',
    done: '完了',
    doneFailed: (n) => `完了 · ${n}枚 失敗`,
    progress: (i, n) => `${i} / ${n} 処理中`,
    aborted: (n) => `中断しました。${n}枚は保存できます。`,
    manyFiles: (n) => `${n}枚です。100枚を超えると時間がかかることがあります。`,
    zipBuilding: 'zip を作成中…',
    zipFailed: (msg) => `zip を作成できませんでした: ${msg}`,
    summaryCut: (pct, n) => `${pct >= 0 ? `${pct}% 削減` : `${-pct}% 増加`} · ${n}枚`,

    heic: 'このブラウザでは HEIC を開けません',
    decode: '読み取れない画像のためスキップしました',
    encode: '変換できませんでした',
    gifFrame: 'GIF は最初のコマだけ変換されます',

    noteContain:
      '枠に収まるように縮小します — 一辺だけが枠に接し、もう一辺は比率で決まります。'
      + 'すべて同じ寸法にしたい場合は「ちょうどこの寸法」を選んでください。',
    noteContainUp:
      '枠に収まるように合わせます — 一辺だけが枠に接します。'
      + '小さい元画像は引き伸ばすため、ぼやけて容量も増えます。',
    noteCover: (w, h) =>
      `中央を切り取ってちょうど ${w}×${h} にします。枠からはみ出す部分は失われ、`
      + `${w}×${h} より小さい元画像はそのまま小さく残ります。`,
    noteCoverUp: (w, h) =>
      `中央を切り取って例外なく ${w}×${h} にします。枠の外は切り取られ、`
      + '小さい元画像は引き伸ばして埋めるためぼやけます。',
    noteCoverNeedBoth: '幅と高さの両方を入力してください — 片方が空だと切り取る比率が決まりません。',
    noteScale: '比率は保たれ、元画像より大きくはしません。',
    noteScaleUp: '元画像より大きくもします。存在しない画素を作るためぼやけて容量も増えます。',

    grew: '設定どおりに変換しましたが、容量が増えました。',
    grewPng: 'PNG は可逆圧縮なので写真を入れると大きくなります。写真には WebP を勧めます。',
    grewFlat:
      '線・文字・べた塗りが広い画像（スクリーンショット・ロゴ・QR）は PNG が最も小さくなります。'
      + 'WebP や JPEG は写真向けなので、こうした画像はかえって大きくなり、輪郭も粗くなります。',
    grewKeep:
      'サイズが「元のまま」なので縮む余地がありませんでした。長辺を 1920 程度にしてみてください。',
    grewElse: '元画像がすでによく圧縮されている場合、保存し直すだけでは小さくなりません。',
    grewSome: (n) => `${n}枚が元画像より大きくなりました。それらは元のまま使う方がよいでしょう。`,
  },
};

/**
 * 이 문서의 언어에 맞는 묶음.
 *
 * `<html lang>` 을 본다 — 페이지가 이미 자기 언어를 알고 있으므로 다시 고를 일이 없다.
 * 모르는 값이면 영어다. x-default 와 루트 302 의 폴백이 영어라 그쪽과 같은 답을 준다.
 */
export function pickStrings(lang) {
  return STRINGS[(lang || '').slice(0, 2)] || STRINGS.en;
}
