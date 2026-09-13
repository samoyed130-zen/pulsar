/**
 * @file scenes.js
 * @brief デモを構成する各エフェクトと、その並び（タイムライン）。
 *
 * 全シーンは共通の色相 `f.hue` から色を引く。個々の効果は別物でも、
 * 色が一本の線で繋がっていれば1つの作品として見えるため。
 *
 * 重いエフェクト（プラズマ・メタボール）は低解像度バッファへ描いてから
 * 画面いっぱいに拡大する。計算量を落としつつ、拡大時のにじみを味として使う。
 */
(function (global) {
  'use strict';

  var M = global.PULSAR.mathx;
  var TAU = M.TAU;

  /** @brief スクロールテキストに流す文章。 */
  var SCROLL_TEXT =
    '  PULSAR  —  a megademo written in plain javascript  ' +
    '***  外部ライブラリなし。canvas 2d と web audio だけで書いています  ' +
    '***  トンネルの区間では画面に触れると操縦できます  ' +
    '***  code + music by samoyed130-zen  ' +
    '***  ZEN Study プログラミングコンテスト 2026 夏  ' +
    '***  greetings to everyone still writing demos in 2026  ';

  /**
   * @brief 星の一覧。シーンを跨いで保持し、毎回作り直さない。
   * @private
   * @type {Array<{x: number, y: number, z: number}>}
   */
  var stars = [];

  /**
   * @brief 星を生成する。
   * @private
   * @param {number} count 生成数
   * @returns {void}
   */
  function seedStars(count) {
    stars.length = 0;
    for (var i = 0; i < count; i++) {
      stars.push({
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2,
        z: Math.random() * 1 + 0.02
      });
    }
  }
  seedStars(420);

  /**
   * @brief 前フレームの絵を薄く残す（残像と発光の土台）。
   * @private
   * @param {Object} f フレーム文脈
   * @param {number} amount 黒を重ねる濃さ [0..1]。小さいほど尾が長い
   * @returns {void}
   */
  function fadeCanvas(f, amount) {
    f.ctx.globalCompositeOperation = 'source-over';
    f.ctx.fillStyle = 'rgba(4,5,10,' + amount.toFixed(3) + ')';
    f.ctx.fillRect(0, 0, f.W, f.H);
  }

  /**
   * @brief `ImageData` の使い回し置き場。毎フレーム作ると確保が負荷になる。
   * @private
   */
  var imageCache = { w: 0, h: 0, img: null };

  /**
   * @brief バッファと同じ大きさの `ImageData` を返す（使い回す）。
   * @private
   * @param {CanvasRenderingContext2D} bctx バッファの文脈
   * @param {number} w 幅
   * @param {number} h 高さ
   * @returns {ImageData} 書き込み先
   */
  function getImage(bctx, w, h) {
    if (!imageCache.img || imageCache.w !== w || imageCache.h !== h) {
      imageCache.img = bctx.createImageData(w, h);
      imageCache.w = w;
      imageCache.h = h;
    }
    return imageCache.img;
  }

  /**
   * @brief 低解像度バッファを画面いっぱいに引き伸ばす。
   * @private
   * @param {Object} f フレーム文脈
   * @param {number} alpha 不透明度 [0..1]
   * @returns {void}
   */
  function blitBuffer(f, alpha) {
    var c = f.ctx;
    c.save();
    c.globalAlpha = alpha;
    c.imageSmoothingEnabled = true;
    c.drawImage(f.buf, 0, 0, f.W, f.H);
    c.restore();
  }

  // -----------------------------------------------------------------
  // S1 スターフィールド
  // -----------------------------------------------------------------

  /**
   * @brief 星が手前へ流れるシーン。拍に合わせて加速する。
   * @param {Object} f フレーム文脈
   * @returns {void}
   */
  function drawStarfield(f) {
    // 残像を短くする。長いと線が重なり続け、加算合成で画面全体が白く飽和する。
    fadeCanvas(f, 0.42);

    var c = f.ctx;
    var cx = f.W / 2;
    var cy = f.H / 2;
    var focal = Math.min(f.W, f.H) * 0.9;
    var speed = (0.28 + f.kick * 0.55) * f.dt;

    c.globalCompositeOperation = 'lighter';

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var prevZ = s.z;
      s.z -= speed;
      if (s.z <= 0.02) {
        s.x = (Math.random() - 0.5) * 2;
        s.y = (Math.random() - 0.5) * 2;
        s.z = 1;
        prevZ = s.z;
      }

      var x = cx + s.x * focal / s.z;
      var y = cy + s.y * focal / s.z;
      var px = cx + s.x * focal / prevZ;
      var py = cy + s.y * focal / prevZ;

      var near = M.clamp(1 - s.z, 0, 1);

      // 手前の星だけを明るくする。全部を明るくすると画面が白く埋まる。
      var bright = near * near;
      c.strokeStyle = M.hsl(f.hue * 0.25 + 205 + near * 55, 80, 34 + bright * 44,
                            0.16 + bright * 0.7);
      c.lineWidth = 0.5 + bright * 2.2;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(x, y);
      c.stroke();
    }

    // 作品名は DOM のタイトル画面が担当する（二重に出さない）。
    c.globalCompositeOperation = 'source-over';
  }

  // -----------------------------------------------------------------
  // S2 プラズマ
  // -----------------------------------------------------------------

  /**
   * @brief 正弦波を重ねた色の場。画面全体が脈打つ。
   * @param {Object} f フレーム文脈
   * @returns {void}
   */
  function drawPlasma(f) {
    var bw = f.buf.width;
    var bh = f.buf.height;
    var img = getImage(f.bufCtx, bw, bh);
    var data = img.data;
    var t = f.t;

    for (var y = 0; y < bh; y++) {
      for (var x = 0; x < bw; x++) {
        var v =
          Math.sin(x * 0.16 + t * 1.3) +
          Math.sin(y * 0.13 - t * 0.9) +
          Math.sin((x + y) * 0.09 + t * 1.7) +
          Math.sin(Math.sqrt((x - bw / 2) * (x - bw / 2) + (y - bh / 2) * (y - bh / 2)) * 0.18 - t * 2.1);

        // -4..4 を 0..1 へ写す
        var n = (v + 4) / 8;

        // 共通色相はゆっくり一周するため、そのまま使うと黄や緑にも回ってしまう。
        // 4分の1に縮めて青紫の周辺に留め、他の場面と地続きに見せる。
        var hue = (f.hue * 0.25 + 215 + n * 90) % 360;
        var rgb = hslToRgb(hue / 360, 0.72, 0.10 + n * n * 0.42);

        var o = (y * bw + x) * 4;
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
        data[o + 3] = 255;
      }
    }

    f.bufCtx.putImageData(img, 0, 0);
    fadeCanvas(f, 0.5);
    blitBuffer(f, 0.9);
  }

  /**
   * @brief HSL を RGB へ変換する（`ImageData` へ直接書き込むために必要）。
   * @private
   * @param {number} h 色相 [0..1]
   * @param {number} s 彩度 [0..1]
   * @param {number} l 明度 [0..1]
   * @returns {Array<number>} [r, g, b] 各 0..255
   */
  function hslToRgb(h, s, l) {
    if (s === 0) {
      var g = Math.round(l * 255);
      return [g, g, g];
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [
      Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
      Math.round(hueToChannel(p, q, h) * 255),
      Math.round(hueToChannel(p, q, h - 1 / 3) * 255)
    ];
  }

  /**
   * @brief HSL→RGB 変換の1チャンネル分を求める補助関数。
   * @private
   * @param {number} p 補間下限
   * @param {number} q 補間上限
   * @param {number} t 色相位置
   * @returns {number} チャンネル値 [0..1]
   */
  function hueToChannel(p, q, t) {
    var x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  }

  // -----------------------------------------------------------------
  // 立体背景（多角形による建造物）
  // -----------------------------------------------------------------

  /**
   * @brief 立体背景を描くかどうか。
   *
   * 面の数だけ負荷がかかるため、描画が追いつかない端末では切れるようにしてある。
   * @private
   */
  var backgroundOn = true;

  /**
   * @brief 立体背景の有無を設定する。
   * @param {boolean} on 描くなら true
   * @returns {void}
   */
  function setRaymarch(on) {
    backgroundOn = !!on;
    try {
      global.localStorage.setItem('pulsar.bg', backgroundOn ? '1' : '0');
    } catch (e) { /* 保存できなくても動作には影響しない */ }
  }

  /**
   * @brief 立体背景を描く設定になっているか。
   * @returns {boolean} 描くなら true
   */
  function isRaymarch() {
    return backgroundOn;
  }

  // 前回の選択を復元する。設定が読めない環境では既定（描く）のままにする。
  try {
    if (global.localStorage.getItem('pulsar.bg') === '0') backgroundOn = false;
  } catch (e) { /* 既定のまま */ }

  /**
   * @brief 建造物の寸法。
   *
   * 単位はトンネルのリングと共通で、リングの半径が 1 にあたる。
   * 通路をリングより大きく取ることが、そのまま規模感になる。
   */
  var HALL = {
    /** @brief 通路の半幅。 */
    halfWidth: 2.05,
    /** @brief 通路の半分の高さ。 */
    halfHeight: 1.45,
    /** @brief 柱や梁が並ぶ間隔。広いほど構造物が大きく感じられる。 */
    period: 2.9,
    /** @brief 何区画分を同時に描くか。奥行きの見通しを決める。 */
    cells: 9,
    /** @brief 柱の位置（中心からの距離）。 */
    columnX: 1.78,
    /** @brief 描き始める手前の位置。これより近い部材は描かない。 */
    nearZ: 0.6,
    /**
     * @brief 壁・床・天井を奥行き方向に何分割するか。
     *
     * 長い板のままだと、カメラに近づいたとき一部が背後へ回り込む。
     * 頂点が1つでもカメラの後ろにあると面ごと描けず、そこが黒く抜ける。
     * 短く割っておけば、抜けるのはカメラを通り過ぎた区画だけで済む。
     */
    segments: 3,
    /**
     * @brief カメラの手前でこの位置を切る面（ニアクリップ）。
     *
     * これより手前に掛かった部材は、捨てずにここで切り詰めて描く。
     * 値を大きくすると、近づいた部材が早々に消えたように見える。
     */
    clipZ: 0.16
  };

  /**
   * @brief 建造物の色。すべて同系色でまとめ、背景として沈める。
   */
  var HALL_HUE = {
    wall: 214,
    column: 206,
    beam: 200,
    floor: 220,
    light: 188
  };

  /**
   * @brief ステージごとの建造物の見た目。
   *
   * 同じ通路を6回走らされると、進んでいる実感が出ない。
   * 色味と寸法を変えて、別の場所へ来たと分かるようにする。
   *
   * `hue` は色相のずらし量 [deg]、`light` は照明帯の色相、
   * `width`/`height` は通路の大きさの倍率、`period` は柱の間隔の倍率。
   */
  var STAGE_LOOK = [
    // 通路の形そのものは全ステージ共通。違いは色と、奥へ向かう揺れ方だけ。
    // 部材の配置まで変えると、同じ作品の中で別の建物を見ている感覚になり、
    // かえって繋がりが切れる。
    //
    // `vertical` が立つステージでは、通路が左右ではなく上下へうねる。
    // 同じ道でも進む向きの感覚が変わる。
    //
    // 周期は長く取る。短い周期で揺らすと、画面が小刻みに振れて酔いやすい。
    // 違いは「ゆっくり、大きく」曲がることで出す。
    // 上下方向は天井と床が近いぶん、振幅を控えめにする。
    { hue:   0, sat: 30, light: 190, bendAmp: 0.90, bendFreq: 0.10, vertical: false },
    { hue:  52, sat: 44, light: 142, bendAmp: 0.58, bendFreq: 0.09, vertical: true },
    { hue: 108, sat: 52, light:  86, bendAmp: 1.25, bendFreq: 0.12, vertical: false },
    { hue: 168, sat: 46, light:  36, bendAmp: 0.76, bendFreq: 0.11, vertical: true },
    { hue: 232, sat: 58, light:   6, bendAmp: 1.60, bendFreq: 0.13, vertical: false },
    { hue: 292, sat: 64, light: 318, bendAmp: 0.94, bendFreq: 0.12, vertical: true }
  ];

  /**
   * @brief 今のステージの見た目を返す。
   * @private
   * @returns {Object} `STAGE_LOOK` の要素
   */
  function currentLook() {
    var n = global.PULSAR.game.state.stage;
    var i = Math.floor(n) - 1;
    if (!(i >= 0)) i = 0;
    if (i >= STAGE_LOOK.length) i = STAGE_LOOK.length - 1;
    return STAGE_LOOK[i];
  }

  /**
   * @brief 描画待ちの部材。奥から手前へ並べ替えてから描く。
   * @private
   */
  var parts = [];

  /** @brief 部材オブジェクトの使い回し置き場。毎フレームの確保を避ける。 @private */
  var partPool = [];

  /** @brief 今フレームで使った部材の数。 @private */
  var partCount = 0;

  /**
   * @brief 部材を1つ登録する（この時点では描かない）。
   *
   * @private
   * @param {number} x 位置 x
   * @param {number} y 位置 y（下が正）
   * @param {number} z 位置 z（奥が正）
   * @param {number} sx 半径 x
   * @param {number} sy 半径 y
   * @param {number} sz 半径 z
   * @param {number} hue 色相 [deg]
   * @param {number} metal 金属らしさ [0..1]
   * @param {boolean} emissive 自ら光るか
   * @returns {void}
   */
  function addPart(x, y, z, sx, sy, sz, hue, metal, emissive, rx, ry) {
    var nearEdge = z - sz;

    if (nearEdge < HALL.clipZ) {
      var farEdge = z + sz;

      // 完全にカメラの後ろへ行ったものだけ捨てる。
      if (farEdge <= HALL.clipZ) return;

      // カメラを跨ぐ部材は投影できず、面ごと消えて黒い穴になる。
      // 捨てるのではなく、カメラの手前で切り詰めて描く。
      // 箱は奥行き方向に軸が揃っているので、z の範囲を詰めるだけで
      // 正しく「途中で切った」形になる。
      z = (HALL.clipZ + farEdge) * 0.5;
      sz = (farEdge - HALL.clipZ) * 0.5;
    }

    var p = partPool[partCount];
    if (!p) {
      p = { pos: [0, 0, 0], size: [0, 0, 0] };
      partPool[partCount] = p;
    }
    partCount++;

    p.pos[0] = x; p.pos[1] = y; p.pos[2] = z;
    p.size[0] = sx; p.size[1] = sy; p.size[2] = sz;
    p.hue = hue;
    p.metal = metal;
    p.emissive = emissive;
    p.rx = rx || 0;
    p.ry = ry || 0;
    p.depth = z;
    parts.push(p);
  }

  /**
   * @brief 通路のずれ。奥行きに応じて曲げ、直線に見せない。
   *
   * ステージによって、ずらす向きが左右になったり上下になったりする。
   * 同じ形の通路でも、揺れる向きが変わると進む感覚が変わる。
   *
   * @private
   * @param {number} z 奥行き
   * @param {number} t 時刻 [s]
   * @param {Object} look ステージの見た目
   * @param {Array<number>} out 結果を書き込む長さ2の配列 [x, y]
   * @returns {void}
   */
  function hallBend(z, t, look, out) {
    var v = Math.sin(z * look.bendFreq + t * 0.25) * look.bendAmp;

    if (look.vertical) {
      out[0] = 0;
      out[1] = v;
    } else {
      out[0] = v;
      out[1] = 0;
    }
  }

  /** @brief 通路のずれを受け取る配列。毎回の確保を避けるため使い回す。 @private */
  var bendOut = [0, 0];

  /**
   * @brief 建造物を描く。
   *
   * レイマーチングをやめ、すべて多角形で組み立てている。理由は3つ:
   * - 画面の解像度そのままで描けるため、拡大によるにじみが出ない
   * - 面の色を直接決められるため、階調の縞（マッハバンド）が出ない
   * - 箱ばかりの構造物では、1ピクセルずつ面を探すより桁違いに速い
   *
   * @param {Object} f フレーム文脈
   * @param {number} travel 走行距離（奥行きの基準）
   * @returns {void}
   */
  function drawHall(f, travel) {
    var mesh3d = global.PULSAR.mesh3d;
    var c = f.ctx;

    var cx = f.W / 2;
    var cy = f.H / 2;
    var focal = Math.min(f.W, f.H) * global.PULSAR.game.CONFIG.focal;

    // 通路の形は全ステージ共通。変わるのは色と、奥へ向かう揺れ方だけ。
    var look = currentLook();
    var period = HALL.period;
    var offset = travel % period;

    // 見通す区画の数が、そのまま描く面の数になる。
    // 画面が小さいときと、描画が追いついていないときは減らす。
    var cells = HALL.cells;
    if (f.light) cells -= 3;
    if (f.quality === 0) cells -= 2;
    cells = Math.max(3, cells);

    parts.length = 0;
    partCount = 0;

    var hw = HALL.halfWidth;
    var hh = HALL.halfHeight;

    // カメラの位置での通路の中心を求め、その分だけ全体をずらす。
    //
    // これをしないと、通路が曲がるたびにカメラだけが取り残され、
    // 壁が正面から迫ってくる見え方になる。通路の中心に沿って
    // カメラが滑る形にすれば、曲がっていく通路を進む感覚になる。
    hallBend(0, f.t, look, bendOut);
    var camX = bendOut[0];
    var camY = bendOut[1];

    // 映り込む照明の本数もステージで変える。金属面に映る景色が変われば、
    // 同じ形の通路でも別の場所に見える。
    mesh3d.ENV.streaks = 4 + (global.PULSAR.game.state.stage % 4) * 2;

    for (var i = 0; i < cells; i++) {
      var z = HALL.nearZ + i * period - offset + period;
      if (z < HALL.nearZ * 0.5) continue;

      hallBend(z, f.t, look, bendOut);
      var bx = bendOut[0] - camX;
      var by = bendOut[1] - camY;
      var half = period * 0.5;

      // 壁・床・天井は奥行きに長いので、短く割って並べる。
      // カメラに掛かった区画だけが消えるようになり、黒い抜けが出にくい。
      // 重いときは割る数を減らす（手前の抜けは出やすくなるが、動きを優先する）。
      var segments = f.quality === 0 ? 2 : HALL.segments;
      var segLen = period / segments;
      var segHalf = segLen * 0.5;

      for (var s = 0; s < segments; s++) {
        var zs = z + (s - (segments - 1) * 0.5) * segLen;
        hallBend(zs, f.t, look, bendOut);
        var sx = bendOut[0] - camX;
        var sy = bendOut[1] - camY;

        // 左右の壁
        addPart(sx - hw, sy, zs, 0.12, hh, segHalf, HALL_HUE.wall, 0.35, false);
        addPart(sx + hw, sy, zs, 0.12, hh, segHalf, HALL_HUE.wall, 0.35, false);

        // 床と天井
        addPart(sx, sy + hh, zs, hw, 0.1, segHalf, HALL_HUE.floor, 0.3, false);
        addPart(sx, sy - hh, zs, hw, 0.1, segHalf, HALL_HUE.wall, 0.25, false);
      }

      // 柱。床から天井まで通す。金属らしさを最も強くする。
      addPart(bx - HALL.columnX, by, z, 0.14, hh, 0.14, HALL_HUE.column, 0.95, false);
      addPart(bx + HALL.columnX, by, z, 0.14, hh, 0.14, HALL_HUE.column, 0.95, false);

      // 天井を渡る梁
      addPart(bx, by - hh * 0.86, z, hw * 0.98, 0.1, 0.13, HALL_HUE.beam, 0.85, false);

      // 壁から突き出す桁。2段にして規模感を出す。
      addPart(bx - hw * 0.88, by - hh * 0.3, z, 0.16, 0.07, half * 0.95,
              HALL_HUE.beam, 0.7, false);
      addPart(bx + hw * 0.88, by - hh * 0.3, z, 0.16, 0.07, half * 0.95,
              HALL_HUE.beam, 0.7, false);

      // 照明帯。等間隔に流れることで、通路の長さと自分の速さが分かる。
      addPart(bx - hw * 0.9, by + hh * 0.1, z, 0.05, 0.05, half * 0.62,
              look.light, 0, true);
      addPart(bx + hw * 0.9, by + hh * 0.1, z, 0.05, 0.05, half * 0.62,
              look.light, 0, true);
    }

    // 奥の部材から描く。これで前後関係が正しくなる。
    parts.sort(function (a, b) { return b.depth - a.depth; });

    c.save();
    c.lineJoin = 'round';

    for (var k = 0; k < parts.length; k++) {
      var p = parts[k];

      // 奥ほど霞ませる。距離が伝わり、遠くの面のちらつきも抑えられる。
      var fade = M.clamp(1.35 - p.depth / (period * cells), 0.06, 1);

      mesh3d.drawMesh(c, mesh3d.CUBE, {
        pos: p.pos,
        scale: p.size,
        rx: p.rx,
        ry: p.ry,
        focal: focal,
        cx: cx,
        cy: cy,
        hue: (f.hue * 0.25 + p.hue + (p.emissive ? 0 : look.hue)) % 360,
        // 彩度もステージごとに変える。色相だけ動かしても、金属の映り込みで
        // 色が抜けてしまい、違う場所へ来た感じが出ないため。
        sat: p.emissive ? 92 : look.sat,
        metal: p.metal,
        emissive: p.emissive,
        // 映り込む照明の位置を走行に合わせて流す
        phase: f.t * 0.8 + travel * 0.25,
        dim: fade,
        alpha: 1,
        // 照明帯は光の面として見せたいので、輪郭線を描かない。
        // 線が入ると板を貼ったように見え、光っている感じが消える。
        edges: false
      });
    }

    c.restore();
  }

  // -----------------------------------------------------------------
  // S3 トンネル（触れる区間）
  // -----------------------------------------------------------------

  /**
   * @brief トンネルを走るシーン。触れている間は操縦できる。
   * @param {Object} f フレーム文脈
   * @returns {void}
   */
  /**
   * @brief トンネルに浮かぶ立体の配置。
   */
  var SOLIDS = {
    /** @brief 立体の大きさ。 */
    scale: 0.19,
    /**
     * @brief 色相が一周する速さ [deg/s]。
     *
     * 拾う対象は建造物と別の存在だと一目で分かる必要がある。
     * 建造物が同系色でまとまっているぶん、こちらは虹色に回して対比させる。
     */
    hueSpeed: 350,
    /** @brief 奥行き1つぶんあたりの色相のずれ [deg]。列が虹の帯に見える。 */
    hueByDepth: 42
  };

  /**
   * @brief トンネルに浮かぶ立体を描く。
   *
   * レイマーチングではなく三角形で描く。面が8枚しかない物体を
   * 1ピクセルずつ探すより、頂点を回して塗る方が速く、輪郭も鮮明になる。
   *
   * @private
   * @param {Object} f フレーム文脈
   * @param {number} travel 走行距離（奥行きの基準）
   * @returns {void}
   */
  function drawSolids(f) {
    var mesh3d = global.PULSAR.mesh3d;
    var game = global.PULSAR.game;

    var c = f.ctx;
    var cx = f.W / 2;
    var cy = f.H / 2;
    var focal = Math.min(f.W, f.H) * game.CONFIG.focal;
    var pos = [0, 0, 0];

    // 立方体はリングに連れられている。切れ目の中心に浮かせることで、
    // 「あの切れ目を中心で抜ければ拾える」と見ただけで分かる。
    var rings = game.state.rings;
    var order = rings.slice().sort(function (a, b) { return b.z - a.z; });

    c.save();
    c.lineJoin = 'round';

    for (var i = 0; i < order.length; i++) {
      var r = order[i];
      if (!r.item || r.itemTaken || r.z <= 0.35) continue;

      // リングの内側に収まる位置へ置く。切れ目の中心の、少し内より。
      var orbit = game.cursorRadius(focal) / focal * game.CONFIG.shipZ * 0.62;

      pos[0] = Math.cos(r.itemAngle) * orbit;
      pos[1] = Math.sin(r.itemAngle) * orbit;
      pos[2] = r.z;

      // 奥ほど薄く。手前の立体だけが主張するようにする。
      var alpha = M.clamp(1.3 - r.z / game.CONFIG.farZ, 0.15, 1);

      // 色相を時間と奥行きで回す。列全体が虹の帯として流れて見える。
      var hue = (f.t * SOLIDS.hueSpeed + r.z * SOLIDS.hueByDepth) % 360;

      mesh3d.drawMesh(c, mesh3d.CUBE, {
        pos: pos,
        scale: SOLIDS.scale * (1 + f.kick * 0.18),
        rx: f.t * 1.1 + r.z,
        ry: f.t * 0.7 + r.z * 0.6,
        focal: focal,
        cx: cx,
        cy: cy,
        hue: hue,
        sat: 95,
        metal: 0.5,
        // 拾う対象だと一目で分かるよう、自ら光らせて背景から浮かせる
        emissive: true,
        // 稜線を描かない。色の面だけの方が、光の塊として見える
        edges: false,
        phase: f.t,
        alpha: alpha
      });
    }

    c.restore();
  }

  function drawTunnel(f) {
    var game = global.PULSAR.game;
    game.update(f);

    var c = f.ctx;
    c.globalCompositeOperation = 'source-over';

    if (backgroundOn) {
      // 走った距離をそのままカメラ位置にするため、手前のリングと
      // 奥の構造物が同じ速さで流れ、立体感が一致する。
      c.fillStyle = '#04050a';
      c.fillRect(0, 0, f.W, f.H);
      drawHall(f, game.state.dist);
    } else {
      // 背景なしのときは毎フレーム塗りつぶす。
      //
      // 残像を残す（薄く重ねる）方式にすると、加算で描くグレアの光が
      // 前の絵に残り、それをまた明るくする循環に入って画面が白く飽和する。
      // 背景を描かない場面では前の絵を持ち越さないのが確実。
      c.fillStyle = '#04050a';
      c.fillRect(0, 0, f.W, f.H);
    }

    // 立体はリングより先に描く。リングと自機が常に手前に見える方が、
    // 避ける対象を見失わずに済む。
    drawSolids(f);

    game.draw(f);
    // スコア表示と操作案内は main.js が DOM 側でまとめて担当する。
  }

  // -----------------------------------------------------------------
  // S4 メタボール
  // -----------------------------------------------------------------

  /**
   * @brief 距離場をしきい値で切った、にじむ塊。
   * @param {Object} f フレーム文脈
   * @returns {void}
   */
  function drawMetaballs(f) {
    var bw = f.buf.width;
    var bh = f.buf.height;
    var img = getImage(f.bufCtx, bw, bh);
    var data = img.data;
    var t = f.t;

    // 玉の数は負荷に直結するため、小さい画面では減らす。
    var count = f.light ? 4 : 6;
    var balls = [];
    for (var i = 0; i < count; i++) {
      var a = t * (0.5 + i * 0.17) + i * 1.7;
      balls.push({
        x: bw * (0.5 + Math.cos(a) * 0.32),
        y: bh * (0.5 + Math.sin(a * 1.3 + i) * 0.34),
        r: (bw * 0.13) * (0.7 + 0.5 * Math.sin(t * 1.1 + i))
      });
    }

    for (var y = 0; y < bh; y++) {
      for (var x = 0; x < bw; x++) {
        var field = 0;
        for (var b = 0; b < balls.length; b++) {
          var dx = x - balls[b].x;
          var dy = y - balls[b].y;
          field += (balls[b].r * balls[b].r) / (dx * dx + dy * dy + 1);
        }

        var o = (y * bw + x) * 4;
        // しきい値の前後で色を切り替え、輪郭を帯として見せる。
        var v = M.clamp(field * 0.55, 0, 1.6);

        // こちらも共通色相を縮めて使い、青紫の範囲に留める。
        var hue = (f.hue * 0.25 + 228 + v * 55) % 360;
        var light = v < 0.85 ? v * 0.14 : 0.24 + (v - 0.85) * 0.5;
        var rgb = hslToRgb(hue / 360, 0.8, M.clamp(light, 0, 0.7));

        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
        data[o + 3] = 255;
      }
    }

    f.bufCtx.putImageData(img, 0, 0);
    fadeCanvas(f, 0.55);
    blitBuffer(f, 0.95);
  }

  // -----------------------------------------------------------------
  // S5 コッパーバー + スクロールテキスト
  // -----------------------------------------------------------------

  /**
   * @brief 横帯の走査と、波打つ横スクロール文字。デモの締めにあたる場面。
   * @param {Object} f フレーム文脈
   * @returns {void}
   */
  function drawCopper(f) {
    var c = f.ctx;
    c.fillStyle = '#04050a';
    c.fillRect(0, 0, f.W, f.H);

    // --- コッパーバー ---
    //
    // 帯は画面の高さに等間隔で配り、そこから小さく揺らす。
    // 全部を同じ正弦波で動かすと一箇所に集まり、加算合成で白く飽和して
    // 何が映っているのか分からなくなる。
    var bars = f.light ? 5 : 8;
    var h = f.H * 0.042 * (1 + f.kick * 0.35);

    c.globalCompositeOperation = 'lighter';

    for (var i = 0; i < bars; i++) {
      var slot = (i + 0.5) / bars;                       // 等間隔の定位置
      var wobble = Math.sin(f.t * 1.1 + i * 0.9) * 0.055; // 定位置からの揺れ
      var cy = f.H * (slot + wobble);

      // 色相の幅を狭く保つ。広く散らすと重なった部分が白へ寄る。
      // 共通色相も縮めて使い、他の場面と同じ色の家族に収める。
      var hue = f.hue * 0.25 + 212 + (i - bars * 0.5) * 9;

      // 中心が明るく端が暗い帯。縦方向のグラデーションで厚みを出す。
      var grad = c.createLinearGradient(0, cy - h, 0, cy + h);
      grad.addColorStop(0, M.hsl(hue, 92, 6, 0));
      grad.addColorStop(0.45, M.hsl(hue, 92, 46, 0.62));
      grad.addColorStop(0.5, M.hsl(hue, 80, 62, 0.75));
      grad.addColorStop(0.55, M.hsl(hue, 92, 46, 0.62));
      grad.addColorStop(1, M.hsl(hue, 92, 6, 0));
      c.fillStyle = grad;
      c.fillRect(0, cy - h, f.W, h * 2);
    }

    c.globalCompositeOperation = 'source-over';

    // 文字の帯だけ暗く落とし、背後の帯に埋もれないようにする。
    var textY = f.H * 0.5;
    var band = c.createLinearGradient(0, textY - f.H * 0.22, 0, textY + f.H * 0.22);
    band.addColorStop(0, 'rgba(4,5,10,0)');
    band.addColorStop(0.5, 'rgba(4,5,10,0.72)');
    band.addColorStop(1, 'rgba(4,5,10,0)');
    c.fillStyle = band;
    c.fillRect(0, textY - f.H * 0.22, f.W, f.H * 0.44);

    drawScroller(f);
  }

  /**
   * @brief 正弦波で上下に波打つ横スクロール文字を描く。
   * @private
   * @param {Object} f フレーム文脈
   * @returns {void}
   */
  function drawScroller(f) {
    var c = f.ctx;
    var size = M.clamp(f.W * 0.045, 18, 34);
    var speed = 190; // [px/s]

    c.save();
    c.font = '700 ' + size.toFixed(0) + 'px "Consolas", monospace';
    c.textBaseline = 'middle';
    c.textAlign = 'left';

    var chars = SCROLL_TEXT.split('');
    var x = f.W - (f.t * speed) % (measureText(c, SCROLL_TEXT) + f.W);
    var baseY = f.H * 0.5;

    for (var i = 0; i < chars.length; i++) {
      var w = c.measureText(chars[i]).width;

      // 画面外の文字は描かない（1文字ずつ描くため、これが効く）
      if (x > -w && x < f.W) {
        var wave = Math.sin(x * 0.012 + f.t * 2.2) * f.H * 0.09;
        var hue = f.hue + x * 0.25;
        c.fillStyle = M.hsl(hue, 95, 72, 0.95);
        c.fillText(chars[i], x, baseY + wave);
      }
      x += w;
      if (x > f.W) break;
    }

    c.restore();
  }

  /**
   * @brief 文字列全体の描画幅を測る（スクロールの折り返し位置に使う）。
   * @private
   * @param {CanvasRenderingContext2D} c 計測に使う文脈（フォント設定済みであること）
   * @param {string} text 対象の文字列
   * @returns {number} 幅 [px]
   */
  function measureText(c, text) {
    return c.measureText(text).width;
  }

  // -----------------------------------------------------------------
  // タイムライン
  // -----------------------------------------------------------------

  /**
   * @brief 再生順。`duration` は秒。合計すると1周の長さになる。
   *
   * `glare` はその場面でのグレアの強さの倍率。画面全体が明るい場面では
   * グレアが乗ると白く飛んでしまうため、場面ごとに抑える。
   *
   * @type {Array<{name: string, duration: number, transition: string,
   *               glare: number, draw: Function}>}
   */
  var timeline = [
    { name: 'starfield', duration: 9,  transition: 'flash',  glare: 0.45, draw: drawStarfield },
    { name: 'plasma',    duration: 8,  transition: 'wipe',   glare: 0.35, draw: drawPlasma },
    { name: 'tunnel',    duration: 16, transition: 'flash',  glare: 1,    draw: drawTunnel },
    { name: 'metaballs', duration: 8,  transition: 'blinds', glare: 0.4, draw: drawMetaballs },
    { name: 'copper',    duration: 12, transition: 'wipe',   glare: 0.5,  draw: drawCopper }
  ];

  global.PULSAR.scenes = {
    timeline: timeline,
    HALL: HALL,
    STAGE_LOOK: STAGE_LOOK,
    setRaymarch: setRaymarch,
    isRaymarch: isRaymarch,
    SCROLL_TEXT: SCROLL_TEXT,
    hslToRgb: hslToRgb,
    drawHall: drawHall
  };
})(typeof window !== 'undefined' ? window : this);
