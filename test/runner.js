/**
 * @file runner.js
 * @brief 依存ゼロの最小テストランナー。`test.html` から利用する。
 *
 * Node.js が使えない環境のため、ブラウザ上で単体テストを実行して結果を表示する。
 * 外部テストフレームワークは使わない（コンテスト規定で外部ライブラリを避けるため、
 * および審査員が URL を開くだけで結果を確認できるようにするため）。
 *
 * 使い方:
 * @code
 *   describe('clamp', function () {
 *     it('下限で止まる', function () { expect(clamp(-5, 0, 1)).toBe(0); });
 *   });
 *   PULSAR.test.run(document.getElementById('out'));
 * @endcode
 */
(function (global) {
  'use strict';

  /**
   * @brief 登録済みテストの一覧。
   * @private
   * @type {Array<{suite: string, name: string, fn: Function}>}
   */
  var cases = [];

  /** @brief 現在登録中のスイート名。 @private */
  var currentSuite = '(未分類)';

  /**
   * @brief テストをまとめる単位を宣言する。
   * @param {string} name スイート名
   * @param {Function} fn 中で `it` を呼ぶ関数
   * @returns {void}
   */
  function describe(name, fn) {
    var prev = currentSuite;
    currentSuite = name;
    fn();
    currentSuite = prev;
  }

  /**
   * @brief テスト1件を登録する。
   * @param {string} name このテストが何を保証するか
   * @param {Function} fn 失敗時に例外を投げる関数
   * @returns {void}
   */
  function it(name, fn) {
    cases.push({ suite: currentSuite, name: name, fn: fn });
  }

  /**
   * @brief 値を人が読める文字列にする。失敗時の表示に使う。
   * @private
   * @param {*} v 任意の値
   * @returns {string} 表示用文字列
   */
  function show(v) {
    if (typeof v === 'string') return '"' + v + '"';
    if (typeof v === 'number') return String(v);
    if (v === null || v === undefined) return String(v);
    try {
      return JSON.stringify(v);
    } catch (e) {
      return Object.prototype.toString.call(v);
    }
  }

  /**
   * @brief 検証の失敗を表す例外を投げる。
   * @private
   * @param {string} message 失敗理由
   * @returns {void}
   * @throws {Error} 常に投げる
   */
  function fail(message) {
    throw new Error(message);
  }

  /**
   * @brief 検証対象を包み、検証メソッドを提供する。
   * @param {*} actual 実際の値
   * @returns {{toBe: Function, toBeCloseTo: Function, toEqual: Function,
   *            toBeTrue: Function, toBeFalse: Function, toThrow: Function}}
   */
  function expect(actual) {
    return {
      /**
       * @brief 厳密等価（`===`）で比較する。
       * @param {*} want 期待値
       * @returns {void}
       */
      toBe: function (want) {
        if (actual !== want) fail('期待 ' + show(want) + ' / 実際 ' + show(actual));
      },

      /**
       * @brief 浮動小数を許容誤差つきで比較する。
       * @param {number} want 期待値
       * @param {number} [eps=1e-9] 許容誤差
       * @returns {void}
       */
      toBeCloseTo: function (want, eps) {
        var e = (eps === undefined) ? 1e-9 : eps;
        if (typeof actual !== 'number' || isNaN(actual) || Math.abs(actual - want) > e) {
          fail('期待 ' + show(want) + ' ±' + e + ' / 実際 ' + show(actual));
        }
      },

      /**
       * @brief JSON 表現の一致で比較する（配列・単純なオブジェクト向け）。
       * @param {*} want 期待値
       * @returns {void}
       */
      toEqual: function (want) {
        if (JSON.stringify(actual) !== JSON.stringify(want)) {
          fail('期待 ' + show(want) + ' / 実際 ' + show(actual));
        }
      },

      /**
       * @brief `true` であることを検証する。
       * @returns {void}
       */
      toBeTrue: function () {
        if (actual !== true) fail('期待 true / 実際 ' + show(actual));
      },

      /**
       * @brief `false` であることを検証する。
       * @returns {void}
       */
      toBeFalse: function () {
        if (actual !== false) fail('期待 false / 実際 ' + show(actual));
      },

      /**
       * @brief 関数を呼ぶと例外が投げられることを検証する。
       * @returns {void}
       */
      toThrow: function () {
        if (typeof actual !== 'function') fail('toThrow には関数を渡してください');
        var threw = false;
        try {
          actual();
        } catch (e) {
          threw = true;
        }
        if (!threw) fail('例外が投げられませんでした');
      }
    };
  }

  /**
   * @brief 登録済みの全テストを実行し、結果を DOM へ描画する。
   * @param {HTMLElement} mount 結果を差し込む要素
   * @returns {{total: number, passed: number, failed: number}} 集計結果
   */
  function run(mount) {
    var passed = 0;
    var failed = 0;
    var bySuite = {};
    var order = [];
    var flat = [];

    for (var i = 0; i < cases.length; i++) {
      var c = cases[i];
      var ok = true;
      var message = '';

      try {
        c.fn();
      } catch (e) {
        ok = false;
        message = e && e.message ? e.message : String(e);
      }

      if (ok) passed++; else failed++;
      flat.push({ suite: c.suite, name: c.name, ok: ok, message: message });

      if (!bySuite[c.suite]) {
        bySuite[c.suite] = [];
        order.push(c.suite);
      }
      bySuite[c.suite].push({ name: c.name, ok: ok, message: message });
    }

    // コマンドライン実行（test/run-node.js）から失敗内容を取り出すために保持する。
    global.PULSAR.test.__lastResults = flat;

    render(mount, order, bySuite, passed, failed);
    return { total: cases.length, passed: passed, failed: failed };
  }

  /**
   * @brief 結果を DOM に描画する。
   * @private
   * @param {HTMLElement} mount 差し込み先
   * @param {Array<string>} order スイートの表示順
   * @param {Object} bySuite スイート名 → 結果配列
   * @param {number} passed 成功件数
   * @param {number} failed 失敗件数
   * @returns {void}
   */
  function render(mount, order, bySuite, passed, failed) {
    if (!mount) return;
    mount.textContent = '';

    var banner = document.createElement('div');
    banner.className = 'banner ' + (failed === 0 ? 'ok' : 'ng');
    banner.textContent = failed === 0
      ? 'PASSED — ' + passed + ' 件すべて成功'
      : 'FAILED — 失敗 ' + failed + ' 件 / 成功 ' + passed + ' 件';
    mount.appendChild(banner);

    for (var i = 0; i < order.length; i++) {
      var suite = order[i];
      var list = bySuite[suite];

      var h = document.createElement('h2');
      h.textContent = suite;
      mount.appendChild(h);

      var ul = document.createElement('ul');
      for (var j = 0; j < list.length; j++) {
        var r = list[j];
        var li = document.createElement('li');
        li.className = r.ok ? 'pass' : 'failcase';

        var mark = document.createElement('span');
        mark.className = 'mark';
        mark.textContent = r.ok ? 'PASS' : 'FAIL';
        li.appendChild(mark);

        var label = document.createElement('span');
        label.textContent = r.name;
        li.appendChild(label);

        if (!r.ok) {
          var why = document.createElement('div');
          why.className = 'why';
          why.textContent = r.message;
          li.appendChild(why);
        }
        ul.appendChild(li);
      }
      mount.appendChild(ul);
    }
  }

  global.PULSAR = global.PULSAR || {};
  global.PULSAR.test = { describe: describe, it: it, expect: expect, run: run };

  // テストファイル側を簡潔に書けるよう、これらだけはグローバルに出す。
  // 本番ページ（index.html）は runner.js を読み込まないため、作品側は汚染されない。
  global.describe = describe;
  global.it = it;
  global.expect = expect;
})(typeof window !== 'undefined' ? window : this);
