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
     * @brief コンボが最大のとき、リングの明度を何割下げるか。
     *
     * 加算で光を重ねると、濃い色ほど先に振り切れて色相が動く。
     * 足す前に下げておくぶん。半分まで下げると、色相のずれは 55 度から
     * 19 度、彩度の落ちは 0.50 から 0.02 まで収まる。下げたぶんは光が
     * 足し返すので、明るさそのものは変わらない。
     *
     * これ以上下げると、光の乗らない奥のリングまで沈んで見えなくなる。
     */
    ringGlowCut: 0.5,
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
     * 繋がり始めるまでは落ち着いて狙いを定められる遅さ。
     * ただし遅すぎると、一度ぶつかっただけで取り返しがつかなくなる。
     */
    baseSpeed: 3.6,
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
    /**
     * @brief 判定を行う奥行き。
     *
     * この位置にあるリングの見かけの大きさが、そのままカーソルの輪の
     * 大きさになる。両者が画面上でぴったり重なった瞬間に通過を判定するので、
     * 「輪に入っているのに当たった」という食い違いが起きない。
     */
    shipZ: 4.15,
    /** @brief キー操作時の角速度 [rad/s]（押し続けたときの最大）。 */
    keyTurnRate: 3.4,
    /** @brief 押し始めの速さの割合。小さいほど、軽く叩いたときの動きが小さい。 */
    keyRampStart: 0.25,
    /** @brief 最大の速さに達するまでの時間 [s]。 */
    keyRampTime: 0.45,
    /** @brief 自動操縦が切れ目へ向かう追従の速さ。 */
    autoRate: 4.5,
    /** @brief 手動操作の追従の速さ。自動より機敏にする。 */
    manualRate: 14.0,
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
    ringNearThickness: 5.2,
    /**
     * @brief 線の太さの基準となる画面の短辺 [px]。
     *
     * これより小さい画面では、太さもその比で細くする。輪の半径は画面に
     * 比例するのに太さだけ据え置くと、小さい画面で輪が潰れて見える。
     */
    ringRefSize: 800,
    /** @brief コンボゲージが満タンになる連続通過数。 */
    comboForMax: 20,
    /** @brief 1つのステージの持ち時間 [s]。 */
    sessionSeconds: 120,

    /** @brief ステージ数。 */
    stageCount: 6,
    /**
     * @brief 1ステージを抜けるのに必要な走行距離。
     *
     * 持ち時間・速度と噛み合っていないと、上手い人しか先へ進めない。
     * 実際に模擬して決めた値（下の `baseSpeed` も同じ）。
     */
    stageDistance: 800,

    /**
     * @brief 立方体に触れたとみなす角度の幅 [rad]。
     *
     * どのステージでも切れ目の半分より狭くしておく。そうでないと
     * 通り抜けさえすれば必ず拾えてしまい、狙う意味がなくなる。
     */
    itemCatchAngle: 0.42,
    /**
     * @brief 取ったときに延びる時間 [s]。
     *
     * 立方体は切れ目の端に浮いているので、取りにいくほど当たりやすくなる。
     * 「安全に抜けるか、時間を取りにいくか」が釣り合う程度に留める。
     */
    itemBonusSeconds: 4,
    /**
     * @brief 持ち時間の上限 [s]。
     *
     * 取り続ければ無限に遊べてしまうため、上限を設ける。
     * 初期値より少しだけ高くして、貯金できる余地を残す。
     */
    maxSeconds: 150
  };

  /**
   * @brief 自機の追従速度の倍率。遊ぶ人の好みで選べるようにする。
   *
   * 指を動かした量に対して自機がどれだけ機敏に追うか。
   * 細かく狙いたい人は遅く、素早く振りたい人は速くする。
   */
  var SENSITIVITY_STEPS = [0.25, 0.5, 1, 2, 4];

  /** @brief 現在の倍率。既定は等倍。 @private */
  var sensitivity = 1;

  /**
   * @brief 追従速度の倍率を設定し、端末に覚えさせる。
   * @param {number} v 倍率。用意した段階のいずれか
   * @returns {void}
   */
  function setSensitivity(v) {
    var best = SENSITIVITY_STEPS[0];
    for (var i = 0; i < SENSITIVITY_STEPS.length; i++) {
      // 指定された値に最も近い段階を選ぶ（範囲外でも壊れない）
      if (Math.abs(SENSITIVITY_STEPS[i] - v) < Math.abs(best - v)) {
        best = SENSITIVITY_STEPS[i];
      }
    }
    sensitivity = best;
    global.PULSAR.store.set('pulsar.sens', String(best));
  }

  /**
   * @brief 現在の追従速度の倍率。
   * @returns {number} 倍率
   */
  function getSensitivity() {
    return sensitivity;
  }

  // 前回の選択を復元する。
  var saved = parseFloat(global.PULSAR.store.get('pulsar.sens'));
  if (!isNaN(saved)) setSensitivity(saved);

  /**
   * @brief カーソルのガイド輪を常に出すか。
   *
   * 既定は切。常に出ていると輪が二重に見えて、くぐるべきリングと
   * 紛らわしい。走り始めの数秒だけは出して自然に消えるので、
   * 「この円の上を動く」ことは切っていても伝わる。
   * @private
   */
  var guideOn = false;

  /** @brief 実際に描くときの濃さ [0..1]。設定の切り替えに滑らかに追従する。 @private */
  var guideAlpha = 0;

  /**
   * @brief ガイド輪を常に出すかを設定し、端末に覚えさせる。
   * @param {boolean} on 出すなら true
   * @returns {void}
   */
  function setGuide(on) {
    guideOn = !!on;
    global.PULSAR.store.set('pulsar.guide', guideOn ? '1' : '0');
  }

  /**
   * @brief ガイド輪を常に出す設定か。
   * @returns {boolean} 出すなら true
   */
  function isGuide() {
    return guideOn;
  }

  // 前回の選択を復元する。入れた人だけが '1' を持っている。
  if (global.PULSAR.store.get('pulsar.guide') === '1') {
    guideOn = true;
    guideAlpha = 1;
  }

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
      itemPeriod: M.lerp(46, 95, t),
      // 最高速を保てば、時間延長を当てにしなくても時間内に抜けられる速さ。
      // 立方体は数が少ないので、拾えることを前提にすると詰みやすい。
      maxSpeed: M.lerp(7.0, 9.2, t)
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
    /** @brief 直近の衝突からの経過時間 [s]。 */
    sinceHit: 99,
    /** @brief 左右キーを押し続けている時間 [s]。離すと 0 に戻る。 */
    keyHold: 0,
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
    /** @brief 次に立方体を連れさせるまでに置いたリングの枚数。 */
    ringsSincePlaced: 0,
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
    var v = parseInt(global.PULSAR.store.get('pulsar.unlocked'), 10);
    if (isNaN(v)) return 1;
    return M.clamp(v, 1, CONFIG.stageCount);
  }

  /**
   * @brief 開放済みステージを保存する。失敗しても無視する。
   * @private
   * @param {number} v 開放済みの最大ステージ番号
   * @returns {void}
   */
  function saveUnlocked(v) {
    global.PULSAR.store.set('pulsar.unlocked', String(v));
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
    return {
      z: z,
      gap: M.wrapAngle(prevGap + delta),
      judged: false,
      item: false,      // 時間を延ばす立方体を連れているか
      itemAngle: 0,
      itemTaken: false
    };
  }

  /**
   * @brief リングに立方体を持たせ、置く角度を決める。
   *
   * 切れ目の中では端寄りに置く。中心に置くと、安全な線を通るだけで
   * 勝手に拾えてしまい、狙う意味がなくなる。端に寄せることで
   * 「安全に抜けるか、時間を取りにいくか」の選択が生まれる。
   *
   * @private
   * @param {Object} r 対象のリング
   * @returns {void}
   */
  function placeItem(r) {
    var half = state.params.gapWidth * 0.5;

    // 切れ目の幅に比例して端へ寄せる。中心から取得範囲より遠い位置に
    // 置かないと、真ん中を通るだけで勝手に拾えてしまう。
    var offset = half * 0.8;
    var side = Math.random() < 0.5 ? -1 : 1;

    r.item = true;
    r.itemTaken = false;
    r.itemAngle = M.wrapAngle(r.gap + side * offset);
  }

  /**
   * @brief 何枚おきに立方体を連れたリングを置くか。
   * @private
   * @returns {number} 枚数（1 以上）
   */
  function ringsPerItem() {
    return Math.max(1, Math.round(state.params.itemPeriod / CONFIG.spacing));
  }

  /**
   * @brief 立方体を取ったときの処理。
   *
   * 記録と持ち時間が動くのは挑戦中だけ。自動操縦で流れている間は
   * 見た目だけ反応させ、数値は変えない。
   *
   * @private
   * @param {Object} r 立方体を連れているリング
   * @returns {void}
   */
  function takeItem(r) {
    r.itemTaken = true;
    state.collectFlash = 1;

    // 拾った手応えは、目と耳の両方で返す。
    if (global.PULSAR.sound && global.PULSAR.sound.playPickup) {
      global.PULSAR.sound.playPickup();
    }

    if (!state.started || state.finished) return;

    state.collected++;

    // 上限を超えない範囲で時間を足す。実際に増えた分だけを記録する。
    var before = state.timeLeft;
    state.timeLeft = Math.min(CONFIG.maxSeconds, state.timeLeft + CONFIG.itemBonusSeconds);
    state.timeGained += state.timeLeft - before;
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
    state.ringsSincePlaced = 0;

    // 最初のリングは自機の正面に切れ目を置く。切り替わった直後に
    // いきなり轢かれると、腕前ではなく運の問題になってしまう。
    var gap = state.angle;
    var n = 0;

    for (var z = CONFIG.shipZ + 4; z < CONFIG.farZ; z += CONFIG.spacing) {
      var r = makeRing(z, gap);
      r.gap = gap;

      // 立方体はリングに連れさせる。別々に流すと速さも位置もばらばらで、
      // 「あの切れ目を通れば拾える」という読みが立たない。
      n++;
      if (n % ringsPerItem() === 0) placeItem(r);

      state.rings.push(r);
      gap = M.wrapAngle(gap + (Math.random() - 0.5) * 2 * state.params.gapDrift);
    }

    state.ringsSincePlaced = n % ringsPerItem();
  }

  /**
   * @brief 次のステージへ進む。最後のステージを抜けたら踏破とする。
   *
   * @private
   * @returns {void}
   */
  function advanceStage() {
    if (state.stage >= CONFIG.stageCount) return;

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
   * @brief 全ステージ踏破として終了する。
   * @returns {void}
   */
  function completeGame() {
    state.cleared = true;
    state.finished = true;
    unlock(CONFIG.stageCount);
  }

  /**
   * @brief 今のステージを抜ける距離に達しているか。
   *
   * 到達しても自動では進めない。祝いの表示を挟んでから切り替えたいので、
   * 進めるかどうかの判断は呼び出し側（`main.js`）に任せる。
   *
   * @returns {boolean} 抜ける条件を満たしていれば true
   */
  function goalReached() {
    return state.started && !state.finished &&
           (state.dist - state.stageStartDist) >= CONFIG.stageDistance;
  }

  /**
   * @brief 今が最後のステージか。
   * @returns {boolean} 最終ステージなら true
   */
  function isLastStage() {
    return state.stage >= CONFIG.stageCount;
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
    state.sinceHit = 99;
    state.combo = 0;
    state.maxCombo = 0;
    state.passed = 0;
    state.hits = 0;
    state.started = false;
    state.finished = false;
    state.timeLeft = CONFIG.sessionSeconds;

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
      // キーは「毎秒この角度だけ回す」という速度として扱う。
      //
      // 目標角を一定量だけ先へ置く方式にすると、感度を上げたときに
      // 1フレームの差が π を超え、最短で回る計算が逆向きを選んで
      // 半周してしまう。経過時間を掛けて回せば、その事故が起きない。
      //
      // さらに、押し始めは遅く、押し続けるほど速くする。
      // 最初から全速だと、軽く叩いただけで大きく回ってしまう。
      var ramp = Math.min(1, CONFIG.keyRampStart + state.keyHold / CONFIG.keyRampTime);

      // 感度は指の操作のためのもの。キーにそのまま掛けると効きすぎるので、
      // 平方根で穏やかにする（×4 でも 2 倍まで）。
      var keyScale = Math.sqrt(sensitivity);

      return {
        target: M.wrapAngle(state.angle +
                            f.steer * CONFIG.keyTurnRate * keyScale * ramp * f.dt),
        rate: 999   // 目標そのものが毎フレーム進むので、遅れずに追う
      };
    }

    // キーから手を離したら、その場に留まる。
    // ここで指の位置へ戻してしまうと、キーで動かした意味がなくなる。
    if (f.inputMode === 'key') {
      return { target: state.angle, rate: CONFIG.manualRate };
    }

    if (f.pointer.everTouched) {
      var dx = f.pointer.x - f.W / 2;
      var dy = f.pointer.y - f.H / 2;
      if (dx * dx + dy * dy > 64) {
        return {
          target: M.wrapAngle(Math.atan2(dy, dx)),
          rate: CONFIG.manualRate * sensitivity
        };
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

    // キーを押し続けている時間。離した瞬間に 0 へ戻す。
    state.keyHold = (f.steer !== 0) ? state.keyHold + dt : 0;

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

          // 立方体は切れ目の端寄りに浮いている。抜けるだけでは届かず、
          // そちらへ寄せて抜けたときだけ拾える。
          if (r.item && !r.itemTaken &&
              M.angleDist(state.angle, r.itemAngle) <= CONFIG.itemCatchAngle) {
            takeItem(r);
          }
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
        state.rings[k].item = false;
        state.rings[k].itemTaken = false;

        // 一定の枚数ごとに立方体を連れさせる。
        state.ringsSincePlaced++;
        if (state.ringsSincePlaced % ringsPerItem() === 0) placeItem(state.rings[k]);
      }
    }

    state.collectFlash = M.approach(state.collectFlash, 0, 5, dt);
  }


  /**
   * @brief ある奥行きにあるリングの、画面上での半径を返す。
   *
   * 透視投影に加えて、手前ほど余分に広げている。描画と判定で同じ式を
   * 使うために、ここに一本化する。
   *
   * @param {number} z 奥行き
   * @param {number} focal 焦点距離 [px]
   * @returns {number} 画面上の半径 [px]
   */
  function ringRadius(z, focal) {
    var near = M.clamp(1 - z / CONFIG.farZ, 0, 1);
    return focal / z * (1 + CONFIG.ringNearBoost * near * near);
  }

  /**
   * @brief カーソル（自機）が動く円の半径。
   *
   * 判定する奥行きにあるリングと同じ大きさにする。画面の上で
   * ぴったり重なるので、通れるかどうかが見たままになる。
   *
   * @param {number} focal 焦点距離 [px]
   * @returns {number} 画面上の半径 [px]
   */
  function cursorRadius(focal) {
    return ringRadius(CONFIG.shipZ, focal);
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
   * @brief 線の太さや自機の大きさを、画面の大きさに合わせる倍率。
   *
   * リングの半径は画面に比例して小さくなるのに、線の太さを固定にすると
   * 小さい画面では輪が塗り潰れたように見えてしまう。
   *
   * @param {number} minSide 画面の短辺 [px]
   * @returns {number} 倍率 [0.45..1]
   */
  function thinScale(minSide) {
    return M.clamp(minSide / CONFIG.ringRefSize, 0.45, 1);
  }

  /**
   * @brief リングの線の太さを求める。
   *
   * 手前ほど太くする。近さの2乗の項を足すことで、遠くでは細い線のまま、
   * くぐる直前だけ急に太くなる。奥行きが線の太さからも読み取れる。
   *
   * @param {number} near 近さ [0..1]。1 がカメラの位置
   * @param {number} minSide 画面の短辺 [px]
   * @returns {number} 線の太さ [px]
   */
  function ringLineWidth(near, minSide) {
    return (1.2 + near * 2.8 + near * near * CONFIG.ringNearThickness) *
           CONFIG.ringThickness * thinScale(minSide);
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

    var thin = thinScale(Math.min(f.W, f.H));

    /*
     * コンボで光を足すぶん、リング自身の明度を下げておく。
     *
     * リングは彩度 90 で塗っている。そこへ加算で光を重ねると、
     * 3色のうち強い色から先に振り切れ、残った色との釣り合いが崩れて
     * 色相そのものが動いてしまう（青緑が白緑に寄るなど）。
     * 足す前に下げておけば、合計は振り切れず、色が保たれる。
     *
     * 背景は彩度も明度も低いので、この細工は要らない。振り切れるのは
     * もともと濃い色で塗っているリングだけ。
     */
    var glowCut = 1 - (f.glow || 0) * CONFIG.ringGlowCut;

    // 奥から手前へ描くことで、近いリングが上に重なる。
    var sorted = state.rings.slice().sort(function (a, b) { return b.z - a.z; });

    c.lineCap = 'round';

    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      if (r.z <= 0.05) continue;

      var near = M.clamp(1 - r.z / CONFIG.farZ, 0, 1);
      var radius = ringRadius(r.z, focal);
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
      var width = ringLineWidth(near, Math.min(f.W, f.H));

      // 太い線の下に、さらに広がる淡い線を敷いて厚みを出す。
      c.strokeStyle = M.hsl(hue, 90, 50 * glowCut, alpha * 0.35);
      c.lineWidth = width * 1.9;
      c.beginPath();
      c.arc(cx + twist, cy + sway, radius, start, end);
      c.stroke();

      c.strokeStyle = M.hsl(hue, 90, (55 + near * 18) * glowCut, alpha);
      c.lineWidth = width;
      c.beginPath();
      c.arc(cx + twist, cy + sway, radius, start, end);
      c.stroke();
    }

    drawGuide(f, cx, cy, focal, thin);
    drawShip(f, cx, cy, focal, thin);
  }

  /**
   * @brief カーソルが動く円を常に描く。
   *
   * 自分がどの円の上を動いているのか、そしてどのリングと重なった瞬間に
   * 判定されるのかを、いつでも目で確かめられるようにする。
   *
   * @private
   * @param {Object} f フレーム文脈
   * @param {number} cx 画面中心 x
   * @param {number} cy 画面中心 y
   * @param {number} focal 焦点距離
   * @param {number} thin 線の太さの倍率（小さい画面ほど細くする）
   * @returns {void}
   */
  function drawGuide(f, cx, cy, focal, thin) {
    // 常時表示のときは濃く、切っているときは走り始めの案内だけ。
    // 目標へ滑らかに近づけることで、消えかけている最中に切り替えても
    // そこから自然に濃くなる（跳ねない）。
    var target = guideOn ? 1 : (f.guideIntro || 0);
    guideAlpha = M.approach(guideAlpha, target, 4, f.dt || 0);

    if (guideAlpha <= 0.01) return;

    var c = f.ctx;
    var radius = cursorRadius(focal);
    var a = guideAlpha;

    c.save();
    c.globalCompositeOperation = 'lighter';

    // 下地の太い輪と、その上に破線。太さがあると「この線の上を動く」と
    // 分かりやすく、リングと重なる瞬間も掴みやすい。
    c.strokeStyle = 'rgba(150,200,255,' + (a * 0.10).toFixed(3) + ')';
    c.lineWidth = 9 * thin;
    c.beginPath();
    c.arc(cx, cy, radius, 0, TAU);
    c.stroke();

    c.strokeStyle = 'rgba(170,215,255,' + (a * 0.34).toFixed(3) + ')';
    c.lineWidth = 3.5 * thin;
    c.setLineDash([10 * thin, 12 * thin]);
    c.beginPath();
    c.arc(cx, cy, radius, 0, TAU);
    c.stroke();
    c.setLineDash([]);

    c.restore();
    c.globalCompositeOperation = 'source-over';
  }

  /**
   * @brief 自機を描く。
   * @private
   * @param {Object} f フレーム文脈
   * @param {number} cx 画面中心 x
   * @param {number} cy 画面中心 y
   * @param {number} focal 焦点距離
   * @param {number} thin 大きさの倍率（小さい画面ほど小さくする）
   * @returns {void}
   */
  function drawShip(f, cx, cy, focal, thin) {
    var c = f.ctx;
    var radius = cursorRadius(focal);
    var x = cx + Math.cos(state.angle) * radius;
    var y = cy + Math.sin(state.angle) * radius;

    // 衝突直後は赤く点滅させ、何が起きたかを一目で分かるようにする。
    var hurt = M.clamp(1 - state.sinceHit * 2.2, 0, 1);
    var hue = M.lerp(f.hue + 150, 0, hurt);
    // 自機も画面の大きさに合わせる。輪だけ細くすると、今度は自機が
    // 輪からはみ出して見える。
    var size = (14 + f.kick * 6) * thin;

    c.save();
    c.globalCompositeOperation = 'lighter';

    // 自機の軌跡。円周上をどう動いたかが短く残り、動かしている実感を与える。
    // 長く引くと円周をなぞる輪に見えてしまい、操作の案内と紛らわしい。
    c.strokeStyle = M.hsl(hue, 100, 65, 0.16);
    c.lineWidth = 2 * thin;
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
    ringRadius: ringRadius,
    cursorRadius: cursorRadius,
    ringLineWidth: ringLineWidth,
    stageParams: stageParams,
    stageProgress: stageProgress,
    unlockedStage: unlockedStage,
    SENSITIVITY_STEPS: SENSITIVITY_STEPS,
    setSensitivity: setSensitivity,
    getSensitivity: getSensitivity,
    setGuide: setGuide,
    isGuide: isGuide,
    advanceStage: advanceStage,
    completeGame: completeGame,
    goalReached: goalReached,
    isLastStage: isLastStage
  };
})(typeof window !== 'undefined' ? window : this);
