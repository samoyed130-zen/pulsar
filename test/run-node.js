/**
 * @file run-node.js
 * @brief 同じテストをコマンドラインからも実行するための入口（開発時の確認用）。
 *
 * 本番の確認手段はブラウザの `test.html`。こちらは実装中に素早く回すためのもので、
 * 作品ページからは読み込まれない。
 *
 * 使い方: `node test/run-node.js`
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');

/** @brief ブラウザに似せた最小の実行環境。`window` は自分自身を指す。 */
var sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.Math = Math;
sandbox.JSON = JSON;

var context = vm.createContext(sandbox);

/**
 * @brief ファイルをサンドボックス内で評価する。
 * @param {string} rel リポジトリ相対のパス
 * @returns {void}
 */
function load(rel) {
  var code = fs.readFileSync(path.join(root, rel), 'utf8');
  vm.runInContext(code, context, { filename: rel });
}

// 作品側。DOM に触れるのは起動関数の中だけなので、読み込むだけなら通る。
//
// 設定の保存はテストの前に止める。ブラウザで同じテストを開いたときに、
// 遊び手の設定や開放済みステージを書き換えてしまわないようにするため。
load('src/store.js');
vm.runInContext('PULSAR.store.setEnabled(false)', context);

load('src/mathx.js');
load('src/raster.js');
load('src/mesh3d.js');
load('src/sound.js');
load('src/game.js');
load('src/scenes.js');
load('src/main.js');

load('test/runner.js');
load('test/mathx.test.js');
load('test/mesh3d.test.js');
load('test/game.test.js');
load('test/scenes.test.js');

// mount に null を渡すと DOM を触らずに集計だけ行う。
var result = vm.runInContext('PULSAR.test.run(null)', context);

var cases = vm.runInContext('PULSAR.test.__lastResults || []', context);
cases.forEach(function (c) {
  if (!c.ok) console.error('FAIL  [' + c.suite + '] ' + c.name + '\n      ' + c.message);
});

console.log(
  (result.failed === 0 ? 'PASSED' : 'FAILED') +
  ' — 成功 ' + result.passed + ' / 失敗 ' + result.failed + ' / 合計 ' + result.total
);

process.exit(result.failed === 0 ? 0 : 1);
