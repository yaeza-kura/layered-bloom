/**
 * Layered Bloom — ギャラリー管理 Worker
 *
 * data/gallery.yml を GitHub 上で直接編集し、画像を R2 に置くための管理画面。
 * 保存すると main に commit され、Cloudflare Pages が自動でリビルドする。
 *
 * 依存パッケージなし・ビルド不要。Cloudflare ダッシュボードに貼るだけで動く。
 *
 * 必要な設定（ダッシュボード > Worker > Settings）
 *   バインディング  BUCKET         R2 バケット（layered-bloom-images）
 *   変数           GITHUB_REPO    例: yaeza-kura/layered-bloom
 *                  GITHUB_BRANCH  例: main
 *                  IMAGE_BASE     例: https://pub-xxxx.r2.dev/images
 *                  R2_PREFIX      例: images
 *   シークレット    ADMIN_PASSWORD 管理画面のパスワード
 *                  GITHUB_TOKEN   contents:write 権限の fine-grained PAT
 */

const GALLERY_PATH = "data/gallery.yml";

const GALLERY_HEADER =
  "# 作品ギャラリー（上から表示順）\n" +
  "#   file:    R2 の images/ フォルダ内のファイル名\n" +
  "#   caption: 表示名（ホバー時とライトボックスに出る）\n" +
  "#   size:    tall（縦長・2行分）/ wide（横長・2列分）/ 省略で通常セル\n" +
  "# 管理画面から編集される。手で直すことも可能。\n";

/* ===========================================================================
 * YAML（このファイルの形だけを扱う最小実装）
 *
 * 扱う形は「文字列だけを値に持つマップの配列」に限定されている。
 * 書き出しは必ず二重引用符で囲むので、値に : や # や改行が含まれても壊れない。
 * =========================================================================== */

function yamlEscape(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function yamlDump(entries) {
  let out = "";
  for (const entry of entries) {
    out += '- file: "' + yamlEscape(entry.file) + '"\n';
    out += '  caption: "' + yamlEscape(entry.caption == null ? "" : entry.caption) + '"\n';
    if (entry.size) out += '  size: "' + yamlEscape(entry.size) + '"\n';
  }
  return out;
}

function yamlUnescape(raw) {
  const text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  const SQ = String.fromCharCode(39);
  if (text.length >= 2 && text.startsWith(SQ) && text.endsWith(SQ)) {
    return text.slice(1, -1).split(SQ + SQ).join(SQ);
  }
  // 引用符なしのプレーンスカラー。行内コメントを落とす。
  const hash = text.indexOf(" #");
  return (hash === -1 ? text : text.slice(0, hash)).trim();
}

function yamlLoad(text) {
  const entries = [];
  let current = null;

  const assign = (target, pair) => {
    const colon = pair.indexOf(":");
    if (colon === -1) return;
    const key = pair.slice(0, colon).trim();
    if (key) target[key] = yamlUnescape(pair.slice(colon + 1));
  };

  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;

    const item = /^-\s*(.*)$/.exec(stripped);
    if (item) {
      current = {};
      entries.push(current);
      if (item[1].trim()) assign(current, item[1]);
      continue;
    }
    if (current) assign(current, stripped);
  }
  return entries;
}

/* ===========================================================================
 * base64（Worker には Buffer が無いので自前で用意する）
 * =========================================================================== */

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000; // 一度に渡しすぎるとスタックが溢れる
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/* ===========================================================================
 * GitHub Contents API
 * =========================================================================== */

