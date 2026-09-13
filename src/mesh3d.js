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

    var x = p[0] * scale;
    var y = p[1] * scale;
    var z = p[2] * scale;

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
    if (z <= 0.05) return false; // カメラの後ろ、または近すぎる点は描けない
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

  /** @brief 一時領域。 @private */
  var tmpNormal = [0, 0, 0];
  var tmpCenter = [0, 0, 0];

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

      visible.push({ f: f, depth: tmpCenter[2], light: lambert });
    }

    // 奥の面から塗る。面どうしが重なっても正しい前後関係になる。
    visible.sort(function (p, q) { return q.depth - p.depth; });

    for (i = 0; i < visible.length; i++) {
      v = visible[i];
      var s0 = sbuf[v.f[0]], s1 = sbuf[v.f[1]], s2 = sbuf[v.f[2]];

      ctx.beginPath();
      ctx.moveTo(s0[0], s0[1]);
      ctx.lineTo(s1[0], s1[1]);
      ctx.lineTo(s2[0], s2[1]);
      ctx.closePath();

      var l = 16 + v.light * 46;
      ctx.fillStyle = 'hsla(' + o.hue.toFixed(0) + ',92%,' + l.toFixed(0) + '%,' + o.alpha.toFixed(3) + ')';
      ctx.fill();

      // 稜線を明るく描くと、面が平らでも形が読み取れる。
      ctx.strokeStyle = 'hsla(' + o.hue.toFixed(0) + ',100%,78%,' + (o.alpha * 0.75).toFixed(3) + ')';
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    return visible.length;
  }

  global.PULSAR = global.PULSAR || {};
  global.PULSAR.mesh3d = {
    OCTAHEDRON: OCTAHEDRON,
    CUBE: CUBE,
    TETRAHEDRON: TETRAHEDRON,
    LIGHT: LIGHT,
    transform: transform,
    project: project,
    faceNormal: faceNormal,
    isBackFace: isBackFace,
    drawMesh: drawMesh
  };
})(typeof window !== 'undefined' ? window : this);
