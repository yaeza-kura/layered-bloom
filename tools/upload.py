"""
Cloudflare R2 画像アップローダー

使い方:
  # 1枚アップロード（自動リサイズ: 横幅1920px, JPEG品質80%）
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

import boto3
from dotenv import load_dotenv
from PIL import Image

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
    client, file_path: Path, prefix: str, max_width: int, quality: int, no_resize: bool
) -> str:
    """ファイルをR2にアップロードし、公開URLを返す。"""
    if no_resize:
        data = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        ext = file_path.suffix
    else:
        data, content_type = resize_image(file_path, max_width, quality)
        ext = ".jpg"

    key = f"{prefix}/{file_path.stem}{ext}"

    client.put_object(
        Bucket=BUCKET_NAME,
        Key=key,
        Body=data,
        ContentType=content_type,
    )

    url = f"{PUBLIC_URL}/{key}"
    size_kb = len(data) / 1024
    print(f"  {file_path.name} -> {url} ({size_kb:.0f} KB)")
    return url


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

    urls = []
    for path in paths:
        url: str = upload_file(client, path, args.prefix, args.width, args.quality, args.no_resize)
        urls.append(url)

    if urls:
        print()
        print("Markdown:")
        for url in urls:
            name = url.rsplit("/", 1)[-1]
            print(f"  ![{name}]({url})")


if __name__ == "__main__":
    main()
