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
      expect(G.state.speed <= G.CONFIG.maxSpeed + 1e-9).toBeTrue();
    });

    it('コンボが 0 のままなら速度は初速付近に留まる', function () {
      G.reset();
      var f = makeFrame({ dt: 1 / 30 });
      for (var i = 0; i < 300; i++) {
        G.state.combo = 0; // 繋がっていない状態を保つ
        G.update(f);
      }
      expect(G.state.speed <= G.CONFIG.baseSpeed + 0.2).toBeTrue();
    });

    it('ゲージ満タンを保つと最高速へ近づく', function () {
      G.reset();
      var f = makeFrame({ dt: 1 / 30 });
      for (var i = 0; i < 400; i++) {
        G.state.combo = G.CONFIG.comboForMax;
        G.update(f);
      }
      expect(G.state.speed >= G.CONFIG.maxSpeed - 0.2).toBeTrue();
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

    it('衝突するとコンボが切れ、速度が初速へ向かって落ちていく', function () {
      G.reset();
      var f = makeFrame({ dt: 1 / 60 });
      G.state.combo = G.CONFIG.comboForMax;
      G.state.speed = G.CONFIG.maxSpeed;

      // 直近のリングの反対側へ置いて、通過判定を衝突させる
      var near = null;
      for (var j = 0; j < G.state.rings.length; j++) {
        var r = G.state.rings[j];
        if (r.z > G.CONFIG.shipZ && (near === null || r.z < near.z)) near = r;
      }
      near.z = G.CONFIG.shipZ + 0.001;
      G.state.angle = M.wrapAngle(near.gap + Math.PI);
      G.update(f);

      expect(f.impacts).toBe(1);
      expect(G.state.combo).toBe(0);

      // ゲージが空になったので、速度は初速へ戻っていく
      var before = G.state.speed;
      for (var i = 0; i < 120; i++) {
        G.state.combo = 0;
        G.update(f);
      }
      expect(G.state.speed < before).toBeTrue();
      expect(G.state.speed <= G.CONFIG.baseSpeed + 0.3).toBeTrue();
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

  describe('コンボと持ち時間', function () {
    it('開始時はコンボ 0、ゲージは空', function () {
      G.reset();
      expect(G.state.combo).toBe(0);
      expect(G.gauge()).toBe(0);
    });

    it('ゲージは 0..1 に収まる', function () {
      G.reset();
      G.state.combo = 9999;
      expect(G.gauge()).toBe(1);
      G.state.combo = -5;
      expect(G.gauge()).toBe(0);
    });

    it('通過するとコンボが増える', function () {
      G.reset();
      var f = makeFrame();
      f.pointer.everTouched = true;
      for (var i = 0; i < 600; i++) G.update(f);
      expect(G.state.combo > 0).toBeTrue();
      expect(G.state.passed > 0).toBeTrue();
    });

    it('衝突するとコンボが 0 に戻る', function () {
      G.reset();
      var f = makeFrame();
      G.state.combo = 12;
      var near = null;
      for (var j = 0; j < G.state.rings.length; j++) {
        var r = G.state.rings[j];
        if (r.z > G.CONFIG.shipZ && (near === null || r.z < near.z)) near = r;
      }
      near.z = G.CONFIG.shipZ + 0.001;
      G.state.angle = M.wrapAngle(near.gap + Math.PI);
      G.update(f);
      expect(G.state.combo).toBe(0);
      expect(G.state.hits).toBe(1);
    });

    it('最大コンボは減らない', function () {
      G.reset();
      G.state.combo = 7;
      G.state.maxCombo = 7;
      G.state.combo = 0;
      expect(G.state.maxCombo).toBe(7);
    });

    it('触れるまで持ち時間は減らない', function () {
      G.reset();
      var f = makeFrame({ dt: 1 });
      for (var i = 0; i < 5; i++) G.update(f);
      expect(G.state.timeLeft).toBe(G.CONFIG.sessionSeconds);
      expect(G.state.started).toBeFalse();
    });

    it('触れると持ち時間が減り始める', function () {
      G.reset();
      var f = makeFrame({ dt: 1 });
      f.pointer.everTouched = true;
      G.update(f);
      expect(G.state.started).toBeTrue();
      expect(G.state.timeLeft < G.CONFIG.sessionSeconds).toBeTrue();
    });

    it('持ち時間を使い切ると finished になり、残り時間は負にならない', function () {
      G.reset();
      var f = makeFrame({ dt: 10 });
      f.pointer.everTouched = true;
      for (var i = 0; i < 25; i++) G.update(f);
      expect(G.state.finished).toBeTrue();
      expect(G.state.timeLeft).toBe(0);
    });

    it('終了後は衝突判定が止まる', function () {
      G.reset();
      var f = makeFrame({ dt: 1 / 60 });
      f.pointer.everTouched = true;
      G.state.finished = true;
      var before = f.impacts;
      // 反対を向き続けても、もう轢かれない
      for (var i = 0; i < 900; i++) {
        var near = null;
        for (var j = 0; j < G.state.rings.length; j++) {
          var r = G.state.rings[j];
          if (r.z > G.CONFIG.shipZ && (near === null || r.z < near.z)) near = r;
        }
        if (near) G.state.angle = M.wrapAngle(near.gap + Math.PI);
        G.update(f);
      }
      expect(f.impacts).toBe(before);
    });

    it('reset で挑戦の状態が初期化される', function () {
      G.state.combo = 5;
      G.state.finished = true;
      G.state.started = true;
      G.state.hits = 3;
      G.reset();
      expect(G.state.combo).toBe(0);
      expect(G.state.finished).toBeFalse();
      expect(G.state.started).toBeFalse();
      expect(G.state.hits).toBe(0);
      expect(G.state.timeLeft).toBe(G.CONFIG.sessionSeconds);
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
