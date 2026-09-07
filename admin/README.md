# ギャラリー管理画面（Cloudflare Worker）

スマホ・PC のブラウザから作品ギャラリーを編集するための管理画面。

できること:

- サムネイル一覧の表示
- **ドラッグで並べ替え**（タッチ対応）／ ↑ ↓ ／ 先頭へ
- キャプションの書き換え
- 通常 / 縦長 / 横長 の切り替え
- 一覧からの削除
- 写真の追加（ブラウザ側で 1920px・JPEG品質80% に縮小してから送信）

保存すると `data/gallery.yml` が GitHub に commit され、Cloudflare Pages が
自動でリビルドして 2〜3 分でサイトに反映される。

```
ブラウザ ──▶ Worker ──┬─▶ R2（画像）
                      └─▶ GitHub（data/gallery.yml を commit）
                                   │
                                   ▼
                       Cloudflare Pages が自動リビルド
```

---

## デプロイ

**npm も wrangler も不要。** `worker.js` は依存パッケージゼロの単一ファイルなので、
Cloudflare のダッシュボードに貼り付けるだけで動く。

### 1. GitHub のトークンを作る

1. GitHub > Settings > Developer settings > **Personal access tokens > Fine-grained tokens**
2. **Generate new token**
3. Repository access: **Only select repositories** → `layered-bloom` だけを選ぶ
4. **Expiration** は既定が 30 days になっている。**選べる中で一番長いものにする。**
   期限が切れると管理画面の保存だけが突然失敗するようになり、原因が分かりにくい。
   選んだ日付は控えておくこと（切れたら同じ手順で作り直して
   Cloudflare の `GITHUB_TOKEN` を差し替える）。
5. Permissions > Repository permissions > **Contents** を **Read and write** にする
6. 生成されたトークン（`github_pat_...`）を控える

> 権限は Contents だけで足りる。他は付けないこと。
> Contents を選ぶと `Metadata` が自動で Read-only になるが、これは必須の依存なので正常。
> トークンは画面を離れると二度と表示されない。Cloudflare に貼るまでタブを閉じないこと。

### 2. Worker を作る

1. Cloudflare ダッシュボード > **Workers & Pages** > **Create** > **Worker**
2. 名前を決めて（例: `layered-bloom-admin`）**Deploy**
3. **Edit code** を開き、中身を全部消して [`worker.js`](worker.js) の内容を貼り付け
4. **Deploy**

### 3. 変数とシークレットを設定する

Worker > **Settings** > **Variables and Secrets**

| 種類 | 名前 | 値 |
|---|---|---|
| Text | `GITHUB_REPO` | `yaeza-kura/layered-bloom` |
| Text | `GITHUB_BRANCH` | `main` |
| Text | `IMAGE_BASE` | `https://pub-51f06b982bee4a31ace985952c2651a2.r2.dev/images` |
| Text | `R2_PREFIX` | `images` |
| **Secret** | `ADMIN_PASSWORD` | 管理画面のパスワード（自分で決める） |
| **Secret** | `GITHUB_TOKEN` | 手順1で作ったトークン |

`IMAGE_BASE` は `mkdocs.yml` の `extra.image_base` と同じ値にする。ここがズレると
サムネイルが表示されない。

### 4. R2 バケットを繋ぐ

Worker > **Settings** > **Bindings** > **Add** > **R2 bucket**

| 項目 | 値 |
|---|---|
| Variable name | `BUCKET` |
| R2 bucket | `layered-bloom-images`（`.env` の `R2_BUCKET_NAME` と同じもの） |

> R2 バインディングを使うので、Worker 側に S3 のアクセスキーを置く必要はない。

### 5. アクセスする

`https://<worker名>.<あなたのサブドメイン>.workers.dev`

パスワードを入れればログインできる。Cookie は30日間有効。

---

## セキュリティについて

`workers.dev` の URL は誰でも到達できる。パスワードで保護してはいるが、
**Cloudflare Access（Zero Trust）を前段に置くことを勧める。**

1. Cloudflare ダッシュボード > **Zero Trust** > Access > **Applications**
2. Add an application > **Self-hosted**
3. ドメインに Worker の URL を指定
4. ポリシー: Emails → 自分のメールアドレスだけを許可

無料枠（50ユーザーまで）で使える。Worker 側のパスワード認証はそのまま残るので、
二重の防御になる。

---

## 仕様と制約

- **削除は一覧からだけ。** R2 の画像本体は残る。誤操作で画像を失わないための設計。
  R2 から本当に消したいときは `python tools/upload.py --delete images/xxx.jpg`。
- **同時編集は検知される。** 読み込み時の commit SHA を保存時に送るので、
  他の場所（手編集や `upload.py`）で `gallery.yml` が更新されていた場合は
  保存が弾かれる。「読み直す」を押してからやり直すこと。
- **ファイル名は自動で決まる。** キャプションではなく元のファイル名をスラグ化する。
  日本語ファイル名などスラグが空になる場合は `photo-YYYYMMDDHHMMSS.jpg` になる。
  同名があれば `-2`, `-3` と連番が付く。
- **縦長/横長は自動判定。** 縦横比が 1.45 以上で横長、0.8 以下で縦長。
  `tools/upload.py` の `classify_size()` と同じ基準。あとから画面上で変更できる。
- 画像の縮小はブラウザ側で行う。スマホの通信量を抑えるためと、
  Worker では Pillow のような画像処理ライブラリが使えないため。

---

## テスト

`worker.js` の YAML 実装（本番ビルドが読む `data/gallery.yml` を書き出す部分）は
往復テストで検証している。

```bash
node admin/test_yaml.mjs
```

実データ21件の読み取り、特殊文字（`:` `#` `"` `\` 改行 絵文字）を含む往復、
手書き YAML との互換を確認する。書き出した YAML が PyYAML でも同一に読めることは
`CROSS_CHECK_OUT` を指定して Python 側と突き合わせて確認済み。
