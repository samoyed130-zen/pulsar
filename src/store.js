/**
 * @file store.js
 * @brief 設定を端末に覚えさせるための、`localStorage` の薄い包み。
 *
 * 各所で `try` / `catch` を書き散らさないために1つにまとめている。
 * `localStorage` は、設定でサイトのデータを禁じている環境や、
 * プライベート窓では読み書きそのものが例外を投げる。遊べなくなる
 * ほどのことではないので、失敗しても黙って既定値のまま進む。
 *
 * もう1つの役目が、**書き込みを止められること**。単体テストは
 * 設定を切り替える関数もそのまま呼ぶため、素通しにしていると
 * テストを開いただけで、その人の設定や開放済みステージが
 * 書き換わってしまう。テストの入口で止める。
 */
(function (global) {
  'use strict';

  /** @brief 書き込みを許すか。テスト中だけ false にする。 @private */
  var enabled = true;

  /** @brief この作品が使う鍵の頭。まとめて消すときの目印になる。 @private */
  var PREFIX = 'pulsar.';

  /**
   * @brief 保存された文字列を読む。
   * @param {string} key 鍵
   * @returns {string|null} 値。無いか読めなければ null
   */
  function get(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  /**
   * @brief 文字列を保存する。
   * @param {string} key 鍵
   * @param {string} value 値
   * @returns {void}
   */
  function set(key, value) {
    if (!enabled) return;

    try {
      global.localStorage.setItem(key, value);
    } catch (e) { /* 保存できなくても動作には影響しない */ }
  }

  /**
   * @brief この作品が保存したものをすべて消す。
   *
   * 同じ端末で他のページも `localStorage` を使っているため、全部を
   * 消すわけにはいかない。鍵の頭文字で自分のものだけを選ぶ。
   *
   * @returns {void}
   */
  function clear() {
    if (!enabled) return;

    try {
      var store = global.localStorage;
      var keys = [];

      for (var i = 0; i < store.length; i++) {
        var key = store.key(i);
        if (key && key.indexOf(PREFIX) === 0) keys.push(key);
      }

      // 消しながら数えると番号がずれるので、集めてから消す
      for (var k = 0; k < keys.length; k++) store.removeItem(keys[k]);
    } catch (e) { /* 消せなくても遊べる */ }
  }

  /**
   * @brief 書き込みの可否を切り替える。
   *
   * 単体テストから呼ぶ。読み取りは止めない。設定の復元まで
   * 止めてしまうと、復元の挙動そのものを試せなくなる。
   *
   * @param {boolean} on 保存してよいなら true
   * @returns {void}
   */
  function setEnabled(on) {
    enabled = !!on;
  }

  global.PULSAR = global.PULSAR || {};
  global.PULSAR.store = {
    PREFIX: PREFIX,
    get: get,
    set: set,
    clear: clear,
    setEnabled: setEnabled
  };
})(typeof window !== 'undefined' ? window : this);
