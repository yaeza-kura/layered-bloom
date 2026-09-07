/**
 * worker.js の YAML 実装の往復テスト。
 *
 *   node admin/test_yaml.mjs
 *
 * 書き出した YAML は最終的に PyYAML（hooks/data.py）が読むので、
 * 突き合わせは tools 側の Python と cross_check.py で行う。
 * このファイルは JS 単体の往復と、結果を JSON で吐くところまでを担当する。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { yamlLoad, yamlDump, GALLERY_HEADER } from "./worker.js";

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log("  PASS  " + label);
  } else {
    failures++;
    console.log("  FAIL  " + label + "\n        期待: " + b + "\n        実際: " + a);
  }
}

/* ---- 1. 実データを読めるか ---- */
console.log("\n[1] data/gallery.yml の読み取り");
const real = readFileSync(new URL("../data/gallery.yml", import.meta.url), "utf8");
const parsed = yamlLoad(real);
check("件数", parsed.length, 21);
check("1件目", parsed[0], { file: "forest-lantern.jpg", caption: "Forest Lantern", size: "tall" });
check("3件目（size なし）", parsed[2], { file: "frosted-glass.jpg", caption: "Frosted Glass" });
check("最後", parsed[20], { file: "rainbow-windmill.jpg", caption: "Rainbow Windmill", size: "tall" });

/* ---- 2. JS 内での往復 ---- */
console.log("\n[2] 書き出し → 読み直し（JS 内）");
check("実データの往復", yamlLoad(yamlDump(parsed)), parsed);

/* ---- 3. YAML を壊しやすい文字 ---- */
console.log("\n[3] 特殊文字を含むキャプション");
const nasty = [
  { file: "a.jpg", caption: 'コロン: あり' },
  { file: "b.jpg", caption: "# シャープ始まり" },
  { file: "c.jpg", caption: 'ダブル"クオート"入り', size: "wide" },
  { file: "d.jpg", caption: "バックスラッシュ \\ 入り" },
  { file: "e.jpg", caption: "シングル'クオート'入り" },
  { file: "f.jpg", caption: "改行\nあり" },
  { file: "g.jpg", caption: "- ハイフン始まり" },
  { file: "h.jpg", caption: "" },
  { file: "i.jpg", caption: "絵文字🌸と日本語", size: "tall" },
  { file: "j.jpg", caption: "  前後に空白  " },
];
check("特殊文字の往復", yamlLoad(yamlDump(nasty)), nasty);

/* ---- 4. 手書きの（引用符なし）YAML も読めるか ---- */
console.log("\n[4] 手書き YAML との互換");
const handwritten = [
  "# コメント行",
  "- file: hand.jpg",
  "  caption: Hand Written",
  "  size: wide",
  "- file: quoted.jpg",
  '  caption: "Quoted Caption"',
  "- file: inline.jpg   # 行内コメント",
  "  caption: Inline",
].join("\n");
check("手書き形式", yamlLoad(handwritten), [
  { file: "hand.jpg", caption: "Hand Written", size: "wide" },
  { file: "quoted.jpg", caption: "Quoted Caption" },
  { file: "inline.jpg", caption: "Inline" },
]);

/* ---- 5. PyYAML に渡す用の出力を書き出す ---- */
const out = new URL("../", import.meta.url).pathname;
const tmp = process.env.CROSS_CHECK_OUT;
if (tmp) {
  writeFileSync(tmp + "/from_js.yml", GALLERY_HEADER + yamlDump(parsed.concat(nasty)), "utf8");
  writeFileSync(tmp + "/expected.json", JSON.stringify(parsed.concat(nasty), null, 2), "utf8");
  console.log("\n[5] PyYAML 突き合わせ用のファイルを出力: " + tmp);
}

console.log(failures === 0 ? "\n全テスト成功" : "\n" + failures + " 件失敗");
process.exit(failures === 0 ? 0 : 1);
