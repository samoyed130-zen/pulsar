/**
 * @file main.js
 * @brief 描画ループ、シーン管理、入力、遷移演出をまとめた実行の中心。
 *
 * 設計の要点:
 * - **時計は音ではなく数値**。拍は `performance.now()` から計算するため、
 *   音を鳴らさなくても（鳴らせない環境でも）演出は同じように動く。
 * - 各シーンは「フレーム文脈」1つだけを受け取って描く。シーン同士は互いを知らない。
 * - 重いエフェクトは低解像度のバッファへ描いてから拡大する。
 */
(function (global) {
  'use strict';

  var M = global.PULSAR.mathx;

  /**
   * @brief 全体の調整値。マジックナンバーを散らさないためここへ集約する。
   */
  var CONFIG = {
    /** @brief 曲のテンポ [BPM]。演出の脈拍もこれに従う。 */
    bpm: 126,
    /** @brief シーンの入り際・終わり際に遷移演出をかける秒数 [s]。 */
    fade: 0.55,
    /** @brief キックに合わせた画面ズームの最大量（1.0 = 等倍）。 */
    beatZoom: 0.016,
    /** @brief 低解像度バッファの横幅 [px]。プラズマ等はここへ描いて拡大する。 */
    bufferWidth: 160,
    /**
     * @brief 自前ラスタライザで描くときの横幅 [px]。
     *
     * 1画素ずつ塗るので、この値の2乗で処理時間が効いてくる。
     * 直線の階段が目立たない下限を探した結果の値。
     */
    rasterWidth: 560,
    /**
     * @brief 描画が追いついていないときの、ラスタライザの横幅 [px]。
     *
     * 塗りをやめるのではなく粗くする。1画素ずつ塗る方式はブラウザによる
     * 速度差がほとんどないので、遅い環境でこそ頼りになる経路になる。
     */
    rasterWidthLow: 380,
    /** @brief 画面の対角がこれ未満なら描画量を落とす（スマートフォン想定）。 */
    lightModeDiagonal: 900,
    /** @brief 触れたときに飛ぶ先のシーン名。作品の主張そのもの。 */
    playableScene: 'tunnel',
    /** @brief 最後の操作からこの秒数のあいだは、操作区間に留まる [s]。 */
    holdSeconds: 7,
    /** @brief 走り出しのテンポ倍率（遅い方）。 */
    tempoMin: 0.80,
    /** @brief 最高速でのテンポ倍率（速い方）。 */
    tempoMax: 1.28,
    /** @brief グレアの基本の強さ [0..1]。 */
    glare: 0.55,
    /** @brief グレアのぼかし半径 [px]（縮小後のバッファ上での値）。 */
    glareBlur: 5,
    /** @brief グレアに使う縮小率。小さいほど軽く、光が大きく広がる。 */
    glareScale: 0.25,
    /**
     * @brief ぼかしを使えない環境で重ねる、加算ライトの強さ [0..1]。
     *
     * こちらは暗部を切り落とさずに画面全体を加算するので、
     * 同じ強さだと白く濁る。本来のグレアより弱めに入れる。
     */
    softGlare: 0.55,
    /**
     * @brief 暗部潰しの乗算を繰り返す回数。
     *
     * 1回（明るさの2乗）では中間の明るさが残り、光らせたくない壁まで
     * 一緒に持ち上がって画面全体が白く濁る。増やすほど本当に明るい
     * ところだけが滲むようになる。
     */
    softGlareSqueeze: 2,
    /**
     * @brief 加算ライトに使う縮小率。
     *
     * 粗く縮めるほど軽いが、拡大して戻したときに四角い段が見える。
     * ずらし加算は縮小画素より細かくはぼかせないので、
     * ここを削るより回数で稼ぐ方が結果がきれいになる。
     */
    softGlareScale: 0.2,
    /** @brief ずらし加算のずれ幅 [縮小バッファ上の px]。 */
    softGlareSpread: 1,
    /** @brief ずらし加算の回数（縦横それぞれ）。奇数にして中心を含める。 */
    softGlareTaps: 5,
    /**
     * @brief 疑似グレアの環境で、彩度を持ち上げる倍率。
     *
     * 本来のグレアは色を保ったまま光を足すが、乗算で暗部を潰す作りでは
     * 色も一緒に沈むため、全体が灰色に寄る。
     *
     * 明るさを掛けて補うと、上限で頭打ちになった面が増えて面の境目が
     * 段差として浮くが、彩度は面の向きによる差を作っていないので、
     * 同じように掛けても境目は生まれない。
     */
    softGlareSat: 1.6,
    /**
     * @brief 疑似グレアの環境で、明るさを底上げする割合 [0..1)。
     *
     * 倍率ではなく「上限までの残りに対する割合」。倍率で持ち上げると
     * 明るい面から順に上限へ張り付き、面の境目が段差として見えてしまう。
     */
    softGlareLift: 0.1,
    /**
     * @brief 描き直す間隔の下限 [ms]。
     *
     * 60 回/秒（16.67ms）より少しだけ短くしてある。ちょうどで比べると、
     * わずかな誤差で1枚おきに落ちて 30 回/秒に見えてしまう。
     */
    minFrameMs: 15.5,
    /** @brief FPS 表示を書き換える間隔 [ms]。速すぎると数字が読めない。 */
    fpsUpdateMs: 250,
    /**
     * @brief コンボが最大の段階のときに、光をどれだけ増やすか。
     *
     * 風の線は画面の端を流れるので、中心を見ている目には届きにくい。
     * 画面そのものが明るくなれば、視線を動かさずに段階が上がったと
     * 分かる。曲の層が増える瞬間と同じ拍で起きるので、音と絵と光が
     * 一つの手応えになる。
     */
    comboGlare: 1.6,
    /**
     * @brief グレアを重ねる回数の上限。
     *
     * 透明度は 1 が上限なので、それより眩しくするには重ねるしかない。
     * 重ねるのは縮小バッファの上なので1回あたりは安いが、それでも
     * 際限なく増やす理由はない。
     */
    glarePassMax: 3,
    /**
     * @brief 光の増減にかける時間の目安 [1/s]。
     *
     * 段階が変わった瞬間に切り替えると、画面が一瞬白く弾けたように
     * 見えて、ぶつかった合図と紛らわしい。少し遅らせて持ち上げる。
     */
    comboGlareEase: 3,
    /** @brief 風の線が出ているときの、最低限の本数。 */
    windLinesBase: 8,
    /**
     * @brief コンボの段階1つあたり、風の線を何本足すか。
     *
     * 段階が上がったと分かる増え方であること。ただし本数はそのまま
     * 1枚あたりの手間になる。長さと濃さを散らしてあるので、数を
     * 減らしても密度が薄くなったようには見えない。
     */
    windLinesPerStep: 6,
    /**
     * @brief 描画が追いつかないときに、風の線を何割まで減らすか。
     *
     * 勢いを見せるものなので、消してしまうと段階が伝わらなくなる。
     * 減らしても、長さと濃さの散らばりは残るので絵は保たれる。
     */
    windLinesLowRatio: 0.5,
    /**
     * @brief 1段階目の強さ [0..1]。
     *
     * ゲージの代わりに勢いを示すものなので、最初の段階から
     * はっきり見えていないと「増えた」ことが伝わらない。
     */
    windFirstLevel: 0.5,
    /**
     * @brief 風の線が奥から手前へ進む速さ（奥行き 1 を何回/秒くぐるか）。
     *
     * 速すぎると1本ずつを目が追えず、画面全体が一様なブレに見える。
     * 追える速さまで落としたうえで、本数と尾の長さで勢いを出す。
     */
    windSpeed: 1.35,
    /**
     * @brief 風の線の色相。
     *
     * 1本ずつ色を変えていたときは、風ではなく色の付いた棒が並んで
     * いるようにしか見えなかった。全部そろえて、明るさと長さの差だけで
     * 奥行きを見せる。
     */
    windHue: 195,
    /**
     * @brief 尾の長さ。今いる位置の中心からの隔たりに対する割合。
     *
     * 実際に動いた距離から求めるのをやめている。物として正しくは
     * あっても、奥にいるあいだは筋が短く、飛んでいるものに見えない。
     * ここは勢いを見せる絵なので、見え方のほうを取った。
     *
     * 割合で持つと、奥でも手前でも同じ細長さに見え、しかも手前へ
     * 出るほど実際の長さは伸びる。時間もフレームレートも関わらない。
     */
    windTrailFrac: 0.55,
    /**
     * @brief 風の線が消える奥行き。0 に近いほど手前。
     *
     * 透視投影では 0 で無限に広がるので、0 にはできない。ここを小さく
     * 取るほど、最後は画面の外へ大きく飛び抜けてから消える。
     */
    windNearZ: 0.12,
    /**
     * @brief 風の線の投影の焦点距離（画面の隅までの距離を 1 とする）。
     *
     * 小さくすると広角になり、手前での横切り方が速く派手になる。
     */
    windFocal: 0.8,
    /** @brief この時間を超え続けたら描画を軽くする [ms]。 */
    slowMs: 22,
    /**
     * @brief この時間を下回り続けたら、一度だけ描画を戻す [ms]。
     *
     * 落とす基準との差を大きく取っている。差が小さいと、落として速く
     * なった結果「戻せる」と判断し、戻した途端にまた遅くなる往復に陥る。
     */
    fastMs: 12,
    /** @brief 落とすまでに必要な、遅いフレームの連続数。 */
    slowFramesToDrop: 45,
    /** @brief 戻すまでに必要な、速いフレームの連続数（約5秒ぶん）。 */
    fastFramesToRestore: 300,
    /**
     * @brief 測り始めるまでに見送るフレーム数。
     *
     * 開き始めは音声の初期化や各種の作り直しが重なり、本来の速さが
     * 出ない。ここを数えると、動く端末でも「遅い」と誤判定してしまう。
     */
    warmupFrames: 120
  };

  /** @brief 表示用のキャンバスと文脈。 @private */
  var canvas, ctx;

  /** @brief 低解像度バッファ。 @private */
  var buf, bufCtx;

  /** @brief 画面サイズ [CSS px]。 @private */
  var W = 0, H = 0;

  /** @brief 端末の画素密度（2 で頭打ち。それ以上は負荷に見合わない）。 @private */
  var dpr = 1;

  /** @brief 描画量を落とすモードか。 @private */
  var lightMode = false;

  /** @brief 前フレームの時刻 [ms]。 @private */
  var prevMs = 0;

  /**
   * @brief 前回「描いた」時刻 [ms]。
   *
   * `prevMs` と別に持つ。あちらは止まるたびに 0 へ戻すが、
   * こちらは回数を抑えるための物差しなので、止まっていても連続させる。
   * @private
   */
  var prevDrawMs = 0;

  /**
   * @brief 描き直す間隔の移動平均 [ms]。
   *
   * `frameMs` が「1枚を描くのにかかった時間」なのに対し、こちらは
   * 「次の1枚までの間隔」。毎秒の枚数はこちらから求める。混ぜると、
   * 4ms で描けている端末が 250 枚/秒と出るような誤りになる。
   * @private
   */
  var intervalMs = 16.7;

  /**
   * @brief デモ開始からの経過時刻 [s]。常に単調増加する。
   *
   * 色相・拍・音はこちらを見る。シーンの巻き戻しで色が飛ばないようにするため、
   * シーン選択用の時計（`sceneTime`）とは分けている。
   * @private
   */
  var clock = 0;

  /**
   * @brief 風の線の進み具合。
   *
   * 時計とは別に持って足し込んでいる。速さが拍やコンボで変わるので、
   * 経過時間に掛けて求めると、速さが変わった瞬間に線の位置そのものが
   * 飛んでしまう。足し込む形なら、変わるのはそこから先の進み方だけ。
   *
   * @private
   */
  var windPhase = 0;

  /**
   * @brief 今どれだけ光を増しているか [0..1]。
   *
   * コンボの段階をそのまま使わず、追いかけさせている。段階が変わった
   * 瞬間に切り替えると画面が弾けたように見え、ぶつかった合図と紛れる。
   *
   * @private
   */
  var comboGlow = 0;

  /**
   * @brief 風の線を、根元から先端へ区切る割合と濃さ。
   *
   * [始まり, 終わり, 濃さの倍率] の並び。最後の区間がいちばん濃い。
   * 加算で重ねるので、区間の境目は溶けて段には見えない。
   *
   * 表にして持つのは、線ごとに作り直さないため。毎フレーム、線の数
   * だけ同じ配列を組み直すと、そのぶん捨てるごみが増える。
   *
   * @private
   */
  var WIND_STEPS = [[0, 0.75, 0.3], [0.6, 1, 1]];

  /**
   * @brief 濃さと太さの近い線をまとめる入れ物。
   *
   * 1本ずつ `stroke()` を呼ぶと、線の数だけ呼び出しの手間がかかる。
   * 塗る面積そのものは小さいのに、コンボが最大の段階（110 区間）では
   * それだけで 60 回/秒に届かなくなった。
   *
   * 濃さと太さを段に丸めて、同じ段のものを一つの道筋へ足していけば、
   * 実際に呼ぶのは段の数だけで済む。丸めの粗さは見た目に出ない程度に
   * 取ってあるので、絵は変わらない。
   *
   * @private
   */
  var windBuckets = [];

  /**
   * @brief 濃さをいくつの段に丸めるか。多いほど元の絵に近い。
   *
   * 粗くすると、いちばん薄い線が段の下限まで持ち上げられてしまう。
   * 数倍の濃さになるので、そこだけは見て分かる。刻みを、いちばん薄い
   * 線の濃さより細かく取る。
   *
   * @private
   */
  var WIND_ALPHA_STEPS = 14;

  /**
   * @brief 太さを丸める刻み [px]。1px 未満の違いは見えない。
   * @private
   */
  var WIND_WIDTH_STEP = 1;

  /**
   * @brief 太さの段の数。入れ物の番号を組み立てるときの幅。
   * @private
   */
  var WIND_WIDTH_MAX = 8;

  /**
   * @brief 風の線の一区間を、濃さと太さの近いものへ振り分ける。
   *
   * 段の代表値（丸めた値そのもの）で描く。1本目の値を採ると、同じ
   * 入れ物に入った他の線がその太さに引きずられてしまう。
   *
   * @private
   * @param {number} alpha 濃さ [0..1]
   * @param {number} width 太さ [px]
   * @param {number} x0 始点 x
   * @param {number} y0 始点 y
   * @param {number} x1 終点 x
   * @param {number} y1 終点 y
   * @returns {void}
   */
  function addWindSegment(alpha, width, x0, y0, x1, y1) {
    // 丸めて 0 になるものは、そもそも見えないので捨てる
    var ai = M.clamp(Math.round(alpha * WIND_ALPHA_STEPS), 0, WIND_ALPHA_STEPS);
    if (ai === 0) return;

    var wi = M.clamp(Math.round(width / WIND_WIDTH_STEP), 1, WIND_WIDTH_MAX);
    var key = ai * WIND_WIDTH_MAX + wi;
    var b = windBuckets[key];

    if (!b) {
      b = windBuckets[key] = {
        path: null,
        alpha: ai / WIND_ALPHA_STEPS,
        width: wi * WIND_WIDTH_STEP,
        n: 0
      };
    }

    if (b.n === 0) b.path = new global.Path2D();

    b.path.moveTo(x0, y0);
    b.path.lineTo(x1, y1);
    b.n++;
  }

  /**
   * @brief まとめた線を、段ごとに一度ずつ引く。
   * @private
   * @returns {void}
   */
  function strokeWindBuckets() {
    for (var i = 0; i < windBuckets.length; i++) {
      var b = windBuckets[i];
      if (!b || b.n === 0) continue;

      ctx.strokeStyle = M.hsl(CONFIG.windHue, 55, 85, b.alpha);
      ctx.lineWidth = b.width;
      ctx.stroke(b.path);

      b.n = 0;
      b.path = null;
    }
  }

  /**
   * @brief シーン選択に使う時刻 [s]。操作に応じて飛んだり巻き戻したりする。
   * @private
   */
  var sceneTime = 0;

  /** @brief 最後に操作された時刻 [s]（`clock` 基準）。 @private */
  var lastInput = -999;

  /**
   * @brief 拍の進行位置（1.0 で1拍）。
   *
   * テンポが変わるため、時刻から割り算で求めるのではなく積算する。
   * こうしないと、テンポを上げた瞬間に拍の位置が飛んで演出が乱れる。
   * @private
   */
  var beatPos = 0;

  /** @brief 現在のテンポ倍率。 @private */
  var tempoScale = 1;

  /** @brief 遊び始めた時刻 [s]（`clock` 基準）。操作案内の表示に使う。 @private */
  var startedAt = -999;

  /** @brief 直前に始めたステージ番号。「もう一度あそぶ」で使う。 @private */
  var lastStage = 1;

  /**
   * @brief 一時停止の理由ごとの状態。
   *
   * 「何かを開いた」「タブが隠れた」「合図を出している」は別々に立つ。
   * ひとつでも立っていれば止まり、すべて解除されたときだけ再開する。
   * 1つの真偽値で管理すると、説明を閉じた拍子にタブが隠れている分まで
   * 解除されてしまう。
   * @private
   */
  var pauseReasons = {
    dialog: false, hidden: false, countdown: false, banner: false
  };

  /** @brief 大きく出す知らせを消すタイマー。 @private */
  var bannerTimer = 0;

  /** @brief 知らせを出している最中か（二重に出さないため）。 @private */
  var bannerBusy = false;

  /** @brief カウントダウンの表示を進めるタイマー。 @private */
  var countdownTimer = 0;

  /**
   * @brief 止まっていても1枚だけ描き直したいときに立てる。
   *
   * 合図のあいだに映るのは「止まる直前の絵」なので、これが無いと
   * 選んだステージの景色ではなく、直前の場面が残ってしまう。
   * @private
   */
  var needsRender = false;

  /**
   * @brief カウントダウンの並びと、それぞれを見せる時間 [ms]。
   *
   * 「READY」で構えさせ、数字で間合いを取らせ、「START」で走り出す。
   * 最後だけ短いのは、合図を見てから動くまでの間を詰めるため。
   * @private
   */
  var COUNT_STEPS = [
    { text: 'READY', ms: 800 },
    { text: '3', ms: 600 },
    { text: '2', ms: 600 },
    { text: '1', ms: 600 },
    { text: 'START', ms: 450 }
  ];

  /**
   * @brief ステージの頭で READY を見せている時間 [ms]。
   *
   * 番号を添えているぶん、読むものが1行増えている。続きに戻るときと
   * 同じ長さだと、ステージ名を読み終える前に数え始めてしまう。
   * @private
   */
  var READY_STAGE_MS = 2000;

  /**
   * @brief 自前ラスタライザの描画先。
   *
   * `ImageData` の中身をそのまま画素配列として扱い、描き終えてから
   * 画面へ引き伸ばす。画素数が処理時間そのものなので、画面より粗くする。
   * @private
   */
  var rasterCanvas = null, rasterCtx = null, rasterImg = null, rasterBuf = null;

  /** @brief グレア用の縮小バッファ。 @private */
  var glareBuf = null, glareCtx = null;

  /**
   * @brief ずらし加算に使う、もう1枚の縮小バッファ。
   *
   * 同じ画を「元」と「積み上げ先」の両方に使うことはできないため、
   * ぼかしを自前で作る経路では2枚を行き来させる。
   * @private
   */
  var glareTmp = null, glareTmpCtx = null;

  /** @brief グレアが使えるか（描画先を作れたか）。 @private */
  var glareOk = false;

  /**
   * @brief 1フレームにかかっている時間の移動平均 [ms]。
   * @private
   */
  var frameMs = 16;

  /**
   * @brief 描画の重さの段階。1 = そのまま、0 = 落とす。
   *
   * 端末やブラウザによって得意不得意が大きく違う。特に Canvas の
   * ぼかし（filter）は、実装によって桁で速度が変わる。
   * 事前に見分けるのは無理なので、実際にかかった時間を見て落とす。
   * @private
   */
  var quality = 1;

  /**
   * @brief タイトル（デモ）を映しているか。
   *
   * 遊んでいるのかデモなのかは、走行状態だけでは見分けられない。
   * 画面に触れた時点で走行の印は立ってしまうためで、どちらの画面に
   * いるかはこちらで覚えておく。
   * @private
   */
  var onTitle = true;

  /** @brief 段階を切り替えるまでの連続フレーム数。 @private */
  var slowFrames = 0;

  /** @brief 戻す判断のための、速いフレームの連続数。 @private */
  var fastFrames = 0;

  /** @brief これまでに描いたフレーム数（測り始めの見送りに使う）。 @private */
  var framesSeen = 0;

  /**
   * @brief 描画を戻した回数。
   *
   * 戻すのは一度だけにしている。落とす・戻すを繰り返せるようにすると、
   * 境目あたりの端末で画面が行き来してちらついてしまう。
   * @private
   */
  var restores = 0;

  /**
   * @brief Canvas のぼかしが極端に遅い環境か。
   *
   * Firefox は `filter` の処理が他より桁で遅く、これを使うだけで
   * 処理落ちする。実測に任せると、止めた途端に速くなって元へ戻し、
   * また遅くなる……という往復に陥るため、最初から使わない。
   *
   * 将来 Firefox が速くなれば、この判定を外せばよい。
   * @private
   */
  var slowFilter = /firefox/i.test(
    (global.navigator && global.navigator.userAgent) || ''
  );

  /**
   * @brief ぼかしを使わないグレアを、判定によらず使うか。
   *
   * 上の見分けは名乗り（ユーザーエージェント）頼みなので、外れることがある。
   * また、どちらの絵になるのかを見比べたいこともある。既定は切で、
   * 入れると Firefox 以外でも合成だけで組んだグレアになる。
   * @private
   */
  var forceSoftGlare = global.PULSAR.store.get('pulsar.softglare') === '1';

  /**
   * @brief 今の環境で、ぼかしを使わないグレアを使うか。
   * @private
   * @returns {boolean} 使うなら true
   */
  function useSoftGlare() {
    return slowFilter || forceSoftGlare;
  }

  /**
   * @brief 疑似グレアを固定するかを設定する。
   * @param {boolean} on 固定するなら true
   * @returns {void}
   */
  function setSoftGlare(on) {
    forceSoftGlare = !!on;
    global.PULSAR.store.set('pulsar.softglare', forceSoftGlare ? '1' : '0');
    // 縮小バッファの大きさが経路で違うので、作り直す
    resizeGlare();
    needsRender = true;
  }

  /**
   * @brief 疑似グレアを固定する設定か。
   * @returns {boolean} 固定するなら true
   */
  function isSoftGlare() {
    return forceSoftGlare;
  }

  /**
   * @brief 毎秒の枚数（FPS）を出すか。
   *
   * 調整のための表示なので既定は切。動作が重いという相談を受けたときに、
   * 出してもらえば数字で話せる。
   * @private
   */
  var showFps = global.PULSAR.store.get('pulsar.fps') === '1';

  /**
   * @brief FPS 表示の有無を設定する。
   * @param {boolean} on 出すなら true
   * @returns {void}
   */
  function setFps(on) {
    showFps = !!on;
    global.PULSAR.store.set('pulsar.fps', showFps ? '1' : '0');

    // 止まっている最中に切り替えても、その場で出入りさせる
    if (fpsEl) fpsEl.hidden = !showFps;
  }

  /**
   * @brief FPS を出す設定か。
   * @returns {boolean} 出すなら true
   */
  function isFps() {
    return showFps;
  }

  /**
   * @brief 実測に基づいて描画の重さを上下させる。
   *
   * すぐ切り替えると行ったり来たりするので、一定数続いたときだけ動かす。
   *
   * @private
   * @param {number} ms 今回のフレームにかかった時間 [ms]
   * @returns {void}
   */
  function tuneQuality(ms) {
    frameMs += (ms - frameMs) * 0.1;

    // 開き始めの重さで判断しない。ここを数えると、十分に動く端末でも
    // 立ち上がりのもたつきだけで「遅い」と決めつけてしまう。
    if (framesSeen++ < CONFIG.warmupFrames) return;

    if (quality === 0) {
      // 戻すのは一度だけ。落とす・戻すを繰り返せるようにすると、
      // 境目あたりの端末で画面が行き来してちらつく。
      if (restores > 0) return;

      if (frameMs < CONFIG.fastMs) {
        fastFrames++;
        if (fastFrames > CONFIG.fastFramesToRestore) {
          quality = 1;
          restores++;
          slowFrames = 0;
          resizeRaster();
        }
      } else {
        fastFrames = 0;
      }
      return;
    }

    if (frameMs > CONFIG.slowMs) {
      slowFrames++;
      if (slowFrames > CONFIG.slowFramesToDrop) {
        quality = 0;
        fastFrames = 0;
        // 自前の塗りは解像度がそのまま負荷なので、粗いバッファへ作り直す
        resizeRaster();
      }
    } else {
      slowFrames = 0;
    }
  }

  /**
   * @brief 明るい部分をにじませて重ねる（グレア）。
   *
   * 画面を縮小して写し、暗い部分を潰してからぼかし、加算で戻す。
   * 縮小してからぼかすので、広がりの割に計算量が小さい。
   *
   * 光源そのものを明るくするのではなく「周囲へ光が漏れる」ことで、
   * 画面の輝度差が誇張され、金属や照明の眩しさが伝わる。
   *
   * ぼかしが遅い環境では `filter` を使わずに同じ形を組み立てる。
   * 暗部潰しは縮小バッファ同士の乗算（明るさが2乗になるので、
   * 暗いところほど強く沈む）、ぼかしは縦横にずらしながらの加算で作る。
   * 縮小後は数十 px 四方しかないため、何度重ねても安い。
   *
   * @private
   * @param {number} amount 強さ [0..1]
   * @returns {void}
   */
  function drawGlare(amount) {
    if (!glareOk || amount <= 0.01) return;

    var gw = glareBuf.width;
    var gh = glareBuf.height;

    glareCtx.setTransform(1, 0, 0, 1, 0, 0);
    glareCtx.globalCompositeOperation = 'source-over';
    glareCtx.globalAlpha = 1;

    if (useSoftGlare()) {
      buildSoftGlare(gw, gh);
    } else {
      // 暗部を切り落として明るい部分だけを残す。
      // brightness で持ち上げ、contrast で暗い側を潰すのが最も安い方法。
      glareCtx.filter = 'brightness(2.1) contrast(2.6) saturate(1.25) blur(' +
                        CONFIG.glareBlur + 'px)';
      glareCtx.clearRect(0, 0, gw, gh);
      glareCtx.drawImage(canvas, 0, 0, gw, gh);
      glareCtx.filter = 'none';
    }

    /*
     * 1 を超える強さは、縮小バッファの中で足しておく。
     *
     * 透明度は 1 が上限なので、それ以上の値を渡しても頭打ちになる。
     * 画面へ重ねて塗れば超えられるが、1回ごとに画面いっぱい（例えば
     * 1920x1080 で約 207 万画素）を塗り直すことになり、そのぶん
     * はっきり遅くなる。
     *
     * 同じ足し算を縮小バッファの上（同じ例で 384x216、約 8.3 万画素）
     * で済ませれば、25 分の1 の手間で同じ明るさになる。画面に重ねるのは
     * どれだけ眩しくしても1回だけ。
     */
    var left = amount - 1;
    if (left > 0.01 && glareTmp) {
      glareTmpCtx.setTransform(1, 0, 0, 1, 0, 0);
      glareTmpCtx.globalCompositeOperation = 'source-over';
      glareTmpCtx.globalAlpha = 1;
      glareTmpCtx.clearRect(0, 0, gw, gh);
      glareTmpCtx.drawImage(glareBuf, 0, 0);

      glareCtx.globalCompositeOperation = 'lighter';
      for (var n = 0; n < CONFIG.glarePassMax && left > 0.01; n++) {
        glareCtx.globalAlpha = Math.min(1, left);
        glareCtx.drawImage(glareTmp, 0, 0);
        left -= 1;
      }
      glareCtx.globalAlpha = 1;
      glareCtx.globalCompositeOperation = 'source-over';
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = Math.min(1, amount);
    ctx.drawImage(glareBuf, 0, 0, W, H);
    ctx.restore();
  }

  /**
   * @brief コンボの段階ぶんだけ、画面全体に光を足す。
   *
   * グレアを使えないときの控え。縮小もぼかしもせず、画面いっぱいを
   * 加算で1回塗るだけなので、いちばん遅い端末でも払える。
   *
   * 中心を明るく、周りを落としている。一様に塗ると、白い紙をかぶせた
   * ようになって奥行きが消えてしまう。
   *
   * @private
   * @param {number} glow 明るさの割合 [0..1]
   * @returns {void}
   */
  function drawComboLight(glow) {
    if (glow <= 0.01) return;

    var g = ctx.createRadialGradient(W / 2, H / 2, 0,
                                     W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, M.hsl(CONFIG.windHue, 60, 60,
                            Math.min(0.7, glow * CONFIG.comboGlare * 0.35)));
    g.addColorStop(1, M.hsl(CONFIG.windHue, 60, 60, 0));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /**
   * @brief `filter` を使わずに、縮小バッファ上でグレアの素を作る。
   *
   * 手順は3つ。
   *
   * 1. 画面を縮小して写す
   * 2. その画を自分自身に乗算で重ねる。明るさが2乗になるので、
   *    暗いところほど大きく沈む。`contrast` の代わりになる。
   *    繰り返すほど明るいところだけが残る
   * 3. 縦横にずらしながら加算で積む。等間隔のずらし加算は
   *    そのまま矩形のぼかしなので、`blur` の代わりになる
   *
   * 積むときに回数で割らず、そのまま足しているのは、
   * `brightness` に当たる持ち上げを兼ねさせるため。
   *
   * 結果は `glareBuf` に入る。
   *
   * @private
   * @param {number} gw 縮小バッファの幅 [px]
   * @param {number} gh 縮小バッファの高さ [px]
   * @returns {void}
   */
  function buildSoftGlare(gw, gh) {
    glareTmpCtx.setTransform(1, 0, 0, 1, 0, 0);
    glareTmpCtx.globalAlpha = 1;
    glareTmpCtx.globalCompositeOperation = 'source-over';
    glareTmpCtx.clearRect(0, 0, gw, gh);
    glareTmpCtx.drawImage(canvas, 0, 0, gw, gh);

    // 暗部潰し。乗算の相手として同じ画がもう1枚要るので、
    // いったん glareBuf へ写してから掛け合わせる。
    //
    // 1回（2乗）では中間の明るさが残り、光らせたくない壁まで一緒に
    // 持ち上がって画面全体が白く濁る。繰り返して本当に明るいところだけを
    // 残すほど、グレアらしい「眩しいところが滲む」形に近づく。
    for (var n = 0; n < CONFIG.softGlareSqueeze; n++) {
      glareCtx.globalCompositeOperation = 'source-over';
      glareCtx.globalAlpha = 1;
      glareCtx.clearRect(0, 0, gw, gh);
      glareCtx.drawImage(glareTmp, 0, 0);
      glareTmpCtx.globalCompositeOperation = 'multiply';
      glareTmpCtx.drawImage(glareBuf, 0, 0);
    }

    // ずらし加算。taps が奇数なので、中心のずれ 0 も必ず含まれる。
    var taps = CONFIG.softGlareTaps;
    var step = CONFIG.softGlareSpread;
    var half = (taps - 1) / 2;

    glareCtx.clearRect(0, 0, gw, gh);
    glareCtx.globalCompositeOperation = 'lighter';
    // 全部そのまま足すと飽和しきるので、1回あたりは薄くする。
    glareCtx.globalAlpha = 1 / taps;

    for (var iy = -half; iy <= half; iy++) {
      for (var ix = -half; ix <= half; ix++) {
        glareCtx.drawImage(glareTmp, ix * step, iy * step);
      }
    }

    glareCtx.globalAlpha = 1;
    glareCtx.globalCompositeOperation = 'source-over';
  }

  /** @brief 衝突などで一時的に加わる画面の揺れの強さ [0..1]。 @private */
  var shake = 0;

  /** @brief 衝突時の赤い閃光の強さ [0..1]。 @private */
  var hitFlash = 0;

  /**
   * @brief 指・マウスの状態。シーンと `game` が共有して読む。
   * @type {{x: number, y: number, down: boolean, everTouched: boolean}}
   */
  var pointer = { x: 0, y: 0, down: false, everTouched: false };

  /** @brief 左右キーの押下状態。 @private */
  var keys = { left: false, right: false };

  /**
   * @brief 直前に使った操作手段。'pointer' か 'key'。
   *
   * キーで動かした後に指の位置へ引き戻されると、キー操作が成立しない。
   * どちらで操作しているかを覚えておき、手を離したときの扱いを変える。
   * @private
   */
  var inputMode = 'pointer';

  /**
   * @brief マウスが「動かされた」とみなす距離 [px]。
   *
   * これ未満の揺れでは主導権を移さない。
   * @private
   */
  var POINTER_WAKE = 4;

  /**
   * @brief キャンバスと低解像度バッファを画面サイズに合わせる。
   * @returns {void}
   */
  function resize() {
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;

    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    lightMode = Math.sqrt(W * W + H * H) < CONFIG.lightModeDiagonal;

    resizeGlare();

    // バッファは画面比を保ったまま固定幅にする（拡大時に歪ませないため）。
    buf.width = CONFIG.bufferWidth;
    buf.height = Math.max(1, Math.round(CONFIG.bufferWidth * H / Math.max(1, W)));

    resizeRaster();

    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, W, H);
  }

  /**
   * @brief グレア用の縮小バッファを、今の経路に合わせて作り直す。
   *
   * ぼかしを使わない経路のほうが粗く縮める。縮小そのものがぼかしの
   * 代わりになるためで、経路を切り替えたら大きさも作り直す必要がある。
   *
   * @private
   * @returns {void}
   */
  function resizeGlare() {
    if (!glareBuf) return;

    var gs = useSoftGlare() ? CONFIG.softGlareScale : CONFIG.glareScale;
    glareBuf.width = Math.max(1, Math.round(W * gs));
    glareBuf.height = Math.max(1, Math.round(H * gs));

    if (glareTmp) {
      glareTmp.width = glareBuf.width;
      glareTmp.height = glareBuf.height;
    }
  }

  /**
   * @brief 自前ラスタライザ用のバッファを画面の縦横比に合わせて作り直す。
   *
   * 幅は固定で、高さだけを比率から決める。画素数が処理時間に直結するので、
   * 画面が大きくなっても描く量が増えないようにするためで、拡大したときに
   * 縦横が歪まないようにするためでもある。
   *
   * @private
   * @returns {void}
   */
  function resizeRaster() {
    if (!rasterCtx) return;

    var rw = quality === 0 ? CONFIG.rasterWidthLow : CONFIG.rasterWidth;
    var rh = Math.max(1, Math.round(rw * H / Math.max(1, W)));
    if (rasterBuf && rasterBuf.w === rw && rasterBuf.h === rh) return;

    rasterCanvas.width = rw;
    rasterCanvas.height = rh;
    rasterImg = rasterCtx.createImageData(rw, rh);
    rasterBuf = global.PULSAR.raster.createBuffer(rw, rh, rasterImg);
  }

  /**
   * @brief ラスタライザのバッファを画面いっぱいに引き伸ばして重ねる。
   *
   * 描かれなかった画素は透明なので、背景の残像はそのまま残る。
   *
   * @private
   * @returns {void}
   */
  function blitRaster() {
    if (!rasterBuf) return;

    rasterCtx.putImageData(rasterImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(rasterCanvas, 0, 0, W, H);
  }

  /**
   * @brief 画面座標へポインタ位置を取り込む。
   * @private
   * @param {PointerEvent} e ポインタイベント
   * @returns {void}
   */
  function readPointer(e) {
    var r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
  }

  /**
   * @brief 入力イベントを登録する。マウス・タッチ・キーボードを同じ経路で扱う。
   * @returns {void}
   */
  function bindInput() {
    canvas.addEventListener('pointerdown', function (e) {
      readPointer(e);
      pointer.down = true;
      inputMode = 'pointer';
      noteInput();
      // 自動再生制限があるため、操作を起点に音を起こす。
      // 中断されていた場合もここで復帰する（操作のたびに試すのが最も確実）。
      global.PULSAR.sound.keepAlive();
    });

    canvas.addEventListener('pointermove', function (e) {
      var prevX = pointer.x;
      var prevY = pointer.y;
      readPointer(e);

      if (!pointer.everTouched) return;
      lastInput = clock;

      // キーを押している間は、マウスに主導権を渡さない。
      // 渡してしまうと、キーで動かしている最中に手元のマウスが少し
      // 揺れただけで、キーを離した瞬間にそちらへ飛んでしまう。
      if (keys.left || keys.right) return;

      // わずかな揺れは動かしたうちに入れない。机の振動などで
      // 主導権が移ると、キーで操作している人には事故に見える。
      var dx = pointer.x - prevX;
      var dy = pointer.y - prevY;
      if (dx * dx + dy * dy < POINTER_WAKE * POINTER_WAKE) return;

      inputMode = 'pointer';
    });

    global.addEventListener('pointerup', function () { pointer.down = false; });
    global.addEventListener('pointercancel', function () { pointer.down = false; });

    global.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (e.key === 'ArrowLeft') keys.left = true;
        else keys.right = true;
        inputMode = 'key';
        noteInput();
        e.preventDefault();   // 画面が動くのを防ぐ
        return;
      }

      // 修飾キー付きはブラウザの操作なので、こちらでは拾わない。
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      var handler = api.onShortcut;
      if (typeof handler === 'function' && handler(e.key)) e.preventDefault();
    });
    global.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowLeft') keys.left = false;
      if (e.key === 'ArrowRight') keys.right = false;
    });

    // 画面の大きさが変わったら作り直す。
    //
    // 回した直後は、まだ古い大きさを返す端末がある。1回だけだと縦向きの
    // ままの絵が横向きの画面に残ってしまうため、少し置いてもう一度測る。
    var t = null, t2 = null;
    function scheduleResize() {
      clearTimeout(t);
      clearTimeout(t2);
      t = setTimeout(resize, 150);
      t2 = setTimeout(resize, 600);
    }

    global.addEventListener('resize', scheduleResize);
    global.addEventListener('orientationchange', scheduleResize);

    // 端末によっては、ブラウザの枠の出入りがこちらにしか通知されない
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', scheduleResize);
    }
  }

  /**
   * @brief タイムライン上での、あるシーンの開始位置を求める。
   * @private
   * @param {string} name シーン名
   * @returns {number} 1周の先頭からの秒数。見つからなければ 0
   */
  function sceneStartOf(name) {
    var tl = global.PULSAR.scenes.timeline;
    var acc = 0;
    for (var i = 0; i < tl.length; i++) {
      if (tl[i].name === name) return acc;
      acc += tl[i].duration;
    }
    return 0;
  }

  /**
   * @brief 操作可能なシーンへ飛ぶ。
   *
   * 「デモに触ると、ゲームになる」を成立させるための中核。
   * どのシーンを見ていても、触れた瞬間に操作区間へ切り替わる。
   * 飛ぶのは `sceneTime` だけで、色相と拍の時計は連続したまま保つ。
   *
   * @private
   * @returns {void}
   */
  function jumpToPlayable() {
    var tl = global.PULSAR.scenes.timeline;
    var total = 0;
    for (var i = 0; i < tl.length; i++) total += tl[i].duration;

    var cycle = Math.floor(sceneTime / total) * total;
    // 遷移演出の途中から始まらないよう、少しだけ内側に入れる。
    sceneTime = cycle + sceneStartOf(CONFIG.playableScene) + CONFIG.fade;
    hitFlash = 0;
  }

  /**
   * @brief 操作があったことを記録し、必要なら操作区間へ飛ぶ。
   * @private
   * @returns {void}
   */
  function noteInput() {
    var tl = global.PULSAR.scenes.timeline;
    var current = tl[M.pickScene(tl, sceneTime).index];

    lastInput = clock;
    pointer.everTouched = true;
    if (current.name !== CONFIG.playableScene) jumpToPlayable();
  }

  /**
   * @brief 画面を赤く弾けさせ、揺らす（衝突時の反応）。
   * @param {number} amount 強さ [0..1]
   * @returns {void}
   */
  function impact(amount) {
    hitFlash = Math.max(hitFlash, amount);
    shake = Math.max(shake, amount);
  }

  /**
   * @brief シーンの切り替わりに重ねる演出を描く。
   * @private
   * @param {CanvasRenderingContext2D} c 描画先
   * @param {string} kind 演出の種類 'flash' | 'wipe' | 'blinds'
   * @param {number} amount 強さ [0..1]
   * @returns {void}
   */
  function drawTransition(c, kind, amount) {
    if (amount <= 0.001) return;
    var a = M.easeInOut(amount);

    if (kind === 'wipe') {
      c.fillStyle = 'rgba(4,5,10,' + a.toFixed(3) + ')';
      c.fillRect(0, 0, W * a, H);
      c.fillRect(W * (1 - a), 0, W * a, H);
    } else if (kind === 'blinds') {
      var bars = 14;
      var bh = H / bars;
      c.fillStyle = 'rgba(4,5,10,0.95)';
      for (var i = 0; i < bars; i++) {
        c.fillRect(0, i * bh, W, bh * a);
      }
    } else {
      c.fillStyle = 'rgba(255,255,255,' + (a * a * 0.9).toFixed(3) + ')';
      c.fillRect(0, 0, W, H);
    }
  }

  /**
   * @brief まだ一度も操作されていない間、遊び方を画面に示す。
   *
   * 「触れると操縦できる」ことは、作品の主張そのものでありながら
   * 見ただけでは絶対に伝わらない。だから控えめにせず、はっきり出す。
   * 一度でも操作されたら二度と出さない。
   *
   * @private
   * @param {Object} f フレーム文脈
   * @param {boolean} playable 今が操作可能な区間か
   * @returns {void}
   */
  function drawPrompt(f, playable) {
    // デモとして流れている間はタイトル画面が案内を担うため、ここでは描かない。
    // 遊び始めた直後の数秒だけ、操作の仕方を図で示す。
    if (!playable || !global.PULSAR.game.state.started) return;

    var c = f.ctx;
    var pulse = 0.6 + 0.4 * Math.sin(clock * 2.6);
    var alpha = (0.5 + pulse * 0.5) * fadeOutHint();

    if (alpha <= 0.01) return;

    var cx = f.W / 2;
    var cy = f.H / 2;
    // 自機が実際に動く円と同じ半径にする。案内と動きがずれると混乱するため。
    var g = global.PULSAR.game.CONFIG;
    var radius = global.PULSAR.game.cursorRadius(Math.min(f.W, f.H) * g.focal);
    var a = clock * 1.5;

    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.globalCompositeOperation = 'lighter';

    c.strokeStyle = 'rgba(160,220,255,' + (alpha * 0.3).toFixed(3) + ')';
    c.lineWidth = 1.5;
    c.setLineDash([6, 10]);
    c.beginPath();
    c.arc(cx, cy, radius, 0, TAU_LOCAL);
    c.stroke();
    c.setLineDash([]);

    // 円周をなぞる指先
    var fx = cx + Math.cos(a) * radius;
    var fy = cy + Math.sin(a) * radius;
    var grad = c.createRadialGradient(fx, fy, 0, fx, fy, 26);
    grad.addColorStop(0, 'rgba(190,235,255,' + (alpha * 0.75).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(190,235,255,0)');
    c.fillStyle = grad;
    c.beginPath();
    c.arc(fx, fy, 26, 0, TAU_LOCAL);
    c.fill();

    c.globalCompositeOperation = 'source-over';
    c.font = '700 ' + Math.min(f.W * 0.045, 22).toFixed(0) + 'px system-ui, sans-serif';
    c.fillStyle = 'rgba(236,243,255,' + alpha.toFixed(3) + ')';
    c.fillText('なぞって操作', cx, cy + radius + 42);

    c.restore();
  }

  /**
   * @brief 遊び始めた直後の案内を、時間とともに消す係数。
   * @private
   * @returns {number} 不透明度の倍率 [0..1]
   */
  function fadeOutHint() {
    var since = clock - startedAt;
    return M.clamp(1 - (since - 3.5) / 1.5, 0, 1);
  }

  /** @brief 円周。`mathx` の TAU をローカルに束縛して参照を短くする。 @private */
  var TAU_LOCAL = M.TAU;

  /** @brief 走行パネルとリザルトの DOM 参照。 @private */
  var panelEl = null, distEl = null, timeEl = null;
  var countdownEl = null, countdownNumEl = null, countdownHeadEl = null;
  var bannerEl = null, bannerTextEl = null, bannerHeadEl = null;

  /** @brief FPS を出す要素。 @private */
  var fpsEl = null;

  /** @brief FPS の文字を最後に書き換えた時刻 [ms]。 @private */
  var fpsShownMs = 0;

  /** @brief 桁を埋める見えない 0 を入れる要素。 @private */
  var distPadEl = null;
  var resultEl = null;

  /** @brief 直前に描いた値。同じなら DOM を触らない。 @private */
  var shownDist = -1, shownTime = '';
  var shownCollected = -1;

  /**
   * @brief 画面に出ているステージ番号。
   *
   * これは「DOM に書いた値」であって、進行の状態ではない。
   * ゲーム側の値を先読みして入れてしまうと、DOM は古いままなのに
   * 一致していると判断され、表示が更新されなくなる。
   * @private
   */
  /** @brief リザルトを表示済みか。 @private */
  var resultShown = false;

  /**
   * @brief 秒数を m:ss 形式にする。
   * @private
   * @param {number} sec 秒数（0 以上）
   * @returns {string} 表示用の文字列
   */
  function formatTime(sec) {
    var s = Math.max(0, Math.ceil(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  /**
   * @brief 数を、決まった桁数の位置に置く。
   *
   * 桁が変わるたびに文字数が増えると、その場で表示の幅も変わる。
   * 走っている最中に数字の位置が動くと、目で追えなくなってしまう。
   *
   * そこで足りない桁を 0 で埋めるが、その 0 は見えない要素に入れる。
   * 場所だけ取って見た目には出ないので、`7` と出したまま位置は
   * `007` のときと変わらない。
   *
   * @private
   * @param {HTMLElement} padEl 見えない 0 を入れる要素
   * @param {HTMLElement} numEl 数字を入れる要素
   * @param {number} value 値（0 以上）
   * @param {number} digits 桁数
   * @returns {void}
   */
  function showNumber(padEl, numEl, value, digits) {
    var s = String(value);
    var zeros = '';

    for (var i = s.length; i < digits; i++) zeros += '0';

    if (padEl) padEl.textContent = zeros;
    numEl.textContent = s;
  }

  /**
   * @brief コンボの段階を数える。
   *
   * 音の層が増えるしきい値をそのまま使う。曲が厚くなる瞬間と
   * 絵が変わる瞬間が揃い、どちらも「上手くなった手応え」として
   * 同じ出来事に聞こえ、同じ出来事に見える。
   *
   * @private
   * @param {number} gauge コンボゲージ [0..1]
   * @returns {number} 0（まだ何も増えていない）〜 層の数
   */
  function comboStep(gauge) {
    var layers = global.PULSAR.sound.LAYER;
    var n = 0;

    for (var key in layers) {
      if (Object.prototype.hasOwnProperty.call(layers, key) && gauge >= layers[key]) n++;
    }

    return n;
  }

  /**
   * @brief 脇を通り過ぎていく風の線を描く。
   *
   * コンボが段階を上げるほど、本数と速さと明るさが増える。ゲージの棒を
   * 読ませる代わりに、勢いそのものを絵で見せる。
   *
   * 1本ずつに奥行きを持たせ、それを手前へ進める。位置は透視投影
   * （焦点距離 ÷ 奥行き）に任せる。半径と長さを式で決めていたときは
   * 放射状の棒が伸び縮みして見えたが、投影に任せると、手前ほど速く
   * 大きく開いていく加速が計算するまでもなく出てくる。
   *
   * 尾の長さは、実際に動いた距離からは求めていない。それは物として
   * 正しくても、1枚ぶんの移動はモーションブラーの定義そのもので、
   * 飛んでいるものではなく残像に見えてしまう。ここは勢いを見せる絵
   * なので、今の位置を中心へ向かって縮めた点を根元にしている。
   * 奥でも手前でも同じ細長さに見え、進むほど実際の長さは伸びる。
   *
   * 出どころは常に画面の中心。通路のうねりに合わせて動かしてみたが、
   * 風そのものが揺さぶられているように見えて落ち着かなかった。風は
   * 自分が進んでいる向きに流れるものなので、動かないほうが正しい。
   *
   * 中心の近く、つまり奥にいるあいだは薄い。そこはリングの切れ目を
   * 読み取る場所なので、線が重なると遊びの邪魔になる。
   *
   * 1本ごとの位置は番号から決めている（乱数ではない）。毎フレーム
   * 引き直しても同じ筋が流れ続けるので、ちらつかない。
   *
   * 進み具合は足し込んで持つ（windPhase）。経過時間に速さを掛けて
   * 求めていたときは、拍で速さが変わるたびに位置そのものが飛んだ。
   * とくに拍が弱まる局面では掛ける数が減るので位置が戻り、手前から
   * 奥へ引き返しているように見えてしまう。足し込む形なら、速さが
   * 変わっても今いる場所は動かず、そこから先の進み方だけが変わる。
   *
   * @private
   * @param {number} step コンボの段階（0 なら描かない）
   * @param {number} kick 拍の強さ [0..1]
   * @param {number} dt 前の画面からの経過 [s]
   * @returns {void}
   */
  function drawWindLines(step, kick, dt) {
    if (step <= 0) return;

    var cx = W / 2;
    var cy = H / 2;
    var reach = Math.sqrt(cx * cx + cy * cy);   // 画面の隅までの距離
    var focal = reach * CONFIG.windFocal;
    var span = 1 - CONFIG.windNearZ;            // 奥行き 1 から手前までの幅

    /*
     * 段階の強さ。1段階目をいきなり読める濃さから始める。
     *
     * ここはゲージの代わりなので、「増えた」と分かることが役目になる。
     * 段階の数でそのまま割ると、1段階目が最大の 1/5 の濃さになり、
     * 背景に沈んで何も起きていないように見えてしまう。
     * 下限を持たせ、そこから最大まで伸ばす。
     */
    var last = Math.max(1, comboStepMax() - 1);
    var level = CONFIG.windFirstLevel +
                (1 - CONFIG.windFirstLevel) * ((step - 1) / last);

    /*
     * 本数は、描画が追いつかない端末では減らす。
     *
     * 背景の解像度を落とすのと同じ考え方。ここは1枚あたりの手間が
     * 本数にそのまま比例するので、いちばん素直に効く。
     */
    var count = Math.round((CONFIG.windLinesBase +
                            step * CONFIG.windLinesPerStep) *
                           (quality > 0 ? 1 : CONFIG.windLinesLowRatio));

    windPhase += dt * CONFIG.windSpeed * (0.7 + step * 0.12 + kick * 0.2);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (var i = 0; i < count; i++) {
      /*
       * 本ごとの偏り。小数部を取り出して 0〜1 の散らばりを作る。
       * 角度を等間隔にすると車輪のスポークに見えるので、少しずらす。
       */
      var seed = i * 12.9898;
      var jitter = seed - Math.floor(seed);
      var seed2 = i * 78.233;
      var jitter2 = seed2 - Math.floor(seed2);
      var seed3 = i * 39.3467;
      var jitter3 = seed3 - Math.floor(seed3);
      var seed4 = i * 15.7312;
      var jitter4 = seed4 - Math.floor(seed4);

      var a = (i / count + jitter * 0.9 / count) * TAU_LOCAL;

      /*
       * 奥行き 1 に置いたときの、中心からの隔たり。
       * 本ごとに変えないと、全部が同じ輪の上を流れてしまう。
       */
      var r = 0.10 + jitter2 * 0.28;

      // 0 から 1 へ進み、端まで行ったら奥へ戻る。速さは本ごとに変える
      var p = (windPhase * (0.75 + jitter2 * 0.5) + jitter) % 1;

      // 奥行きは 1（遠い）から windNearZ（目の前）へ。0 にはしない
      var z = 1 - p * span;

      /*
       * 濃さは、奥にいるあいだだけ薄くする。
       *
       * そこは中心＝リングの切れ目を読み取る場所でもあり、まだ遠くに
       * あるものでもある。手前へ出てからは濃いまま、画面の外へ抜ける。
       * 外側で薄くすると、抜けたのではなく「溶けて消えた」ように見える。
       */
      var near = M.clamp(1 - z, 0, 1);

      /*
       * 濃さと長さは本ごとに変える。
       *
       * すべて同じにすると、放射状に等間隔で並んだ図形にしか見えない。
       * 濃い長い筋と薄い短い筋が混ざって初めて、離れた奥行きに散らばった
       * ものが流れているように見える。
       *
       * 散らばりは2乗して偏らせている。そのまま使うと長さも濃さも
       * まんべんなく分かれ、結局は同じような筋が並ぶ。2乗すると
       * 大半が短く薄いほうへ寄り、いちばん濃い長い筋の値は変わらない。
       * 少数の目立つ筋と、その隙間を埋める細かい筋という差が生まれる。
       */
      var alpha = (0.10 + level * 0.62) * M.clamp(near * 3, 0, 1) *
                  (0.8 + kick * 0.45) *
                  (0.15 + jitter4 * jitter4 * 1.15);
      if (alpha < 0.004) continue;

      var trail = CONFIG.windTrailFrac * (0.22 + jitter3 * jitter3 * 1.23);

      /*
       * 中心から今の位置へのベクトル。尾と先端は、これを縮めた点に
       * すぎない。実際に動いた距離ではなく割合で取っているので、
       * 手前へ出るほど長く、奥では短く、比率は変わらない。
       */
      var ex = Math.cos(a) * r * focal / z;
      var ey = Math.sin(a) * r * focal / z;
      var x = cx + ex;
      var y = cy + ey;
      var tx = cx + ex * (1 - trail);
      var ty = cy + ey * (1 - trail);

      // 尾の根元がもう画面の外なら、線は丸ごと外にある
      if (tx < -reach || tx > W + reach || ty < -reach || ty > H + reach) continue;

      var width = (1.1 + level * 2.0) * (0.5 + near * 1.0);

      /*
       * 根元から先端へ、区間に区切って濃さを上げていく。
       *
       * 濃さが一様な棒は、長くしただけ余計にブレに見える。飛んでいる
       * ものは頭が明るく、後ろへ流れるほど薄い。ただし別の色を重ねると、
       * 先端だけ色の違う短い棒が乗っているように見えてしまう。色も彩度も
       * 明度も同じまま、濃さだけを変える。
       *
       * 描くのはここではなく、濃さと太さの近いものをまとめる入れ物へ。
       */
      for (var s = 0; s < WIND_STEPS.length; s++) {
        var from = WIND_STEPS[s][0];
        var to = WIND_STEPS[s][1];

        addWindSegment(alpha * WIND_STEPS[s][2], width,
                       tx + (x - tx) * from, ty + (y - ty) * from,
                       tx + (x - tx) * to, ty + (y - ty) * to);
      }
    }

    strokeWindBuckets();

    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * @brief コンボの段階の最大値（音の層の数）。
   * @private
   * @returns {number} 段階の数
   */
  function comboStepMax() {
    var layers = global.PULSAR.sound.LAYER;
    var n = 0;

    for (var key in layers) {
      if (Object.prototype.hasOwnProperty.call(layers, key)) n++;
    }

    return n;
  }

  /**
   * @brief 今のステージの進み具合を、割合で返す。
   *
   * 「あと何メートル」は、この作品の距離の単位を知らないと意味を持たない。
   * 「何パーセント」なら、初めて見た人にも残りが分かる。
   *
   * 切り上げず、切り捨てる。四捨五入だと 99.5% で 100 と出てしまい、
   * まだ走っているのに抜けたように見える。100 は「抜けた」ことの合図
   * として取っておきたい。
   *
   * 逆に、抜けたのに 99 のままで終わることもない。進み具合は 1 で
   * 頭打ちにしてあるので、条件を満たした時点で必ず 100 になる。
   *
   * 走行中の表示とリザルトで同じ値を使う。別々に計算すると、
   * 片方だけ丸め方を直したときに食い違う。
   *
   * @private
   * @returns {number} 0〜100
   */
  function goalPercent() {
    var game = global.PULSAR.game;

    // 踏破したあとは、最後のステージを抜けきった状態として見せる
    if (game.state.cleared) return 100;

    var v = Math.floor(game.stageProgress() * 100);
    return (v >= 100 && !game.goalReached()) ? 99 : v;
  }

  /**
   * @brief スコア表示を更新する。
   *
   * Canvas ではなく DOM で出す理由: 数字は等幅で安定して読めた方がよく、
   * 拡大や画面の揺れの影響も受けない方が読みやすいため。
   *
   * @private
   * @param {boolean} visible 表示するか
   * @returns {void}
   */
  function updateScore(visible) {
    if (!panelEl) return;
    var game = global.PULSAR.game;
    var st = game.state;

    panelEl.classList.toggle('hidden', !visible);
    if (!visible) return;

    // 距離は「このステージで進んだぶん / 抜けるのに必要なぶん」で出す。
    // 通算の距離より、あとどれだけでクリアかの方が今の判断に効く。
    var run = goalPercent();
    if (run !== shownDist) {
      // 桁が増えるたびに幅が変わると、走っている最中に数字が横へずれる。
      showNumber(distPadEl, distEl, run, 3);
      shownDist = run;
    }

    var tm = formatTime(st.timeLeft);
    if (tm !== shownTime) {
      timeEl.textContent = tm;
      shownTime = tm;
    }

    // 立体を取った瞬間だけ TIME を弾ませる。どこで時間が増えたか分かる。
    if (st.collected !== shownCollected) {
      timeEl.classList.remove('gain');
      void timeEl.offsetWidth;
      timeEl.classList.add('gain');
      shownCollected = st.collected;
    }

  }

  /**
   * @brief リザルトを表示する。
   * @private
   * @returns {void}
   */
  function showResult() {
    var st = global.PULSAR.game.state;
    resultShown = true;

    // 全ステージを抜けたときと、時間切れのときで見出しを変える。
    var titleEl = document.getElementById('resultTitle');
    var leadEl = document.querySelector('.resultLead');

    if (st.cleared) {
      titleEl.textContent = 'ALL CLEAR';
      titleEl.classList.add('clear');
      leadEl.textContent = 'クリアおめでとう！';
      leadEl.classList.add('clear');
    } else {
      titleEl.textContent = 'TIME UP';
      titleEl.classList.remove('clear');
      leadEl.textContent = 'ステージ ' + st.stage + ' で時間切れです。';
      leadEl.classList.remove('clear');
    }

    document.getElementById('rsStage').textContent =
      st.stage + ' / ' + global.PULSAR.game.CONFIG.stageCount;
    // 走行中の HUD と同じ見せ方に揃える（距離ではなく、抜けるまでの割合）
    document.getElementById('rsDist').textContent = goalPercent() + '%';
    document.getElementById('rsCombo').textContent = String(st.maxCombo);
    document.getElementById('rsItems').textContent = String(st.collected);
    document.getElementById('rsGained').textContent = Math.round(st.timeGained) + 's';
    document.getElementById('rsPassed').textContent = String(st.passed);
    document.getElementById('rsHits').textContent = String(st.hits);

    var note = (st.hits === 0 && st.passed > 0) ? 'ノーミス走破。' : '';
    document.getElementById('rsNote').textContent = note;

    resultEl.hidden = false;
  }

  /**
   * @brief 今なにかの理由で止まっているか。
   * @returns {boolean} 止まっていれば true
   */
  function isPaused() {
    return pauseReasons.dialog || pauseReasons.hidden ||
           pauseReasons.countdown || pauseReasons.banner;
  }

  /**
   * @brief 一時停止の状態を切り替える。
   *
   * 止まっている間は時計を進めず、描画もしない。Canvas は前の絵を
   * 保持するため、画面はその瞬間で固まったように見える。
   *
   * @param {string} reason 理由 'dialog' | 'hidden' | 'countdown' | 'banner'
   * @param {boolean} on 止めるなら true
   * @returns {void}
   */
  function setPaused(reason, on) {
    var before = isPaused();
    pauseReasons[reason] = !!on;
    var after = isPaused();
    if (before === after) return;

    // 止めている間は音も止める。鳴り続けると止まった感じがしない。
    // ただし「音を出したいか」という設定そのものは変えない。
    global.PULSAR.sound.setSuspended(after);

    if (!after) {
      // 止まっていた時間を経過時間として数えないよう、時計を取り直す。
      prevMs = 0;
    }
  }

  /**
   * @brief 画面いっぱいに知らせを出し、一定時間おいてから次へ進む。
   *
   * ステージを抜けた瞬間にそのまま次が始まると、何が起きたのか分からない。
   * 手を止めさせて結果を伝えてから、次へ渡す。
   *
   * @private
   * @param {string} head 上に小さく添える文字（無ければ空）
   * @param {string} text 出す文字
   * @param {number} ms 見せている時間 [ms]
   * @param {Function} done 消した後に行う処理
   * @returns {void}
   */
  function showBanner(head, text, ms, done) {
    global.clearTimeout(bannerTimer);
    setPaused('banner', true);

    if (bannerEl) {
      if (bannerHeadEl) {
        bannerHeadEl.textContent = head;
        bannerHeadEl.hidden = !head;
      }
      if (bannerTextEl) bannerTextEl.textContent = text;

      bannerEl.hidden = false;
      bannerEl.classList.remove('pop');
      void bannerEl.offsetWidth;
      bannerEl.classList.add('pop');
    }

    bannerTimer = global.setTimeout(function () {
      if (bannerEl) bannerEl.hidden = true;
      setPaused('banner', false);
      done();
    }, ms);
  }

  /**
   * @brief 3・2・1 と数えてから走り出す。
   *
   * 止まった状態からいきなり動き出すと、身構える間もなくリングが来る。
   * 数えるあいだに指の位置を決められるようにする。
   *
   * ステージの頭では番号を添える。同じ合図でも「新しいステージが
   * 始まる」のか「さっきの続きに戻る」のかで意味が違うためで、
   * メニューから戻るときは添えない。
   *
   * @param {string} [head] 最初の READY に添える文字（例: `STAGE 2`）
   * @returns {void}
   */
  function startCountdown(head) {
    var i = 0;

    if (countdownHeadEl) countdownHeadEl.textContent = head || '';

    /**
     * @brief 表示を1つ進め、弾むアニメーションを掛け直す。
     * @param {string} label 表示する文字
     * @returns {void}
     */
    var show = function (label) {
      if (!countdownEl || !countdownNumEl) return;
      countdownEl.hidden = false;

      /*
       * ステージ番号を添えるのは、最初の READY のあいだだけ。
       *
       * 数え始めたあとも出し続けると、指を置く場所より先に文字を
       * 読ませることになる。番号は「どのステージが始まるか」を
       * 伝えるためのもので、その役目は最初の一枚で終わっている。
       */
      if (countdownHeadEl) {
        countdownHeadEl.hidden = !head || i > 0;
      }

      countdownNumEl.textContent = label;
      // 数字と単語では収まる大きさが違うので、字数で切り替える
      countdownNumEl.classList.toggle('word', label.length > 1);
      countdownNumEl.classList.remove('tick');
      void countdownNumEl.offsetWidth;   // 再フローさせてアニメーションを作り直す
      countdownNumEl.classList.add('tick');
    };

    global.clearTimeout(countdownTimer);
    setPaused('countdown', true);

    show(COUNT_STEPS[0].text);

    var step = function () {
      i++;

      if (i < COUNT_STEPS.length) {
        show(COUNT_STEPS[i].text);
        countdownTimer = global.setTimeout(step, COUNT_STEPS[i].ms);
        return;
      }

      if (countdownEl) countdownEl.hidden = true;
      setPaused('countdown', false);
    };

    // ステージの頭だけ、最初の一枚を長く見せる（番号を読む間を取る）
    countdownTimer = global.setTimeout(step, head ? READY_STAGE_MS : COUNT_STEPS[0].ms);
  }

  /**
   * @brief カウントダウンを取り消す（タイトルへ戻るときなど）。
   * @private
   * @returns {void}
   */
  function cancelCountdown() {
    global.clearTimeout(countdownTimer);
    if (countdownEl) countdownEl.hidden = true;
    setPaused('countdown', false);
  }

  /**
   * @brief 開いていたものを閉じて再開する。
   *
   * 走行中の一時停止は、すべて「何かを開いている」状態として扱う。
   * メニュー・説明・確認のどれであっても、閉じたらここを通る。
   *
   * 閉じた瞬間にいきなり動き出すと、身構える間もなくリングが来る。
   * 走行中なら合図を挟んでから戻す。
   *
   * @returns {void}
   */
  function closeDialog() {
    setPaused('dialog', false);

    var st = global.PULSAR.game.state;
    if (st.started && !st.finished) startCountdown();
  }

  /**
   * @brief 遊び始める。タイトル画面から呼ばれる。
   * @returns {void}
   */
  function startGame(stage) {
    onTitle = false;
    global.PULSAR.game.reset(stage);
    lastStage = global.PULSAR.game.state.stage;
    pointer.everTouched = true;
    lastInput = clock;
    startedAt = clock;
    jumpToPlayable();

    // 合図の裏に、これから走るステージの景色を描いておく。
    needsRender = true;
    startCountdown('STAGE ' + global.PULSAR.game.state.stage);
  }

  /**
   * @brief もう一度挑戦する。直前に遊んでいたステージから始める。
   * @returns {void}
   */
  function retry() {
    resultEl.hidden = true;
    resultShown = false;
    startGame(lastStage);
  }

  /**
   * @brief デモ（自動操縦）の状態へ戻す。タイトルへ帰るときに使う。
   * @returns {void}
   */
  function showAutoplay() {
    onTitle = true;

    // すでに自動操縦を映しているなら何もしない。
    // 押すたびに走行が巻き戻ると、反応だけあって進まない画面に見える。
    var tl = global.PULSAR.scenes.timeline;
    var current = tl[M.pickScene(tl, sceneTime).index];
    if (current.name === CONFIG.playableScene &&
        !global.PULSAR.game.state.started) {
      return;
    }

    cancelCountdown();
    resultEl.hidden = true;
    resultShown = false;

    global.PULSAR.game.reset(1);
    pointer.everTouched = false;
    lastInput = -999;
    startedAt = -999;
    jumpToPlayable();
  }


  /**
   * @brief 1フレーム描画する。
   * @private
   * @param {number} ms `requestAnimationFrame` が渡す時刻 [ms]
   * @returns {void}
   */
  function frame(ms) {
    /*
     * 表示が 120Hz や 240Hz でも、更新は 60 回/秒までに抑える。
     *
     * requestAnimationFrame は画面の書き換えに合わせて呼ばれるため、
     * 高い表示の端末では 1 秒に 240 回まわる。動きの計算は経過時間で
     * 行っているので速さは変わらないが、描画の負担だけが4倍になる。
     * ぼかしや1画素ずつの塗りを4倍の回数かけても、目に見える差はない。
     *
     * 60 の枠ちょうどで比べると、わずかな誤差で1枚おきに落ちて
     * 30 回/秒に見えてしまう。少しだけ手前で比べる。
     */
    if (prevDrawMs && (ms - prevDrawMs) < CONFIG.minFrameMs) {
      global.requestAnimationFrame(frame);
      return;
    }

    // 実際の間隔。1枚あたりの処理時間とは別物で、こちらが毎秒の枚数になる。
    if (prevDrawMs) intervalMs += ((ms - prevDrawMs) - intervalMs) * 0.1;
    prevDrawMs = ms;

    var paused = isPaused();

    // 止まっている間は何も進めず、何も描かない。
    // Canvas は前の絵を保ったままなので、その瞬間で固まって見える。
    //
    // ただし1枚だけ描き直したい場合がある。合図のあいだに映るのは
    // 止まる直前の絵なので、ステージを選んで始めたときに前の場面が
    // 残ってしまう。そのときだけ時間を進めずに1枚描く。
    if (paused && !needsRender) {
      prevMs = 0;
      global.requestAnimationFrame(frame);
      return;
    }

    // 初回とタブ復帰時に巨大な dt が入らないよう上限を設ける。
    var dt = paused ? 0 : (prevMs ? Math.min((ms - prevMs) / 1000, 0.05) : 0);

    if (paused) {
      needsRender = false;
      prevMs = 0;
    } else {
      prevMs = ms;
    }

    var t0 = (global.performance && global.performance.now) ? global.performance.now() : 0;
    clock += dt;
    sceneTime += dt;

    var timeline = global.PULSAR.scenes.timeline;
    var pick = M.pickScene(timeline, sceneTime);
    var scene = timeline[pick.index];

    var game = global.PULSAR.game;

    var playing = isPlaying();

    // 挑戦中は、手を止めていても操作区間から出さない。
    // 考えている最中に場面が切り替わって遊べなくなるのは事故でしかない。
    // 遊び終えたあとは、直近に操作があるあいだだけ引き留める。
    var engaged = playing || (clock - lastInput) < CONFIG.holdSeconds;

    if (engaged && scene.name === CONFIG.playableScene &&
        pick.local > scene.duration - CONFIG.fade) {
      sceneTime -= scene.duration * 0.5;
      pick = M.pickScene(timeline, sceneTime);
      scene = timeline[pick.index];
    }

    // 走行速度をテンポに写す。速く走るほど曲も前のめりになる。
    var speedRatio = (game.state.speed - game.CONFIG.baseSpeed) /
                     Math.max(0.001, game.state.params.maxSpeed - game.CONFIG.baseSpeed);
    var wantedTempo = playing
      ? M.lerp(CONFIG.tempoMin, CONFIG.tempoMax, M.clamp(speedRatio, 0, 1))
      : 1;
    tempoScale = M.approach(tempoScale, wantedTempo, 2.5, dt);
    global.PULSAR.sound.setTempoScale(tempoScale);

    beatPos += dt * CONFIG.bpm * tempoScale / 60;
    var phase = beatPos - Math.floor(beatPos);
    // 拍の頭で 1、次の拍へ向かって減衰する値。キックの手応えを視覚に流用する。
    var kick = Math.exp(-phase * 5.5);

    // 左右を同時に押したときは打ち消し合って 0 になる。
    // その場に留まる扱いになり、マウスへ主導権が移らない（下の inputMode）。
    var steer = 0;
    if (keys.left) steer -= 1;
    if (keys.right) steer += 1;

    // キーを押している間は、操作手段をキーに固定する。
    // 押しっぱなしの最中にマウスへ移ると、離した瞬間に飛んでしまう。
    if (keys.left || keys.right) inputMode = 'key';

    /**
     * @brief 1フレーム分の文脈。シーンはこれだけを見て描く。
     */
    var f = {
      ctx: ctx,
      W: W,
      H: H,
      t: clock,
      dt: dt,
      local: pick.local,
      progress: pick.progress,
      beat: Math.floor(beatPos),
      phase: phase,
      kick: kick,
      hue: (clock * 7) % 360,   // 全シーン共通の色相。作品を一本に見せるための背骨
      light: lightMode,
      buf: buf,
      bufCtx: bufCtx,
      pointer: pointer,
      steer: steer,
      inputMode: inputMode,
      // ガイド輪を切っている人にも、走り始めだけは見せて自然に消す
      guideIntro: fadeOutHint(),
      // 描画が追いついていないときは、シーン側も手を抜く
      quality: quality,
      // 自前ラスタライザの描画先と、それを画面へ出す手段
      rasterBuf: rasterBuf,
      rasterBlit: blitRaster,
      // 疑似グレアでは色も明るさも沈むので、塗る側で補う
      satBoost: useSoftGlare() ? CONFIG.softGlareSat : 1,
      lightLift: useSoftGlare() ? CONFIG.softGlareLift : 0,
      impact: impact
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // キックに合わせた微小なズームと、衝突時の揺れ。
    var zoom = 1 + kick * CONFIG.beatZoom + shake * 0.03;
    var sx = (Math.random() - 0.5) * shake * 14;
    var sy = (Math.random() - 0.5) * shake * 14;
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2, -H / 2);

    scene.draw(f);

    /*
     * コンボの段階。風の線の本数と、画面全体の明るさの両方を決める。
     * 同じ数から出すので、絵と光が食い違うことがない。
     */
    var step = playing ? comboStep(game.gauge()) : 0;

    // 段階そのものではなく、そこへ近づいていく値を光に使う
    comboGlow += (step / comboStepMax() - comboGlow) *
                 M.clamp(dt * CONFIG.comboGlareEase, 0, 1);

    // 風の線はグレアの前に描く。光として拾わせたいため。
    if (playing) drawWindLines(step, kick, dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 絵ができた直後にグレアを重ねる。UI の文字までにじませないよう、
    // スコアや案内を描く前にかける。
    // 場面ごとの倍率で調整する。画面全体が明るい場面に同じ強さで掛けると、
    // 光が全面に回って白く飛び、何が映っているのか分からなくなる。
    // 背景を切っているときはグレアも止める。動作が重い端末向けの逃げ道として
    // 用意したボタンなので、重い処理がもう一つ残っていては意味がない。
    //
    // 描画が追いついていないときも止める。画面の縮小コピーとぼかしは
    // この作品でいちばん重く、しかも実装によって速度が桁で違う。
    //
    // ぼかしが遅い環境では止めずに、ぼかしを使わない加算ライトへ差し替える。
    // 光を足すのをやめると画面が沈んでしまい、描く側の明るさを上げるだけでは
    // 輝度差が出ないため、暗いままに見えてしまう。
    var glareScale = (global.PULSAR.scenes.isRaymarch() && quality > 0)
      ? ((scene.glare === undefined) ? 1 : scene.glare)
      : 0;
    var glareBase = useSoftGlare() ? CONFIG.softGlare : CONFIG.glare;

    // コンボの段階が上がるほど、画面そのものを明るくする。
    // 端を流れる風の線と違い、中心を見たままでも変化に気づける。
    var glareAmount = glareBase * glareScale * (0.75 + kick * 0.45);
    drawGlare(glareAmount * (1 + comboGlow * CONFIG.comboGlare));

    /*
     * グレアが走らないときの控え。
     *
     * 背景を切っているときや、描画が追いつかず光を止めているときは、
     * 上の1行では明るさが変わらない。段階の上がりはゲージの代わりに
     * 出している情報なので、設定で消えてしまっては困る。
     * 画面全体に薄い光を足すだけなら、どれだけ遅い端末でも払える。
     */
    if (glareAmount <= 0.01) drawComboLight(comboGlow);

    var playable = scene.name === CONFIG.playableScene;
    drawPrompt(f, playable);
    // 操作区間にいる間と、遊んだ直後だけ出す。他の場面では絵を優先する。
    updateScore(playable || engaged);

    /*
     * 曲の厚み。
     *
     * 遊んでいる間はコンボゲージがそのまま入り、溜めた分だけ層が増える。
     *
     * デモとして流れている間は最大にする。初めて開いた人が耳にするのは
     * ここなので、層を削って聞かせる理由がない。作品の音として
     * いちばん厚いところを、最初から出しておく。
     */
    global.PULSAR.sound.setIntensity(playing ? game.gauge() : 1);

    // ステージに応じて曲そのものを差し替える。
    global.PULSAR.sound.setStage(game.state.stage);

    // 端末側の都合で音が中断されていたら、気づかれないうちに戻す。
    global.PULSAR.sound.keepAlive();

    // ステージを抜けたら、祝いの表示を挟んでから次へ渡す。
    if (game.goalReached() && !bannerBusy) {
      bannerBusy = true;

      if (game.isLastStage()) {
        // 踏破は作品そのものの結びなので、ステージ番号は添えない
        showBanner('', 'GAME COMPLETED!', 2000, function () {
          game.completeGame();
          bannerBusy = false;
        });
      } else {
        var cleared = game.state.stage;

        showBanner('STAGE ' + cleared, 'CLEAR!', 2000, function () {
          game.advanceStage();
          lastStage = game.state.stage;
          needsRender = true;   // 合図の裏に次のステージの景色を描く
          bannerBusy = false;
          // 次のステージの頭なので、番号を添えて数え直す
          startCountdown('STAGE ' + game.state.stage);
        });
      }
    }

    if (game.state.finished && !resultShown && !bannerBusy) showResult();

    if (hitFlash > 0.002) {
      ctx.fillStyle = 'rgba(255,60,80,' + (hitFlash * 0.5).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    // 取得の反応はトンネル区間でしか意味を持たない。
    // その区間の外では消しておく。減衰はトンネルの更新処理の中でしか
    // 進まないため、抜けた瞬間の値のまま固まり、以降の場面すべてに
    // 同じ輪が描かれ続けてしまう。
    if (!playable) game.state.collectFlash = 0;

    // 立体を取ったときの反応。衝突の赤に対して、こちらは暖色で「良いこと」を示す。
    //
    // 画面全体に広がる輪にすると、取るたびに視界を覆って鬱陶しい。
    // 自機のいる場所で小さく弾けさせ、「拾ったのは自分」と分かるようにする。
    if (playable && game.state.collectFlash > 0.01) {
      var cf = game.state.collectFlash;
      var g = game.CONFIG;
      var shipR = game.cursorRadius(Math.min(W, H) * g.focal);
      var sxp = W / 2 + Math.cos(game.state.angle) * shipR;
      var syp = H / 2 + Math.sin(game.state.angle) * shipR;

      var reach = Math.min(W, H);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // 広がる輪を2枚重ねる。速さの違う輪が追いかけると、
      // 一瞬の出来事でも「弾けた」と分かる。
      ctx.strokeStyle = 'rgba(255,214,130,' + (cf * 0.8).toFixed(3) + ')';
      ctx.lineWidth = 2 + cf * 6;
      ctx.beginPath();
      ctx.arc(sxp, syp, 14 + (1 - cf) * reach * 0.42, 0, TAU_LOCAL);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,246,214,' + (cf * 0.45).toFixed(3) + ')';
      ctx.lineWidth = 1 + cf * 3;
      ctx.beginPath();
      ctx.arc(sxp, syp, 10 + (1 - cf) * reach * 0.24, 0, TAU_LOCAL);
      ctx.stroke();

      // 画面全体にもわずかに光を回す
      ctx.fillStyle = 'rgba(255,206,110,' + (cf * 0.10).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);

      ctx.restore();
    }

    drawTransition(ctx, scene.transition, M.edgeFade(pick.local, scene.duration, CONFIG.fade));

    updateFps(ms);

    shake = M.approach(shake, 0, 7, dt);
    hitFlash = M.approach(hitFlash, 0, 6, dt);

    // 実際にかかった時間を見て、次のフレームの重さを決める。
    if (t0) tuneQuality(global.performance.now() - t0);

    global.requestAnimationFrame(frame);
  }

  /**
   * @brief 毎秒の枚数と、今の描画の状態を画面の隅に出す。
   *
   * 絵の中ではなく DOM に出す。絵に描くとグレアでにじみ、メニューを
   * 開けばぼかしの向こう側になって読めない。測るための数字なので、
   * 後処理の一切かからない場所に置く。
   *
   * 数字は移動平均から求める。1フレームごとの生の値は上下に大きく振れ、
   * 読めないうえに「重い」と誤解させる。
   *
   * @private
   * @param {number} ms 今の時刻 [ms]
   * @returns {void}
   */
  function updateFps(ms) {
    if (!fpsEl) return;

    fpsEl.hidden = !showFps;
    if (!showFps) return;

    // 毎フレーム書き換えると、数字が目まぐるしく変わって読めない。
    // 文字を差し替える処理そのものも無駄になる。
    if (ms - fpsShownMs < CONFIG.fpsUpdateMs) return;
    fpsShownMs = ms;

    var fps = intervalMs > 0 ? (1000 / intervalMs) : 0;
    if (fps > 999) fps = 999;

    // 「毎秒の枚数」と「1枚にかかった時間」は別物。後者が短くても、
    // 間隔が空いていれば枚数は出ない。両方を並べて出す。
    fpsEl.textContent = fps.toFixed(0) + ' fps  描画 ' + frameMs.toFixed(1) + ' ms' +
                        (quality === 0 ? '  [軽量]' : '');
  }

  /**
   * @brief 起動する。DOM の準備後に一度だけ呼ぶ。
   * @returns {void}
   */
  function boot() {
    canvas = document.getElementById('stage');
    ctx = canvas.getContext('2d', { alpha: false });

    buf = document.createElement('canvas');
    bufCtx = buf.getContext('2d', { willReadFrequently: true });

    rasterCanvas = document.createElement('canvas');
    rasterCtx = rasterCanvas.getContext('2d');

    glareBuf = document.createElement('canvas');
    glareCtx = glareBuf.getContext('2d');
    glareTmp = document.createElement('canvas');
    glareTmpCtx = glareTmp.getContext('2d');

    // ぼかしを自前で組む経路は filter を使わないので、
    // filter への対応を求めるのは本来のグレアを使う環境だけでよい。
    glareOk = !!glareCtx && !!glareTmpCtx &&
              (useSoftGlare() || ('filter' in glareCtx));

    panelEl = document.getElementById('panel');
    distEl = document.getElementById('scoreDist');
    timeEl = document.getElementById('scoreTime');

    distPadEl = document.getElementById('distPad');

    resultEl = document.getElementById('result');
    fpsEl = document.getElementById('fps');
    if (fpsEl) fpsEl.hidden = !showFps;
    countdownEl = document.getElementById('countdown');
    countdownNumEl = document.getElementById('countdownNum');
    countdownHeadEl = document.getElementById('countdownHead');
    bannerEl = document.getElementById('banner');
    bannerTextEl = document.getElementById('bannerText');
    bannerHeadEl = document.getElementById('bannerHead');

    // タブが隠れている間は止める。戻ったときに時間だけ進んでいる事故を防ぐ。
    document.addEventListener('visibilitychange', function () {
      setPaused('hidden', document.hidden);
    });

    resize();
    bindInput();
    global.PULSAR.game.reset();

    // 最初に見せるのは操作区間の自動操縦。
    // 何が遊べる作品なのかを、説明ではなく動きそのもので示す。
    // 一巡したあとは幾何学的なエフェクトへ移っていく。
    sceneTime = sceneStartOf(CONFIG.playableScene) + CONFIG.fade;

    global.requestAnimationFrame(frame);
  }

  /**
   * @brief 演出の最中か（合図・知らせ）。
   *
   * このあいだは操作を受け付けるべきではないので、ボタンを押せなくする。
   *
   * @returns {boolean} 演出中なら true
   */
  function isBusy() {
    return pauseReasons.countdown || pauseReasons.banner;
  }

  /**
   * @brief 挑戦として走っている最中か。
   *
   * タイトルのデモと区別する。画面側もこの判断を使い、止めるかどうかや
   * ボタンの表記を決める。同じことを別々に数えると必ずずれる。
   *
   * @returns {boolean} 走行中なら true
   */
  function isPlaying() {
    var st = global.PULSAR.game.state;
    return !onTitle && st.started && !st.finished;
  }

  /**
   * @brief 止まっていても1枚だけ描き直す。
   *
   * 見た目に関わる設定は、止めている最中に変えられる。そのままでは
   * 前の絵が残り続け、変えたのに何も起きていないように見えてしまう。
   *
   * @returns {void}
   */
  function requestRender() {
    needsRender = true;
  }

  /**
   * @brief 今の描画の状態を返す（調整用）。
   *
   * ブラウザごとの速度差を追うには、実際にかかっている時間を見るのが
   * いちばん早い。開発者コンソールから `PULSAR.app.stats()` で確認する。
   *
   * @returns {Object} フレーム時間 [ms]、品質の段階、ラスタライザの解像度
   */
  function stats() {
    return {
      fps: intervalMs > 0 ? (1000 / intervalMs) : 0,
      frameMs: frameMs,
      intervalMs: intervalMs,
      quality: quality,
      rasterWidth: rasterBuf ? rasterBuf.w : 0,
      smooth: global.PULSAR.scenes.isSmooth()
    };
  }

  /**
   * @brief 外部へ公開する窓口。
   *
   * `onShortcut` はキー入力を受け取る差し込み口で、`index.html` 側が
   * 実装を入れる（どのキーに何を割り当てるかは画面側の都合なので）。
   */
  var api = {
    CONFIG: CONFIG,
    boot: boot,
    impact: impact,
    startGame: startGame,
    retry: retry,
    showAutoplay: showAutoplay,
    startCountdown: startCountdown,
    setPaused: setPaused,
    closeDialog: closeDialog,
    isPaused: isPaused,
    isPlaying: isPlaying,
    isBusy: isBusy,
    setSoftGlare: setSoftGlare,
    isSoftGlare: isSoftGlare,
    setFps: setFps,
    isFps: isFps,
    requestRender: requestRender,
    stats: stats,
    onShortcut: null
  };

  global.PULSAR.app = api;
})(typeof window !== 'undefined' ? window : this);
