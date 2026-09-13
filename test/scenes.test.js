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
      expect(S.SCROLL_TEXT.indexOf('samoyed130') >= 0).toBeTrue();
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

    it('うねりの周期は長く保たれている（小刻みに振れると酔う）', function () {
      for (var i = 0; i < S.STAGE_LOOK.length; i++) {
        expect(S.STAGE_LOOK[i].bendFreq > 0).toBeTrue();
        expect(S.STAGE_LOOK[i].bendFreq <= 0.16).toBeTrue();
      }
    });

    it('同じ向きどうしで比べると、後のステージほど大きく曲がる', function () {
      // 左右と上下では収まる幅が違うため、2つ飛ばし（同じ向き）で比べる
      for (var i = 2; i < S.STAGE_LOOK.length; i++) {
        expect(S.STAGE_LOOK[i].bendAmp > S.STAGE_LOOK[i - 2].bendAmp).toBeTrue();
      }
    });

    it('うねりの大きさは通路の内側に収まる', function () {
      for (var i = 0; i < S.STAGE_LOOK.length; i++) {
        var k = S.STAGE_LOOK[i];
        var limit = k.vertical ? S.HALL.halfHeight : S.HALL.halfWidth;
        expect(k.bendAmp > 0).toBeTrue();
        // 壁に貼り付かないよう、余裕を残す
        expect(k.bendAmp < limit * 0.8).toBeTrue();
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

    it('なめらかな塗りの有無を切り替えられる', function () {
      var before = S.isSmooth();
      S.setSmooth(false);
      expect(S.isSmooth()).toBeFalse();
      S.setSmooth(true);
      expect(S.isSmooth()).toBeTrue();
      S.setSmooth(before);
    });
  });

  describe('残像の濃さ', function () {
    /*
     * 残像は「1秒あたりどれだけ消えるか」で決める。毎フレーム同じ濃さで
     * 黒を重ねると、更新の速い端末ほど尾が短く（暗く）なってしまう。
     */

    /** fadeCanvas と同じ式。刻みに応じた実際の濃さを返す。 */
    function fadeAlpha(amount, dt) {
      return 1 - Math.pow(1 - amount, dt * 60);
    }

    it('60回/秒のときは指定した濃さのまま', function () {
      expect(fadeAlpha(0.42, 1 / 60)).toBeCloseTo(0.42);
    });

    it('刻みが粗いほど濃く重ねる（尾の長さを保つため）', function () {
      expect(fadeAlpha(0.42, 1 / 30) > fadeAlpha(0.42, 1 / 60)).toBeTrue();
      expect(fadeAlpha(0.42, 1 / 120) < fadeAlpha(0.42, 1 / 60)).toBeTrue();
    });

    it('1秒あたりの残り方が刻みによらない', function () {
      // 60回と120回で1秒ぶん重ねたとき、残る割合が一致すること
      var a = Math.pow(1 - fadeAlpha(0.42, 1 / 60), 60);
      var b = Math.pow(1 - fadeAlpha(0.42, 1 / 120), 120);
      expect(Math.abs(a - b) < 1e-9).toBeTrue();
    });
  });

  describe('ソフトウェアラスタライザ', function () {
    var R = window.PULSAR.raster;

    /** 単色の三角形を描いたバッファを作る補助。 */
    function fill(w, h, color) {
      var buf = R.createBuffer(w, h);
      R.clear(buf);
      R.triangle(buf,
                 [0, 0, 1, color[0], color[1], color[2]],
                 [w, 0, 1, color[0], color[1], color[2]],
                 [0, h, 1, color[0], color[1], color[2]], 1);
      return buf;
    }

    it('空のバッファは透明', function () {
      var buf = R.createBuffer(4, 4);
      R.clear(buf);
      expect(buf.color[0]).toBe(0);
    });

    it('三角形の内側は塗られ、外側は塗られない', function () {
      var buf = fill(8, 8, [255, 0, 0]);
      // 左上は三角形の中、右下は外
      expect(buf.color[0] >>> 24).toBe(255);
      expect(buf.color[8 * 8 - 1]).toBe(0);
    });

    it('頂点の色が面の中で混ざる', function () {
      var buf = R.createBuffer(16, 1);
      R.clear(buf);
      // 横一列を、左端が黒、右端が白の三角形で覆う
      R.triangle(buf,
                 [0, -8, 1, 0, 0, 0],
                 [16, -8, 1, 255, 255, 255],
                 [8, 8, 1, 128, 128, 128], 1);

      // 三角形が覆っているのは中ほどだけなので、その内側で比べる
      var left = buf.color[5] & 255;
      var right = buf.color[11] & 255;
      expect(left < right).toBeTrue();
    });

    it('手前の面が奥の面を隠す（Zバッファ）', function () {
      var buf = R.createBuffer(4, 4);
      R.clear(buf);

      // 奥に赤、手前に緑。描く順は奥が先でも後でも結果が変わらないこと。
      function draw(z, r, g) {
        R.triangle(buf,
                   [0, 0, z, r, g, 0],
                   [4, 0, z, r, g, 0],
                   [0, 4, z, r, g, 0], 1);
      }

      draw(1, 0, 255);   // 手前（緑）
      draw(5, 255, 0);   // 奥（赤）。あとから描いても隠れるはず

      expect(buf.color[0] & 255).toBe(0);
      expect((buf.color[0] >> 8) & 255).toBe(255);
    });

    it('潰れた三角形は何も描かない', function () {
      var buf = R.createBuffer(4, 4);
      R.clear(buf);
      R.triangle(buf,
                 [0, 0, 1, 255, 255, 255],
                 [4, 0, 1, 255, 255, 255],
                 [2, 0, 1, 255, 255, 255], 1);
      expect(buf.color[0]).toBe(0);
    });

    it('HSL の変換が既存の実装と一致する', function () {
      // scenes 側は 0..1、ラスタライザは度と % で受け取る
      var a = S.hslToRgb(0.5, 0.8, 0.4);
      var b = R.hslToRgb(180, 80, 40, [0, 0, 0]);
      expect(Math.round(b[0])).toBe(a[0]);
      expect(Math.round(b[1])).toBe(a[1]);
      expect(Math.round(b[2])).toBe(a[2]);
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

    it('一時停止中でも、操作を起点に音声を起こせる', function () {
      // ブラウザは利用者の操作を起点にしないと音声を起こさせない。
      // 「止まっているから」と見送ると、その瞬間を逃して無音のままになる。
      // 止まっている間は音量 0 で黙らせる、という分担にしている。
      S2.setSuspended(true);
      S2.turnOn();
      expect(S2.isOn()).toBeTrue();
      S2.setSuspended(false);
    });

    it('禁じられている場面では、音を出す操作をしても鳴らない', function () {
      // このテスト自体が、作品の中に埋め込まれて走ることがある。
      // 「音を出す」関数を試した拍子に曲が鳴り出さないこと。
      S2.setAllowed(false);
      S2.turnOn();
      expect(S2.isPlaying()).toBeFalse();
    });

    it('遅れの許容は先読みの幅で決まる', function () {
      // タブが隠れている間に予約が止まり、戻ったときにまとめて鳴るのを
      // 防ぐため、先読みより遅れていたら現在へ飛ばしている。
      expect(S2.CONFIG.lookahead > 0).toBeTrue();
      // 刻み1つぶんより広くないと、通常の予約まで飛ばしてしまう
      expect(S2.CONFIG.lookahead > 60 / S2.CONFIG.bpm / 4).toBeTrue();
    });

    it('層のしきい値は 0..1 に入り、順番どおりに並んでいる', function () {
      var L = S2.LAYER;
      expect(L.bass < L.hat).toBeTrue();
      expect(L.hat < L.lead).toBeTrue();
      expect(L.lead < L.arp).toBeTrue();
      expect(L.arp < L.pad).toBeTrue();
      expect(L.bass >= 0 && L.pad <= 1).toBeTrue();
    });

    it('ゲージ満タンで全ての層が鳴る条件を満たす', function () {
      expect(1 >= S2.LAYER.pad).toBeTrue();
    });

    it('層は5段階ある（打楽器から伸びる音まで）', function () {
      var keys = [];
      for (var k in S2.LAYER) {
        if (Object.prototype.hasOwnProperty.call(S2.LAYER, k)) keys.push(k);
      }
      expect(keys.length).toBe(5);
    });

    it('音を出す操作をすると、出したい状態になる', function () {
      // 実際に鳴り始めるのは最初の操作のとき（自動再生の制限があるため）。
      // ここで見ているのは「出したいと思っているか」のほう。
      S2.turnOn();
      expect(S2.isOn()).toBeTrue();
    });

    it('一時的な消音は、音を出したいという設定を変えない', function () {
      // 一時停止や合図の最中に読み込み直しただけで
      // 「音なし」が既定になってしまわないようにするため。
      S2.turnOn();
      S2.setSuspended(true);
      expect(S2.isOn()).toBeTrue();
      S2.setSuspended(false);
      expect(S2.isOn()).toBeTrue();
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

  describe('描画の重さの調整', function () {
    var app = window.PULSAR.app;

    it('更新は 60 回/秒までに抑えられている', function () {
      // 表示が 120Hz や 240Hz の端末でも、描画の負担を増やさない。
      // 16.67ms ちょうどだと、わずかな誤差で1枚おきに落ちてしまう。
      expect(app.CONFIG.minFrameMs < 1000 / 60).toBeTrue();
      expect(app.CONFIG.minFrameMs > 1000 / 70).toBeTrue();
    });

    it('落とす基準は、更新の間隔より長い', function () {
      // 60 回/秒で回っているだけで「遅い」と判定してはいけない。
      expect(app.CONFIG.slowMs > app.CONFIG.minFrameMs).toBeTrue();
    });

    it('落とす基準は 60fps の枠より大きい', function () {
      // 16.6ms を少し超えた程度で落とすと、一瞬の重さで画質が変わってしまう
      expect(app.CONFIG.slowMs > 16.6).toBeTrue();
    });

    it('戻す基準と落とす基準の間を大きく空ける', function () {
      // 差が小さいと、落として速くなった結果「戻せる」と判断し、
      // 戻した途端にまた遅くなる往復に陥る。
      expect(app.CONFIG.fastMs < app.CONFIG.slowMs * 0.7).toBeTrue();
    });

    it('戻すほうが、落とすより慎重である', function () {
      // 一瞬速いだけで戻すと、重い場面へ入るたびに行き来する。
      expect(app.CONFIG.fastFramesToRestore > app.CONFIG.slowFramesToDrop).toBeTrue();
    });

    it('開き始めのフレームは判断に使わない', function () {
      // 立ち上がりのもたつきで「遅い」と決めつけないこと
      expect(app.CONFIG.warmupFrames > 0).toBeTrue();
    });

    it('彩度は持ち上げる（明るさと違い境目を作らないため）', function () {
      expect(app.CONFIG.softGlareSat > 1).toBeTrue();
    });

    it('明るさの底上げは上限に届かない割合で指定する', function () {
      // 1 以上だと全面が上限に張り付き、面の境目だけが段差として残る。
      expect(app.CONFIG.softGlareLift > 0).toBeTrue();
      expect(app.CONFIG.softGlareLift < 1).toBeTrue();
    });

    it('明るさを倍率で持ち上げる設定は持たない', function () {
      // 掛けて持ち上げると明るい面から順に上限で頭打ちになり、
      // 面と面の境目が段差として見えてしまう。
      expect(app.CONFIG.noGlareBoost === undefined).toBeTrue();
    });

    it('暗部潰しは複数回かける', function () {
      // 1回では中間の明るさが残り、光らせたくない面まで持ち上がって
      // 画面全体が白く濁る。
      expect(app.CONFIG.softGlareSqueeze >= 2).toBeTrue();
    });

    /*
     * 以下の2つは「今どうなっているか」ではなく「切り替えられるか」を見る。
     *
     * 既定が切であることは、保存された値が '1' のときだけ入れる、という
     * 読み方で保証している。ここで既定値そのものを確かめようとすると、
     * その端末の設定に左右されて落ちる（実際に落ちた）。
     * テストが遊び手の設定を書き換えないよう、元の値へ戻しておく。
     */
    it('疑似グレアの固定を切り替えられる', function () {
      var before = app.isSoftGlare();

      app.setSoftGlare(true);
      expect(app.isSoftGlare()).toBeTrue();
      app.setSoftGlare(false);
      expect(app.isSoftGlare()).toBeFalse();

      app.setSoftGlare(before);
    });

    it('FPS の文字は目で追える間隔で書き換える', function () {
      // 毎フレーム書き換えると数字が目まぐるしく変わって読めない。
      expect(app.CONFIG.fpsUpdateMs >= 100).toBeTrue();
    });

    it('FPS 表示を切り替えられる', function () {
      var before = app.isFps();

      app.setFps(true);
      expect(app.isFps()).toBeTrue();
      app.setFps(false);
      expect(app.isFps()).toBeFalse();

      app.setFps(before);
    });

    it('ずらし加算のずれ幅は 0 より大きい', function () {
      expect(app.CONFIG.softGlareSpread > 0).toBeTrue();
    });

    it('ずらし加算の回数は奇数（中心のずれ 0 を含めるため）', function () {
      expect(app.CONFIG.softGlareTaps % 2 === 1).toBeTrue();
      expect(app.CONFIG.softGlareTaps >= 3).toBeTrue();
    });
  });

  describe('設定の保存', function () {
    var store = window.PULSAR.store;

    /**
     * 偽の保存場所を作る。
     *
     * ブラウザの `window.localStorage` は読み取り専用の属性で、偽物に
     * 差し替えようとすると例外になる。そこで store 側の受け口を使う。
     */
    function fakeStore(data) {
      return {
        get length() { return Object.keys(data).length; },
        key: function (i) { return Object.keys(data)[i]; },
        getItem: function (k) { return data[k] === undefined ? null : data[k]; },
        setItem: function (k, v) { data[k] = v; },
        removeItem: function (k) { delete data[k]; }
      };
    }

    it('テスト中は保存しない', function () {
      // これが効いていないと、テストのページを開くだけで
      // 遊び手の設定や開放済みステージが書き換わってしまう。
      var data = {};
      store.setBackend(fakeStore(data));

      store.set('pulsar.probe', '1');
      store.setBackend(null);

      expect(Object.keys(data).length).toBe(0);
    });

    it('読み取りは止めない（復元の挙動を試せなくなるため）', function () {
      store.setBackend(fakeStore({ 'pulsar.probe': '1' }));

      var v = store.get('pulsar.probe');
      store.setBackend(null);

      expect(v).toBe('1');
    });

    it('初期化は、この作品の鍵だけを消す', function () {
      var data = { 'pulsar.sens': '2', 'pulsar.bg': '0', 'other.app': 'keep' };
      store.setBackend(fakeStore(data));

      // clear は書き込みを止めている間は動かないので、一時的に戻す
      store.setEnabled(true);
      store.clear();
      store.setEnabled(false);
      store.setBackend(null);

      var left = Object.keys(data);
      expect(left.length).toBe(1);
      expect(left[0]).toBe('other.app');
    });

    it('この作品の鍵には決まった頭が付く', function () {
      // 頭が揃っていないと、初期化のときに消し残しが出る。
      expect(store.PREFIX).toBe('pulsar.');
    });

    it('保存できない環境でも例外を投げない', function () {
      // 設定でサイトのデータを禁じていると、読み書きそのものが例外を投げる。
      store.setBackend({
        getItem: function () { throw new Error('拒否'); },
        setItem: function () { throw new Error('拒否'); }
      });

      var ok = true;
      try {
        store.setEnabled(true);
        store.set('pulsar.probe', '1');
        expect(store.get('pulsar.probe')).toBe(null);
      } catch (e) {
        ok = false;
      }

      store.setEnabled(false);
      store.setBackend(null);
      expect(ok).toBeTrue();
    });
  });

  describe('一時停止', function () {
    var app = window.PULSAR.app;

    it('初期状態では止まっていない', function () {
      expect(app.isPaused()).toBeFalse();
    });

    it('タイトルのデモは走行中として扱わない', function () {
      // 画面に触れると走行の印は立つが、それはタイトルでも同じ。
      // これを走行中と見なすと、タイトルでメニューを開いただけで
      // デモが止まり、曲の厚みもゲージ（0）に引きずられる。
      // 起動直後はタイトルにいる（走り始めていない）
      window.PULSAR.game.state.started = true;
      expect(app.isPlaying()).toBeFalse();
      window.PULSAR.game.state.started = false;
    });

    it('進み具合は 0〜100 の割合で出せる', function () {
      // HUD は距離ではなく割合で見せる。作品の距離の単位を知らなくても
      // 残りが分かるようにするため。
      var G = window.PULSAR.game;
      G.reset(1);
      expect(Math.round(G.stageProgress() * 100)).toBe(0);
      expect(G.stageProgress() <= 1).toBeTrue();
    });

    it('止まっていても1枚だけ描き直せる', function () {
      // 止めている最中に見た目の設定を変えたとき、前の絵が残ったままだと
      // 何も起きていないように見えてしまう。
      expect(typeof app.requestRender).toBe('function');
      app.requestRender();
      expect(app.isPaused()).toBeFalse();   // 描き直しは停止状態を変えない
    });

    it('メニューや説明を開いている間は止まる', function () {
      app.setPaused('dialog', true);
      expect(app.isPaused()).toBeTrue();
      app.setPaused('dialog', false);
      expect(app.isPaused()).toBeFalse();
    });

    it('閉じると再開する（走行中でなければ合図は挟まない）', function () {
      app.setPaused('dialog', true);
      app.closeDialog();
      expect(app.isPaused()).toBeFalse();
    });

    it('理由が複数あるとき、片方を解除しても止まったまま', function () {
      // メニューを閉じた拍子に、タブが隠れている分まで解除されてはいけない
      app.setPaused('hidden', true);
      app.setPaused('dialog', true);
      app.setPaused('dialog', false);
      expect(app.isPaused()).toBeTrue();

      app.setPaused('hidden', false);
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
      app.setPaused('dialog', false);
      app.setPaused('dialog', false);
      expect(app.isPaused()).toBeFalse();
    });
  });

  describe('テンポ設定の一致', function () {
    it('映像と音の BPM が一致している（ずれると演出が合わなくなる）', function () {
      expect(window.PULSAR.sound.CONFIG.bpm).toBe(window.PULSAR.app.CONFIG.bpm);
    });
  });
})();
