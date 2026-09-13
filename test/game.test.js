/**
 * @file game.test.js
 * @brief `src/game.js` の状態更新の単体テスト。
 *
 * 描画はテストしない。テストするのは「走行状態が正しく進むか」だけ。
 * そのために、フレーム文脈を最小限だけ真似た偽のオブジェクトを渡す。
 */
(function () {
  'use strict';

  var G = window.PULSAR.game;
  var M = window.PULSAR.mathx;

  /**
   * @brief テスト用のフレーム文脈を作る。
   * @param {Object} [over] 上書きしたい項目
   * @returns {Object} `game.update` が必要とする最小限の文脈
   */
  function makeFrame(over) {
    var f = {
      dt: 1 / 60,
      W: 800,
      H: 600,
      steer: 0,
      pointer: { x: 400, y: 300, down: false, everTouched: false },
      impacts: 0
    };
    f.impact = function () { f.impacts++; };
    if (over) {
      for (var k in over) {
        if (Object.prototype.hasOwnProperty.call(over, k)) f[k] = over[k];
      }
    }
    return f;
  }

  describe('game.reset', function () {
    it('リングが生成される', function () {
      G.reset();
      expect(G.state.rings.length > 0).toBeTrue();
    });
    it('距離と速度が初期値に戻る', function () {
      G.reset();
      expect(G.state.dist).toBe(0);
      expect(G.state.speed).toBe(G.CONFIG.baseSpeed);
    });
    it('全リングの切れ目が [0, 2π) に入る', function () {
      G.reset();
      for (var i = 0; i < G.state.rings.length; i++) {
        var g = G.state.rings[i].gap;
        expect(g >= 0 && g < M.TAU).toBeTrue();
      }
    });
  });

  describe('game.update', function () {
    it('dt が 0 なら何も進まない', function () {
      G.reset();
      var before = G.state.dist;
      G.update(makeFrame({ dt: 0 }));
      expect(G.state.dist).toBe(before);
    });

    it('時間が経つと距離が増える', function () {
      G.reset();
      G.update(makeFrame());
      expect(G.state.dist > 0).toBeTrue();
    });

    it('速度は上限を超えない', function () {
      G.reset();
      for (var i = 0; i < 2000; i++) G.update(makeFrame({ dt: 1 / 30 }));
      expect(G.state.speed <= G.CONFIG.maxSpeed).toBeTrue();
    });

    it('自機の角度は常に [0, 2π) に入る', function () {
      G.reset();
      for (var i = 0; i < 300; i++) {
        G.update(makeFrame({ steer: i % 2 ? 1 : -1 }));
        expect(G.state.angle >= 0 && G.state.angle < M.TAU).toBeTrue();
      }
    });

    it('リングの本数は増え続けない（使い回している）', function () {
      G.reset();
      var n = G.state.rings.length;
      for (var i = 0; i < 1200; i++) G.update(makeFrame({ dt: 1 / 30 }));
      expect(G.state.rings.length).toBe(n);
    });

    it('自動操縦なら滅多にぶつからない', function () {
      G.reset();
      var f = makeFrame({ dt: 1 / 60 });
      for (var i = 0; i < 1800; i++) {
        f.impacts = f.impacts; // 同じ文脈を使い回して衝突回数を累積する
        G.update(f);
      }
      // 30秒走って衝突が数回以内なら、放置してもデモとして成立する
      expect(f.impacts <= 3).toBeTrue();
    });

    it('切れ目と反対を向いたままなら衝突する', function () {
      G.reset();
      var f = makeFrame({ dt: 1 / 60 });
      // 毎フレーム、直近のリングの切れ目の反対側へ自機を強制的に置く
      for (var i = 0; i < 600; i++) {
        var near = null;
        for (var j = 0; j < G.state.rings.length; j++) {
          var r = G.state.rings[j];
          if (r.z > G.CONFIG.shipZ && (near === null || r.z < near.z)) near = r;
        }
        if (near) G.state.angle = M.wrapAngle(near.gap + Math.PI);
        G.update(f);
      }
      expect(f.impacts > 0).toBeTrue();
    });

    it('衝突すると速度が初期値まで落ちる', function () {
      G.reset();
      var f = makeFrame({ dt: 1 / 60 });
      G.state.speed = G.CONFIG.maxSpeed;
      // 直近のリングの反対側へ置いて、通過judgeを衝突させる
      var near = null;
      for (var j = 0; j < G.state.rings.length; j++) {
        var r = G.state.rings[j];
        if (r.z > G.CONFIG.shipZ && (near === null || r.z < near.z)) near = r;
      }
      near.z = G.CONFIG.shipZ + 0.001;
      G.state.angle = M.wrapAngle(near.gap + Math.PI);
      G.update(f);
      expect(f.impacts).toBe(1);
      expect(G.state.speed <= G.CONFIG.baseSpeed + 0.01).toBeTrue();
    });

    it('スコアは距離から導かれ、負にならない', function () {
      G.reset();
      for (var i = 0; i < 120; i++) G.update(makeFrame());
      expect(G.state.score).toBe(M.scoreFromDistance(G.state.dist));
      expect(G.state.score >= 0).toBeTrue();
    });
  });

  describe('game の設定値', function () {
    it('切れ目の幅は 1 周より狭い', function () {
      expect(G.CONFIG.gapWidth < M.TAU).toBeTrue();
    });
    it('自機の位置は最遠リングより手前にある', function () {
      expect(G.CONFIG.shipZ < G.CONFIG.farZ).toBeTrue();
    });
    it('初速は上限以下', function () {
      expect(G.CONFIG.baseSpeed <= G.CONFIG.maxSpeed).toBeTrue();
    });
  });

  describe('遊びやすさの条件', function () {
    it('最高速でもリングの間隔が 0.4 秒以上ある（反応する時間を残す）', function () {
      var interval = G.CONFIG.spacing / G.CONFIG.maxSpeed;
      expect(interval >= 0.4).toBeTrue();
    });

    it('切れ目のずれは、その間に回りきれる範囲に収まっている', function () {
      // 1枚あたりの猶予時間に、手動操作で回せる角度
      var interval = G.CONFIG.spacing / G.CONFIG.maxSpeed;
      var reachable = G.CONFIG.manualRate * interval * 0.5;
      expect(G.CONFIG.gapDrift <= reachable).toBeTrue();
    });

    it('切れ目は円周の 1/4 より広い（狙って通せる幅がある）', function () {
      expect(G.CONFIG.gapWidth > M.TAU / 4).toBeTrue();
    });

    it('衝突後に無敵時間がある', function () {
      expect(G.CONFIG.graceSeconds > 0).toBeTrue();
    });

    it('開幕の最初のリングは自機の正面に切れ目がある', function () {
      G.reset();
      var near = null;
      for (var i = 0; i < G.state.rings.length; i++) {
        var r = G.state.rings[i];
        if (near === null || r.z < near.z) near = r;
      }
      expect(M.canPass(G.state.angle, near.gap, G.CONFIG.gapWidth)).toBeTrue();
    });
  });
})();
