# Layered Bloom's photo

八重咲クラ — VRChat Photographer のポートフォリオ＋ブログサイト。

MkDocs Material で構築し、GitHub Pages でホスティング。画像は Cloudflare R2 で配信。

## セットアップ

```bash
# 仮想環境の作成（初回のみ）
py -3.14 -m venv .venv

# 仮想環境の有効化
.venv\Scripts\activate

# 依存パッケージのインストール（初回のみ）
pip install -r requirements.txt
```

## ローカルプレビュー

```bash
.venv\Scripts\activate
mkdocs serve
```

ブラウザで [ローカルホスト](http://127.0.0.1:8000/) を開く。`Ctrl+C` で停止。

## ブログ記事の追加

`docs/blog/posts/` に Markdown ファイルを作成する。

```markdown
---
date: 2026-02-06
categories:
  - フォトコン
---

# 記事タイトル

本文
```

## 画像管理（Cloudflare R2）

### 初回セットアップ

1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) でアカウント作成（無料）
2. R2 > バケットを作成 > バケット名: `layered-bloom-images`
3. 作成したバケット > 設定 > パブリックアクセスを有効化 > `r2.dev` サブドメインを有効化
4. R2 > APIトークンの管理 > APIトークンを作成（読み書き権限）
5. `.env.example` を `.env` にコピーして認証情報を記入

```bash
copy .env.example .env
# .env を編集して R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL を記入
```

1. アップロード用ツールの依存をインストール

```bash
pip install -r tools/requirements.txt
```

### 管理画面から編集する（いちばんよく使う）

ブラウザ（スマホ可）から、並べ替え・キャプション変更・縦横の切り替え・削除・追加ができる。
保存すると `data/gallery.yml` が commit され、2〜3分でサイトに反映される。

```
https://<worker名>.<サブドメイン>.workers.dev
```

セットアップと仕様は [admin/README.md](admin/README.md) を参照。
Cloudflare Worker として動いていて、npm も wrangler も要らない（ダッシュボードに貼るだけ）。

### コマンドラインからギャラリーに追加する

```bash
# アップロード + data/gallery.yml へ自動追記（縦長/横長も画像サイズから自動判定）
python tools/upload.py --gallery photo.png

# 表示名・ファイル名を指定（VRChatのスクショを日本語名のまま渡せる）
python tools/upload.py --gallery --name summer-pool --caption "Summer Pool" "VRChat_2026-09-02.png"

# ギャラリーの一番上に追加（デフォルトは末尾）
python tools/upload.py --gallery --top photo.png
```

あとは `git add data/gallery.yml && git commit && git push` するだけで反映される。

並べ替え・削除・表示名の変更は [data/gallery.yml](data/gallery.yml) を直接編集する。
`size: tall`（縦長・2行分）/ `size: wide`（横長・2列分）/ 省略で通常セル。

### 画像のアップロードのみ（ブログ記事用など）

```bash
# 1枚アップロード（自動で横幅1920px・JPEG品質80%にリサイズ）
python tools/upload.py photo.png

# 複数枚
python tools/upload.py photo1.png photo2.jpg photo3.png

# リサイズなし
python tools/upload.py --no-resize photo.png

# ブログ記事用にフォルダ分け
python tools/upload.py --prefix blog/2026-02 photo.png

# アップロード済み一覧
python tools/upload.py --list

# 削除
python tools/upload.py --delete images/photo.jpg
```

アップロード後に表示される Markdown をそのまま記事に貼り付ければOK。

### 仕組み

`data/` 以下の YAML がサイトの唯一の情報源になっている。

```text
data/awards.yml  ──┐
data/events.yml  ──┼─→ hooks/data.py ─→ config.extra.awards / .events / .gallery
data/gallery.yml ──┘   （data/*.yml を起動時に全部読む）
                              │
              ┌───────────────┴───────────────┐
      overrides/home.html              docs/portfolio.md
```

- 画像本体は Cloudflare R2（`mkdocs.yml` の `extra.image_base` が公開URL）
- 一覧を増やしたいときは `data/` に YAML を置くだけでよく、`hooks/data.py` の編集は不要
  （`data/foo.yml` を置けば `config.extra.foo` で参照できる）
- Markdown ページから参照するときは front-matter に `jinja: true` を書く。
  書いたページだけ Jinja が有効になるので、ブログ記事に `{{ }}` が出てきても壊れない

### 受賞歴・イベントの編集

[data/awards.yml](data/awards.yml) と [data/events.yml](data/events.yml) を編集する。
トップページと [Portfolio ページ](docs/portfolio.md) が同じデータを見ているので、片方だけ古くなることがない。

```yaml
# data/awards.yml
- name: ○○フォトコン
  detail: 最優秀賞
  icon: "🥇"
  url: https://...   # 任意。書けばリンクになり、省けばただのテキスト
```

## デプロイ

`main` ブランチに push すれば GitHub Actions が自動でビルド＆デプロイする。

手動デプロイする場合:

```bash
mkdocs gh-deploy --force
```

## ディレクトリ構成

```text
docs/
├── index.md              # トップページ
├── portfolio.md          # 実績ページ
├── about.md              # 自己紹介ページ
├── images/               # 画像置き場（少量ならここ）
├── stylesheets/extra.css # カスタムCSS
└── blog/posts/           # ブログ記事
data/
├── awards.yml            # 受賞歴（トップ・Portfolio 共通）
├── events.yml            # 主催フォトコン（トップ・Portfolio 共通）
└── gallery.yml           # トップのギャラリー一覧（表示順・表示名・セル種別）
hooks/data.py             # data/*.yml を config.extra に載せる MkDocs フック
overrides/home.html       # トップページ用カスタムテンプレート
tools/upload.py           # R2 画像アップローダー（--gallery でギャラリー自動追記）
tools/test_gallery.py     # upload.py のギャラリー追記まわりの回帰テスト
admin/worker.js           # ギャラリー管理画面（Cloudflare Worker・単一ファイル）
admin/test_yaml.mjs       # 管理画面の YAML 実装の往復テスト
```
