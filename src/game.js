/**
 * @file game.js
 * @brief トンネル区間の状態更新と描画。「触れる区間」の実体。
 *
 * ゲームとして作り込まず、デモを止めないことを最優先にしている:
 * - 触っていない間は自動操縦で走り続けるため、放置してもデモとして成立する
 * - 衝突しても終了しない。画面を赤く弾けさせて走行を続ける
 * - スコアは隅に小さく出すだけで、絵の邪魔をしない
 *
 * 判定に使う角度計算は `mathx.js` に切り出してあり、単体テストで検証している。
 */
(function (global) {
  'use strict';

  var M = global.PULSAR.mathx;
  var TAU = M.TAU;

  /**
   * @brief トンネル区間の調整値。
   */
  var CONFIG = {
    /** @brief カメラから最も遠いリングまでの距離（内部単位）。 */
    farZ: 22,
    /** @brief リングの間隔（内部単位）。 */
    spacing: 2.2,
    /** @brief 走行速度の初期値（1秒あたりの距離）。 */
    baseSpeed: 7.0,
    /** @brief 走行速度の上限。 */
    maxSpeed: 12.0,
    /** @brief 1秒あたりの加速量。 */
    accel: 0.22,
    /** @brief 透視投影の焦点距離。画面短辺に対する比率。 */
    focal: 0.62,
    /** @brief リングの切れ目の開き角 [rad]。 */
    gapWidth: 1.15,
    /** @brief 自機が置かれる奥行き（この位置を通過するリングと判定する）。 */
    shipZ: 1.1,
    /** @brief キー操作時の角速度 [rad/s]。 */
    keyTurnRate: 3.4,
    /** @brief 自動操縦が切れ目へ向かう追従の速さ。 */
    autoRate: 4.5,
    /** @brief 手動操作の追従の速さ。自動より機敏にする。 */
    manualRate: 14.0
  };

  /**
   * @brief 走行状態。
   * @type {{ships: number, angle: number, dist: number, speed: number,
   *         rings: Array<Object>, score: number, best: number, sinceHit: number}}
   */
  var state = {
    angle: 0,
    dist: 0,
    speed: CONFIG.baseSpeed,
    rings: [],
    score: 0,
    best: 0,
    sinceHit: 99
  };

  /**
   * @brief ベストスコアを読み出す。保存が使えない環境でも落ちないようにする。
   * @private
   * @returns {number} 保存されていたベストスコア。無ければ 0
   */
  function loadBest() {
    try {
      var v = parseInt(global.localStorage.getItem('pulsar.best'), 10);
      return isNaN(v) ? 0 : v;
    } catch (e) {
      // プライベートモード等で localStorage が例外を投げる場合がある。
      return 0;
    }
  }

  /**
   * @brief ベストスコアを保存する。失敗しても無視する。
   * @private
   * @param {number} v 保存するスコア
   * @returns {void}
   */
  function saveBest(v) {
    try {
      global.localStorage.setItem('pulsar.best', String(v));
    } catch (e) { /* 保存できなくても作品の動作には影響しない */ }
  }

  /**
   * @brief 新しいリングを1枚作る。
   * @private
   * @param {number} z 生成位置の奥行き
   * @param {number} prevGap 直前のリングの切れ目の角度 [rad]
   * @returns {{z: number, gap: number, judged: boolean}} 生成したリング
   */
  function makeRing(z, prevGap) {
    // 直前の切れ目から離れすぎないようにして、避けられない配置を防ぐ。
    var delta = (Math.random() - 0.5) * 2.2;
    return { z: z, gap: M.wrapAngle(prevGap + delta), judged: false };
  }

  /**
   * @brief 走行状態を初期化する。
   * @returns {void}
   */
  function reset() {
    state.angle = 0;
    state.dist = 0;
    state.speed = CONFIG.baseSpeed;
    state.rings = [];
    state.score = 0;
    state.sinceHit = 99;
    state.best = loadBest();

    var gap = 0;
    for (var z = CONFIG.shipZ + 3; z < CONFIG.farZ; z += CONFIG.spacing) {
      gap = M.wrapAngle(gap + (Math.random() - 0.5) * 2.2);
      state.rings.push({ z: z, gap: gap, judged: false });
    }
  }

  /**
   * @brief 自機が次に通るべき切れ目の角度を返す。
   * @private
   * @returns {number} 目標角 [rad]。対象が無ければ現在角
   */
  function nextGapAngle() {
    var best = null;
    for (var i = 0; i < state.rings.length; i++) {
      var r = state.rings[i];
      if (r.z > CONFIG.shipZ && (best === null || r.z < best.z)) best = r;
    }
    return best ? best.gap : state.angle;
  }

  /**
   * @brief 入力から自機の目標角を決める。
   *
   * 一度でも操作されたら手動、それまでは自動操縦。
   * 画面に触れた位置の「中心から見た向き」をそのまま自機の位置にするため、
   * 説明なしで操作が伝わる。
   *
   * @private
   * @param {Object} f フレーム文脈
   * @returns {{target: number, rate: number}} 目標角 [rad] と追従の速さ
   */
  function decideTarget(f) {
    if (f.steer !== 0) {
      return {
        target: M.wrapAngle(state.angle + f.steer * CONFIG.keyTurnRate * 0.25),
        rate: CONFIG.manualRate
      };
    }

    if (f.pointer.everTouched) {
      var dx = f.pointer.x - f.W / 2;
      var dy = f.pointer.y - f.H / 2;
      if (dx * dx + dy * dy > 64) {
        return { target: M.wrapAngle(Math.atan2(dy, dx)), rate: CONFIG.manualRate };
      }
    }

    return { target: nextGapAngle(), rate: CONFIG.autoRate };
  }

  /**
   * @brief 走行を1フレーム進める。
   * @param {Object} f フレーム文脈（`dt`, `pointer`, `steer`, `impact` を使う）
   * @returns {void}
   */
  function update(f) {
    var dt = f.dt;
    if (dt <= 0) return;

    state.speed = Math.min(CONFIG.maxSpeed, state.speed + CONFIG.accel * dt);
    state.dist += state.speed * dt;
    state.sinceHit += dt;

    var aim = decideTarget(f);
    // 最短方向へ回すため、目標との差分を符号つきで求めてから加算する。
    var diff = M.wrapAngle(aim.target - state.angle);
    if (diff > Math.PI) diff -= TAU;
    state.angle = M.wrapAngle(state.angle + diff * (1 - Math.exp(-aim.rate * dt)));

    var lastGap = 0;
    for (var i = 0; i < state.rings.length; i++) {
      var r = state.rings[i];
      r.z -= state.speed * dt;

      // 自機の位置を通過する瞬間に一度だけ判定する。
      if (!r.judged && r.z <= CONFIG.shipZ) {
        r.judged = true;
        if (!M.canPass(state.angle, r.gap, CONFIG.gapWidth)) {
          f.impact(1);
          state.speed = CONFIG.baseSpeed; // 衝突した分だけ減速する（終了はしない）
          state.sinceHit = 0;
        }
      }
      if (r.z > lastGap) lastGap = r.gap;
    }

    // 手前へ抜けたリングを奥へ回して使い回す（配列を伸ばさない）。
    var farthest = -Infinity;
    for (var j = 0; j < state.rings.length; j++) {
      if (state.rings[j].z > farthest) farthest = state.rings[j].z;
    }
    for (var k = 0; k < state.rings.length; k++) {
      if (state.rings[k].z < -1) {
        farthest += CONFIG.spacing;
        var fresh = makeRing(farthest, lastGap);
        state.rings[k].z = fresh.z;
        state.rings[k].gap = fresh.gap;
        state.rings[k].judged = false;
      }
    }

    state.score = M.scoreFromDistance(state.dist);
    if (state.score > state.best) {
      state.best = state.score;
      saveBest(state.best);
    }
  }

  /**
   * @brief トンネルと自機を描く。
   * @param {Object} f フレーム文脈
   * @returns {void}
   */
  function draw(f) {
    var c = f.ctx;
    var cx = f.W / 2;
    var cy = f.H / 2;
    var focal = Math.min(f.W, f.H) * CONFIG.focal;

    // 奥から手前へ描くことで、近いリングが上に重なる。
    var sorted = state.rings.slice().sort(function (a, b) { return b.z - a.z; });

    c.lineCap = 'round';

    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      if (r.z <= 0.05) continue;

      var radius = focal / r.z;
      if (radius > Math.max(f.W, f.H) * 1.6) continue;

      // 奥行きに応じてトンネル全体をねじる。直線的に見せないための細工。
      var twist = Math.sin(r.z * 0.22 + f.t * 0.6) * focal * 0.10;
      var sway = Math.cos(r.z * 0.18 + f.t * 0.45) * focal * 0.08;

      var near = M.clamp(1 - r.z / CONFIG.farZ, 0, 1);
      var alpha = 0.15 + near * 0.8;
      var hue = f.hue + r.z * 9 + near * 40;

      c.strokeStyle = M.hsl(hue, 90, 55 + near * 18, alpha);
      c.lineWidth = 1.5 + near * 3.5;

      c.beginPath();
      c.arc(cx + twist, cy + sway, radius,
            r.gap + CONFIG.gapWidth * 0.5,
            r.gap - CONFIG.gapWidth * 0.5 + TAU);
      c.stroke();
    }

    drawShip(f, cx, cy, focal);
  }

  /**
   * @brief 自機を描く。
   * @private
   * @param {Object} f フレーム文脈
   * @param {number} cx 画面中心 x
   * @param {number} cy 画面中心 y
   * @param {number} focal 焦点距離
   * @returns {void}
   */
  function drawShip(f, cx, cy, focal) {
    var c = f.ctx;
    var radius = focal / CONFIG.shipZ * 0.82;
    var x = cx + Math.cos(state.angle) * radius;
    var y = cy + Math.sin(state.angle) * radius;

    // 衝突直後は赤く点滅させ、何が起きたかを一目で分かるようにする。
    var hurt = M.clamp(1 - state.sinceHit * 2.2, 0, 1);
    var hue = M.lerp(f.hue + 150, 0, hurt);
    var size = 14 + f.kick * 6;

    c.save();
    c.globalCompositeOperation = 'lighter';

    // 自機の軌跡。円周上をどう動いたかが残り、自分が動かしている実感を与える。
    c.strokeStyle = M.hsl(hue, 100, 65, 0.28);
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, cy, radius, state.angle - 0.45, state.angle);
    c.stroke();

    // 後光。小さな三角形だけだと背景のリングに埋もれるため。
    var glow = c.createRadialGradient(x, y, 0, x, y, size * 2.6);
    glow.addColorStop(0, M.hsl(hue, 100, 72, 0.55));
    glow.addColorStop(1, M.hsl(hue, 100, 72, 0));
    c.fillStyle = glow;
    c.beginPath();
    c.arc(x, y, size * 2.6, 0, TAU);
    c.fill();

    c.translate(x, y);
    c.rotate(state.angle + Math.PI / 2);

    c.fillStyle = M.hsl(hue, 100, 78, 0.95);
    c.beginPath();
    c.moveTo(0, -size);
    c.lineTo(size * 0.72, size * 0.72);
    c.lineTo(0, size * 0.28);
    c.lineTo(-size * 0.72, size * 0.72);
    c.closePath();
    c.fill();

    // 白い芯を入れて、色が変わっても常に視認できるようにする。
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.beginPath();
    c.moveTo(0, -size * 0.45);
    c.lineTo(size * 0.26, size * 0.3);
    c.lineTo(-size * 0.26, size * 0.3);
    c.closePath();
    c.fill();

    c.restore();
    c.globalCompositeOperation = 'source-over';
  }

  global.PULSAR.game = {
    CONFIG: CONFIG,
    state: state,
    reset: reset,
    update: update,
    draw: draw
  };
})(typeof window !== 'undefined' ? window : this);
