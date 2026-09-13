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
    /** @brief 画面の対角がこれ未満なら描画量を落とす（スマートフォン想定）。 */
    lightModeDiagonal: 900
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

  /** @brief デモ開始からの経過時刻 [s]。 @private */
  var clock = 0;

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

    // バッファは画面比を保ったまま固定幅にする（拡大時に歪ませないため）。
    buf.width = CONFIG.bufferWidth;
    buf.height = Math.max(1, Math.round(CONFIG.bufferWidth * H / Math.max(1, W)));

    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, W, H);
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
      pointer.everTouched = true;
      global.PULSAR.sound.start(); // 自動再生制限があるため、最初の操作で音を起こす
    });

    canvas.addEventListener('pointermove', function (e) {
      readPointer(e);
      // マウスは押していなくても操作とみなす（PC では触れずに動かせた方が自然）
      if (e.pointerType === 'mouse') pointer.everTouched = true;
    });

    global.addEventListener('pointerup', function () { pointer.down = false; });
    global.addEventListener('pointercancel', function () { pointer.down = false; });

    global.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { keys.left = true; pointer.everTouched = true; }
      if (e.key === 'ArrowRight') { keys.right = true; pointer.everTouched = true; }
    });
    global.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowLeft') keys.left = false;
      if (e.key === 'ArrowRight') keys.right = false;
    });

    var t = null;
    global.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(resize, 150);
    });
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
   * @brief 1フレーム描画する。
   * @private
   * @param {number} ms `requestAnimationFrame` が渡す時刻 [ms]
   * @returns {void}
   */
  function frame(ms) {
    // 初回とタブ復帰時に巨大な dt が入らないよう上限を設ける。
    var dt = prevMs ? Math.min((ms - prevMs) / 1000, 0.05) : 0;
    prevMs = ms;
    clock += dt;

    var timeline = global.PULSAR.scenes.timeline;
    var pick = M.pickScene(timeline, clock);
    var scene = timeline[pick.index];

    var phase = M.beatPhase(CONFIG.bpm, clock);
    // 拍の頭で 1、次の拍へ向かって減衰する値。キックの手応えを視覚に流用する。
    var kick = Math.exp(-phase * 5.5);

    var steer = 0;
    if (keys.left) steer -= 1;
    if (keys.right) steer += 1;

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
      beat: M.beatAt(CONFIG.bpm, clock),
      phase: phase,
      kick: kick,
      hue: (clock * 7) % 360,   // 全シーン共通の色相。作品を一本に見せるための背骨
      light: lightMode,
      buf: buf,
      bufCtx: bufCtx,
      pointer: pointer,
      steer: steer,
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (hitFlash > 0.002) {
      ctx.fillStyle = 'rgba(255,60,80,' + (hitFlash * 0.5).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    drawTransition(ctx, scene.transition, M.edgeFade(pick.local, scene.duration, CONFIG.fade));

    shake = M.approach(shake, 0, 7, dt);
    hitFlash = M.approach(hitFlash, 0, 6, dt);

    global.requestAnimationFrame(frame);
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

    resize();
    bindInput();
    global.PULSAR.game.reset();
    global.requestAnimationFrame(frame);
  }

  global.PULSAR.app = {
    CONFIG: CONFIG,
    boot: boot,
    impact: impact
  };
})(typeof window !== 'undefined' ? window : this);
