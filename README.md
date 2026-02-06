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

### 画像のアップロード

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

### サイトで使う

`mkdocs.yml` の `extra.image_base` を R2 の公開URLに書き換える:

```yaml
extra:
  image_base: https://pub-xxxxxxxx.r2.dev/images
```

`overrides/home.html` のギャラリーで画像を差し替える:

```html
<div class="works-item">
  <img src="{{ config.extra.image_base }}/photo01.jpg" alt="作品名" loading="lazy">
</div>
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
overrides/home.html       # トップページ用カスタムテンプレート
tools/upload.py           # R2 画像アップローダー
```
