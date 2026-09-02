"""data/gallery.yml を読み込んで config.extra.gallery に渡す MkDocs フック。"""

from pathlib import Path

import yaml

GALLERY_FILE = Path(__file__).resolve().parent.parent / "data" / "gallery.yml"


def on_config(config):
    with open(GALLERY_FILE, encoding="utf-8") as f:
        config["extra"]["gallery"] = yaml.safe_load(f) or []
    return config


def on_serve(server, config, builder):
    # mkdocs serve 中に gallery.yml を編集したら自動リロード
    server.watch(str(GALLERY_FILE))
    return server
