"""add_to_gallery の回帰テスト。

    python tools/test_gallery.py

R2 には接続しない（upload_file を呼ばず add_to_gallery だけを検証する）。
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import yaml

import upload

FAILURES = 0


def check(label, actual, expected):
    global FAILURES
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        FAILURES += 1
        print(f"  FAIL  {label}\n        期待: {expected!r}\n        実際: {actual!r}")


def run(initial, uploaded, caption=None, top=False):
    """一時ファイルを gallery.yml に見立てて add_to_gallery を実行し、結果を返す。"""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "gallery.yml"
        path.write_text(yaml.safe_dump(initial, allow_unicode=True, sort_keys=False), encoding="utf-8")
        original = upload.GALLERY_FILE
        upload.GALLERY_FILE = path
        try:
            upload.add_to_gallery(uploaded, caption, top)
            return yaml.safe_load(path.read_text(encoding="utf-8"))
        finally:
            upload.GALLERY_FILE = original


def info(filename, size=None):
    return {"url": "", "filename": filename, "size": size}


print("\n[1] --top に複数枚を渡しても逆順にならない")
result = run(
    [{"file": "old.jpg", "caption": "Old"}],
    [info("a.jpg"), info("b.jpg"), info("c.jpg")],
    top=True,
)
check("並び順", [e["file"] for e in result], ["a.jpg", "b.jpg", "c.jpg", "old.jpg"])

print("\n[2] 既存項目を上げ直しても手編集した caption / size が消えない")
result = run(
    [{"file": "summer-pool.jpg", "caption": "Summer Pool", "size": "wide"}],
    [info("summer-pool.jpg", size="tall")],  # 自動判定は tall だが手で wide にしてある
)
check("件数", len(result), 1)
check("caption を維持", result[0]["caption"], "Summer Pool")
check("size を維持（自動判定で上書きしない）", result[0]["size"], "wide")

print("\n[3] --caption を明示したときだけ表示名を更新する")
result = run(
    [{"file": "x.jpg", "caption": "Before", "size": "tall"}],
    [info("x.jpg", size="wide")],
    caption="After",
)
check("caption を更新", result[0]["caption"], "After")
check("size は維持", result[0]["size"], "tall")

print("\n[4] 同じ実行内で同名キーに落ちる2枚が重複しない")
# sunset.png と sunset.jpg はどちらもリサイズ後 sunset.jpg になる
result = run([], [info("sunset.jpg"), info("sunset.jpg")])
check("重複していない", [e["file"] for e in result], ["sunset.jpg"])

print("\n[5] 通常の追記は末尾に入る")
result = run(
    [{"file": "one.jpg", "caption": "One"}],
    [info("two.jpg", size="wide")],
)
check("並び順", [e["file"] for e in result], ["one.jpg", "two.jpg"])
check("size が付く", result[1]["size"], "wide")

print("\n[6] 書き出したファイルは PyYAML で読み直せる（本番ビルドと同じ経路）")
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "gallery.yml"
    path.write_text("", encoding="utf-8")
    original = upload.GALLERY_FILE
    upload.GALLERY_FILE = path
    try:
        upload.add_to_gallery([info("a.jpg")], 'コロン: と "引用符" 入り', False)
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    finally:
        upload.GALLERY_FILE = original
check("特殊文字を含む caption", loaded[0]["caption"], 'コロン: と "引用符" 入り')

print("\n全テスト成功" if FAILURES == 0 else f"\n{FAILURES} 件失敗")
sys.exit(0 if FAILURES == 0 else 1)
