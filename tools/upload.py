"""
Cloudflare R2 画像アップローダー

使い方:
  # トップのギャラリーに追加（アップロード + data/gallery.yml に自動追記。縦長/横長も自動判定）
  python tools/upload.py --gallery photo.png

  # ギャラリー追加時に表示名とファイル名を指定（日本語ファイル名のまま渡せる）
  python tools/upload.py --gallery --name summer-pool --caption "Summer Pool" VRChat_スクショ.png

  # 一番上に追加（デフォルトは末尾）
  python tools/upload.py --gallery --top photo.png

  # 1枚アップロードのみ（自動リサイズ: 横幅1920px, JPEG品質80%）
  python tools/upload.py photo.png

  # 複数枚アップロード
  python tools/upload.py photo1.png photo2.jpg photo3.png

  # リサイズなし（元画像のまま）
  python tools/upload.py --no-resize photo.png

  # 横幅指定
  python tools/upload.py --width 1280 photo.png

  # アップロード先のフォルダ指定（デフォルト: images）
  python tools/upload.py --prefix blog/2026-02 photo.png

  # アップロード済み画像の一覧
  python tools/upload.py --list

  # 画像の削除
  python tools/upload.py --delete images/photo.jpg
"""

import argparse
import io
import mimetypes
import os
import sys
from pathlib import Path

from typing import TypedDict

import boto3
import yaml
from dotenv import load_dotenv
from PIL import Image

GALLERY_FILE: Path = Path(__file__).resolve().parent.parent / "data" / "gallery.yml"


class UploadInfo(TypedDict):
    url: str
    filename: str
    size: str | None

load_dotenv()

ACCOUNT_ID: str = os.environ["R2_ACCOUNT_ID"]
ACCESS_KEY_ID: str = os.environ["R2_ACCESS_KEY_ID"]
SECRET_ACCESS_KEY: str = os.environ["R2_SECRET_ACCESS_KEY"]
BUCKET_NAME: str = os.environ["R2_BUCKET_NAME"]
PUBLIC_URL: str = os.environ["R2_PUBLIC_URL"].rstrip("/")

ENDPOINT_URL: str = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"


def get_client():
    return boto3.client(
        "s3",
        endpoint_url=ENDPOINT_URL,
        aws_access_key_id=ACCESS_KEY_ID,
        aws_secret_access_key=SECRET_ACCESS_KEY,
        region_name="auto",
    )


def resize_image(file_path: Path, max_width: int, quality: int) -> tuple[bytes, str]:
    """画像をリサイズしてJPEGバイト列を返す。"""
    img = Image.open(file_path)

    if img.width > max_width:
        ratio: float = max_width / img.width
        new_size: tuple[int, int] = (max_width, int(img.height * ratio))
        img: Image.Image = img.resize(new_size, Image.Resampling.LANCZOS)

    # RGBA → RGB 変換（JPEG保存のため）
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    buf.seek(0)
    return buf.getvalue(), "image/jpeg"


def upload_file(
    client,
    file_path: Path,
    prefix: str,
    max_width: int,
    quality: int,
    no_resize: bool,
    name: str | None = None,
) -> UploadInfo:
    """ファイルをR2にアップロードし、{url, filename, size} を返す。"""
    if no_resize:
        data = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        ext = file_path.suffix
    else:
        data, content_type = resize_image(file_path, max_width, quality)
        ext = ".jpg"

    key = f"{prefix}/{name or file_path.stem}{ext}"

    client.put_object(
        Bucket=BUCKET_NAME,
        Key=key,
        Body=data,
        ContentType=content_type,
    )

    url = f"{PUBLIC_URL}/{key}"
    size_kb = len(data) / 1024
    print(f"  {file_path.name} -> {url} ({size_kb:.0f} KB)")
    return {"url": url, "filename": key.rsplit("/", 1)[-1], "size": classify_size(file_path)}


def classify_size(file_path: Path) -> str | None:
    """縦横比からギャラリーのセル種別を判定する。横長 -> wide / 縦長 -> tall / それ以外 -> None"""
    try:
        with Image.open(file_path) as img:
            ratio = img.width / img.height
    except OSError:
        return None
    if ratio >= 1.45:
        return "wide"
    if ratio <= 0.8:
        return "tall"
    return None


def caption_from_stem(stem: str) -> str:
    return stem.replace("-", " ").replace("_", " ").title()


