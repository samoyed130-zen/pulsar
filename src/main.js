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
    lightModeDiagonal: 900,
    /** @brief 触れたときに飛ぶ先のシーン名。作品の主張そのもの。 */
    playableScene: 'tunnel',
    /** @brief 最後の操作からこの秒数のあいだは、操作区間に留まる [s]。 */
    holdSeconds: 7
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
   * @brief デモ開始からの経過時刻 [s]。常に単調増加する。
   *
   * 色相・拍・音はこちらを見る。シーンの巻き戻しで色が飛ばないようにするため、
   * シーン選択用の時計（`sceneTime`）とは分けている。
   * @private
   */
  var clock = 0;

  /**
   * @brief シーン選択に使う時刻 [s]。操作に応じて飛んだり巻き戻したりする。
   * @private
   */
  var sceneTime = 0;

  /** @brief 最後に操作された時刻 [s]（`clock` 基準）。 @private */
  var lastInput = -999;

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
      noteInput();
      global.PULSAR.sound.start(); // 自動再生制限があるため、最初の操作で音を起こす
    });

    canvas.addEventListener('pointermove', function (e) {
      readPointer(e);
      // 一度操作した後は、PC では押していなくてもマウスで操縦できる方が自然。
      // ただし「初めての操作」とはみなさない（不用意なマウス移動でデモが飛ぶため）。
      if (pointer.everTouched) lastInput = clock;
    });

    global.addEventListener('pointerup', function () { pointer.down = false; });
    global.addEventListener('pointercancel', function () { pointer.down = false; });

    global.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { keys.left = true; noteInput(); }
      if (e.key === 'ArrowRight') { keys.right = true; noteInput(); }
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
    if (pointer.everTouched) return;
    // 開幕のタイトルと重ならないよう、少し待ってから出す。
    var appear = M.clamp((clock - 2.2) / 0.8, 0, 1);
    if (appear <= 0.01) return;

    var c = f.ctx;
    var pulse = 0.6 + 0.4 * Math.sin(clock * 2.6);
    var alpha = appear * (0.55 + pulse * 0.45);

    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    if (playable) {
      // 操作区間では、指が円を描く動きそのものを見せる。
      var cx = f.W / 2;
      var cy = f.H / 2;
      // 自機が実際に動く円と同じ半径にする。案内と動きがずれると混乱するため。
      var g = global.PULSAR.game.CONFIG;
      var radius = Math.min(f.W, f.H) * g.focal / g.shipZ * g.shipRadiusRatio;
      var a = clock * 1.5;

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
      c.fillText('なぞって操縦', cx, cy + radius + 42);
    } else {
      // 通常のシーンでは、触れれば操作区間へ飛べることだけを伝える。
      var size = Math.min(f.W * 0.036, 16);
      c.font = '600 ' + size.toFixed(0) + 'px system-ui, sans-serif';
      var label = '画面に触れると、デモがゲームになる';
      var w = c.measureText(label).width;
      var y = f.H - 52;

      c.fillStyle = 'rgba(4,5,10,0.55)';
      c.fillRect(f.W / 2 - w / 2 - 16, y - 17, w + 32, 34);
      c.strokeStyle = 'rgba(122,215,255,' + (alpha * 0.55).toFixed(3) + ')';
      c.lineWidth = 1;
      c.strokeRect(f.W / 2 - w / 2 - 16, y - 17, w + 32, 34);

      c.fillStyle = 'rgba(236,243,255,' + alpha.toFixed(3) + ')';
      c.fillText(label, f.W / 2, y);
    }

    c.restore();
  }

  /** @brief 円周。`mathx` の TAU をローカルに束縛して参照を短くする。 @private */
  var TAU_LOCAL = M.TAU;

  /** @brief スコアとゲージの DOM 参照。 @private */
  var scoreEl = null, distEl = null, bestEl = null, timeEl = null;
  var comboEl = null, comboValueEl = null, gaugeFillEl = null, layerEls = null;
  var resultEl = null;

  /** @brief 直前に描いた値。同じなら DOM を触らない。 @private */
  var shownDist = -1, shownBest = -1, shownTime = '', shownCombo = -1;

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
    if (!scoreEl) return;
    var game = global.PULSAR.game;
    var st = game.state;

    scoreEl.classList.toggle('hidden', !visible);
    comboEl.classList.toggle('hidden', !visible);
    if (!visible) return;

    if (st.score !== shownDist) {
      distEl.textContent = String(st.score);
      shownDist = st.score;
    }
    if (st.best !== shownBest) {
      bestEl.textContent = String(st.best);
      shownBest = st.best;
    }

    var tm = formatTime(st.timeLeft);
    if (tm !== shownTime) {
      timeEl.textContent = tm;
      shownTime = tm;
    }

    if (st.combo !== shownCombo) {
      comboValueEl.textContent = String(st.combo);
      // 伸びた瞬間だけ弾ませる。次のフレームでクラスを外して再生し直せるようにする。
      if (st.combo > shownCombo) {
        comboValueEl.classList.remove('bump');
        void comboValueEl.offsetWidth; // 再フローを強制してアニメーションを作り直す
        comboValueEl.classList.add('bump');
      }
      shownCombo = st.combo;
    }

    var g = game.gauge();
    gaugeFillEl.style.width = (g * 100).toFixed(1) + '%';

    // どの層まで鳴っているかを、音と同じ条件で表示する
    var layers = global.PULSAR.sound.LAYER;
    for (var i = 0; i < layerEls.length; i++) {
      var key = layerEls[i].getAttribute('data-layer');
      if (!key) continue;
      layerEls[i].classList.toggle('on', g >= layers[key]);
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

    document.getElementById('rsDist').textContent = String(st.score);
    document.getElementById('rsBest').textContent = String(st.best);
    document.getElementById('rsCombo').textContent = String(st.maxCombo);
    document.getElementById('rsPassed').textContent = String(st.passed);
    document.getElementById('rsHits').textContent = String(st.hits);

    var note = '';
    if (st.score >= st.best && st.score > 0) note = '自己ベスト更新。';
    else if (st.hits === 0) note = 'ノーミス走破。';
    else if (st.maxCombo >= global.PULSAR.game.CONFIG.comboForMax) note = 'ゲージ満タン到達。';
    document.getElementById('rsNote').textContent = note;

    resultEl.hidden = false;
  }

  /**
   * @brief もう一度挑戦する。
   * @returns {void}
   */
  function retry() {
    resultEl.hidden = true;
    resultShown = false;
    global.PULSAR.game.reset();
    pointer.everTouched = true; // 説明は出し直さない
    lastInput = clock;
    jumpToPlayable();
  }

  /**
   * @brief リザルトを閉じ、デモの流れへ戻る。
   * @returns {void}
   */
  function watchDemo() {
    resultEl.hidden = true;
    resultShown = false;
    global.PULSAR.game.reset();
    lastInput = -999; // 引き留めを解除し、次のシーンへ進ませる
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
    sceneTime += dt;

    var timeline = global.PULSAR.scenes.timeline;
    var pick = M.pickScene(timeline, sceneTime);
    var scene = timeline[pick.index];

    // 操作中に区間が終わってしまうと「遊べていたのに取り上げられた」と感じる。
    // 直近に操作があるあいだは、終わり際で少し巻き戻して操作区間に留める。
    var engaged = (clock - lastInput) < CONFIG.holdSeconds;
    if (engaged && scene.name === CONFIG.playableScene &&
        pick.local > scene.duration - CONFIG.fade) {
      sceneTime -= scene.duration * 0.5;
      pick = M.pickScene(timeline, sceneTime);
      scene = timeline[pick.index];
    }

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

    var playable = scene.name === CONFIG.playableScene;
    drawPrompt(f, playable);
    // 操作区間にいる間と、遊んだ直後だけ出す。他の場面では絵を優先する。
    updateScore(playable || engaged);

    // 曲の厚み。遊んでいる間はコンボゲージ、デモとして流れている間は
    // 場面の進行に合わせて自動でうねらせる（無人でも音が育って聞こえる）。
    var game = global.PULSAR.game;
    global.PULSAR.sound.setIntensity(
      game.state.started && !game.state.finished
        ? game.gauge()
        : 0.35 + 0.35 * Math.sin(clock * 0.12)
    );

    if (game.state.finished && !resultShown) showResult();

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

    scoreEl = document.getElementById('score');
    distEl = document.getElementById('scoreDist');
    bestEl = document.getElementById('scoreBest');
    timeEl = document.getElementById('scoreTime');

    comboEl = document.getElementById('combo');
    comboValueEl = document.getElementById('comboValue');
    gaugeFillEl = document.getElementById('gaugeFill');
    layerEls = document.getElementById('comboLayers').querySelectorAll('.layer');

    resultEl = document.getElementById('result');

    resize();
    bindInput();
    global.PULSAR.game.reset();
    global.requestAnimationFrame(frame);
  }

  global.PULSAR.app = {
    CONFIG: CONFIG,
    boot: boot,
    impact: impact,
    retry: retry,
    watchDemo: watchDemo
  };
})(typeof window !== 'undefined' ? window : this);