function githubHeaders(env) {
  return {
    Authorization: "Bearer " + env.GITHUB_TOKEN,
    Accept: "application/vnd.github+json",
    "User-Agent": "layered-bloom-admin",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readGallery(env) {
  const branch = env.GITHUB_BRANCH || "main";
  const url =
    "https://api.github.com/repos/" + env.GITHUB_REPO + "/contents/" + GALLERY_PATH +
    "?ref=" + encodeURIComponent(branch);
  const res = await fetch(url, { headers: githubHeaders(env) });
  if (!res.ok) {
    throw new Error("GitHub の読み取りに失敗しました (" + res.status + "): " + (await res.text()));
  }
  const meta = await res.json();
  const text = new TextDecoder().decode(base64ToBytes(meta.content.replace(/\s/g, "")));
  return { entries: yamlLoad(text), sha: meta.sha };
}

async function writeGallery(env, entries, sha, message) {
  const body = GALLERY_HEADER + yamlDump(entries);
  const res = await fetch(
    "https://api.github.com/repos/" + env.GITHUB_REPO + "/contents/" + GALLERY_PATH,
    {
      method: "PUT",
      headers: Object.assign(githubHeaders(env), { "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: message,
        content: bytesToBase64(new TextEncoder().encode(body)),
        sha: sha,
        branch: env.GITHUB_BRANCH || "main",
      }),
    }
  );
  if (!res.ok) {
    // 409 は他所から gallery.yml が更新されていた場合。画面側で読み直させる。
    throw new Error("GitHub への保存に失敗しました (" + res.status + "): " + (await res.text()));
  }
  const result = await res.json();
  return result.commit.sha;
}

/* ===========================================================================
 * 認証（Cloudflare Access を前段に置く場合でも、二重に効かせておく）
 * =========================================================================== */

async function sessionToken(env) {
  const data = new TextEncoder().encode("layered-bloom:" + env.ADMIN_PASSWORD);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function isAuthed(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = /(?:^|;\s*)lb_admin=([a-f0-9]{64})/.exec(cookie);
  if (!match) return false;
  return timingSafeEqual(match[1], await sessionToken(env));
}

/* ===========================================================================
 * ルーティング
 * =========================================================================== */

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function htmlResponse(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

const REQUIRED_SETTINGS = ["ADMIN_PASSWORD", "GITHUB_TOKEN", "GITHUB_REPO", "IMAGE_BASE"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const missing = REQUIRED_SETTINGS.filter((key) => !env[key]);
    if (missing.length) {
      return new Response("設定が不足しています: " + missing.join(", "), { status: 500 });
    }
    if (!env.BUCKET) {
      return new Response("R2 バインディング BUCKET が設定されていません", { status: 500 });
    }

    if (path === "/login" && request.method === "POST") {
      const form = await request.formData();
      if (String(form.get("password")) !== env.ADMIN_PASSWORD) {
        return htmlResponse(loginPage("パスワードが違います"), 401);
      }
      const token = await sessionToken(env);
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/",
          "Set-Cookie":
            "lb_admin=" + token + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000",
        },
      });
    }

    if (path === "/logout") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/", "Set-Cookie": "lb_admin=; Path=/; Max-Age=0" },
      });
    }

    if (!(await isAuthed(request, env))) {
      if (path.startsWith("/api/")) return json({ error: "未認証です" }, 401);
      return htmlResponse(loginPage());
    }

    try {
      if (path === "/") {
        return htmlResponse(adminPage(env));
      }

      if (path === "/api/gallery" && request.method === "GET") {
        const state = await readGallery(env);
        return json({ entries: state.entries, sha: state.sha });
      }

      if (path === "/api/upload" && request.method === "POST") {
        const name = url.searchParams.get("name") || "";
        // 画面側でスラグ化済みの名前だけを受け付ける（R2 のキーを汚さないため）
        if (!/^[a-z0-9][a-z0-9-]*\.(jpg|png|webp)$/.test(name)) {
          return json({ error: "ファイル名が不正です: " + name }, 400);
        }
        const key = (env.R2_PREFIX || "images") + "/" + name;
        await env.BUCKET.put(key, request.body, {
          httpMetadata: {
            contentType: request.headers.get("Content-Type") || "image/jpeg",
          },
        });
        return json({ file: name, key: key });
      }

      if (path === "/api/save" && request.method === "POST") {
        const payload = await request.json();
        const entries = payload.entries;
        if (!Array.isArray(entries) || !entries.length) {
          return json({ error: "entries が空です" }, 400);
        }
        const seen = new Set();
        for (const entry of entries) {
          if (!entry.file) return json({ error: "file の無い項目があります" }, 400);
          if (seen.has(entry.file)) {
            return json({ error: "ファイル名が重複しています: " + entry.file }, 400);
          }
          seen.add(entry.file);
          if (entry.size && entry.size !== "tall" && entry.size !== "wide") {
            return json({ error: "size が不正です: " + entry.size }, 400);
          }
        }
        const commit = await writeGallery(
          env,
          entries,
          payload.sha,
          "ギャラリーを更新（管理画面から " + entries.length + " 件）"
        );
        return json({ ok: true, commit: commit });
      }
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }

    return new Response("Not found", { status: 404 });
  },
};

/* ===========================================================================
 * ログイン画面
 * =========================================================================== */

