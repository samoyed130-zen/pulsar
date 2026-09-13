/**
 * @file mathx.js
 * @brief 描画や音から切り離した純粋関数だけを集めたモジュール。
 *
 * Canvas や AudioContext に触れる処理はテストが難しいため、
 * 判定・補間・時間計算といった「答えが一意に決まる処理」は全てここへ集約し、
 * `test.html` から単体テストで検証する。
 *
 * 角度の単位は全てラジアン。時刻の単位は全て秒。
 */
(function (global) {
  'use strict';

  /** @brief 円周（2π）。角度の正規化で頻出するため定数化する。 */
  var TAU = Math.PI * 2;

  /**
   * @brief 値を指定範囲へ収める。
   * @param {number} v  入力値
   * @param {number} lo 下限（含む）
   * @param {number} hi 上限（含む）
   * @returns {number} lo 以上 hi 以下に丸めた値
   */
  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  /**
   * @brief 線形補間。
   * @param {number} a 始点
   * @param {number} b 終点
   * @param {number} t 位置 [0..1]（範囲外も許容し、そのまま外挿する）
   * @returns {number} 補間値
   */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * @brief 現在値を目標値へ、フレームレートに依存しない速さで近づける。
   *
   * 単純な `v += (target - v) * k` は fps によって追従速度が変わってしまうため、
   * 経過時間を指数に入れて補正する。
   *
   * @param {number} current 現在値
   * @param {number} target  目標値
   * @param {number} rate    追従の速さ（1秒あたりの減衰係数。大きいほど速い）
   * @param {number} dt      経過時間 [s]
   * @returns {number} 更新後の値
   */
  function approach(current, target, rate, dt) {
    var k = 1 - Math.exp(-rate * dt);
    return current + (target - current) * k;
  }

  /**
   * @brief 角度を [0, 2π) へ正規化する。
   * @param {number} rad 角度 [rad]（負値・2π 超えも可）
   * @returns {number} [0, 2π) に収めた角度 [rad]
   */
  function wrapAngle(rad) {
    var a = rad % TAU;
    if (a < 0) a += TAU;
    // 負の極小値が丸めで TAU になる場合があるため、開区間を保証する。
    return a === TAU ? 0 : a;
  }

  /**
   * @brief 2つの角度の最短距離を求める。
   *
   * 0 と 2π をまたぐ場合（例: 0.1 と 6.2）に大きな値を返さないことが要点。
   *
   * @param {number} a 角度 [rad]
   * @param {number} b 角度 [rad]
   * @returns {number} 最短角距離 [0..π]
   */
  function angleDist(a, b) {
    var d = wrapAngle(a - b);
    return d > Math.PI ? TAU - d : d;
  }

  /**
   * @brief 自機がリングの切れ目を通過できるか判定する。
   * @param {number} shipAngle 自機の角度 [rad]
   * @param {number} gapCenter 切れ目の中心角 [rad]
   * @param {number} gapWidth  切れ目の開き角 [rad]（全幅。中心から左右に半分ずつ）
   * @returns {boolean} 通過できるなら true。ちょうど端の場合も通過とみなす
   */
  function canPass(shipAngle, gapCenter, gapWidth) {
    return angleDist(shipAngle, gapCenter) <= gapWidth * 0.5;
  }

  /**
   * @brief 走行距離を表示用スコアへ変換する。
   * @param {number} distance 走行距離（内部単位）
   * @returns {number} 0 以上の整数スコア（距離に対し単調非減少）
   */
  function scoreFromDistance(distance) {
    return Math.max(0, Math.floor(distance));
  }

  /**
   * @brief BPM と経過時刻から、何拍目かを求める。
   * @param {number} bpm 1分あたりの拍数
   * @param {number} t   経過時刻 [s]（0 以上）
   * @returns {number} 0 から始まる拍番号（整数）
   */
  function beatAt(bpm, t) {
    return Math.floor(t * bpm / 60);
  }

  /**
   * @brief 拍の中の位置（0=拍の頭, 1=次の拍の直前）を求める。
   * @param {number} bpm 1分あたりの拍数
   * @param {number} t   経過時刻 [s]
   * @returns {number} 拍内位相 [0..1)
   */
  function beatPhase(bpm, t) {
    var beats = t * bpm / 60;
    return beats - Math.floor(beats);
  }

  /**
   * @brief 再生時刻から、今どのシーンを表示すべきかを求める。
   *
   * 尺の合計を超えた時刻は先頭へ巻き戻す（デモは無限ループする）。
   *
   * @param {Array<{name: string, duration: number}>} timeline シーンの並び。duration は秒
   * @param {number} t 再生開始からの経過時刻 [s]
   * @returns {{index: number, local: number, progress: number}}
   *          index=シーン番号, local=そのシーン内の経過秒, progress=シーン内の進行度 [0..1)
   * @throws {Error} timeline が空、または尺の合計が 0 以下の場合
   */
  function pickScene(timeline, t) {
    if (!timeline || timeline.length === 0) {
      throw new Error('pickScene: timeline が空です');
    }

    var total = 0;
    for (var i = 0; i < timeline.length; i++) total += timeline[i].duration;
    if (total <= 0) throw new Error('pickScene: 尺の合計が 0 以下です');

    var tt = t % total;
    if (tt < 0) tt += total;

    for (var j = 0; j < timeline.length; j++) {
      var d = timeline[j].duration;
      if (tt < d) {
        return { index: j, local: tt, progress: d > 0 ? tt / d : 0 };
      }
      tt -= d;
    }

    // 浮動小数の丸めで抜けた場合の保険。最後のシーンの末尾として扱う。
    var last = timeline.length - 1;
    return { index: last, local: timeline[last].duration, progress: 1 };
  }

  /**
   * @brief シーンの切り替わり際に 1 へ近づく値を返す（遷移演出の強さに使う）。
   * @param {number} local    シーン内の経過秒 [s]
   * @param {number} duration シーンの尺 [s]
   * @param {number} fade     遷移にかける秒数 [s]
   * @returns {number} 入り際と出際で 1、中央で 0 になる値 [0..1]
   */
  function edgeFade(local, duration, fade) {
    if (fade <= 0) return 0;
    var inAmt = clamp(1 - local / fade, 0, 1);
    var outAmt = clamp(1 - (duration - local) / fade, 0, 1);
    return Math.max(inAmt, outAmt);
  }

  /**
   * @brief 3次のイージング。遷移を機械的に見せないために使う。
   * @param {number} t 入力 [0..1]
   * @returns {number} 出力 [0..1]
   */
  function easeInOut(t) {
    var x = clamp(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  /**
   * @brief HSL 文字列を組み立てる。色相は自動で [0,360) へ丸める。
   * @param {number} h 色相 [deg]（範囲外可）
   * @param {number} s 彩度 [%]
   * @param {number} l 明度 [%]
   * @param {number} [a=1] 不透明度 [0..1]
   * @returns {string} CSS の色指定文字列
   */
  function hsl(h, s, l, a) {
    var hh = ((h % 360) + 360) % 360;
    var aa = (a === undefined) ? 1 : clamp(a, 0, 1);
    return 'hsla(' + hh.toFixed(1) + ',' + s.toFixed(1) + '%,' + l.toFixed(1) + '%,' + aa.toFixed(3) + ')';
  }

  global.PULSAR = global.PULSAR || {};
  global.PULSAR.mathx = {
    TAU: TAU,
    clamp: clamp,
    lerp: lerp,
    approach: approach,
    wrapAngle: wrapAngle,
    angleDist: angleDist,
    canPass: canPass,
    scoreFromDistance: scoreFromDistance,
    beatAt: beatAt,
    beatPhase: beatPhase,
    pickScene: pickScene,
    edgeFade: edgeFade,
    easeInOut: easeInOut,
    hsl: hsl
  };
})(typeof window !== 'undefined' ? window : this);
