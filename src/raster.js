/**
 * @file raster.js
 * @brief 三角形を1画素ずつ塗る、自前のソフトウェアラスタライザ。
 *
 * Canvas 2D の `fill()` は三角形を1色か、せいぜい直線状のグラデーションでしか
 * 塗れない。頂点ごとの色を面の中で混ぜる仕組みがないため、平らな面が単色に
 * 潰れ、面と面の境目が線として浮いてしまう。
 *
 * そこで塗りだけを自前で持つ。画素ごとに三角形の中かどうかを判定し、
 * 中にあれば3頂点の色を重心座標で混ぜて書き込む。GPU が固定機能として
 * 持っている処理を、そのまま JavaScript で書き下ろした形になる。
 *
 * 得られるもの:
 * - 頂点カラーの面内補間（グーローシェーディング）
 * - Z バッファによる正しい前後関係（面を並べ替えなくてよい）
 *
 * 代償は速度で、画素数がそのまま処理時間になる。低い解像度のバッファへ描いて
 * 拡大する前提で使う。
 */
(function (global) {
  'use strict';

  /**
   * @brief 描画先のバッファを作る。
   *
   * 色は `Uint32Array` で持つ。`ImageData` と同じ並び（リトルエンディアンで
   * ABGR）にしてあるので、書き出すときは中身をそのまま渡せる。1画素を
   * 1回の書き込みで済ませられるため、成分ごとに4回書くより速い。
   *
   * @param {number} w 幅 [px]
   * @param {number} h 高さ [px]
   * @param {ImageData} [img] 色をここへ直接書くなら渡す
   * @returns {Object} バッファ
   */
  function createBuffer(w, h, img) {
    return {
      w: w,
      h: h,
      /**
       * @brief 色。1要素が1画素（ABGR）。
       *
       * `ImageData` を渡された場合はその中身を直接指す。画面へ出すときに
       * 詰め替えが要らなくなる（1画面ぶんのコピーは無視できない量になる）。
       */
      color: img ? new Uint32Array(img.data.buffer) : new Uint32Array(w * h),
      /**
       * @brief 奥行き。奥行きの逆数を入れる。
       *
       * 逆数にするのは、画面上で線形に変化するのが z ではなく 1/z だから。
       * 大きいほど手前になるので、比較は「大きければ書く」になる。
       */
      depth: new Float32Array(w * h)
    };
  }

  /**
   * @brief バッファを空にする。
   *
   * 色は透明で埋める。何も描かれなかった画素をそのまま透かすことで、
   * 画面へ重ねたときに下の絵（残像など）が残る。
   *
   * @param {Object} buf 描画先
   * @returns {void}
   */
  function clear(buf) {
    buf.color.fill(0);
    buf.depth.fill(0);
  }

  /**
   * @brief 三角形を、頂点の色を混ぜながら塗る。
   *
   * 各頂点は `[x, y, z, r, g, b]`。x, y は画面座標 [px]、z はカメラからの
   * 奥行き（正で、大きいほど奥）、r, g, b は [0..255]。
   *
   * 手順:
   *
   * 1. 3辺それぞれについて「その辺から見て内側か」を表す式を作る。
   *    3つとも同符号なら三角形の中にある
   * 2. 外接する矩形の中だけを走査する。式は1次なので、x が1つ進むごとに
   *    一定量ずつ変わる。毎回計算し直さず、足していくだけでよい
   * 3. 中にあれば重心座標が求まるので、奥行きと色を混ぜる
   *
   * 色は奥行きで割ってから混ぜ、最後に掛け戻している（透視補正）。
   * 画面上で等間隔でも、奥行きの違う頂点の間では実際の間隔が違うためで、
   * これを省くと奥へ伸びる長い面で色の変化が歪む。
   *
   * @param {Object} buf 描画先
   * @param {Array<number>} v0 頂点1 [x, y, z, r, g, b]
   * @param {Array<number>} v1 頂点2
   * @param {Array<number>} v2 頂点3
   * @param {number} alpha 不透明度 [0..1]。1 未満なら下の色と混ぜる
   * @returns {void}
   */
  function triangle(buf, v0, v1, v2, alpha) {
    var w = buf.w, h = buf.h;

    var x0 = v0[0], y0 = v0[1];
    var x1 = v1[0], y1 = v1[1];
    var x2 = v2[0], y2 = v2[1];

    // 面積の2倍。符号が向きを表す。0 なら潰れているので描くものがない。
    var area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    if (area === 0) return;

    // 裏向きでも同じ式で扱えるよう、符号を揃えておく。
    var sign = area < 0 ? -1 : 1;
    var invArea = 1 / (area * sign);

    var minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    var maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
    var minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    var maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) return;

    // 辺の式の係数。x が1進むと a、y が1進むと b だけ変わる。
    var a0 = (y1 - y2) * sign, b0 = (x2 - x1) * sign;
    var a1 = (y2 - y0) * sign, b1 = (x0 - x2) * sign;
    var a2 = (y0 - y1) * sign, b2 = (x1 - x0) * sign;

    // 走査を始める画素の中心での値。
    var px = minX + 0.5, py = minY + 0.5;
    var row0 = (a0 * (px - x1) + b0 * (py - y1));
    var row1 = (a1 * (px - x2) + b1 * (py - y2));
    var row2 = (a2 * (px - x0) + b2 * (py - y0));

    // 奥行きの逆数と、奥行きで割った色。どちらも画面上で線形に変わる。
    var iz0 = 1 / v0[2], iz1 = 1 / v1[2], iz2 = 1 / v2[2];
    var r0 = v0[3] * iz0, g0 = v0[4] * iz0, bl0 = v0[5] * iz0;
    var r1 = v1[3] * iz1, g1 = v1[4] * iz1, bl1 = v1[5] * iz1;
    var r2 = v2[3] * iz2, g2 = v2[4] * iz2, bl2 = v2[5] * iz2;

    var opaque = alpha >= 1;
    var color = buf.color, depth = buf.depth;

    for (var y = minY; y <= maxY; y++) {
      var e0 = row0, e1 = row1, e2 = row2;
      var idx = y * w + minX;

      for (var x = minX; x <= maxX; x++, idx++) {
        // 3辺すべての内側にあるか
        if (e0 >= 0 && e1 >= 0 && e2 >= 0) {
          var l0 = e0 * invArea, l1 = e1 * invArea, l2 = e2 * invArea;
          var iz = l0 * iz0 + l1 * iz1 + l2 * iz2;

          if (iz > depth[idx]) {
            var z = 1 / iz;
            var r = (l0 * r0 + l1 * r1 + l2 * r2) * z;
            var g = (l0 * g0 + l1 * g1 + l2 * g2) * z;
            var b = (l0 * bl0 + l1 * bl1 + l2 * bl2) * z;

            var dst = color[idx];

            // まだ何も描かれていない画素は、混ぜる相手がいない。
            // 透明な黒と混ぜると、そこだけ暗く縁取られて見えてしまう。
            if (!opaque && (dst >>> 24) !== 0) {
              // 下の色と混ぜる。奥行きは書き換えない。透けているものの
              // 後ろにあるものを、後から描けなくなってしまうため。
              var inv = 1 - alpha;
              r = r * alpha + (dst & 255) * inv;
              g = g * alpha + ((dst >> 8) & 255) * inv;
              b = b * alpha + ((dst >> 16) & 255) * inv;
            } else if (opaque) {
              depth[idx] = iz;
            }

            color[idx] = (255 << 24) |
                         ((b < 0 ? 0 : b > 255 ? 255 : b) << 16) |
                         ((g < 0 ? 0 : g > 255 ? 255 : g) << 8) |
                         (r < 0 ? 0 : r > 255 ? 255 : r);
          }
        }

        e0 += a0; e1 += a1; e2 += a2;
      }

      row0 += b0; row1 += b1; row2 += b2;
    }
  }

  /**
   * @brief HSL を RGB に直す。
   *
   * 陰影の計算は明るさを直接扱える HSL の方が書きやすいが、画素へ書くときは
   * RGB が要る。1画素ごとではなく頂点ごとにしか呼ばないので、素直な式でよい。
   *
   * @param {number} hue 色相 [deg]
   * @param {number} sat 彩度 [%]
   * @param {number} light 明るさ [%]
   * @param {Array<number>} out 書き込み先（3要素）
   * @returns {Array<number>} out（r, g, b いずれも [0..255]）
   */
  function hslToRgb(hue, sat, light, out) {
    var s = sat / 100, l = light / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = (((hue % 360) + 360) % 360) / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;

    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }

    out[0] = (r + m) * 255;
    out[1] = (g + m) * 255;
    out[2] = (b + m) * 255;
    return out;
  }

  global.PULSAR = global.PULSAR || {};
  global.PULSAR.raster = {
    createBuffer: createBuffer,
    clear: clear,
    triangle: triangle,
    hslToRgb: hslToRgb
  };
})(typeof window !== 'undefined' ? window : this);