def add_to_gallery(uploaded: list[UploadInfo], caption: str | None, top: bool) -> None:
    """data/gallery.yml に追記する。

    既にある項目は表示順・表示名・セル種別をそのまま保つ。--caption を明示したときだけ
    表示名を上書きする（画像を上げ直すたびに手編集が消えるのを防ぐため）。
    """
    entries: list[dict[str, str]] = yaml.safe_load(GALLERY_FILE.read_text(encoding="utf-8")) or []
    existing: dict[str, dict[str, str]] = {e["file"]: e for e in entries}
    inserted = 0

    for info in uploaded:
        filename = info["filename"]
        current = existing.get(filename)
        if current is not None:
            if caption:
                current["caption"] = caption
                print(f"  gallery.yml: {filename} の表示名を更新（位置とセル種別は維持）")
            else:
                print(f"  gallery.yml: {filename} は既にあるので内容を維持")
            continue

        entry: dict[str, str] = {
            "file": filename,
            "caption": caption or caption_from_stem(Path(filename).stem),
        }
        if info["size"]:
            entry["size"] = info["size"]

        if top:
            # 複数枚を渡したときに逆順にならないよう、挿入位置をずらしていく
            entries.insert(inserted, entry)
            inserted += 1
            print(f"  gallery.yml: {filename} を先頭に追加 ({entry.get('size', 'normal')})")
        else:
            entries.append(entry)
            print(f"  gallery.yml: {filename} を末尾に追加 ({entry.get('size', 'normal')})")

        # 同じ実行内で同名キーに落ちる2枚目を重複させない
        existing[filename] = entry

    header = (
        "# 作品ギャラリー（上から表示順）\n"
        "#   file:    R2 の images/ フォルダ内のファイル名\n"
        "#   caption: 表示名（ホバー時とライトボックスに出る）\n"
        "#   size:    tall（縦長・2行分）/ wide（横長・2列分）/ 省略で通常セル\n"
        "# 管理画面から編集される。手で直すことも可能。\n"
    )
    body = yaml.safe_dump(entries, allow_unicode=True, sort_keys=False)
    GALLERY_FILE.write_text(header + body, encoding="utf-8")


def list_objects(client) -> None:
    """バケット内のオブジェクト一覧を表示。"""
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET_NAME):
        for obj in page.get("Contents", []):
            size_kb = obj["Size"] / 1024
            print(f"  {obj['Key']}  ({size_kb:.0f} KB)")


def delete_object(client, key: str) -> None:
    """オブジェクトを削除。"""
    client.delete_object(Bucket=BUCKET_NAME, Key=key)
    print(f"  Deleted: {key}")


IMAGE_EXTENSIONS: set[str] = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"}


def collect_files(files: list[str], directory: str | None) -> list[Path]:
    """ファイルリストまたはディレクトリから画像ファイルを収集する。"""
    paths: list[Path] = []
    if directory:
        dir_path = Path(directory)
        if dir_path.is_dir():
            for p in sorted(dir_path.iterdir()):
                if p.suffix.lower() in IMAGE_EXTENSIONS:
                    paths.append(p)
    for f in files:
        path = Path(f)
        if path.exists():
            paths.append(path)
        else:
            print(f"  SKIP: {f} (not found)", file=sys.stderr)
    return paths


def main():
    parser = argparse.ArgumentParser(description="Cloudflare R2 画像アップローダー")
    parser.add_argument("files", nargs="*", help="アップロードするファイル")
    parser.add_argument("--dir", metavar="DIR", help="ディレクトリ内の画像を一括アップロード")
    parser.add_argument("--prefix", default="images", help="R2上のフォルダ (default: images)")
    parser.add_argument("--width", type=int, default=1920, help="リサイズ横幅 (default: 1920)")
    parser.add_argument("--quality", type=int, default=80, help="JPEG品質 (default: 80)")
    parser.add_argument("--no-resize", action="store_true", help="リサイズせず元画像のまま")
    parser.add_argument("--list", action="store_true", help="アップロード済み一覧")
    parser.add_argument("--delete", metavar="KEY", help="画像を削除")
    parser.add_argument("--gallery", action="store_true", help="data/gallery.yml に自動追記する")
    parser.add_argument("--top", action="store_true", help="--gallery 時に先頭へ追加（デフォルトは末尾）")
    parser.add_argument("--caption", help="ギャラリーの表示名（1枚のときのみ。省略時はファイル名から生成）")
    parser.add_argument("--name", help="アップロード後のファイル名（拡張子なし・1枚のときのみ）")
    args: argparse.Namespace = parser.parse_args()

    client = get_client()

    if args.list:
        print("R2 objects:")
        list_objects(client)
        return

    if args.delete:
        delete_object(client, args.delete)
        return

    paths = collect_files(args.files, args.dir)
    if not paths:
        parser.print_help()
        sys.exit(1)

    if args.gallery and args.prefix != "images":
        # gallery.yml は画像の basename しか持たず、URL は extra.image_base + basename で
        # 組み立てられる。images 以外に置くとリンク切れになるので先に止める。
        print(
            f"ERROR: --gallery は --prefix images でのみ使えます（指定: {args.prefix}）",
            file=sys.stderr,
        )
        sys.exit(1)

    if (args.caption or args.name) and len(paths) > 1:
        print("ERROR: --caption / --name は1枚アップロードのときだけ使えます", file=sys.stderr)
        sys.exit(1)

    uploaded: list[UploadInfo] = []
    for path in paths:
        info: UploadInfo = upload_file(
            client, path, args.prefix, args.width, args.quality, args.no_resize, args.name
        )
        uploaded.append(info)

    if args.gallery:
        print()
        add_to_gallery(uploaded, args.caption, args.top)
        print("  -> 確認: mkdocs serve / 反映: git add data/gallery.yml && git commit && git push")
    elif uploaded:
        print()
        print("Markdown:")
        for info in uploaded:
            print(f"  ![{info['filename']}]({info['url']})")


if __name__ == "__main__":
    main()
