/**
 * @file sound.js
 * @brief Web Audio API だけで曲を合成する簡易シーケンサ。
 *
 * 音源ファイルを一切使わない。理由は2つ:
 * 1. 素材の著作権・ライセンス確認が構造的に不要になる
 * 2. 読み込み待ちが無く、開いた瞬間から鳴らせる
 *
 * 映像側の時計とは独立している。音が鳴らせない環境（自動再生制限、
 * 音声出力なし）でも演出は同じテンポで動く。
 */
(function (global) {
  'use strict';

  /**
   * @brief 曲の設定。
   */
  var CONFIG = {
    /** @brief テンポ [BPM]。`main.js` の CONFIG.bpm と一致させること。 */
    bpm: 126,
    /** @brief 全体音量 [0..1]。初見で驚かせない程度に抑える。 */
    masterGain: 0.22,
    /** @brief 何秒先まで音を予約するか [s]。短すぎると音が途切れる。 */
    lookahead: 0.18,
    /** @brief 予約処理を回す間隔 [ms]。 */
    tickMs: 30
  };

  /**
   * @brief ベースの音程（16分音符16個 = 1小節分）。null は休符。
   *
   * A マイナー系。単純な繰り返しだが、フィルタを揺らすことで動きを出す。
   * @private
   */
  var BASS = [
    55.00, null, 55.00, null, 82.41, null, 55.00, null,
    73.42, null, 73.42, null, 61.74, null, 61.74, null
  ];

  /**
   * @brief リードの音程（16分音符16個）。
   * @private
   */
  var LEAD = [
    440.00, 523.25, 659.25, 523.25, null, 659.25, 587.33, null,
    493.88, 587.33, 739.99, 587.33, null, 493.88, 440.00, null
  ];

  /** @brief 音声文脈。未起動なら null。 @private */
  var ac = null;

  /** @brief 全体の音量を司るノード。 @private */
  var master = null;

  /** @brief 次に予約すべき16分音符の通し番号。 @private */
  var step = 0;

  /** @brief 次の音を鳴らす時刻 [s]（AudioContext の時計）。 @private */
  var nextTime = 0;

  /** @brief 予約ループの識別子。 @private */
  var timer = 0;

  /** @brief 消音されているか。 @private */
  var muted = false;

  /**
   * @brief 曲の厚み [0..1]。コンボゲージがそのまま入る。
   *
   * 0 ではキックだけが鳴り、上がるにつれてベース・ハイハット・リード・
   * 高音のアルペジオが順に加わる。遊び手は数字を見なくても、
   * 音が増えたことで「繋がっている」と分かる。
   * @private
   */
  var intensity = 0;

  /**
   * @brief 層が加わる順番と、それぞれが出てくる厚みのしきい値。
   * @private
   */
  /**
   * @brief テンポ倍率。1.0 で `CONFIG.bpm` どおり。
   *
   * 走行速度に合わせて曲が速くなる。映像側の拍もこの倍率を共有しているため、
   * 加速しても絵と音がずれない。
   * @private
   */
  var tempoScale = 1;

  var LAYER = {
    bass: 0.02,   // 触れて走り出せばすぐ土台が入る
    hat: 0.30,
    lead: 0.55,
    arp: 0.85
  };

  /**
   * @brief キックドラムを鳴らす。
   * @private
   * @param {number} at 発音時刻 [s]
   * @returns {void}
   */
  function kick(at) {
    var osc = ac.createOscillator();
    var gain = ac.createGain();

    // 音程を急降下させることで「打点」に聞こえる。
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.11);

    gain.gain.setValueAtTime(0.9, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.3);

    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + 0.32);
  }

  /**
   * @brief ハイハットを鳴らす（ノイズを高域だけ残して短く切る）。
   * @private
   * @param {number} at 発音時刻 [s]
   * @param {number} level 音量 [0..1]
   * @returns {void}
   */
  function hat(at, level) {
    var len = Math.floor(ac.sampleRate * 0.05);
    var buffer = ac.createBuffer(1, len, ac.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    var src = ac.createBufferSource();
    src.buffer = buffer;

    var hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;

    var gain = ac.createGain();
    gain.gain.setValueAtTime(level * 0.25, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.045);

    src.connect(hp).connect(gain).connect(master);
    src.start(at);
  }

  /**
   * @brief 音程のある音を1つ鳴らす。
   * @private
   * @param {number} freq 周波数 [Hz]
   * @param {number} at 発音時刻 [s]
   * @param {number} dur 長さ [s]
   * @param {OscillatorType} type 波形
   * @param {number} level 音量 [0..1]
   * @param {number} cutoff ローパスの遮断周波数 [Hz]
   * @returns {void}
   */
  function tone(freq, at, dur, type, level, cutoff) {
    var osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    var lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, at);
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.35), at + dur);

    var gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(lp).connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /**
   * @brief 16分音符1つ分の音を予約する。
   * @private
   * @param {number} n 通し番号
   * @param {number} at 発音時刻 [s]
   * @returns {void}
   */
  function scheduleStep(n, at) {
    var i = n % 16;
    var bar = Math.floor(n / 16);
    var v = intensity;

    // キックは常に鳴る。曲の背骨であり、映像の脈拍と一致させているため。
    if (i % 4 === 0) kick(at);

    if (v >= LAYER.bass && BASS[i] !== null) {
      // 厚みが増すほどフィルタを開き、同じ音型でも前に出てくるようにする。
      var cutoff = 320 + v * 900 + Math.sin(bar * 0.7) * 220;
      tone(BASS[i], at, 0.22, 'sawtooth', 0.20 + v * 0.16, cutoff);
    }

    if (v >= LAYER.hat && i % 2 === 1) {
      hat(at, (i % 4 === 3 ? 1 : 0.55) * (0.5 + v * 0.5));
    }

    // リードは2小節に1回休ませて、繰り返しの単調さを減らす。
    if (v >= LAYER.lead && LEAD[i] !== null && bar % 4 !== 3) {
      tone(LEAD[i], at, 0.16, 'square', 0.05 + v * 0.05, 2600);
    }

    // 満タン近くでだけ現れる高音。ここまで来た手応えを音で返す。
    if (v >= LAYER.arp && LEAD[i] !== null) {
      tone(LEAD[i] * 2, at, 0.10, 'triangle', 0.05, 5200);
    }
  }

  /**
   * @brief 曲の厚みを設定する。
   * @param {number} v 厚み [0..1]。範囲外は丸める
   * @returns {void}
   */
  function setIntensity(v) {
    intensity = v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  /**
   * @brief 現在の曲の厚みを返す。
   * @returns {number} 厚み [0..1]
   */
  function getIntensity() {
    return intensity;
  }

  /**
   * @brief 直近の音を先回りして予約する。
   *
   * `setInterval` の時刻は不正確なので、鳴らす時刻は AudioContext の時計で決める。
   * @private
   * @returns {void}
   */
  function schedule() {
    if (!ac) return;

    while (nextTime < ac.currentTime + CONFIG.lookahead) {
      scheduleStep(step, nextTime);
      step++;
      // 予約のたびに現在のテンポで刻み幅を計算する。
      // 先に長い時間を予約してしまうと、加速がすぐ音に反映されない。
      nextTime += 60 / (CONFIG.bpm * tempoScale) / 4;
    }
  }

  /**
   * @brief テンポ倍率を設定する。
   * @param {number} v 倍率（0.5〜2.0 に丸める）
   * @returns {void}
   */
  function setTempoScale(v) {
    tempoScale = v < 0.5 ? 0.5 : (v > 2 ? 2 : v);
  }

  /**
   * @brief 現在のテンポ倍率を返す。
   * @returns {number} 倍率
   */
  function getTempoScale() {
    return tempoScale;
  }

  /**
   * @brief 音を開始する。ブラウザの自動再生制限があるため、必ず操作を起点に呼ぶ。
   * @returns {void}
   */
  function start() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      return;
    }

    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return; // 非対応環境では無音のまま続行する

    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : CONFIG.masterGain;
    master.connect(ac.destination);

    step = 0;
    nextTime = ac.currentTime + 0.08;
    timer = global.setInterval(schedule, CONFIG.tickMs);
    schedule();
  }

  /**
   * @brief 消音状態を設定する。
   * @param {boolean} v true で消音
   * @returns {void}
   */
  function setMuted(v) {
    muted = !!v;
    if (master && ac) {
      master.gain.setTargetAtTime(muted ? 0 : CONFIG.masterGain, ac.currentTime, 0.02);
    }
  }

  /**
   * @brief 消音を切り替える。
   * @returns {boolean} 切り替え後に消音されているか
   */
  function toggleMute() {
    setMuted(!muted);
    return muted;
  }

  /**
   * @brief 音を鳴らす。停止中なら起動し、消音中なら解除する。
   *
   * 「起動」と「消音解除」を1つの操作にまとめる。この2つを別々に扱うと、
   * 起動済みで消音中のときにボタンが効かなくなる。
   *
   * @returns {void}
   */
  function turnOn() {
    start();
    setMuted(false);
    if (ac && ac.state === 'suspended') ac.resume();
  }

  /**
   * @brief 音が鳴っているか。
   * @returns {boolean} 起動済みかつ消音されていなければ true
   */
  function isPlaying() {
    return !!ac && !muted && ac.state === 'running';
  }

  /**
   * @brief 消音されているか（未起動も消音とみなす）。
   * @returns {boolean} 消音中なら true
   */
  function isMuted() {
    return !ac || muted;
  }

  global.PULSAR = global.PULSAR || {};
  global.PULSAR.sound = {
    CONFIG: CONFIG,
    LAYER: LAYER,
    start: start,
    turnOn: turnOn,
    setMuted: setMuted,
    toggleMute: toggleMute,
    isPlaying: isPlaying,
    isMuted: isMuted,
    setIntensity: setIntensity,
    getIntensity: getIntensity,
    setTempoScale: setTempoScale,
    getTempoScale: getTempoScale
  };
})(typeof window !== 'undefined' ? window : this);