function loginPage(error) {
  return `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ギャラリー管理</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#08080b; color:#e0dde4;
         font-family:'Zen Kaku Gothic New',system-ui,sans-serif; }
  form { background:#111118; border:1px solid #2a2a3a; border-radius:14px;
         padding:2rem; width:min(360px,90vw); }
  h1 { font-size:1.1rem; margin:0 0 1.5rem; font-weight:600; }
  input { width:100%; box-sizing:border-box; padding:.75rem; border-radius:8px;
          border:1px solid #2a2a3a; background:#08080b; color:#e0dde4; font-size:1rem; }
  button { width:100%; margin-top:1rem; padding:.75rem; border:0; border-radius:8px;
           background:#c4a0d4; color:#08080b; font-weight:700; font-size:1rem; cursor:pointer; }
  .err { color:#d4a0b0; font-size:.85rem; margin-bottom:1rem; }
</style></head>
<body>
  <form method="POST" action="/login">
    <h1>ギャラリー管理</h1>
    ${error ? '<div class="err">' + error + "</div>" : ""}
    <input type="password" name="password" placeholder="パスワード" autofocus required>
    <button type="submit">ログイン</button>
  </form>
</body></html>`;
}

/* ===========================================================================
 * 管理画面
 * =========================================================================== */

function adminPage(env) {
  return `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ギャラリー管理</title>
<style>
  :root { color-scheme: dark; --bg:#08080b; --card:#111118; --border:#2a2a3a;
          --purple:#c4a0d4; --sakura:#d4a0b0; --text:#e0dde4; --sub:#8a8694; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
         font-family:'Zen Kaku Gothic New',system-ui,sans-serif; padding-bottom:6rem; }

  header { position:sticky; top:0; z-index:10; background:rgba(8,8,11,.94);
           backdrop-filter:blur(12px); border-bottom:1px solid var(--border);
           padding:.75rem 1rem; display:flex; align-items:center; gap:.75rem; }
  header h1 { font-size:1rem; margin:0; font-weight:600; flex:1; }
  .count { color:var(--sub); font-size:.8rem; }

  button { font:inherit; cursor:pointer; border-radius:8px; border:1px solid var(--border);
           background:var(--card); color:var(--text); padding:.5rem .9rem; }
  button:disabled { opacity:.4; cursor:default; }
  .primary { background:var(--purple); color:#08080b; border-color:var(--purple); font-weight:700; }
  .danger { color:var(--sakura); }

  main { padding:1rem; max-width:900px; margin:0 auto; }

  .tile { display:flex; gap:.75rem; align-items:flex-start; background:var(--card);
          border:1px solid var(--border); border-radius:12px; padding:.7rem; margin-bottom:.6rem; }
  .tile.dragging { opacity:.4; }
  .tile.over { border-color:var(--purple); }
  .tile.isnew { border-color:var(--sakura); }

  .handle { touch-action:none; cursor:grab; color:var(--sub); font-size:1.4rem;
            padding:.4rem .2rem; user-select:none; align-self:center; }
  .thumb { width:84px; height:84px; object-fit:cover; border-radius:8px;
           background:#000; flex-shrink:0; }
  .body { flex:1; min-width:0; display:flex; flex-direction:column; gap:.4rem; }
  .body input[type=text] { width:100%; padding:.45rem .6rem; border-radius:6px;
        border:1px solid var(--border); background:var(--bg); color:var(--text); font-size:.9rem; }
  .row { display:flex; gap:.3rem; flex-wrap:wrap; align-items:center; }
  .row select { padding:.4rem; border-radius:6px; border:1px solid var(--border);
                background:var(--bg); color:var(--text); font-size:.8rem; }
  .row button { padding:.35rem .6rem; font-size:.8rem; }
  .idx { color:var(--sub); font-size:.75rem; min-width:2.2em; }

  footer { position:fixed; left:0; right:0; bottom:0; background:rgba(8,8,11,.96);
           backdrop-filter:blur(12px); border-top:1px solid var(--border);
           padding:.75rem 1rem; display:flex; gap:.6rem; align-items:center; }
  footer .msg { flex:1; font-size:.82rem; color:var(--sub); }
  footer .msg.err { color:var(--sakura); }
  footer .msg.ok { color:var(--purple); }
  .dirty { color:var(--sakura); font-weight:700; }
</style></head>
<body>
<header>
  <h1>ギャラリー管理</h1>
  <span class="count" id="count"></span>
  <button onclick="location.href='/logout'">ログアウト</button>
</header>

<main>
  <div id="list"></div>
  <div class="row" style="margin-top:1rem">
    <input type="file" id="picker" accept="image/*" multiple hidden>
    <button onclick="document.getElementById('picker').click()">＋ 写真を追加</button>
    <button onclick="reload()">読み直す</button>
  </div>
</main>

<footer>
  <span class="msg" id="msg">読み込み中…</span>
  <button class="primary" id="save" onclick="save()" disabled>保存</button>
</footer>

<script>
var IMAGE_BASE = "${env.IMAGE_BASE}";
var MAX_WIDTH = 1920;
var QUALITY = 0.8;

var entries = [];   // { file, caption, size, blob?, url? }
var sha = null;
var dirty = false;

function msg(text, kind) {
  var el = document.getElementById('msg');
  el.textContent = text;
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

function markDirty() {
  dirty = true;
  document.getElementById('save').disabled = false;
  msg('未保存の変更があります', 'err');
}

function thumbUrl(entry) {
  return entry.url ? entry.url : IMAGE_BASE + '/' + entry.file;
}

function render() {
  var list = document.getElementById('list');
  list.innerHTML = '';
  entries.forEach(function (entry, i) {
    var tile = document.createElement('div');
    tile.className = 'tile' + (entry.blob ? ' isnew' : '');
    tile.dataset.index = String(i);

    var handle = document.createElement('div');
    handle.className = 'handle';
    handle.textContent = '⠿';
    handle.title = 'ドラッグで並べ替え';
    tile.appendChild(handle);

    var img = document.createElement('img');
    img.className = 'thumb';
    img.loading = 'lazy';
    img.src = thumbUrl(entry);
    img.alt = '';
    tile.appendChild(img);

    var body = document.createElement('div');
    body.className = 'body';

    var caption = document.createElement('input');
    caption.type = 'text';
    caption.value = entry.caption || '';
    caption.placeholder = '表示名';
    caption.oninput = function () { entry.caption = caption.value; markDirty(); };
    body.appendChild(caption);

    var row = document.createElement('div');
    row.className = 'row';

    var idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = (i + 1) + '.';
    row.appendChild(idx);

    var size = document.createElement('select');
    [['', '通常'], ['tall', '縦長'], ['wide', '横長']].forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0]; o.textContent = opt[1];
      if ((entry.size || '') === opt[0]) o.selected = true;
      size.appendChild(o);
    });
    size.onchange = function () { entry.size = size.value; markDirty(); };
    row.appendChild(size);

    row.appendChild(mkBtn('↑', function () { move(i, i - 1); }, i === 0));
    row.appendChild(mkBtn('↓', function () { move(i, i + 1); }, i === entries.length - 1));
    row.appendChild(mkBtn('先頭へ', function () { move(i, 0); }, i === 0));

    var del = mkBtn('削除', function () {
      if (confirm('「' + (entry.caption || entry.file) + '」を一覧から外しますか？\\n（R2 の画像自体は残ります）')) {
        entries.splice(i, 1); markDirty(); render();
      }
    }, false);
    del.className = 'danger';
    row.appendChild(del);

    body.appendChild(row);
    tile.appendChild(body);
    list.appendChild(tile);
  });

  document.getElementById('count').textContent = entries.length + ' 件';
}

function mkBtn(label, onclick, disabled) {
  var b = document.createElement('button');
  b.textContent = label;
  b.onclick = onclick;
  b.disabled = !!disabled;
  return b;
}

function move(from, to) {
  if (to < 0 || to >= entries.length) return;
  entries.splice(to, 0, entries.splice(from, 1)[0]);
  markDirty();
  render();
}

/* ---- ドラッグ並べ替え（マウスもタッチも同じ経路） ---- */
var dragFrom = null;

document.addEventListener('pointerdown', function (e) {
  var handle = e.target.closest ? e.target.closest('.handle') : null;
  if (!handle) return;
  var tile = handle.closest('.tile');
  dragFrom = Number(tile.dataset.index);
  tile.classList.add('dragging');
  handle.setPointerCapture(e.pointerId);
  e.preventDefault();
});

document.addEventListener('pointermove', function (e) {
  if (dragFrom === null) return;
  var el = document.elementFromPoint(e.clientX, e.clientY);
  var tile = el && el.closest ? el.closest('.tile') : null;
  document.querySelectorAll('.tile.over').forEach(function (t) { t.classList.remove('over'); });
  if (tile) tile.classList.add('over');
});

document.addEventListener('pointerup', function (e) {
  if (dragFrom === null) return;
  var el = document.elementFromPoint(e.clientX, e.clientY);
  var tile = el && el.closest ? el.closest('.tile') : null;
  var to = tile ? Number(tile.dataset.index) : dragFrom;
  var from = dragFrom;
  dragFrom = null;
  document.querySelectorAll('.tile.over,.tile.dragging').forEach(function (t) {
    t.classList.remove('over'); t.classList.remove('dragging');
  });
  if (to !== from) move(from, to); else render();
});

/* ---- 追加（ブラウザ側でリサイズしてから送る） ---- */
function slugify(text, fallback) {
  var slug = String(text).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // 日本語のファイル名だと数字しか残らないことがある（「タイトルなし2」→「2」）。
  // 英字を含み3文字以上でなければ意味のある名前ではないとみなし、日時に逃がす。
  return /[a-z]/.test(slug) && slug.length >= 3 ? slug : fallback;
}

function stamp() {
  return 'photo-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
}

function resize(file) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height;
      var scale = w > MAX_WIDTH ? MAX_WIDTH / w : 1;
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        URL.revokeObjectURL(img.src);
        if (!blob) { reject(new Error('画像の変換に失敗しました')); return; }
        var ratio = w / h;
        resolve({ blob: blob, size: ratio >= 1.45 ? 'wide' : (ratio <= 0.8 ? 'tall' : '') });
      }, 'image/jpeg', QUALITY);
    };
    img.onerror = function () { reject(new Error('画像を読み込めませんでした')); };
    img.src = URL.createObjectURL(file);
  });
}

document.getElementById('picker').onchange = async function (e) {
  var files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  msg(files.length + ' 枚を変換中…');
  var taken = {};
  entries.forEach(function (en) { taken[en.file] = true; });

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    try {
      var out = await resize(file);
      var stem = file.name.replace(/\\.[^.]+$/, '');
      var base = slugify(stem, stamp());
      var name = base + '.jpg';
      var n = 2;
      while (taken[name]) { name = base + '-' + n + '.jpg'; n++; }
      taken[name] = true;
      entries.push({
        file: name,
        caption: stem,
        size: out.size,
        blob: out.blob,
        url: URL.createObjectURL(out.blob)
      });
    } catch (err) {
      msg(file.name + ': ' + err.message, 'err');
    }
  }
  markDirty();
  render();
  msg(files.length + ' 枚を追加しました。保存すると公開されます', 'ok');
};

/* ---- 読み込み・保存 ---- */
async function reload() {
  if (dirty && !confirm('未保存の変更があります。破棄して読み直しますか？')) return;
  msg('読み込み中…');
  var res = await fetch('/api/gallery');
  var data = await res.json();
  if (!res.ok) { msg(data.error || '読み込みに失敗しました', 'err'); return; }
  entries = data.entries;
  sha = data.sha;
  dirty = false;
  document.getElementById('save').disabled = true;
  render();
  msg('読み込みました', 'ok');
}

async function save() {
  var btn = document.getElementById('save');
  btn.disabled = true;

  try {
    var pending = entries.filter(function (en) { return en.blob; });
    for (var i = 0; i < pending.length; i++) {
      var en = pending[i];
      msg('アップロード中 ' + (i + 1) + '/' + pending.length + '…');
      var res = await fetch('/api/upload?name=' + encodeURIComponent(en.file), {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: en.blob
      });
      var out = await res.json();
      if (!res.ok) throw new Error(out.error || 'アップロードに失敗しました');
      delete en.blob;
      delete en.url;
    }

    msg('保存中…');
    var payload = entries.map(function (en) {
      var e = { file: en.file, caption: en.caption || '' };
      if (en.size) e.size = en.size;
      return e;
    });
    var res2 = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: payload, sha: sha })
    });
    var out2 = await res2.json();
    if (!res2.ok) throw new Error(out2.error || '保存に失敗しました');

    dirty = false;
    await reload();
    msg('保存しました。2〜3分でサイトに反映されます', 'ok');
  } catch (err) {
    msg(err.message, 'err');
    btn.disabled = false;
  }
}

window.addEventListener('beforeunload', function (e) {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

reload();
</script>
</body></html>`;
}

// テスト用（Worker 実行時には使われない）
export { yamlLoad, yamlDump, GALLERY_HEADER };
