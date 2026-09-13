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
    farZ: 26,
    /**
     * @brief リングの間隔（内部単位）。
     *
     * 速度で割ると「何秒に1枚来るか」になる。初速では約0.75秒、
     * 最高速でも約0.46秒。これより詰めると反応する時間が無くなる。
     */
    spacing: 3.0,
    /**
     * @brief ゲージが空のときの速度（1秒あたりの距離）。
     *
     * 遅い。繋がり始めるまでは落ち着いて狙いを定められる。
     */
    baseSpeed: 2.6,
    /** @brief 速度がゲージに追従する速さ。急変させず、加速を体で感じさせる。 */
    speedRate: 1.6,
    /** @brief 透視投影の焦点距離。画面短辺に対する比率。 */
    focal: 0.62,
    /*
     * 切れ目の広さ・ずれ幅・立体の間隔・最高速はステージごとに変わるため、
     * ここではなく `stageParams()` が持つ。値の置き場所を1つにしておかないと、
     * どちらが効いているのか分からなくなる。
     */

    /** @brief 衝突直後、判定を止める時間 [s]。連続で轢かれるのを防ぐ。 */
    graceSeconds: 0.7,
    /** @brief 自機が置かれる奥行き（この位置を通過するリングと判定する）。 */
    shipZ: 1.1,
    /** @brief キー操作時の角速度 [rad/s]。 */
    keyTurnRate: 3.4,
    /** @brief 自動操縦が切れ目へ向かう追従の速さ。 */
    autoRate: 4.5,
    /** @brief 手動操作の追従の速さ。自動より機敏にする。 */
    manualRate: 14.0,
    /** @brief 自機を置く円の半径（リング半径に対する比率）。 */
    shipRadiusRatio: 0.5,
    /** @brief リングの線の太さの倍率。避ける対象として目立たせる。 */
    ringThickness: 3,
    /**
     * @brief 手前のリングをどれだけ余分に広げるか。
     *
     * 透視投影だけでも手前は大きくなるが、くぐる瞬間に視界の外まで
     * 開いた方が「通り抜けた」感じが出る。0 で透視投影どおり。
     */
    ringNearBoost: 1.2,
    /**
     * @brief 手前のリングをどれだけ余分に太くするか。
     *
     * 近さの2乗に掛かる。遠くでは細い線のまま、くぐる直前だけ太くなる。
     */
    ringNearThickness: 6.5,
    /** @brief コンボゲージが満タンになる連続通過数。 */
    comboForMax: 20,
    /** @brief 1つのステージの持ち時間 [s]。 */
    sessionSeconds: 120,

    /** @brief ステージ数。 */
    stageCount: 6,
    /** @brief 1ステージを抜けるのに必要な走行距離。 */
    stageDistance: 1000,

    /** @brief 立体を置く円の半径（トンネル半径を 1 とする）。 */
    itemOrbit: 0.52,
    /** @brief 立体に触れたとみなす角度の幅 [rad]。 */
    itemCatchAngle: 0.62,
    /** @brief 取ったときに延びる時間 [s]。 */
    itemBonusSeconds: 5,
    /**
     * @brief 持ち時間の上限 [s]。
     *
     * 取り続ければ無限に遊べてしまうため、上限を設ける。
     * 初期値より少しだけ高くして、貯金できる余地を残す。
     */
    maxSeconds: 150
  };

  /**
   * @brief ステージごとの難しさ。
   *
   * 段階を追って次のように変える:
   * - 通り抜ける切れ目を狭くする
   * - 隣り合う切れ目のずれを大きくし、より大きく回り込ませる
   * - 時間を延ばす立体の間隔を広げ、拾える機会を減らす
   * - 最高速を上げる
   *
   * どれか1つだけを強めると理不尽になりやすいので、少しずつ同時に動かす。
   *
   * @param {number} stage ステージ番号（1 から始まる）
   * @returns {{gapWidth: number, gapDrift: number, itemPeriod: number, maxSpeed: number}}
   */
  function stageParams(stage) {
    var last = Math.max(1, CONFIG.stageCount - 1);
    var t = M.clamp((stage - 1) / last, 0, 1);

    return {
      gapWidth: M.lerp(1.95, 1.15, t),
      gapDrift: M.lerp(0.6, 1.05, t),
      itemPeriod: M.lerp(4.6, 9.5, t),
      maxSpeed: M.lerp(6.4, 8.8, t)
    };
  }

  /**
   * @brief 走行状態。
   *
   * `started` は最初の操作で立ち、そこから持ち時間の消費が始まる。
   * `finished` が立つと判定を止め、絵だけが流れ続ける（デモを止めないため）。
   */
  var state = {
    /** @brief 自機の角度 [rad]。 */
    angle: 0,
    /** @brief 走行距離（内部単位）。 */
    dist: 0,
    /** @brief 現在の速度。 */
    speed: CONFIG.baseSpeed,
    /** @brief リングの一覧。 */
    rings: [],
    /** @brief 表示用スコア（距離の整数化）。 */
    score: 0,
    /** @brief 直近の衝突からの経過時間 [s]。 */
    sinceHit: 99,
    /** @brief 連続通過数。衝突で 0 に戻る。 */
    combo: 0,
    /** @brief この挑戦での最大コンボ。 */
    maxCombo: 0,
    /** @brief 通過した総リング数。 */
    passed: 0,
    /** @brief 衝突した回数。 */
    hits: 0,
    /** @brief 挑戦が始まっているか。 */
    started: false,
    /** @brief 持ち時間を使い切ったか。 */
    finished: false,
    /** @brief 残り時間 [s]。 */
    timeLeft: CONFIG.sessionSeconds,
    /** @brief 時間を延ばす立体の一覧。 */
    items: [],
    /** @brief 取った立体の数。 */
    collected: 0,
    /** @brief 立体で延ばした合計時間 [s]。 */
    timeGained: 0,
    /** @brief 取った直後の演出用の値 [0..1]。時間とともに減る。 */
    collectFlash: 0,

    /** @brief 現在のステージ番号（1 から始まる）。 */
    stage: 1,
    /** @brief 現在のステージに入った時点の走行距離。 */
    stageStartDist: 0,
    /** @brief 現在のステージの難しさ。 */
    params: stageParams(1),
    /** @brief 全ステージを抜けたか。 */
    cleared: false,
    /** @brief ステージが変わった直後の演出用の値 [0..1]。 */
    stageFlash: 0,
    /** @brief 開放済みの最大ステージ番号。端末に保存される。 */
    unlocked: 1
  };

  /**
   * @brief どのステージまで開放されているかを読み出す。
   *
   * 一度抜けたステージは、次回以降そこから始められる。長い作品を
   * 毎回最初からやり直させると、先の景色にたどり着けないため。
   *
   * @private
   * @returns {number} 開放済みの最大ステージ番号（最低 1）
   */
  function loadUnlocked() {
    try {
      var v = parseInt(global.localStorage.getItem('pulsar.unlocked'), 10);
      if (isNaN(v)) return 1;
      return M.clamp(v, 1, CONFIG.stageCount);
    } catch (e) {
      return 1;
    }
  }

  /**
   * @brief 開放済みステージを保存する。失敗しても無視する。
   * @private
   * @param {number} v 開放済みの最大ステージ番号
   * @returns {void}
   */
  function saveUnlocked(v) {
    try {
      global.localStorage.setItem('pulsar.unlocked', String(v));
    } catch (e) { /* 保存できなくても遊べる */ }
  }

  /**
   * @brief 開放済みの最大ステージ番号。
   * @returns {number} 1 以上 stageCount 以下
   */
  function unlockedStage() {
    return state.unlocked;
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
    var delta = (Math.random() - 0.5) * 2 * state.params.gapDrift;
    return { z: z, gap: M.wrapAngle(prevGap + delta), judged: false };
  }

  /**
   * @brief 時間を延ばす立体を1つ作る。
   *
   * 置く角度は、その位置にあるリングの切れ目の近くを狙う。
   * 切れ目を通る動きと、立体を取る動きが噛み合い、
   * 「避けながら拾う」1つの流れになる。
   *
   * @private
   * @param {number} z 生成位置の奥行き
   * @returns {{z: number, angle: number, judged: boolean, taken: boolean}}
   */
  function makeItem(z) {
    var near = null;
    for (var i = 0; i < state.rings.length; i++) {
      var r = state.rings[i];
      if (near === null || Math.abs(r.z - z) < Math.abs(near.z - z)) near = r;
    }

    var base = near ? near.gap : Math.random() * TAU;
    return {
      z: z,
      angle: M.wrapAngle(base + (Math.random() - 0.5) * 1.2),
      judged: false,
      taken: false
    };
  }

  /**
   * @brief 走行状態を初期化する。
   * @returns {void}
   */
  /**
   * @brief 現在のステージの難しさでコースを敷き直す。
   *
   * ステージが変わるたびに呼ぶ。距離や記録はそのまま引き継ぐ。
   *
   * @private
   * @returns {void}
   */
  function buildCourse() {
    state.rings = [];
    state.items = [];

    // 最初のリングは自機の正面に切れ目を置く。切り替わった直後に
    // いきなり轢かれると、腕前ではなく運の問題になってしまう。
    var gap = state.angle;
    for (var z = CONFIG.shipZ + 4; z < CONFIG.farZ; z += CONFIG.spacing) {
      state.rings.push({ z: z, gap: gap, judged: false });
      gap = M.wrapAngle(gap + (Math.random() - 0.5) * 2 * state.params.gapDrift);
    }

    for (var iz = CONFIG.shipZ + 6; iz < CONFIG.farZ; iz += state.params.itemPeriod) {
      state.items.push(makeItem(iz));
    }
  }

  /**
   * @brief 次のステージへ進む。最後のステージを抜けたら踏破とする。
   *
   * @private
   * @returns {void}
   */
  function advanceStage() {
    if (state.stage >= CONFIG.stageCount) {
      state.cleared = true;
      state.finished = true;
      unlock(CONFIG.stageCount);
      return;
    }

    state.stage++;
    unlock(state.stage);
    state.stageStartDist = state.dist;
    state.params = stageParams(state.stage);
    state.stageFlash = 1;

    // 持ち時間は次のステージ分だけ戻す。拾って貯めた分は引き継がない。
    state.timeLeft = CONFIG.sessionSeconds;
    state.combo = 0;

    buildCourse();
  }

  /**
   * @brief ステージを開放し、保存する。すでに先まで開放済みなら何もしない。
   *
   * @private
   * @param {number} n 開放するステージ番号
   * @returns {void}
   */
  function unlock(n) {
    var v = M.clamp(Math.floor(n), 1, CONFIG.stageCount);
    if (v <= state.unlocked) return;
    state.unlocked = v;
    saveUnlocked(v);
  }

  /**
   * @brief 現在のステージの進み具合。
   * @returns {number} 0（入ったところ）〜1（抜ける直前）
   */
  function stageProgress() {
    return M.clamp((state.dist - state.stageStartDist) / CONFIG.stageDistance, 0, 1);
  }

  /**
   * @brief 走行状態を初期化する。
   * @param {number} [startStage=1] 始めるステージ番号。開放済みの範囲へ丸める
   * @returns {void}
   */
  function reset(startStage) {
    state.angle = 0;
    state.dist = 0;
    state.speed = CONFIG.baseSpeed;
    state.rings = [];
    state.score = 0;
    state.sinceHit = 99;
    state.combo = 0;
    state.maxCombo = 0;
    state.passed = 0;
    state.hits = 0;
    state.started = false;
    state.finished = false;
    state.timeLeft = CONFIG.sessionSeconds;

    state.items = [];
    state.collected = 0;
    state.timeGained = 0;
    state.collectFlash = 0;

    state.unlocked = loadUnlocked();

    // 開放していないステージからは始められない。
    state.stage = M.clamp(Math.floor(startStage || 1), 1, state.unlocked);
    state.stageStartDist = 0;
    state.params = stageParams(state.stage);
    state.cleared = false;
    state.stageFlash = 0;

    buildCourse();
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

    // 最初の操作で挑戦が始まる。触れられるまでは持ち時間を減らさない。
    if (!state.started && f.pointer.everTouched) state.started = true;

    if (state.started && !state.finished) {
      state.timeLeft = Math.max(0, state.timeLeft - dt);
      if (state.timeLeft === 0) state.finished = true;
    }

    state.stageFlash = M.approach(state.stageFlash, 0, 2.2, dt);

    // 速度はコンボゲージに従う。繋げば速くなり、ぶつかれば元の速さへ戻る。
    // 「上手くなるほど手強くなる」関係を、時間経過ではなく腕前に結びつける。
    var wanted = M.lerp(CONFIG.baseSpeed, state.params.maxSpeed, gauge());
    state.speed = M.approach(state.speed, wanted, CONFIG.speedRate, dt);
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
      // 持ち時間を使い切った後は判定しない。絵としては走り続ける。
      if (!r.judged && r.z <= CONFIG.shipZ) {
        r.judged = true;
        if (state.finished) continue;

        if (M.canPass(state.angle, r.gap, state.params.gapWidth)) {
          state.combo++;
          state.passed++;
          if (state.combo > state.maxCombo) state.maxCombo = state.combo;
        } else if (state.sinceHit >= CONFIG.graceSeconds) {
          // 衝突直後は判定を止める。立て直す間もなく次に轢かれると理不尽に感じるため。
          f.impact(1);
          state.sinceHit = 0;
          state.combo = 0;
          state.hits++;
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

    updateItems(f, dt);

    // 規定の距離を走り抜けたら次のステージへ。
    if (state.started && !state.finished &&
        state.dist - state.stageStartDist >= CONFIG.stageDistance) {
      advanceStage();
    }

    state.score = M.scoreFromDistance(state.dist);
  }

  /**
   * @brief 時間を延ばす立体を動かし、取得を判定する。
   *
   * @private
   * @param {Object} f フレーム文脈
   * @param {number} dt 経過時間 [s]
   * @returns {void}
   */
  function updateItems(f, dt) {
    state.collectFlash = M.approach(state.collectFlash, 0, 5, dt);

    var farthest = -Infinity;
    var i;
    for (i = 0; i < state.items.length; i++) {
      if (state.items[i].z > farthest) farthest = state.items[i].z;
    }

    for (i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      it.z -= state.speed * dt;

      // 自機の位置を通過する瞬間に一度だけ判定する。
      if (!it.judged && it.z <= CONFIG.shipZ) {
        it.judged = true;

        if (M.angleDist(state.angle, it.angle) <= CONFIG.itemCatchAngle) {
          // 重なれば、いつでも取得として扱う。自動操縦で流れている最中に
          // すり抜けてしまうと、拾える物だと伝わらないため。
          it.taken = true;
          state.collectFlash = 1;

          // 記録と持ち時間が動くのは、挑戦が始まっている間だけ。
          if (state.started && !state.finished) {
            state.collected++;

            // 上限を超えない範囲で時間を足す。実際に増えた分だけを記録する。
            var before = state.timeLeft;
            state.timeLeft = Math.min(CONFIG.maxSeconds,
                                      state.timeLeft + CONFIG.itemBonusSeconds);
            state.timeGained += state.timeLeft - before;
          }
        }
      }

      // 通り過ぎたら奥へ戻して使い回す。
      if (it.z < -1.5) {
        farthest += state.params.itemPeriod;
        var fresh = makeItem(farthest);
        it.z = fresh.z;
        it.angle = fresh.angle;
        it.judged = false;
        it.taken = false;
      }
    }
  }

  /**
   * @brief コンボゲージの溜まり具合を返す。
   *
   * 音の層と画面の明るさがこの値に従うため、遊び手は「溜まっている」ことを
   * 数字ではなく音の厚みで感じ取れる。
   *
   * @returns {number} 0（空）〜1（満タン）
   */
  function gauge() {
    return M.clamp(state.combo / CONFIG.comboForMax, 0, 1);
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

      var near = M.clamp(1 - r.z / CONFIG.farZ, 0, 1);

      // 透視投影だけでも手前ほど大きくなるが、それに加えて近いリングを
      // 広げる。くぐる瞬間に視界の外まで開くことで、通り抜けた感じが出る。
      var radius = focal / r.z * (1 + CONFIG.ringNearBoost * near * near);
      if (radius > Math.max(f.W, f.H) * 2.4) continue;

      // 奥行きに応じてトンネル全体をねじる。直線的に見せないための細工。
      var twist = Math.sin(r.z * 0.22 + f.t * 0.6) * focal * 0.10;
      var sway = Math.cos(r.z * 0.18 + f.t * 0.45) * focal * 0.08;

      // 奥ほど薄く。2乗で効かせることで、奥のリングが線の重なりとして
      // 溜まらず、いま抜けるべき手前のリングが自然と目に入る。
      var alpha = 0.04 + near * near * 0.92;
      var hue = f.hue + r.z * 9 + near * 40;

      var start = r.gap + state.params.gapWidth * 0.5;
      var end = r.gap - state.params.gapWidth * 0.5 + TAU;
      // 手前ほど太くする。近さの2乗の項を足すことで、遠くでは細い線のまま、
      // くぐる直前だけ急に太くなる。奥行きが線の太さからも読み取れる。
      var width = (1.2 + near * 2.8 + near * near * CONFIG.ringNearThickness) *
                  CONFIG.ringThickness;

      // 太い線の下に、さらに広がる淡い線を敷いて厚みを出す。
      c.strokeStyle = M.hsl(hue, 90, 50, alpha * 0.35);
      c.lineWidth = width * 1.9;
      c.beginPath();
      c.arc(cx + twist, cy + sway, radius, start, end);
      c.stroke();

      c.strokeStyle = M.hsl(hue, 90, 55 + near * 18, alpha);
      c.lineWidth = width;
      c.beginPath();
      c.arc(cx + twist, cy + sway, radius, start, end);
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
    var radius = focal / CONFIG.shipZ * CONFIG.shipRadiusRatio;
    var x = cx + Math.cos(state.angle) * radius;
    var y = cy + Math.sin(state.angle) * radius;

    // 衝突直後は赤く点滅させ、何が起きたかを一目で分かるようにする。
    var hurt = M.clamp(1 - state.sinceHit * 2.2, 0, 1);
    var hue = M.lerp(f.hue + 150, 0, hurt);
    var size = 14 + f.kick * 6;

    c.save();
    c.globalCompositeOperation = 'lighter';

    // 自機の軌跡。円周上をどう動いたかが短く残り、動かしている実感を与える。
    // 長く引くと円周をなぞる輪に見えてしまい、操作の案内と紛らわしい。
    c.strokeStyle = M.hsl(hue, 100, 65, 0.16);
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, radius, state.angle - 0.2, state.angle);
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
    draw: draw,
    gauge: gauge,
    stageParams: stageParams,
    stageProgress: stageProgress,
    unlockedStage: unlockedStage
  };
})(typeof window !== 'undefined' ? window : this);
