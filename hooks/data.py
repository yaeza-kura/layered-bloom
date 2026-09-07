"""data/*.yml を読み込んで config.extra.<ファイル名> に載せる MkDocs フック。

  data/awards.yml  -> config.extra.awards
  data/events.yml  -> config.extra.events
  data/gallery.yml -> config.extra.gallery

新しい一覧を増やすときは data/ に yml を置くだけでよく、このファイルの編集は不要。
front-matter に `jinja: true` を書いたページからは、Markdown 内でも
`{% for a in config.extra.awards %}` のように同じデータを参照できる。
"""

from pathlib import Path

import jinja2
import yaml

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def on_config(config):
    for path in sorted(DATA_DIR.glob("*.yml")):
        config["extra"][path.stem] = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    return config


def on_page_markdown(markdown, page, config, files):
    # front-matter で明示的にオプトインしたページだけ Jinja に通す。
    # そうしないと本文に {{ }} を含む記事（テンプレートの解説など）が壊れる。
    if not page.meta.get("jinja"):
        return markdown
    return jinja2.Template(markdown).render(config=config, page=page)


def on_serve(server, config, builder):
    # mkdocs serve 中に data/ を編集したら自動リロード
    server.watch(str(DATA_DIR))
    return server
