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

    it('全シーンにグレアの倍率があり、0〜1 に収まる', function () {
      for (var i = 0; i < S.timeline.length; i++) {
        var g = S.timeline[i].glare;
        expect(typeof g).toBe('number');
        expect(g >= 0 && g <= 1).toBeTrue();
      }
    });

    it('画面全体が明るい場面ではグレアを抑えている', function () {
      // 全面に光が回ると白く飛んでしまうため
      var byName = {};
      for (var i = 0; i < S.timeline.length; i++) byName[S.timeline[i].name] = S.timeline[i];
      expect(byName.plasma.glare < byName.tunnel.glare).toBeTrue();
      expect(byName.starfield.glare < byName.tunnel.glare).toBeTrue();
      expect(byName.metaballs.glare < byName.tunnel.glare).toBeTrue();
    });

    it('遷移の種類は実装済みのものだけ', function () {
      var known = { flash: true, wipe: true, blinds: true };
      for (var i = 0; i < S.timeline.length; i++) {
        expect(known[S.timeline[i].transition] === true).toBeTrue();
      }
    });

    it('1周が 30〜90 秒に収まる（短すぎず、飽きさせない）', function () {
      var total = 0;
      for (var i = 0; i < S.timeline.length; i++) total += S.timeline[i].duration;
      expect(total >= 30 && total <= 90).toBeTrue();
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

  describe('scenes.SCROLL_TEXT', function () {
    it('空でない', function () {
      expect(S.SCROLL_TEXT.length > 0).toBeTrue();
    });
    it('作者名が含まれている', function () {
      expect(S.SCROLL_TEXT.indexOf('samoyed130-zen') >= 0).toBeTrue();
    });
  });

  describe('建造物の寸法', function () {
    it('通路がトンネルのリングより大きい（リングの半径は 1）', function () {
      expect(S.HALL.halfWidth > 1).toBeTrue();
      expect(S.HALL.halfHeight > 1).toBeTrue();
    });

    it('柱は通路の内側に立っている', function () {
      expect(S.HALL.columnX < S.HALL.halfWidth).toBeTrue();
      expect(S.HALL.columnX > 0).toBeTrue();
    });

    it('奥行きの見通しが確保されている', function () {
      expect(S.HALL.cells >= 4).toBeTrue();
      expect(S.HALL.period > 0).toBeTrue();
    });

    it('描き始める位置がカメラの前にある', function () {
      expect(S.HALL.nearZ > 0).toBeTrue();
    });

    it('ステージの数だけ背景の見た目が用意されている', function () {
      expect(S.STAGE_LOOK.length).toBe(window.PULSAR.game.CONFIG.stageCount);
    });

    it('偶数ステージは通路が上下にうねる（進む感覚を変える）', function () {
      for (var i = 0; i < S.STAGE_LOOK.length; i++) {
        var isEvenStage = ((i + 1) % 2) === 0;
        expect(S.STAGE_LOOK[i].vertical).toBe(isEvenStage);
      }
    });

    it('ステージが進むほど、うねりが細かくなる', function () {
      for (var i = 1; i < S.STAGE_LOOK.length; i++) {
        expect(S.STAGE_LOOK[i].bendFreq > S.STAGE_LOOK[i - 1].bendFreq).toBeTrue();
      }
    });

    it('うねりの大きさは通路に収まる範囲', function () {
      for (var i = 0; i < S.STAGE_LOOK.length; i++) {
        var amp = S.STAGE_LOOK[i].bendAmp;
        expect(amp > 0).toBeTrue();
        expect(amp < S.HALL.halfHeight).toBeTrue();
      }
    });

    it('ステージごとに色相が十分に離れている', function () {
      for (var i = 1; i < S.STAGE_LOOK.length; i++) {
        var d = Math.abs(S.STAGE_LOOK[i].hue - S.STAGE_LOOK[i - 1].hue);
        expect(d >= 30).toBeTrue();
      }
    });

    it('通路の形はステージによらず共通（寸法を持たない）', function () {
      // 部材の配置まで変えると別の建物に見え、作品としての繋がりが切れる。
      // 違いは色と揺れ方だけに絞っている。
      for (var i = 0; i < S.STAGE_LOOK.length; i++) {
        var k = S.STAGE_LOOK[i];
        expect(k.width === undefined).toBeTrue();
        expect(k.height === undefined).toBeTrue();
        expect(k.period === undefined).toBeTrue();
      }
    });

    it('背景の有無を切り替えられる', function () {
      var before = S.isRaymarch();
      S.setRaymarch(false);
      expect(S.isRaymarch()).toBeFalse();
      S.setRaymarch(true);
      expect(S.isRaymarch()).toBeTrue();
      S.setRaymarch(before);
    });

    it('設定が保存できない環境でも切り替えが例外を投げない', function () {
      // localStorage が無い環境（このテストの実行環境を含む）でも動くこと
      S.setRaymarch(false);
      S.setRaymarch(true);
      expect(typeof S.isRaymarch()).toBe('boolean');
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
      S2.setMuted(true);
      expect(S2.isMuted()).toBeTrue();
      expect(S2.isOn()).toBeFalse();
    });

    it('消音すると「音を出したい状態」も解除される', function () {
      S2.turnOn();
      S2.setMuted(true);
      expect(S2.isOn()).toBeFalse();
    });

    it('中断からの復帰処理は、音声が使えない環境でも例外を投げない', function () {
      S2.keepAlive();
      S2.setMuted(true);
      S2.keepAlive();
      expect(typeof S2.isOn()).toBe('boolean');
    });

    it('ステージの数だけ曲が用意されている', function () {
      expect(S2.stageCount()).toBe(window.PULSAR.game.CONFIG.stageCount);
    });

    it('ステージ番号は用意した曲の範囲へ収められる', function () {
      S2.setStage(-3);
      expect(S2.getStage()).toBe(1);
      S2.setStage(999);
      expect(S2.getStage()).toBe(S2.stageCount());
      S2.setStage(3);
      expect(S2.getStage()).toBe(3);
      S2.setStage(1);
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

  describe('一時停止', function () {
    var app = window.PULSAR.app;

    it('初期状態では止まっていない', function () {
      expect(app.isPaused()).toBeFalse();
    });

    it('ボタンで止めて、もう一度押すと再開する', function () {
      expect(app.togglePause()).toBeTrue();
      expect(app.isPaused()).toBeTrue();
      expect(app.togglePause()).toBeFalse();
      expect(app.isPaused()).toBeFalse();
    });

    it('説明を開いている間は止まる', function () {
      app.setPaused('dialog', true);
      expect(app.isPaused()).toBeTrue();
      app.setPaused('dialog', false);
      expect(app.isPaused()).toBeFalse();
    });

    it('理由が複数あるとき、片方を解除しても止まったまま', function () {
      // 説明を閉じた拍子にボタンでの停止まで解除されてはいけない
      app.setPaused('manual', true);
      app.setPaused('dialog', true);
      app.setPaused('dialog', false);
      expect(app.isPaused()).toBeTrue();

      app.setPaused('manual', false);
      expect(app.isPaused()).toBeFalse();
    });

    it('タブが隠れると止まる', function () {
      app.setPaused('hidden', true);
      expect(app.isPaused()).toBeTrue();
      app.setPaused('hidden', false);
      expect(app.isPaused()).toBeFalse();
    });

    it('カウントダウン中も止まっている', function () {
      app.setPaused('countdown', true);
      expect(app.isPaused()).toBeTrue();
      app.setPaused('countdown', false);
      expect(app.isPaused()).toBeFalse();
    });

    it('同じ理由を重ねて解除しても壊れない', function () {
      app.setPaused('manual', false);
      app.setPaused('manual', false);
      expect(app.isPaused()).toBeFalse();
    });
  });

  describe('テンポ設定の一致', function () {
    it('映像と音の BPM が一致している（ずれると演出が合わなくなる）', function () {
      expect(window.PULSAR.sound.CONFIG.bpm).toBe(window.PULSAR.app.CONFIG.bpm);
    });
  });
})();
