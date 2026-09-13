/**
 * @file mathx.test.js
 * @brief `src/mathx.js` の単体テスト。
 *
 * 重点は「境界値」と「角度が 0 と 2π をまたぐ場合」。
 * この2つが、当たり判定とシーン切り替えのバグの大半を占めるため。
 */
(function () {
  'use strict';

  var m = window.PULSAR.mathx;
  var TAU = m.TAU;
  var PI = Math.PI;

  describe('clamp', function () {
    it('下限より小さい値は下限になる', function () {
      expect(m.clamp(-5, 0, 1)).toBe(0);
    });
    it('上限より大きい値は上限になる', function () {
      expect(m.clamp(9, 0, 1)).toBe(1);
    });
    it('範囲内の値はそのまま', function () {
      expect(m.clamp(0.3, 0, 1)).toBe(0.3);
    });
    it('境界値はそのまま返る', function () {
      expect(m.clamp(0, 0, 1)).toBe(0);
      expect(m.clamp(1, 0, 1)).toBe(1);
    });
  });

  describe('lerp', function () {
    it('t=0 で始点', function () { expect(m.lerp(10, 20, 0)).toBe(10); });
    it('t=1 で終点', function () { expect(m.lerp(10, 20, 1)).toBe(20); });
    it('t=0.5 で中点', function () { expect(m.lerp(10, 20, 0.5)).toBe(15); });
    it('範囲外の t は外挿される', function () { expect(m.lerp(0, 10, 2)).toBe(20); });
  });

  describe('approach', function () {
    it('dt=0 では動かない', function () {
      expect(m.approach(0, 100, 5, 0)).toBeCloseTo(0);
    });
    it('目標を追い越さない', function () {
      var v = m.approach(0, 100, 5, 1);
      expect(v < 100).toBeTrue();
      expect(v > 0).toBeTrue();
    });
    it('時間が長いほど目標に近づく', function () {
      var a = m.approach(0, 100, 5, 0.1);
      var b = m.approach(0, 100, 5, 0.5);
      expect(b > a).toBeTrue();
    });
  });

  describe('wrapAngle', function () {
    it('範囲内はそのまま', function () { expect(m.wrapAngle(1)).toBeCloseTo(1); });
    it('負の角度が正になる', function () { expect(m.wrapAngle(-0.5)).toBeCloseTo(TAU - 0.5); });
    it('2π ちょうどは 0 になる', function () { expect(m.wrapAngle(TAU)).toBe(0); });
    it('0 は 0 のまま', function () { expect(m.wrapAngle(0)).toBe(0); });
    it('何周しても範囲に収まる', function () {
      expect(m.wrapAngle(TAU * 3 + 1)).toBeCloseTo(1, 1e-9);
      expect(m.wrapAngle(-TAU * 3 - 1)).toBeCloseTo(TAU - 1, 1e-9);
    });
    it('結果は常に [0, 2π) に入る', function () {
      for (var i = -20; i < 20; i++) {
        var a = m.wrapAngle(i * 1.37);
        expect(a >= 0 && a < TAU).toBeTrue();
      }
    });
  });

  describe('angleDist', function () {
    it('同じ角度は 0', function () { expect(m.angleDist(1, 1)).toBeCloseTo(0); });
    it('正反対は π', function () { expect(m.angleDist(0, PI)).toBeCloseTo(PI); });
    it('0 と 2π をまたいでも最短距離を返す', function () {
      expect(m.angleDist(0.1, TAU - 0.1)).toBeCloseTo(0.2, 1e-9);
    });
    it('引数の順序を入れ替えても同じ', function () {
      expect(m.angleDist(0.3, 5.9)).toBeCloseTo(m.angleDist(5.9, 0.3), 1e-9);
    });
    it('結果は常に [0, π] に入る', function () {
      for (var i = 0; i < 30; i++) {
        var d = m.angleDist(i * 0.71, i * 1.93);
        expect(d >= 0 && d <= PI + 1e-12).toBeTrue();
      }
    });
  });

  describe('canPass', function () {
    var gap = 0.6; // 全幅 0.6rad → 中心から ±0.3rad

    it('切れ目の中心なら通過できる', function () {
      expect(m.canPass(1.0, 1.0, gap)).toBeTrue();
    });
    it('切れ目の内側なら通過できる', function () {
      expect(m.canPass(1.2, 1.0, gap)).toBeTrue();
    });
    it('ちょうど端は通過できる（境界は通過扱い）', function () {
      expect(m.canPass(1.3, 1.0, gap)).toBeTrue();
    });
    it('わずかに外れると通過できない', function () {
      expect(m.canPass(1.31, 1.0, gap)).toBeFalse();
    });
    it('反対側にいると通過できない', function () {
      expect(m.canPass(1.0 + PI, 1.0, gap)).toBeFalse();
    });
    it('0 と 2π をまたぐ切れ目でも正しく判定する', function () {
      // 切れ目が 0 付近にある場合、自機が 6.2rad（= -0.08rad）でも通過できるはず
      expect(m.canPass(TAU - 0.08, 0.0, gap)).toBeTrue();
      expect(m.canPass(0.08, TAU - 0.02, gap)).toBeTrue();
    });
    it('切れ目の幅が 0 なら中心以外は通過できない', function () {
      expect(m.canPass(0.01, 0, 0)).toBeFalse();
      expect(m.canPass(0, 0, 0)).toBeTrue();
    });
  });

  describe('scoreFromDistance', function () {
    it('0 は 0', function () { expect(m.scoreFromDistance(0)).toBe(0); });
    it('小数は切り捨てられる', function () { expect(m.scoreFromDistance(12.9)).toBe(12); });
    it('負の距離でも 0 未満にならない', function () { expect(m.scoreFromDistance(-3)).toBe(0); });
    it('距離に対して単調非減少', function () {
      var prev = -1;
      for (var d = 0; d < 500; d += 7.3) {
        var s = m.scoreFromDistance(d);
        expect(s >= prev).toBeTrue();
        prev = s;
      }
    });
  });

  describe('beatAt / beatPhase', function () {
    it('t=0 は 0 拍目', function () { expect(m.beatAt(120, 0)).toBe(0); });
    it('120BPM では 0.5 秒で 1 拍進む', function () {
      expect(m.beatAt(120, 0.5)).toBe(1);
      expect(m.beatAt(120, 0.49)).toBe(0);
    });
    it('120BPM の 2 秒で 4 拍目', function () { expect(m.beatAt(120, 2)).toBe(4); });
    it('拍の頭では位相が 0', function () {
      expect(m.beatPhase(120, 0)).toBeCloseTo(0);
      expect(m.beatPhase(120, 0.5)).toBeCloseTo(0, 1e-9);
    });
    it('拍の中間では位相が 0.5', function () {
      expect(m.beatPhase(120, 0.25)).toBeCloseTo(0.5, 1e-9);
    });
    it('位相は常に [0, 1) に入る', function () {
      for (var i = 0; i < 40; i++) {
        var p = m.beatPhase(126, i * 0.137);
        expect(p >= 0 && p < 1).toBeTrue();
      }
    });
  });

  describe('pickScene', function () {
    var tl = [
      { name: 'a', duration: 2 },
      { name: 'b', duration: 3 },
      { name: 'c', duration: 5 }
    ];

    it('先頭のシーンを返す', function () {
      var r = m.pickScene(tl, 0);
      expect(r.index).toBe(0);
      expect(r.local).toBeCloseTo(0);
      expect(r.progress).toBeCloseTo(0);
    });
    it('境界では次のシーンへ移る', function () {
      expect(m.pickScene(tl, 1.99).index).toBe(0);
      expect(m.pickScene(tl, 2).index).toBe(1);
      expect(m.pickScene(tl, 5).index).toBe(2);
    });
    it('シーン内の経過秒が正しい', function () {
      var r = m.pickScene(tl, 3.5);
      expect(r.index).toBe(1);
      expect(r.local).toBeCloseTo(1.5, 1e-9);
      expect(r.progress).toBeCloseTo(0.5, 1e-9);
    });
    it('尺の合計を超えたら先頭へループする', function () {
      var r = m.pickScene(tl, 10); // 合計 10 秒 → 先頭へ
      expect(r.index).toBe(0);
      expect(r.local).toBeCloseTo(0, 1e-9);
    });
    it('2周目も正しい位置を返す', function () {
      expect(m.pickScene(tl, 13.5).index).toBe(1);
    });
    it('progress は常に [0, 1) に入る', function () {
      for (var t = 0; t < 25; t += 0.31) {
        var r = m.pickScene(tl, t);
        expect(r.progress >= 0 && r.progress < 1).toBeTrue();
      }
    });
    it('空の timeline は例外を投げる', function () {
      expect(function () { m.pickScene([], 0); }).toThrow();
    });
    it('尺の合計が 0 なら例外を投げる', function () {
      expect(function () { m.pickScene([{ name: 'x', duration: 0 }], 0); }).toThrow();
    });
  });

  describe('edgeFade', function () {
    it('シーンの入り際は 1', function () {
      expect(m.edgeFade(0, 10, 1)).toBeCloseTo(1);
    });
    it('シーンの中央は 0', function () {
      expect(m.edgeFade(5, 10, 1)).toBeCloseTo(0);
    });
    it('シーンの終わり際は 1', function () {
      expect(m.edgeFade(10, 10, 1)).toBeCloseTo(1);
    });
    it('fade が 0 なら常に 0（遷移なし）', function () {
      expect(m.edgeFade(0, 10, 0)).toBe(0);
    });
    it('結果は常に [0, 1] に入る', function () {
      for (var t = 0; t <= 10; t += 0.25) {
        var v = m.edgeFade(t, 10, 1.5);
        expect(v >= 0 && v <= 1).toBeTrue();
      }
    });
  });

  describe('easeInOut', function () {
    it('0 は 0', function () { expect(m.easeInOut(0)).toBeCloseTo(0); });
    it('1 は 1', function () { expect(m.easeInOut(1)).toBeCloseTo(1); });
    it('0.5 は 0.5', function () { expect(m.easeInOut(0.5)).toBeCloseTo(0.5, 1e-9); });
    it('範囲外の入力は丸められる', function () {
      expect(m.easeInOut(-1)).toBeCloseTo(0);
      expect(m.easeInOut(2)).toBeCloseTo(1);
    });
    it('単調増加', function () {
      var prev = -1;
      for (var t = 0; t <= 1; t += 0.05) {
        var v = m.easeInOut(t);
        expect(v >= prev).toBeTrue();
        prev = v;
      }
    });
  });

  describe('hsl', function () {
    it('CSS の色文字列を返す', function () {
      expect(m.hsl(200, 50, 60, 1).indexOf('hsla(200.0,50.0%,60.0%,1.000)')).toBe(0);
    });
    it('色相が 360 を超えても丸められる', function () {
      expect(m.hsl(400, 50, 60, 1)).toBe(m.hsl(40, 50, 60, 1));
    });
    it('負の色相も丸められる', function () {
      expect(m.hsl(-20, 50, 60, 1)).toBe(m.hsl(340, 50, 60, 1));
    });
    it('不透明度を省略すると 1 になる', function () {
      expect(m.hsl(0, 0, 0)).toBe(m.hsl(0, 0, 0, 1));
    });
  });
})();
