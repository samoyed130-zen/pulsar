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
   * @brief 読み書きの相手。既定では端末の `localStorage`。
   *
   * 差し替えられるようにしてあるのは単体テストのためである。
   * ブラウザの `window.localStorage` は書き換えられない（読み取り専用の
   * 属性なので、代入しようとすると例外になる）ため、偽物に入れ替えて
   * 試すにはこちら側に受け口が要る。
   * @private
   */
  var backend = null;

  /**
   * @brief 実際に読み書きする相手を返す。
   * @private
   * @returns {Object} `localStorage` か、差し替えられた相手
   */
  function target() {
    return backend || global.localStorage;
  }

  /**
   * @brief 保存された文字列を読む。
   * @param {string} key 鍵
   * @returns {string|null} 値。無いか読めなければ null
   */
  function get(key) {
    try {
      return target().getItem(key);
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
      target().setItem(key, value);
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
      var store = target();
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

  /**
   * @brief 読み書きの相手を差し替える（単体テスト用）。
   *
   * @param {Object|null} v 差し替える相手。null で端末の保存場所へ戻す
   * @returns {void}
   */
  function setBackend(v) {
    backend = v || null;
  }

  global.PULSAR = global.PULSAR || {};
  global.PULSAR.store = {
    PREFIX: PREFIX,
    get: get,
    set: set,
    clear: clear,
    setEnabled: setEnabled,
    setBackend: setBackend
  };
})(typeof window !== 'undefined' ? window : this);
