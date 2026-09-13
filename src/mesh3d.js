/**
 * @file mesh3d.js
 * @brief 三角形による立体描画。回転・透視変換・裏面消去・陰影づけを自前で行う。
 *
 * レイマーチングは面を1ピクセルずつ探すため、面の数が少ない立体には割に合わない。
 * 頂点を回して画面へ落とし、三角形を塗る方が速く、輪郭もはっきり出る。
 *
 * 座標系:
 * - 右手系。x は右、y は下、z は奥。
 * - カメラは原点にあり、z の正方向を見ている。
 * - 画面位置は `screen = center + world * focal / z` で求める（単純な透視投影）。
 *
 * 外部ライブラリは使用していない。行列も使わず、必要な回転だけを直接書いている。
 */
(function (global) {
  'use strict';

  /**
   * @brief 正八面体。6頂点8面。
   *
   * 各頂点が軸の上にあるため、頂点をそのまま書き下せる。
   */
  var OCTAHEDRON = {
    name: 'octahedron',
    verts: [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ],
    faces: [
      [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
      [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]
    ]
  };

  /**
   * @brief 立方体。8頂点を三角形12枚で表す。
   */
  var CUBE = {
    name: 'cube',
    verts: [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
    ],
    // 頂点は反時計回りに並べる。この順序が面の表裏を決めるため、
    // 逆に書くと裏面消去で立体が丸ごと消える。
    faces: [
      [2, 1, 0], [3, 2, 0],
      [7, 4, 5], [6, 7, 5],
      [3, 0, 4], [7, 3, 4],
      [6, 5, 1], [2, 6, 1],
      [1, 5, 4], [0, 1, 4],
      [6, 2, 3], [7, 6, 3]
    ]
  };

  /**
   * @brief 四面体。最も面の少ない立体で、遠景用に使う。
   */
  var TETRAHEDRON = {
    name: 'tetrahedron',
    verts: [
      [1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]
    ],
    faces: [
      [2, 1, 0], [1, 3, 0], [3, 2, 0], [2, 3, 1]
    ]
  };

  /** @brief 光の向き（正規化済み）。面の傾きで明るさを変えるために使う。 */
  var LIGHT = [0.43, -0.57, -0.70];

  /**
   * @brief 環境マッピングの設定。
   *
   * 金属面に映り込む「周囲の景色」を、画像を用意せずその場で作る。
   * 反射した向きが上を向いていれば明るい天井、下を向いていれば暗い床、
   * 横を向いていれば等間隔に並ぶ照明が映る、と決めておけばよい。
   * 実際の周囲と厳密に一致していなくても、面の向きに応じて映り込みが
   * 動きさえすれば、目は金属だと解釈する。
   */
  var ENV = {
    /** @brief 上方向（天井側）に映る明るさ。 */
    skyLight: 74,
    /** @brief 下方向（床側）に映る明るさ。 */
    floorLight: 6,
    /** @brief 横方向に映る照明の本数。 */
    streaks: 6,
    /** @brief 映り込む照明の鋭さ。大きいほど細く締まった光になる。 */
    streakSharp: 10,
    /** @brief 映り込む照明の強さ。 */
    streakGain: 38
  };

  /**
   * @brief 反射した向きに何が映るかを返す（環境マッピング）。
   *
   * @private
   * @param {number} rx 反射方向 x
   * @param {number} ry 反射方向 y（下が正）
   * @param {number} rz 反射方向 z
   * @param {number} phase 照明の位置をずらす量。動かすと映り込みが流れる
   * @returns {number} 映り込みの明るさ [0..100 相当]
   */
  function environment(rx, ry, rz, phase) {
    // 上下の向きで、天井の明かりと暗い床を混ぜる。
    var up = -ry;                       // y は下が正なので反転する
    var mix = (up + 1) * 0.5;           // -1..1 を 0..1 へ
    var base = ENV.floorLight + (ENV.skyLight - ENV.floorLight) * mix * mix;

    // 横方向には照明が等間隔に並んでいることにする。
    var angle = Math.atan2(rx, rz);
    var s = Math.sin(angle * ENV.streaks + phase);
    s = s > 0 ? s : 0;

    // 累乗して細い光にする（pow より掛け算の方が速い）
    var s2 = s * s;
    var s4 = s2 * s2;
    var s8 = s4 * s4;

    var v = base + s8 * ENV.streakGain * (0.35 + mix * 0.65);

    // 明度として使うため、100 を超えないようにする。
    return v > 100 ? 100 : v;
  }

  /**
   * @brief 点を x 軸・y 軸まわりに回してから平行移動する。
   * @param {Array<number>} p 元の座標 [x, y, z]
   * @param {number} rx x 軸まわりの回転 [rad]
   * @param {number} ry y 軸まわりの回転 [rad]
   * @param {number} scale 拡大率
   * @param {Array<number>} pos 平行移動量 [x, y, z]
   * @param {Array<number>} out 結果を書き込む長さ3の配列
   * @returns {void}
   */
  function transform(p, rx, ry, scale, pos, out) {
    var cx = Math.cos(rx), sx = Math.sin(rx);
    var cy = Math.cos(ry), sy = Math.sin(ry);

    // 拡大率は数値でも軸ごとの配列でもよい。柱や梁のような細長い部材は
    // 軸ごとに違う倍率が要るため。
    var kx, ky, kz;
    if (typeof scale === 'number') {
      kx = ky = kz = scale;
    } else {
      kx = scale[0]; ky = scale[1]; kz = scale[2];
    }

    var x = p[0] * kx;
    var y = p[1] * ky;
    var z = p[2] * kz;

    // x 軸まわり
    var y1 = y * cx - z * sx;
    var z1 = y * sx + z * cx;

    // y 軸まわり
    var x2 = x * cy + z1 * sy;
    var z2 = -x * sy + z1 * cy;

    out[0] = x2 + pos[0];
    out[1] = y1 + pos[1];
    out[2] = z2 + pos[2];
  }

  /**
   * @brief 3次元の点を画面座標へ落とす（透視投影）。
   * @param {number} x 空間座標 x
   * @param {number} y 空間座標 y
   * @param {number} z 空間座標 z（カメラからの奥行き）
   * @param {number} focal 焦点距離 [px]
   * @param {number} cx 画面中心 x [px]
   * @param {number} cy 画面中心 y [px]
   * @param {Array<number>} out 結果を書き込む長さ2の配列
   * @returns {boolean} カメラの前にあり、投影できたなら true
   */
  function project(x, y, z, focal, cx, cy, out) {
    // カメラの後ろ、または近すぎる点は描けない。
    // ここを大きくすると、近づいた面が消えたように見える。
    if (z <= 0.02) return false;
    out[0] = cx + x * focal / z;
    out[1] = cy + y * focal / z;
    return true;
  }

  /**
   * @brief 三角形の面の向き（法線）を求める。
   *
   * 2辺の外積を取る。頂点の並び順で向きが決まるため、
   * 面の表裏の判定にもそのまま使える。
   *
   * @param {Array<number>} a 頂点1
   * @param {Array<number>} b 頂点2
   * @param {Array<number>} c 頂点3
   * @param {Array<number>} out 結果を書き込む長さ3の配列（正規化済み）
   * @returns {void}
   */
  function faceNormal(a, b, c, out) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];

    var nx = uy * vz - uz * vy;
    var ny = uz * vx - ux * vz;
    var nz = ux * vy - uy * vx;

    var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    out[0] = nx / len;
    out[1] = ny / len;
    out[2] = nz / len;
  }

  /**
   * @brief 面がカメラに背を向けているかを判定する（裏面消去）。
   *
   * 面の法線と、カメラから面へ向かう向きの内積が正なら、その面は裏側。
   * 描かずに済ませることで、描画量が半分近くまで減る。
   *
   * @param {Array<number>} normal 面の法線
   * @param {Array<number>} point 面上の1点（カメラを原点とする座標）
   * @returns {boolean} 背を向けているなら true
   */
  function isBackFace(normal, point) {
    return (normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2]) > 0;
  }

  /** @brief 変換後の頂点。毎フレームの確保を避けるため使い回す。 @private */
  var vbuf = [];

  /** @brief 投影後の画面座標。 @private */
  var sbuf = [];

  /** @brief 描画対象の面。 @private */
  var visible = [];

  /**
   * @brief この大きさ未満の面は、グラデーションを作らず単色で塗る [px]。
   *
   * グラデーションは面ごとに作り直すため、数が増えると生成だけで重くなる。
   * 小さく映っている面では、作っても違いが見えない。
   */
  var GRADIENT_MIN_SIZE = 20;

  /** @brief 割って塗り分ける方式で、これ未満の面は1色にする [px]。 */
  var SHADE_MIN_SIZE = 14;

  /** @brief 一時領域。 @private */
  var tmpNormal = [0, 0, 0];
  var tmpCenter = [0, 0, 0];

  /**
   * @brief ある頂点から見たときの映り込みの明るさを求める。
   *
   * 面の法線は平らな面では一定でも、視線の向きは頂点ごとに違う。
   * その差が面の中の明るさの変化になり、単色に潰れるのを防ぐ。
   *
   * @private
   * @param {Array<number>} p 頂点（カメラを原点とする座標）
   * @param {Array<number>} n 面の法線
   * @param {number} phase 映り込みの位相
   * @returns {number} 映り込みの明るさ [0..100 相当]
   */
  /**
   * @brief 明るさを表示できる範囲へ収める。
   * @private
   * @param {number} l 明るさ [%]
   * @returns {number} 2〜96 に収めた値
   */
  function clampLight(l) {
    if (l < 2) return 2;
    return l > 96 ? 96 : l;
  }

  /**
   * @brief 三角形を、頂点の明るさをつないだグラデーションで塗る。
   *
   * Canvas 2D には頂点ごとの色を面内で補間する仕組みがない。そこで、
   * 最も暗い頂点と最も明るい頂点を結ぶ直線のグラデーションで近似する。
   * 平らな面が単色に潰れなくなり、隣の面との境目が線として浮かなくなる。
   *
   * @private
   * @param {CanvasRenderingContext2D} ctx 描画先
   * @param {Array<number>} s0 画面座標（頂点1）
   * @param {Array<number>} s1 画面座標（頂点2）
   * @param {Array<number>} s2 画面座標（頂点3）
   * @param {number} l0 頂点1の明るさ [%]
   * @param {number} l1 頂点2の明るさ [%]
   * @param {number} l2 頂点3の明るさ [%]
   * @param {number} hue 色相 [deg]
   * @param {number} sat 彩度 [%]
   * @param {number} alpha 不透明度 [0..1]
   * @returns {CanvasGradient|string} 塗りに使う値
   */
  /**
   * @brief 面の稜線を描く。
   *
   * 塗り方が2通りあるため、線を引く処理だけを切り出しておく。
   *
   * @private
   * @param {CanvasRenderingContext2D} ctx 描画先
   * @param {Array<number>} s0 画面座標（頂点1）
   * @param {Array<number>} s1 画面座標（頂点2）
   * @param {Array<number>} s2 画面座標（頂点3）
   * @param {Object} o 見た目の指定
   * @returns {void}
   */
  function strokeEdges(ctx, s0, s1, s2, o) {
    if (o.edges === false) return;

    ctx.beginPath();
    ctx.moveTo(s0[0], s0[1]);
    ctx.lineTo(s1[0], s1[1]);
    ctx.lineTo(s2[0], s2[1]);
    ctx.closePath();

    ctx.strokeStyle = 'hsla(' + o.hue.toFixed(0) + ',100%,' +
                      (o.emissive ? 88 : 70) + '%,' +
                      (o.alpha * (o.emissive ? 0.9 : 0.32)).toFixed(3) + ')';
    ctx.lineWidth = o.emissive ? 1.4 : 0.9;
    ctx.stroke();
  }

  /**
   * @brief 三角形を、頂点ごとの明るさで塗り分ける。
   *
   * Canvas 2D には頂点の色を面内で混ぜる仕組みがない。グラデーションを
   * 作る方法もあるが、面ごとに作り直す必要があり、その生成だけで重くなる。
   * ブラウザによっては、これが処理落ちの主因になる。
   *
   * そこで三角形を重心から3つに割り、それぞれを「その辺の2頂点と重心の
   * 平均の明るさ」で塗る。塗りつぶしは速いので、面の数が増えても耐える。
   * 厳密な補間ではないが、平らな面が単色に潰れるのは防げる。
   *
   * @private
   * @param {CanvasRenderingContext2D} ctx 描画先
   * @param {Array<number>} s0 画面座標（頂点1）
   * @param {Array<number>} s1 画面座標（頂点2）
   * @param {Array<number>} s2 画面座標（頂点3）
   * @param {number} l0 頂点1の明るさ [%]
   * @param {number} l1 頂点2の明るさ [%]
   * @param {number} l2 頂点3の明るさ [%]
   * @param {number} hue 色相 [deg]
   * @param {number} sat 彩度 [%]
   * @param {number} alpha 不透明度 [0..1]
   * @returns {void}
   */
  function fillShaded(ctx, s0, s1, s2, l0, l1, l2, hue, sat, alpha) {
    var h = hue.toFixed(0);
    var s = sat.toFixed(0);
    var a = alpha.toFixed(3);

    // 画面上で小さい面、または明暗の差が無い面は、割らずに1色で塗る。
    var minX = Math.min(s0[0], s1[0], s2[0]);
    var maxX = Math.max(s0[0], s1[0], s2[0]);
    var minY = Math.min(s0[1], s1[1], s2[1]);
    var maxY = Math.max(s0[1], s1[1], s2[1]);
    var spread = Math.max(l0, l1, l2) - Math.min(l0, l1, l2);

    if (((maxX - minX) < SHADE_MIN_SIZE && (maxY - minY) < SHADE_MIN_SIZE) ||
        spread < 1.5) {
      ctx.fillStyle = 'hsla(' + h + ',' + s + '%,' +
                      ((l0 + l1 + l2) / 3).toFixed(1) + '%,' + a + ')';
      ctx.beginPath();
      ctx.moveTo(s0[0], s0[1]);
      ctx.lineTo(s1[0], s1[1]);
      ctx.lineTo(s2[0], s2[1]);
      ctx.closePath();
      ctx.fill();
      return;
    }

    var gx = (s0[0] + s1[0] + s2[0]) / 3;
    var gy = (s0[1] + s1[1] + s2[1]) / 3;
    var gl = (l0 + l1 + l2) / 3;

    // 重心と各辺で3枚に割る。隣り合う破片どうしの明るさが近いので、
    // 境目はほとんど見えない。
    shadePiece(ctx, gx, gy, s0, s1, (gl + l0 + l1) / 3, h, s, a);
    shadePiece(ctx, gx, gy, s1, s2, (gl + l1 + l2) / 3, h, s, a);
    shadePiece(ctx, gx, gy, s2, s0, (gl + l2 + l0) / 3, h, s, a);
  }

  /**
   * @brief 重心と1辺で作る三角形を1枚塗る。
   * @private
   * @param {CanvasRenderingContext2D} ctx 描画先
   * @param {number} gx 重心 x
   * @param {number} gy 重心 y
   * @param {Array<number>} a1 辺の端1
   * @param {Array<number>} a2 辺の端2
   * @param {number} light 明るさ [%]
   * @param {string} h 色相の文字列
   * @param {string} s 彩度の文字列
   * @param {string} alpha 不透明度の文字列
   * @returns {void}
   */
  function shadePiece(ctx, gx, gy, a1, a2, light, h, s, alpha) {
    ctx.fillStyle = 'hsla(' + h + ',' + s + '%,' + light.toFixed(1) + '%,' + alpha + ')';
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(a1[0], a1[1]);
    ctx.lineTo(a2[0], a2[1]);
    ctx.closePath();
    ctx.fill();
  }

  function faceGradient(ctx, s0, s1, s2, l0, l1, l2, hue, sat, alpha) {
    // 画面上で小さい面は単色で塗る。
    //
    // グラデーションは面ごとに作り直すため、数が増えるとそれだけで重い。
    // 小さく映っている面では、作っても違いが見えない。
    var minX = Math.min(s0[0], s1[0], s2[0]);
    var maxX = Math.max(s0[0], s1[0], s2[0]);
    var minY = Math.min(s0[1], s1[1], s2[1]);
    var maxY = Math.max(s0[1], s1[1], s2[1]);

    if ((maxX - minX) < GRADIENT_MIN_SIZE && (maxY - minY) < GRADIENT_MIN_SIZE) {
      var avg = (l0 + l1 + l2) / 3;
      return 'hsla(' + hue.toFixed(0) + ',' + sat.toFixed(0) + '%,' +
             avg.toFixed(1) + '%,' + alpha.toFixed(3) + ')';
    }

    // 明るさの差が小さければ、単色で塗って余計な処理を省く。
    var lo = l0, hi = l0, loS = s0, hiS = s0;
    if (l1 < lo) { lo = l1; loS = s1; }
    if (l2 < lo) { lo = l2; loS = s2; }
    if (l1 > hi) { hi = l1; hiS = s1; }
    if (l2 > hi) { hi = l2; hiS = s2; }

    var h = hue.toFixed(0);
    var s = sat.toFixed(0);
    var a = alpha.toFixed(3);

    if (hi - lo < 1.5) {
      return 'hsla(' + h + ',' + s + '%,' + ((lo + hi) * 0.5).toFixed(1) + '%,' + a + ')';
    }

    var grad = ctx.createLinearGradient(loS[0], loS[1], hiS[0], hiS[1]);
    grad.addColorStop(0, 'hsla(' + h + ',' + s + '%,' + lo.toFixed(1) + '%,' + a + ')');
    grad.addColorStop(1, 'hsla(' + h + ',' + s + '%,' + hi.toFixed(1) + '%,' + a + ')');
    return grad;
  }

  function vertexReflection(p, n, phase) {
    var len = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) || 1;
    var vx = p[0] / len, vy = p[1] / len, vz = p[2] / len;

    var vn = vx * n[0] + vy * n[1] + vz * n[2];
    return environment(vx - 2 * vn * n[0], vy - 2 * vn * n[1], vz - 2 * vn * n[2], phase);
  }

  /**
   * @brief 立体を1つ描く。
   *
   * 手順は次のとおり:
   * 1. 頂点を回転・移動して、カメラを原点とする座標へ移す
   * 2. 画面へ投影する
   * 3. 裏を向いた面を捨てる
   * 4. 残った面を奥から手前の順に並べ替えて塗る（画家のアルゴリズム）
   *
   * @param {CanvasRenderingContext2D} ctx 描画先
   * @param {{verts: Array, faces: Array}} mesh 立体データ
   * @param {Object} o 配置と見た目
   * @param {Array<number>} o.pos 位置 [x, y, z]
   * @param {number} o.scale 大きさ
   * @param {number} o.rx x 軸まわりの回転 [rad]
   * @param {number} o.ry y 軸まわりの回転 [rad]
   * @param {number} o.focal 焦点距離 [px]
   * @param {number} o.cx 画面中心 x [px]
   * @param {number} o.cy 画面中心 y [px]
   * @param {number} o.hue 色相 [deg]
   * @param {number} o.alpha 不透明度 [0..1]
   * @param {number} [o.satBoost] 彩度の倍率。グレアが弱い環境で色を補うのに使う
   * @returns {number} 実際に描いた面の数
   */
  function drawMesh(ctx, mesh, o) {
    var verts = mesh.verts;
    var faces = mesh.faces;
    var i, v;

    for (i = 0; i < verts.length; i++) {
      if (!vbuf[i]) { vbuf[i] = [0, 0, 0]; sbuf[i] = [0, 0]; }
      transform(verts[i], o.rx, o.ry, o.scale, o.pos, vbuf[i]);
      sbuf[i].ok = project(vbuf[i][0], vbuf[i][1], vbuf[i][2], o.focal, o.cx, o.cy, sbuf[i]);
    }

    visible.length = 0;

    for (i = 0; i < faces.length; i++) {
      var f = faces[i];
      var a = vbuf[f[0]], b = vbuf[f[1]], c = vbuf[f[2]];

      if (!sbuf[f[0]].ok || !sbuf[f[1]].ok || !sbuf[f[2]].ok) continue;

      tmpCenter[0] = (a[0] + b[0] + c[0]) / 3;
      tmpCenter[1] = (a[1] + b[1] + c[1]) / 3;
      tmpCenter[2] = (a[2] + b[2] + c[2]) / 3;

      faceNormal(a, b, c, tmpNormal);
      if (isBackFace(tmpNormal, tmpCenter)) continue;

      var lambert = -(tmpNormal[0] * LIGHT[0] + tmpNormal[1] * LIGHT[1] + tmpNormal[2] * LIGHT[2]);
      if (lambert < 0) lambert = 0;

      // 視線の向き（カメラから面の中心へ）
      var len = Math.sqrt(tmpCenter[0] * tmpCenter[0] + tmpCenter[1] * tmpCenter[1] +
                          tmpCenter[2] * tmpCenter[2]) || 1;
      var vx = tmpCenter[0] / len, vy = tmpCenter[1] / len, vz = tmpCenter[2] / len;

      var facing = -(tmpNormal[0] * vx + tmpNormal[1] * vy + tmpNormal[2] * vz);
      if (facing < 0) facing = 0;

      // フレネル。浅い角度で見た面ほど強く反射する。
      var rim = 1 - facing;
      rim = rim * rim * rim;

      // 反射ベクトル r = v - 2(v・n)n
      var vn = vx * tmpNormal[0] + vy * tmpNormal[1] + vz * tmpNormal[2];
      var rx = vx - 2 * vn * tmpNormal[0];
      var ry = vy - 2 * vn * tmpNormal[1];
      var rz = vz - 2 * vn * tmpNormal[2];

      var env = environment(rx, ry, rz, o.phase || 0);

      // 鏡面反射。光源そのものの映り込み。
      var hx = LIGHT[0] - vx, hy = LIGHT[1] - vy, hz = LIGHT[2] - vz;
      var hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
      var spec = -(tmpNormal[0] * hx + tmpNormal[1] * hy + tmpNormal[2] * hz) / hl;
      if (spec < 0) spec = 0;
      var sp2 = spec * spec;
      var sp8 = sp2 * sp2 * sp2 * sp2;

      // 頂点ごとの映り込み。面の法線は平らな面では一定だが、
      // **視線の向きは頂点ごとに違う**。映り込みは視線に依存するため、
      // 頂点ごとに求めれば面の中で連続的に変化する。
      // これがないと平らな面が単色に潰れ、面の境目が線として見えてしまう。
      var e0 = vertexReflection(a, tmpNormal, o.phase || 0);
      var e1 = vertexReflection(b, tmpNormal, o.phase || 0);
      var e2 = vertexReflection(c, tmpNormal, o.phase || 0);

      visible.push({
        f: f, depth: tmpCenter[2],
        light: lambert, rim: rim, env: env, spec: sp8,
        e0: e0, e1: e1, e2: e2
      });
    }

    // 奥の面から塗る。面どうしが重なっても正しい前後関係になる。
    visible.sort(function (p, q) { return q.depth - p.depth; });

    for (i = 0; i < visible.length; i++) {
      v = visible[i];
      var s0 = sbuf[v.f[0]], s1 = sbuf[v.f[1]], s2 = sbuf[v.f[2]];
      var sat = (o.sat === undefined ? 92 : o.sat);
      var metal = (o.metal === undefined ? 0 : o.metal);
      var l, vl0 = 0, vl1 = 0, vl2 = 0;

      if (o.emissive) {
        // 自ら光る部材は面の向きで暗くしない
        l = 62 + v.light * 8;
      } else {
        // 拡散光（素材そのものの色）
        var diffuse = 8 + v.light * 38;

        // 映り込み。金属ほど拡散光より映り込みが支配的になる。
        // 浅い角度（フレネル）ではどんな素材でも映り込みが強くなる。
        var reflectivity = metal * 0.55 + (1 - metal) * 0.10 + v.rim * (0.25 + metal * 0.55);
        if (reflectivity > 1) reflectivity = 1;

        l = diffuse * (1 - reflectivity * 0.65) + v.env * reflectivity;

        // 光源そのものの映り込み。金属の硬さはここで決まる。
        l += v.spec * (18 + metal * 52);

        // 映り込みが強いところほど素材の色は失われ、白く飛ぶ。
        sat = sat * (1 - reflectivity * 0.72);

        // 頂点ごとの映り込みの差を、面の中の明るさの差として反映する。
        vl0 = l + (v.e0 - v.env) * reflectivity;
        vl1 = l + (v.e1 - v.env) * reflectivity;
        vl2 = l + (v.e2 - v.env) * reflectivity;
      }

      // 彩度だけは掛けて持ち上げてよい。明るさと違って面の向きによる差を
      // 作っていないので、上限で頭打ちになっても面の境目は生まれない。
      if (o.satBoost !== undefined) {
        sat = sat * o.satBoost;
        if (sat > 100) sat = 100;
      }

      var dim = (o.dim === undefined ? 1 : o.dim);
      l = clampLight(l * dim);

      // 明暗の付け方を2通り用意している。
      //
      // 既定はグラデーション。面の中を滑らかに変えられるが、面ごとに
      // 作り直す必要があり、実装によってはその生成だけで処理落ちする。
      // 重いと判定された環境では、三角形を割って塗り分ける方式に切り替える。
      // 滑らかさは落ちるが、単色に潰すよりは面の表情が残る。
      if (!o.emissive && o.shade === 'pieces') {
        fillShaded(ctx, s0, s1, s2,
                   clampLight(vl0 * dim), clampLight(vl1 * dim), clampLight(vl2 * dim),
                   o.hue, sat, o.alpha);
        strokeEdges(ctx, s0, s1, s2, o);
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(s0[0], s0[1]);
      ctx.lineTo(s1[0], s1[1]);
      ctx.lineTo(s2[0], s2[1]);
      ctx.closePath();

      if (o.emissive) {
        ctx.fillStyle = 'hsla(' + o.hue.toFixed(0) + ',' + sat.toFixed(0) + '%,' +
                        l.toFixed(1) + '%,' + o.alpha.toFixed(3) + ')';
      } else {
        ctx.fillStyle = faceGradient(ctx, s0, s1, s2,
                                     clampLight(vl0 * dim),
                                     clampLight(vl1 * dim),
                                     clampLight(vl2 * dim),
                                     o.hue, sat, o.alpha);
      }
      ctx.fill();

      // 稜線を描くと、面が平らでも形が読み取れる。
      if (o.edges !== false) {
        ctx.strokeStyle = 'hsla(' + o.hue.toFixed(0) + ',100%,' +
                          (o.emissive ? 88 : 70) + '%,' +
                          (o.alpha * (o.emissive ? 0.9 : 0.32)).toFixed(3) + ')';
        ctx.lineWidth = o.emissive ? 1.4 : 0.9;
        ctx.stroke();
      }
    }

    return visible.length;
  }

  global.PULSAR = global.PULSAR || {};
  global.PULSAR.mesh3d = {
    OCTAHEDRON: OCTAHEDRON,
    CUBE: CUBE,
    TETRAHEDRON: TETRAHEDRON,
    LIGHT: LIGHT,
    ENV: ENV,
    environment: environment,
    transform: transform,
    project: project,
    faceNormal: faceNormal,
    isBackFace: isBackFace,
    drawMesh: drawMesh
  };
})(typeof window !== 'undefined' ? window : this);
