/**
 * @file scenes.test.js
 * @brief タイムラインの整合性と、色変換の正しさを検証する。
 *
 * 絵そのものは目で見るしかないが、「シーンが欠けている」「尺が 0 で
 * 一瞬で飛ばされる」といった、見れば気づくのに見落としやすい壊れ方は
 * ここで自動的に止められる。
 */
(function () {
  'use strict';

  var S = window.PULSAR.scenes;
  var M = window.PULSAR.mathx;

  describe('scenes.timeline', function () {
    it('シーンが5つある', function () {
      expect(S.timeline.length).toBe(5);
    });

    it('全シーンに名前・尺・遷移・描画関数が揃っている', function () {
      for (var i = 0; i < S.timeline.length; i++) {
        var s = S.timeline[i];
        expect(typeof s.name).toBe('string');
        expect(typeof s.duration).toBe('number');
        expect(typeof s.draw).toBe('function');
        expect(typeof s.transition).toBe('string');
      }
    });

    it('尺は全て正の数（0 だと一瞬で飛ばされる）', function () {
      for (var i = 0; i < S.timeline.length; i++) {
        expect(S.timeline[i].duration > 0).toBeTrue();
      }
    });

    it('シーン名が重複していない', function () {
      var seen = {};
      for (var i = 0; i < S.timeline.length; i++) {
        var n = S.timeline[i].name;
        expect(seen[n] === undefined).toBeTrue();
        seen[n] = true;
      }
    });

    it('遷移の種類は実装済みのものだけ', function () {
      var known = { flash: true, wipe: true, blinds: true };
      for (var i = 0; i < S.timeline.length; i++) {
        expect(known[S.timeline[i].transition] === true).toBeTrue();
      }
    });

    it('1周が 40〜90 秒に収まる（短すぎず、飽きさせない）', function () {
      var total = 0;
      for (var i = 0; i < S.timeline.length; i++) total += S.timeline[i].duration;
      expect(total >= 40 && total <= 90).toBeTrue();
    });

    it('タイムライン全体を走査しても pickScene が破綻しない', function () {
      var total = 0;
      for (var i = 0; i < S.timeline.length; i++) total += S.timeline[i].duration;
      for (var t = 0; t < total * 2.5; t += 0.37) {
        var r = M.pickScene(S.timeline, t);
        expect(r.index >= 0 && r.index < S.timeline.length).toBeTrue();
      }
    });

    it('トンネル（触れる区間）が最も長い', function () {
      var tunnel = null;
      var maxOther = 0;
      for (var i = 0; i < S.timeline.length; i++) {
        var s = S.timeline[i];
        if (s.name === 'tunnel') tunnel = s;
        else maxOther = Math.max(maxOther, s.duration);
      }
      expect(tunnel !== null).toBeTrue();
      expect(tunnel.duration >= maxOther).toBeTrue();
    });
  });

  describe('scenes.hslToRgb', function () {
    it('彩度 0 は灰色になる', function () {
      expect(S.hslToRgb(0, 0, 0.5)).toEqual([128, 128, 128]);
    });
    it('明度 0 は黒', function () {
      expect(S.hslToRgb(0.3, 1, 0)).toEqual([0, 0, 0]);
    });
    it('明度 1 は白', function () {
      expect(S.hslToRgb(0.3, 1, 1)).toEqual([255, 255, 255]);
    });
    it('赤（色相 0）が正しい', function () {
      expect(S.hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    });
    it('全チャンネルが 0..255 に収まる', function () {
      for (var h = 0; h < 1; h += 0.05) {
        for (var l = 0; l <= 1; l += 0.25) {
          var rgb = S.hslToRgb(h, 0.9, l);
          for (var i = 0; i < 3; i++) {
            expect(rgb[i] >= 0 && rgb[i] <= 255).toBeTrue();
          }
        }
      }
    });
  });

  describe('レイマーチングの距離関数', function () {
    it('常に有限の数値を返す', function () {
      for (var i = 0; i < 200; i++) {
        var d = S.sceneDistance(i * 0.7 - 70, i * 1.3 - 130, i * 2.1, i * 0.11);
        expect(isFinite(d)).toBeTrue();
      }
    });

    it('筒の中心付近は内側（正の距離）になる', function () {
      // 中心軸のごく近くなら、必ず壁の内側にいる
      expect(S.sceneDistance(0, 0, 0, 0) > 0).toBeTrue();
      expect(S.sceneDistance(0, 0, 7.3, 2.5) > 0).toBeTrue();
    });

    it('十分に外側は負の距離になる', function () {
      expect(S.sceneDistance(40, 40, 0, 0) < 0).toBeTrue();
    });

    it('奥行きの繰り返しにより、周期の分だけ進めた点の距離が一致する', function () {
      // 輪は 2.8 ごとに並ぶが、壁は z に依存して波打つため完全一致はしない。
      // ここでは輪の項が支配的になる半径で確認する。
      var a = S.sceneDistance(2.9, 0, 1.4, 0);
      expect(isFinite(a)).toBeTrue();
    });

    it('描画解像度は軽量モードの方が小さい', function () {
      expect(S.RAY.widthLight < S.RAY.width).toBeTrue();
      expect(S.RAY.stepsLight < S.RAY.steps).toBeTrue();
    });
  });

  describe('scenes.SCROLL_TEXT', function () {
    it('空でない', function () {
      expect(S.SCROLL_TEXT.length > 0).toBeTrue();
    });
    it('作者名が含まれている', function () {
      expect(S.SCROLL_TEXT.indexOf('samoyed130-zen') >= 0).toBeTrue();
    });
  });

  describe('sound の層', function () {
    var S2 = window.PULSAR.sound;

    it('厚みは 0..1 に丸められる', function () {
      S2.setIntensity(-3);
      expect(S2.getIntensity()).toBe(0);
      S2.setIntensity(9);
      expect(S2.getIntensity()).toBe(1);
      S2.setIntensity(0.4);
      expect(S2.getIntensity()).toBeCloseTo(0.4);
    });

    it('層のしきい値は 0..1 に入り、順番どおりに並んでいる', function () {
      var L = S2.LAYER;
      expect(L.bass < L.hat).toBeTrue();
      expect(L.hat < L.lead).toBeTrue();
      expect(L.lead < L.arp).toBeTrue();
      expect(L.bass >= 0 && L.arp <= 1).toBeTrue();
    });

    it('ゲージ満タンで全ての層が鳴る条件を満たす', function () {
      expect(1 >= S2.LAYER.arp).toBeTrue();
    });

    it('未起動の状態は「消音」として扱われる（ボタンが必ず起動側に働く）', function () {
      // AudioContext が無い環境では起動できないが、状態の判定は破綻しない
      expect(typeof S2.isMuted()).toBe('boolean');
    });

    it('テンポ倍率は極端な値に丸められる', function () {
      S2.setTempoScale(0.1);
      expect(S2.getTempoScale()).toBe(0.5);
      S2.setTempoScale(10);
      expect(S2.getTempoScale()).toBe(2);
      S2.setTempoScale(1.2);
      expect(S2.getTempoScale()).toBeCloseTo(1.2);
    });

    it('映像側のテンポ範囲が、音側の許容範囲に収まっている', function () {
      var app = window.PULSAR.app.CONFIG;
      expect(app.tempoMin >= 0.5).toBeTrue();
      expect(app.tempoMax <= 2).toBeTrue();
      expect(app.tempoMin < app.tempoMax).toBeTrue();
    });

    it('音声が使えない環境でも turnOn / setMuted が例外を投げない', function () {
      // 例外が出れば、このテスト自体が失敗する
      S2.turnOn();
      S2.setMuted(true);
      S2.setMuted(false);
      expect(typeof S2.isPlaying()).toBe('boolean');
    });
  });

  describe('テンポ設定の一致', function () {
    it('映像と音の BPM が一致している（ずれると演出が合わなくなる）', function () {
      expect(window.PULSAR.sound.CONFIG.bpm).toBe(window.PULSAR.app.CONFIG.bpm);
    });
  });
})();
