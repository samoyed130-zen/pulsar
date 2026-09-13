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
    fadeCanvas(f, 0.28);

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
      c.strokeStyle = M.hsl(f.hue + near * 90, 85, 60 + near * 35, 0.25 + near * 0.75);
      c.lineWidth = 0.6 + near * 2.4;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(x, y);
      c.stroke();
    }

    c.globalCompositeOperation = 'source-over';
    drawTitle(f);
  }

  /**
   * @brief 作品名を中央に重ねる（スターフィールドの前半のみ）。
   * @private
   * @param {Object} f フレーム文脈
   * @returns {void}
   */
  function drawTitle(f) {
    var appear = M.clamp((f.local - 0.6) / 1.2, 0, 1);
    var leave = M.clamp(1 - (f.local - 6.0) / 1.2, 0, 1);
    var a = M.easeInOut(appear) * M.easeInOut(leave);
    if (a <= 0.01) return;

    var c = f.ctx;
    var size = Math.min(f.W * 0.19, f.H * 0.3);

    c.save();
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '800 ' + size.toFixed(0) + 'px "Consolas", "Impact", system-ui, sans-serif';
    c.globalCompositeOperation = 'lighter';

    // 色をずらして三重に重ね、簡易的な色収差を作る。
    var shift = 2 + f.kick * 5;
    c.fillStyle = M.hsl(f.hue, 100, 60, a * 0.55);
    c.fillText('PULSAR', f.W / 2 - shift, f.H / 2);
    c.fillStyle = M.hsl(f.hue + 160, 100, 60, a * 0.55);
    c.fillText('PULSAR', f.W / 2 + shift, f.H / 2);
    c.fillStyle = 'rgba(255,255,255,' + (a * 0.8).toFixed(3) + ')';
    c.fillText('PULSAR', f.W / 2, f.H / 2);

    c.restore();
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
        var hue = (f.hue + n * 220) % 360;
        var rgb = hslToRgb(hue / 360, 0.85, 0.28 + n * 0.42);

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
  // レイマーチングによる立体背景
  // -----------------------------------------------------------------

  /**
   * @brief レイマーチングの調整値。
   *
   * 1ピクセルごとに光線を進めるため、解像度と歩数がそのまま負荷になる。
   * 低解像度で描いて拡大し、にじみを味として使う。
   */
  var RAY = {
    /** @brief 光線を進める回数。多いほど精細で重い。 */
    steps: 18,
    /** @brief 描画量を落とすときの歩数。 */
    stepsLight: 12,
    /** @brief 描画に使う横幅 [px]。拡大前提なので粗くてよい。 */
    width: 112,
    /** @brief 描画量を落とすときの横幅 [px]。 */
    widthLight: 84,
    /** @brief 光線を打ち切る距離。 */
    far: 26,
    /** @brief 1歩の最小距離。小さすぎると進まず、歩数を無駄にする。 */
    minStep: 0.16
  };

  /**
   * @brief 立体背景を描くかどうか。
   *
   * 1ピクセルずつ光線を進める処理は、この作品でいちばん重い。
   * 描画が追いつかない端末でも遊べるよう、切れるようにしてある。
   * @private
   */
  var raymarchEnabled = true;

  /**
   * @brief 立体背景の有無を設定する。
   * @param {boolean} on 描くなら true
   * @returns {void}
   */
  function setRaymarch(on) {
    raymarchEnabled = !!on;
    try {
      global.localStorage.setItem('pulsar.bg', raymarchEnabled ? '1' : '0');
    } catch (e) { /* 保存できなくても動作には影響しない */ }
  }

  /**
   * @brief 立体背景を描く設定になっているか。
   * @returns {boolean} 描くなら true
   */
  function isRaymarch() {
    return raymarchEnabled;
  }

  // 前回の選択を復元する。設定が読めない環境では既定（描く）のままにする。
  try {
    if (global.localStorage.getItem('pulsar.bg') === '0') raymarchEnabled = false;
  } catch (e) { /* 既定のまま */ }

  /**
   * @brief レイマーチング専用のバッファ。
   *
   * 他のエフェクトより粗い解像度で描くため、共有バッファとは別に持つ。
   * @private
   */
  var rayBuf = null, rayCtx = null;

  /**
   * @brief レイマーチング用バッファを、必要な大きさで用意する。
   * @private
   * @param {number} w 幅 [px]
   * @param {number} h 高さ [px]
   * @returns {void}
   */
  function ensureRayBuffer(w, h) {
    if (!rayBuf) {
      rayBuf = document.createElement('canvas');
      rayCtx = rayBuf.getContext('2d', { willReadFrequently: true });
    }
    if (rayBuf.width !== w || rayBuf.height !== h) {
      rayBuf.width = w;
      rayBuf.height = h;
    }
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
   * @brief 空間上の点から、最も近い物体までのおおよその距離を返す（距離関数）。
   *
   * 形は2つだけ:
   * - ねじれながら続く筒の内壁（波打たせて、のっぺりした面に見せない）
   * - 一定間隔で並ぶ細い輪
   *
   * この2つを `min` で合成するだけで、奥へ続く構造物になる。
   *
   * @private
   * @param {number} x 座標 x
   * @param {number} y 座標 y
   * @param {number} z 座標 z（奥行き）
   * @param {number} t 時刻 [s]
   * @returns {number} 距離（正なら物体の外側）
   */
  function sceneDistance(x, y, z, t) {
    // 空間を回転させても中心軸からの距離は変わらないため、回転の計算は要らない。
    // 代わりに筒の中心を奥行きに応じてずらすことで、曲がりくねった通路にする。
    // 三角関数の呼び出しはここの2回だけ。1ピクセルあたり何十回も通るため効く。
    var s1 = Math.sin(z * 0.55 + t * 1.2);
    var c1 = Math.cos(z * 0.23 - t * 0.7);

    var dx = x - s1 * 1.15;
    var dy = y - c1 * 1.15;
    var rad = Math.sqrt(dx * dx + dy * dy);

    // 内壁までの距離。半径も波打たせて、脈打つ洞窟のようにする。
    var wall = 3.5 + s1 * 0.3 + c1 * 0.25 - rad;

    // 一定間隔で並ぶ輪。繰り返しで表現するので、何個置いても計算量は変わらない。
    var period = 2.8;
    var zz = z - Math.floor(z / period) * period - period * 0.5;
    var qx = rad - 2.9;
    var ring = Math.sqrt(qx * qx + zz * zz) - 0.13;

    return wall < ring ? wall : ring;
  }

  /**
   * @brief レイマーチングで立体的な背景を描く。
   *
   * 法線も陰影も計算しない。光線を進めながら物体への近さを足し込むだけの
   * 「グロー蓄積」方式にしている。計算が軽いうえ、デモらしい発光した見た目になる。
   *
   * @param {Object} f フレーム文脈
   * @param {number} camZ カメラの奥行き位置（進むほど増える）
   * @param {number} brightness 明るさの倍率 [0..1]
   * @returns {void}
   */
  function drawRaymarch(f, camZ, brightness) {
    var bw = f.light ? RAY.widthLight : RAY.width;
    var bh = Math.max(1, Math.round(bw * f.H / Math.max(1, f.W)));
    ensureRayBuffer(bw, bh);

    var img = getImage(rayCtx, bw, bh);
    var data = img.data;

    var steps = f.light ? RAY.stepsLight : RAY.steps;
    var t = f.t;
    var aspect = bw / bh;
    var hueBase = f.hue;

    for (var py = 0; py < bh; py++) {
      // 画面座標を -1..1 に写す
      var sy = (py / bh) * 2 - 1;

      for (var px = 0; px < bw; px++) {
        var sx = ((px / bw) * 2 - 1) * aspect;

        // 光線の向き（正規化は省き、z を 1 に固定して近似する）
        var len = Math.sqrt(sx * sx + sy * sy + 1);
        var dx = sx / len, dy = sy / len, dz = 1 / len;

        var dist = 0.4;
        var glow = 0;

        for (var i = 0; i < steps; i++) {
          var d = sceneDistance(dx * dist, dy * dist, camZ + dz * dist, t);
          var ad = d < 0 ? -d : d;

          // 物体に近いほど強く光る。表面に触れなくても輪郭が浮かび上がる。
          glow += 0.09 / (0.06 + ad * ad);

          dist += ad * 0.75 + RAY.minStep;
          if (dist > RAY.far) break;
        }

        // 奥ほど暗く落として、距離を感じさせる
        var v = glow / steps * brightness;
        v = v > 1.4 ? 1.4 : v;

        var hue = (hueBase + v * 150 + 200) % 360;
        var rgb = hslToRgb(hue / 360, 0.85, v * 0.42);

        var o = (py * bw + px) * 4;
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
        data[o + 3] = 255;
      }
    }

    rayCtx.putImageData(img, 0, 0);

    var c = f.ctx;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#04050a';
    c.fillRect(0, 0, f.W, f.H);

    c.save();
    c.imageSmoothingEnabled = true;
    c.drawImage(rayBuf, 0, 0, f.W, f.H);
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
  function drawTunnel(f) {
    var game = global.PULSAR.game;
    game.update(f);

    if (raymarchEnabled) {
      // 背景はレイマーチングで描く。走った距離をそのままカメラの位置にするため、
      // 手前のリングと奥の構造物が同じ速さで流れ、立体感が一致する。
      drawRaymarch(f, game.state.dist * 0.55, 0.75 + game.gauge() * 0.5);
    } else {
      // 背景なしのときは残像だけを残し、リングの軌跡で奥行きを見せる。
      fadeCanvas(f, 0.26);
    }

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
        var hue = (f.hue + 40 + v * 130) % 360;
        var light = v < 0.85 ? v * 0.18 : 0.28 + (v - 0.85) * 0.55;
        var rgb = hslToRgb(hue / 360, 0.9, M.clamp(light, 0, 0.78));

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
    var bars = f.light ? 5 : 8;
    c.globalCompositeOperation = 'lighter';
    for (var i = 0; i < bars; i++) {
      var phase = f.t * 1.1 + i * 0.8;
      var cy = f.H * (0.5 + Math.sin(phase) * 0.34);
      var h = f.H * 0.055 * (1 + f.kick * 0.5);
      var hue = f.hue + i * 26;

      // 中心が明るく端が暗い帯。縦方向のグラデーションで厚みを出す。
      var grad = c.createLinearGradient(0, cy - h, 0, cy + h);
      grad.addColorStop(0, M.hsl(hue, 95, 8, 0));
      grad.addColorStop(0.5, M.hsl(hue, 95, 62, 0.85));
      grad.addColorStop(1, M.hsl(hue, 95, 8, 0));
      c.fillStyle = grad;
      c.fillRect(0, cy - h, f.W, h * 2);
    }
    c.globalCompositeOperation = 'source-over';

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
   * @type {Array<{name: string, duration: number, transition: string, draw: Function}>}
   */
  var timeline = [
    { name: 'starfield', duration: 9,  transition: 'flash',  draw: drawStarfield },
    { name: 'plasma',    duration: 8,  transition: 'wipe',   draw: drawPlasma },
    { name: 'tunnel',    duration: 16, transition: 'flash',  draw: drawTunnel },
    { name: 'metaballs', duration: 8,  transition: 'blinds', draw: drawMetaballs },
    { name: 'copper',    duration: 12, transition: 'wipe',   draw: drawCopper }
  ];

  global.PULSAR.scenes = {
    timeline: timeline,
    RAY: RAY,
    setRaymarch: setRaymarch,
    isRaymarch: isRaymarch,
    SCROLL_TEXT: SCROLL_TEXT,
    hslToRgb: hslToRgb,
    sceneDistance: sceneDistance
  };
})(typeof window !== 'undefined' ? window : this);
