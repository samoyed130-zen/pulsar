/**
 * @file mesh3d.test.js
 * @brief `src/mesh3d.js` の 3D 計算の単体テスト。
 *
 * 描画そのものは目で見るしかないが、透視変換・法線・裏面消去は
 * 答えが一意に決まるため機械的に検証できる。
 * ここが狂うと立体が裏返る・消える・歪むといった形で必ず破綻する。
 */
(function () {
  'use strict';

  var V = window.PULSAR.mesh3d;

  describe('立体データ', function () {
    var shapes = [V.OCTAHEDRON, V.CUBE, V.TETRAHEDRON];

    it('すべての面が3頂点で構成されている', function () {
      for (var s = 0; s < shapes.length; s++) {
        var faces = shapes[s].faces;
        for (var i = 0; i < faces.length; i++) {
          expect(faces[i].length).toBe(3);
        }
      }
    });

    it('面が参照する頂点番号が範囲内にある', function () {
      for (var s = 0; s < shapes.length; s++) {
        var m = shapes[s];
        for (var i = 0; i < m.faces.length; i++) {
          for (var j = 0; j < 3; j++) {
            var idx = m.faces[i][j];
            expect(idx >= 0 && idx < m.verts.length).toBeTrue();
          }
        }
      }
    });

    it('すべての頂点がいずれかの面に使われている（孤立した頂点がない）', function () {
      for (var s = 0; s < shapes.length; s++) {
        var m = shapes[s];
        var used = [];
        for (var i = 0; i < m.faces.length; i++) {
          for (var j = 0; j < 3; j++) used[m.faces[i][j]] = true;
        }
        for (var k = 0; k < m.verts.length; k++) {
          expect(used[k] === true).toBeTrue();
        }
      }
    });

    it('面の数が立体として正しい', function () {
      expect(V.OCTAHEDRON.faces.length).toBe(8);
      expect(V.CUBE.faces.length).toBe(12);   // 6面 × 三角形2枚
      expect(V.TETRAHEDRON.faces.length).toBe(4);
    });

    it('面の向きが外を向いている（法線が中心から外向き）', function () {
      // 原点を中心とする凸な立体なので、外向き法線と面の中心の内積は正になる
      var n = [0, 0, 0];
      for (var s = 0; s < shapes.length; s++) {
        var m = shapes[s];
        for (var i = 0; i < m.faces.length; i++) {
          var f = m.faces[i];
          var a = m.verts[f[0]], b = m.verts[f[1]], c = m.verts[f[2]];
          V.faceNormal(a, b, c, n);
          var cxx = (a[0] + b[0] + c[0]) / 3;
          var cyy = (a[1] + b[1] + c[1]) / 3;
          var czz = (a[2] + b[2] + c[2]) / 3;
          var dot = n[0] * cxx + n[1] * cyy + n[2] * czz;
          expect(dot > 0).toBeTrue();
        }
      }
    });
  });

  describe('project（透視変換）', function () {
    var out = [0, 0];

    it('中心軸上の点は画面中心に落ちる', function () {
      expect(V.project(0, 0, 5, 100, 320, 180, out)).toBeTrue();
      expect(out[0]).toBeCloseTo(320);
      expect(out[1]).toBeCloseTo(180);
    });

    it('遠い点ほど中心に寄る', function () {
      V.project(1, 0, 2, 100, 0, 0, out);
      var near = out[0];
      V.project(1, 0, 8, 100, 0, 0, out);
      var far = out[0];
      expect(far < near).toBeTrue();
      expect(far > 0).toBeTrue();
    });

    it('奥行きが2倍になると画面上の大きさは半分になる', function () {
      V.project(1, 0, 2, 100, 0, 0, out);
      var a = out[0];
      V.project(1, 0, 4, 100, 0, 0, out);
      var b = out[0];
      expect(b).toBeCloseTo(a / 2, 1e-9);
    });

    it('カメラの後ろの点は投影できない', function () {
      expect(V.project(1, 1, -3, 100, 0, 0, out)).toBeFalse();
    });

    it('カメラに近すぎる点も投影しない（極端に拡大されるのを防ぐ）', function () {
      expect(V.project(1, 1, 0.01, 100, 0, 0, out)).toBeFalse();
    });
  });

  describe('faceNormal', function () {
    var n = [0, 0, 0];

    it('xy 平面の三角形の法線は z 方向', function () {
      V.faceNormal([0, 0, 0], [1, 0, 0], [0, 1, 0], n);
      expect(n[0]).toBeCloseTo(0);
      expect(n[1]).toBeCloseTo(0);
      expect(Math.abs(n[2])).toBeCloseTo(1);
    });

    it('頂点の順序を逆にすると法線も逆を向く', function () {
      var a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0];
      var n1 = [0, 0, 0], n2 = [0, 0, 0];
      V.faceNormal(a, b, c, n1);
      V.faceNormal(a, c, b, n2);
      expect(n1[2]).toBeCloseTo(-n2[2], 1e-9);
    });

    it('法線の長さは常に 1', function () {
      V.faceNormal([1, 2, 3], [4, 0, -1], [-2, 5, 2], n);
      var len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
      expect(len).toBeCloseTo(1, 1e-9);
    });
  });

  describe('isBackFace（裏面消去）', function () {
    it('カメラを向いている面は表', function () {
      // カメラは原点。面は z=5 にあり、法線は -z（カメラ向き）
      expect(V.isBackFace([0, 0, -1], [0, 0, 5])).toBeFalse();
    });

    it('背を向けた面は裏', function () {
      expect(V.isBackFace([0, 0, 1], [0, 0, 5])).toBeTrue();
    });

    it('立体の面の約半分は裏になる（消去が効いている）', function () {
      var m = V.CUBE;
      var n = [0, 0, 0];
      var moved = [];
      var i, j;

      // 立方体を z=6 の位置へ移動させる
      for (i = 0; i < m.verts.length; i++) {
        moved.push([m.verts[i][0], m.verts[i][1], m.verts[i][2] + 6]);
      }

      var back = 0;
      for (i = 0; i < m.faces.length; i++) {
        var f = m.faces[i];
        var a = moved[f[0]], b = moved[f[1]], c = moved[f[2]];
        V.faceNormal(a, b, c, n);
        var center = [
          (a[0] + b[0] + c[0]) / 3,
          (a[1] + b[1] + c[1]) / 3,
          (a[2] + b[2] + c[2]) / 3
        ];
        if (V.isBackFace(n, center)) back++;
      }

      // 12面のうち、見えない側がきちんと捨てられていること
      expect(back > 0).toBeTrue();
      expect(back < m.faces.length).toBeTrue();
    });
  });

  describe('environment（環境マッピング）', function () {
    it('上を向いた反射は明るい（天井が映る）', function () {
      // y は下が正なので、上向きは -1
      var up = V.environment(0, -1, 0, 0);
      var down = V.environment(0, 1, 0, 0);
      expect(up > down).toBeTrue();
    });

    it('下を向いた反射は暗い（床が映る）', function () {
      expect(V.environment(0, 1, 0, 0) <= V.ENV.floorLight + 1).toBeTrue();
    });

    it('返す明るさは 0 以上 100 以下に収まる', function () {
      for (var i = 0; i < 120; i++) {
        var a = i * 0.37;
        var v = V.environment(Math.cos(a), Math.sin(a * 1.3), Math.sin(a), a);
        expect(v >= 0 && v <= 100).toBeTrue();
      }
    });

    it('位相を変えると映り込みが動く', function () {
      // 照明が映らない向きでは位相を変えても値は同じなので、
      // 「どこかの向きで変化すること」を確かめる
      var moved = false;
      for (var i = 0; i < 60; i++) {
        var r = i * 0.1;
        if (V.environment(Math.cos(r), -0.3, Math.sin(r), 0) !==
            V.environment(Math.cos(r), -0.3, Math.sin(r), 1.1)) {
          moved = true;
          break;
        }
      }
      expect(moved).toBeTrue();
    });

    it('横方向には照明が複数本ある（等間隔の映り込み）', function () {
      // 一周ぶん調べて、明るい山が複数回現れること
      var peaks = 0;
      var prev = V.environment(Math.cos(0), 0, Math.sin(0), 0);
      var rising = false;
      for (var i = 1; i <= 360; i++) {
        var r = i * Math.PI / 180;
        var cur = V.environment(Math.cos(r), 0, Math.sin(r), 0);
        if (cur > prev + 0.01) rising = true;
        else if (rising && cur < prev - 0.01) { peaks++; rising = false; }
        prev = cur;
      }
      expect(peaks >= 2).toBeTrue();
    });
  });

  describe('transform（回転と移動）', function () {
    var out = [0, 0, 0];

    it('回転 0・拡大 1 なら位置を足すだけ', function () {
      V.transform([1, 2, 3], 0, 0, 1, [10, 20, 30], out);
      expect(out[0]).toBeCloseTo(11);
      expect(out[1]).toBeCloseTo(22);
      expect(out[2]).toBeCloseTo(33);
    });

    it('拡大率が掛かる', function () {
      V.transform([1, 1, 1], 0, 0, 3, [0, 0, 0], out);
      expect(out[0]).toBeCloseTo(3);
    });

    it('軸ごとに違う拡大率を指定できる（柱や梁のような細長い部材のため）', function () {
      V.transform([1, 1, 1], 0, 0, [2, 5, 0.5], [0, 0, 0], out);
      expect(out[0]).toBeCloseTo(2);
      expect(out[1]).toBeCloseTo(5);
      expect(out[2]).toBeCloseTo(0.5);
    });

    it('回転しても原点からの距離は変わらない', function () {
      var p = [1, 2, 3];
      var before = Math.sqrt(1 + 4 + 9);
      V.transform(p, 0.7, 1.9, 1, [0, 0, 0], out);
      var after = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
      expect(after).toBeCloseTo(before, 1e-9);
    });

    it('1周（2π）回すと元の位置に戻る', function () {
      V.transform([1, 2, 3], Math.PI * 2, Math.PI * 2, 1, [0, 0, 0], out);
      expect(out[0]).toBeCloseTo(1, 1e-9);
      expect(out[1]).toBeCloseTo(2, 1e-9);
      expect(out[2]).toBeCloseTo(3, 1e-9);
    });
  });
})();
