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
   * @brief ステージごとの曲。
   *
   * 音程は A マイナー系。`bass` と `lead` は16分音符16個分（1小節）で、
   * null は休符。
   *
   * 同じ曲が延々と続くと、進んでいる実感が薄れる。ステージが変わったら
   * 場面が変わったと分かるよう、拍の打ち方・ベース・リードを差し替える。
   *
   * `kick` と `hat` は16分音符16個分の鳴らす位置。true の位置で鳴る。
   * @private
   */
  var STAGES = [
    {
      // 1: 素直な四つ打ち。最初はテンポが分かりやすいことを優先する
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      hat:  [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      bass: [55.00, null, 55.00, null, 82.41, null, 55.00, null,
             73.42, null, 73.42, null, 61.74, null, 61.74, null],
      lead: [440.00, null, 659.25, null, null, 587.33, null, null,
             493.88, null, 739.99, null, null, 493.88, null, null]
    },
    {
      // 2: 裏拍のハイハットを増やして前へ進む感じを出す
      kick: [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0],
      hat:  [0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1],
      bass: [55.00, null, 65.41, null, 82.41, null, 65.41, null,
             73.42, null, 87.31, null, 61.74, null, 73.42, null],
      lead: [523.25, 659.25, null, 587.33, null, 783.99, 659.25, null,
             587.33, 739.99, null, 659.25, null, 523.25, null, null]
    },
    {
      // 3: キックを食わせて跳ねを作る
      kick: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      hat:  [0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1],
      bass: [65.41, null, 65.41, 65.41, 98.00, null, 65.41, null,
             87.31, null, 87.31, 87.31, 73.42, null, 73.42, null],
      lead: [659.25, null, 783.99, null, 880.00, null, 783.99, null,
             659.25, null, 587.33, null, 523.25, null, 587.33, null]
    },
    {
      // 4: 低い方へ寄せ、重さを出す
      kick: [1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      hat:  [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1],
      bass: [49.00, 49.00, null, 49.00, 73.42, null, 49.00, null,
             65.41, 65.41, null, 65.41, 58.27, null, 58.27, null],
      lead: [493.88, null, null, 587.33, null, 493.88, null, 440.00,
             392.00, null, null, 493.88, null, 440.00, null, null]
    },
    {
      // 5: 16分のハイハットで密度を上げる
      kick: [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0],
      hat:  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      bass: [55.00, 55.00, 82.41, null, 55.00, null, 82.41, 55.00,
             73.42, 73.42, 110.00, null, 61.74, null, 92.50, 61.74],
      lead: [880.00, 783.99, 659.25, 783.99, null, 880.00, 987.77, null,
             880.00, 739.99, 659.25, 587.33, null, 659.25, null, null]
    },
    {
      // 6: 詰め込んだ最終ステージ。ここまで来た手応えを音数で返す
      kick: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0],
      hat:  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      bass: [55.00, 55.00, 65.41, 73.42, 82.41, 73.42, 65.41, 55.00,
             49.00, 49.00, 58.27, 65.41, 73.42, 65.41, 58.27, 49.00],
      lead: [1046.50, 987.77, 880.00, 783.99, 880.00, 987.77, 1046.50, null,
             880.00, 783.99, 659.25, 587.33, 659.25, 783.99, 880.00, null]
    }
  ];

  /** @brief 現在のステージ番号（1 から始まる）。 @private */
  var stage = 1;

  /**
   * @brief ステージ番号を用意した曲の範囲へ収める。
   *
   * ステージ数と曲数が食い違っても、音が止まったり例外が出たりしないようにする。
   *
   * @private
   * @param {number} n ステージ番号
   * @returns {number} 1 以上 曲数以下の整数
   */
  function clampStage(n) {
    var v = Math.floor(n);
    if (!(v >= 1)) return 1;                 // NaN もここで拾う
    return v > STAGES.length ? STAGES.length : v;
  }

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
   * @brief 利用者が音を出したいと思っているか。
   *
   * 実際に鳴っているかとは別に持つ。スマートフォンでは、
   * 画面を触らない時間が続いたりタブが隠れたりすると、ブラウザが
   * 音声を勝手に中断することがある。そのたびにボタンの表示が
   * 「音を出す」へ戻ってしまうと、利用者には壊れて見える。
   * 意思はここに保ち、中断されたら黙って再開を試みる。
   * @private
   */
  var wanted = true;

  /**
   * @brief 作品側の都合で一時的に止めているか（一時停止・合図の最中）。
   *
   * 利用者の意思とは別に持つ。混ぜると、止まっている最中に
   * 読み込み直しただけで設定が書き換わってしまう。
   * @private
   */
  var suspended = false;

  /**
   * @brief 音を出したいかどうかを端末に覚えさせる。
   * @private
   * @returns {void}
   */
  function savePreference() {
    global.PULSAR.store.set('pulsar.sound', (wanted && !muted) ? '1' : '0');
  }

  // 前回の選択を復元する。既定は「出したい」。
  // ブラウザの自動再生制限があるため、実際に鳴り始めるのは最初の操作のとき。
  if (global.PULSAR.store.get('pulsar.sound') === '0') {
    wanted = false;
    muted = true;
  }

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
   * @brief テンポ倍率。1.0 で `CONFIG.bpm` どおり。
   *
   * 走行速度に合わせて曲が速くなる。映像側の拍もこの倍率を共有しているため、
   * 加速しても絵と音がずれない。
   * @private
   */
  var tempoScale = 1;

  /**
   * @brief 層が加わる順番と、それぞれが出てくる厚みのしきい値。
   * @private
   */
  var LAYER = {
    bass: 0.02,   // 触れて走り出せばすぐ土台が入る
    hat: 0.26,
    lead: 0.48,
    arp: 0.70,
    // 最後は刻む音ではなく、伸びる音を重ねる。音数を増やし続けると
    // ただ忙しくなるだけなので、締めは厚みで聴かせる。
    pad: 0.88
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
   * @brief 長く伸びる音を鳴らす（パッド）。
   *
   * 立ち上がりと減衰をゆっくりにして、刻む音の下に敷く。
   * 2つの発振器をわずかにずらして重ね、厚みを出す。
   *
   * @private
   * @param {number} freq 周波数 [Hz]
   * @param {number} at 発音時刻 [s]
   * @param {number} dur 長さ [s]
   * @param {number} level 音量 [0..1]
   * @returns {void}
   */
  function pad(freq, at, dur, level) {
    var gain = ac.createGain();
    var lp = ac.createBiquadFilter();

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, at);
    lp.frequency.linearRampToValueAtTime(1800, at + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(700, at + dur);

    // ゆっくり立ち上げ、ゆっくり落とす。打点を作らないのが狙い。
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + dur * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    gain.connect(lp).connect(master);

    // わずかに音程をずらした2本で、うねりのある厚みにする
    [0, 1].forEach(function (i) {
      var osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq * (i === 0 ? 1 : 1.005);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    });
  }

  /**
   * @brief 長三和音の構成音の比。根音・長三度・完全五度。
   *
   * 純正律の比をそのまま使う。平均律より響きが澄むうえ、
   * 掛け算だけで求まるので表を持たずに済む。
   * @private
   */
  var MAJOR_CHORD = [1, 5 / 4, 3 / 2];

  /**
   * @brief 長三和音を鳴らす。
   *
   * 刻む音が休んでいる隙間に差し込む。旋律を足すと詰め込みすぎになるが、
   * 和音なら隙間を埋めながらも前へ出てこない。
   *
   * @private
   * @param {number} root 根音の周波数 [Hz]
   * @param {number} at 発音時刻 [s]
   * @param {number} dur 長さ [s]
   * @param {number} level 音量 [0..1]
   * @param {OscillatorType} type 波形
   * @returns {void}
   */
  function chord(root, at, dur, level, type) {
    for (var i = 0; i < MAJOR_CHORD.length; i++) {
      // 上の音ほど控えめにして、根音が土台として残るようにする
      tone(root * MAJOR_CHORD[i], at, dur, type, level * (1 - i * 0.22), 2200);
    }
  }

  /**
   * @brief 立方体を拾ったときの音を鳴らす。
   *
   * 曲の進行とは切り離して、その場ですぐ鳴らす。拍を待つと
   * 「拾った瞬間」から音がずれ、自分の操作の結果に聞こえない。
   *
   * @returns {void}
   */
  function playPickup() {
    if (!ac || muted || suspended) return;

    var at = ac.currentTime + 0.01;

    // 上へ駆け上がる3音。曲のどの場面でも浮くよう、高い音域を使う。
    var steps = [0, 1, 2];
    for (var i = 0; i < steps.length; i++) {
      var freq = 880 * MAJOR_CHORD[i];
      var t = at + i * 0.045;

      var osc = ac.createOscillator();
      var gain = ac.createGain();

      osc.type = 'triangle';
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.32);
    }
  }

  /**
   * @brief その位置で鳴らす和音の根音を求める。
   *
   * ベースの音型をそのまま和音の進行として使う。別に進行表を持つと、
   * ベースと和音が食い違ったときに濁る原因になる。
   *
   * @private
   * @param {Object} p ステージの曲
   * @param {number} i 16分音符の位置
   * @returns {number} 根音の周波数 [Hz]
   */
  function chordRoot(p, i) {
    // その位置に音が無ければ、直前に鳴っていた音まで遡る。
    for (var k = i; k >= 0; k--) {
      if (p.bass[k] !== null) return p.bass[k];
    }
    return p.bass[0] || 55;
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
    var p = STAGES[clampStage(stage) - 1];

    // キックは常に鳴る。曲の背骨であり、映像の脈拍と一致させているため。
    if (p.kick[i]) kick(at);

    if (v >= LAYER.bass && p.bass[i] !== null) {
      // 厚みが増すほどフィルタを開き、同じ音型でも前に出てくるようにする。
      var cutoff = 320 + v * 900 + Math.sin(bar * 0.7) * 220;
      tone(p.bass[i], at, 0.22, 'sawtooth', 0.20 + v * 0.16, cutoff);
    }

    if (v >= LAYER.hat && p.hat[i]) {
      hat(at, (i % 4 === 3 ? 1 : 0.55) * (0.5 + v * 0.5));
    }

    // リードは2小節に1回休ませて、繰り返しの単調さを減らす。
    if (v >= LAYER.lead && p.lead[i] !== null && bar % 4 !== 3) {
      tone(p.lead[i], at, 0.16, 'square', 0.05 + v * 0.05, 2600);
    }

    // 満タン近くでだけ現れる高音。ここまで来た手応えを音で返す。
    if (v >= LAYER.arp && p.lead[i] !== null) {
      tone(p.lead[i] * 2, at, 0.10, 'triangle', 0.05, 5200);
    }

    // --- 最後の層：伸びる音と、隙間を埋める和音 ---
    if (v >= LAYER.pad) {
      var beat = 60 / (CONFIG.bpm * tempoScale);
      var root = p.bass[0] || 55;

      // 小節の頭で、2小節ぶん伸びる長三和音を敷く。
      // 打つ和音が前に出るので、こちらは土台として控えめにする。
      if (i === 0 && bar % 2 === 0) {
        for (var n = 0; n < MAJOR_CHORD.length; n++) {
          pad(root * 2 * MAJOR_CHORD[n], at, beat * 8, 0.038 - n * 0.008);
        }
      }

      // 拍の頭で和音を打つ。隙間を埋める飾りではなく、ここまで来た人への
      // ご褒美として前に出す。和音はその時点のベースに合わせて動かすので、
      // 同じ響きが続かず進行として聞こえる。
      if (i % 4 === 0) {
        chord(chordRoot(p, i) * 4, at, beat * 0.95, 0.085, 'triangle');
      }

      // 2拍目と4拍目の裏に軽く足して、前へ進む感じを出す。
      if (i === 6 || i === 14) {
        chord(chordRoot(p, i) * 4, at, beat * 0.5, 0.05, 'triangle');
      }
    }
  }

  /**
   * @brief 鳴らす曲をステージ番号で選ぶ。
   * @param {number} n ステージ番号（1 から始まる）
   * @returns {void}
   */
  function setStage(n) {
    stage = clampStage(n);
  }

  /**
   * @brief 現在のステージ番号。
   * @returns {number} ステージ番号
   */
  function getStage() {
    return stage;
  }

  /**
   * @brief 用意した曲の数。
   * @returns {number} ステージ数
   */
  function stageCount() {
    return STAGES.length;
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

    /*
     * 大きく遅れていたら、追いつこうとせず現在へ飛ばす。
     *
     * タブが隠れている間、予約のループは間引かれるのに音声の時計は
     * 進み続ける。そのまま再開すると、遅れたぶんの音符をまとめて
     * 予約してしまい、戻った瞬間に固まって鳴る（二重に聞こえる）。
     */
    if (nextTime < ac.currentTime - CONFIG.lookahead) {
      nextTime = ac.currentTime + 0.05;
    }

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
   * @brief 今、音を出してよい状態か。
   *
   * 3つの「出さない理由」をここに集める。散らばっていると、どれかを
   * 見落とした経路が音を起こしてしまい、止めたはずの音が鳴る。
   *
   * @private
   * @returns {boolean} 出してよいなら true
   */
  function canPlay() {
    if (!wanted || muted || suspended) return false;
    // 見えていないページで鳴らさない。別のページを開いたつもりでも
    // 裏で鳴り続け、そちらの音と重なって聞こえてしまう。
    if (global.document && global.document.hidden) return false;
    return true;
  }

  /**
   * @brief 音を開始する。ブラウザの自動再生制限があるため、必ず操作を起点に呼ぶ。
   * @returns {void}
   */
  function start() {
    wanted = true;

    // 見えていないページでは起こさない。テストのページのように
    // 音を必要としない画面で、勝手に鳴り始めるのを防ぐ。
    if (global.document && global.document.hidden) return;

    if (ac) {
      if (ac.state !== 'running') ac.resume();
      return;
    }

    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return; // 非対応環境では無音のまま続行する

    ac = new AC();

    // 端末側の都合で中断されたら、その場で再開を試みる。
    //
    // ただし、こちらの都合で止めたものまで起こしてはいけない。
    // この見張りが無条件だと、タブが隠れて止めた音声をその場で
    // 復帰させてしまい、裏で鳴り続ける。
    ac.onstatechange = function () {
      if (!canPlay()) return;
      if (ac && ac.state === 'suspended') ac.resume();
    };
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
    if (muted) wanted = false;
    applyGain();
    savePreference();
  }

  /**
   * @brief 実際の音量を、今の状態に合わせて反映する。
   * @private
   * @returns {void}
   */
  function applyGain() {
    if (!master || !ac) return;
    var target = (muted || suspended) ? 0 : CONFIG.masterGain;
    master.gain.setTargetAtTime(target, ac.currentTime, 0.02);
  }

  /**
   * @brief 一時的に音を止める（一時停止・合図の最中など）。
   *
   * 利用者の意思（音を出したいかどうか）には触れない。ここで消音として
   * 保存してしまうと、止まっている最中に読み込み直しただけで
   * 「音なし」が既定になってしまう。
   *
   * @param {boolean} v 止めるなら true
   * @returns {void}
   */
  function setSuspended(v) {
    suspended = !!v;
    applyGain();
    if (!suspended && ac && ac.state === 'suspended') ac.resume();
  }

  /**
   * @brief 中断されていたら再開を試みる。毎フレーム呼んでよい。
   *
   * スマートフォンでは、操作が途切れたりタブが隠れたりしたあとに
   * 音声が中断されたままになることがある。利用者が音を出したいままなら、
   * 気づかれないうちに復帰させる。
   *
   * @returns {void}
   */
  function keepAlive() {
    if (!canPlay()) return;

    // まだ音声を起こしていなければ、ここで起こす。
    // 自動再生の制限があるため、この関数は必ず操作を起点に呼ぶこと。
    if (!ac) {
      start();
      return;
    }

    if (ac.state === 'suspended') ac.resume();
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
    muted = false;
    start();
    setMuted(false);
    wanted = true;
    if (ac && ac.state !== 'running') ac.resume();
    savePreference();
  }

  /**
   * @brief 利用者が音を出したい状態か（実際に鳴っているかとは別）。
   *
   * ボタンの表示にはこちらを使う。端末側の一時的な中断で
   * 表示が勝手に戻らないようにするため。
   *
   * @returns {boolean} 音を出す意思があるなら true
   */
  function isOn() {
    return wanted && !muted;
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
    return !isOn();
  }

  // 隠れている間は音声そのものを止め、戻ったら中断から復帰させる。
  //
  // 音量を 0 にするだけでは足りない。別のページを開いたつもりでも
  // 裏で鳴り続け、そちらの音と重なって聞こえてしまう。
  if (global.document && global.document.addEventListener) {
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.hidden) {
        if (ac && ac.state === 'running') ac.suspend();
      } else {
        keepAlive();
      }
    });
  }

  global.PULSAR = global.PULSAR || {};
  global.PULSAR.sound = {
    CONFIG: CONFIG,
    LAYER: LAYER,
    start: start,
    turnOn: turnOn,
    setMuted: setMuted,
    setSuspended: setSuspended,
    toggleMute: toggleMute,
    keepAlive: keepAlive,
    isPlaying: isPlaying,
    isOn: isOn,
    isMuted: isMuted,
    setIntensity: setIntensity,
    getIntensity: getIntensity,
    setTempoScale: setTempoScale,
    getTempoScale: getTempoScale,
    setStage: setStage,
    getStage: getStage,
    stageCount: stageCount,
    playPickup: playPickup
  };
})(typeof window !== 'undefined' ? window : this);
