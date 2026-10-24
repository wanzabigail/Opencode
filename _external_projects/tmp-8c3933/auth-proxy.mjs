import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync, execSync } from "node:child_process";

const PASSWORD = (process.env.OPENCODE_PASSWORD || "").trim();
const OC_VER = (process.env.OC_VER || "v2").trim();
const WORKSPACE = process.env.WORKSPACE_DIR || process.cwd();
const HOME_DIR = process.env.HOME || "/root";
const START_TIME = Number(process.env.START_TIME_MS || Date.now());
const DURATION_MIN = Number(process.env.DURASI_MENIT || 350);
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 4096);
const TOKEN = crypto.createHmac("sha256", PASSWORD || "default").update("opencode-cookie-v3").digest("hex");
const GLOBAL_CFG_FILE = path.join(HOME_DIR, ".config/opencode/opencode.json");
const OC_DB_FILE = path.join(HOME_DIR, ".local/share/opencode/opencode.db");

const previewTunnels = new Map();

function getPersistenceMeta() {
  const out = { worktrees: WORKSPACE ? [WORKSPACE] : [], sessionCount: 0 };
  if (!fs.existsSync(OC_DB_FILE)) return out;
  try {
    const py = [
      "import sys, os, json, sqlite3",
      "db, hd = sys.argv[1], os.path.realpath(sys.argv[2])",
      "conn = sqlite3.connect(db, timeout=5)",
      "wts = [r[0] for r in conn.execute('SELECT worktree FROM project ORDER BY time_updated DESC').fetchall() if r[0] and os.path.exists(r[0]) and os.path.realpath(r[0]) != hd]",
      "try:",
      "  cnt = conn.execute('SELECT COUNT(*) FROM session_v2 WHERE time_archived IS NULL').fetchone()[0]",
      "except Exception:",
      "  cnt = 0",
      "print(json.dumps({'worktrees': wts, 'sessionCount': cnt}))",
    ].join("\n");
    const raw = execFileSync("python3", ["-c", py, OC_DB_FILE, HOME_DIR], { encoding: "utf8", timeout: 4000 }).trim();
    const parsed = JSON.parse(raw);
    for (const wt of parsed.worktrees || []) {
      if (wt && !out.worktrees.includes(wt)) out.worktrees.push(wt);
    }
    out.sessionCount = Number(parsed.sessionCount || 0);
  } catch {}
  return out;
}

function readGlobalConfig() {
  try {
    if (fs.existsSync(GLOBAL_CFG_FILE)) {
      return JSON.parse(fs.readFileSync(GLOBAL_CFG_FILE, "utf8"));
    }
  } catch {}
  return { $schema: "https://opencode.ai/config.json", provider: {} };
}

function getCustomModelEntries() {
  const cfg = readGlobalConfig();
  const entries = [];
  for (const [providerID, p] of Object.entries(cfg.provider || {})) {
    for (const modelID of Object.keys((p && p.models) || {})) {
      entries.push({ providerID, modelID });
    }
  }
  return entries;
}

function reloadOpenCodeEngine() {
  try {
    if (OC_VER === "v1") {
      execSync('pkill -TERM -f "opencode web" || true');
    } else {
      const ocBin = path.join(HOME_DIR, ".local/bin/opencode");
      try {
        execFileSync(ocBin, ["service", "stop"], { env: { ...process.env, HOME: HOME_DIR }, timeout: 10000 });
      } catch {}
      execSync("sleep 1");
      execFileSync(ocBin, ["service", "start"], { cwd: WORKSPACE, env: { ...process.env, HOME: HOME_DIR }, timeout: 15000 });
    }
  } catch {}
}

function writeGlobalConfig(cfg) {
  fs.mkdirSync(path.dirname(GLOBAL_CFG_FILE), { recursive: true });
  const tmp = `${GLOBAL_CFG_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, GLOBAL_CFG_FILE);
  // Simpan terenkripsi AES-256 ke GitHub secara non-blocking di latar belakang
  try {
    const saveBin = path.join(HOME_DIR, ".local/bin/oc-save");
    if (fs.existsSync(saveBin)) {
      const bg = spawn(saveBin, ["chore: auto-save custom provider terenkripsi"], {
        env: { ...process.env, FINAL_PW: PASSWORD, WORKSPACE_DIR: WORKSPACE },
        stdio: "ignore",
        detached: true,
      });
      bg.unref();
    }
  } catch {}
}

// Baca port & UUID service dinamis untuk OpenCode v2 (maupun fallback 4097 untuk v1)
function getUpstreamService() {
  if (OC_VER !== "v1") {
    try {
      const svcFile = path.join(HOME_DIR, ".local/state/opencode/service.json");
      const svc = JSON.parse(fs.readFileSync(svcFile, "utf8"));
      if (svc && svc.url) {
        const u = new URL(svc.url);
        if (u.port) return { port: Number(u.port), id: String(svc.id || "") };
      }
    } catch {}
  }
  return { port: 4097, id: "v1" };
}

function getUpstreamPort() {
  return getUpstreamService().port;
}

// Buat link pairing sekali pakai resmi untuk OpenCode v2 agar otomatis login tanpa ketik terminal
function getV2PairPath() {
  if (OC_VER === "v1") return "/";
  try {
    const ocBin = path.join(HOME_DIR, ".local/bin/opencode");
    const out = execFileSync(ocBin, ["pair", "--url", `http://127.0.0.1:${LISTEN_PORT}`], {
      env: { ...process.env, HOME: HOME_DIR },
      encoding: "utf8",
      timeout: 8000,
    });
    const m = out.match(/\/auth\/connect\/[-A-Za-z0-9_]+/);
    if (m) return m[0];
  } catch {}
  return "/";
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function isAuthed(req) {
  if (!PASSWORD) return true;
  return parseCookies(req.headers.cookie || "").oc_auth === TOKEN;
}

function sendJson(res, code, data) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 131072) req.destroy(); });
    req.on("end", () => resolve(body));
  });
}

function scanArtifacts(dir, depth = 0, out = []) {
  if (depth > 6) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if ([".git", "node_modules", ".gradle", ".cache"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      scanArtifacts(full, depth + 1, out);
    } else if (/\.(apk|aab|ipa|exe|AppImage)$/i.test(e.name)) {
      try {
        const st = fs.statSync(full);
        out.push({
          name: e.name,
          relPath: path.relative(WORKSPACE, full),
          sizeMB: (st.size / (1024 * 1024)).toFixed(2),
          mtime: st.mtimeMs,
        });
      } catch {}
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function detectActivePorts() {
  try {
    const raw = execSync("ss -tlnH 2>/dev/null || true", { encoding: "utf8" });
    const ignored = new Set([22, 4096, 4097, 20241, getUpstreamPort()]);
    const found = new Set();
    for (const line of raw.split("\n")) {
      const m = line.match(/:(\d+)\s+/);
      if (m) {
        const p = Number(m[1]);
        if (p >= 1024 && p <= 65535 && !ignored.has(p) && p < 32768) found.add(p);
      }
    }
    return Array.from(found).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function startPortPreviewTunnel(port) {
  const p = Number(port);
  if (!p || p < 1 || p > 65535) throw new Error("Port tidak valid");
  const existing = previewTunnels.get(p);
  if (existing && existing.url && existing.proc && existing.proc.exitCode === null) {
    return existing.url;
  }
  const cfBin = path.join(HOME_DIR, ".local/bin/cloudflared");
  const proc = spawn(cfBin, ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://127.0.0.1:${p}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  const urlPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout membuat tunnel preview")), 20000);
    const onChunk = (buf) => {
      logs += buf.toString();
      const m = logs.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    proc.stdout.on("data", onChunk);
    proc.stderr.on("data", onChunk);
    proc.on("exit", () => {
      previewTunnels.delete(p);
      clearTimeout(timer);
      reject(new Error("Cloudflared berhenti"));
    });
  });
  const url = await urlPromise;
  previewTunnels.set(p, { url, proc });
  return url;
}

const LOGIN_HTML = (err = false) => `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Login — OpenCode Cloud Pro</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d12; color: #f3f4f6; padding: 16px; }
    .card { width: 100%; max-width: 390px; background: #161922; border: 1px solid #2a2f3d; border-radius: 18px; padding: 28px 24px; box-shadow: 0 20px 50px rgba(0,0,0,.5); }
    h1 { margin: 0 0 8px; font-size: 21px; }
    p { margin: 0 0 18px; font-size: 14px; color: #9ca3af; line-height: 1.5; }
    .err { background: #3b181e; border: 1px solid #ef4444; color: #fca5a5; padding: 10px 12px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; }
    label { display: block; font-size: 13px; color: #d1d5db; margin-bottom: 6px; }
    input { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid #374151; background: #0b0d12; color: #fff; font-size: 15px; margin-bottom: 16px; }
    button { width: 100%; padding: 12px; border: 0; border-radius: 10px; background: #3b82f6; color: #fff; font-weight: 600; font-size: 15px; cursor: pointer; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/__oc_login">
    <h1>🚀 OpenCode Cloud Pro (${OC_VER.toUpperCase()})</h1>
    <p>Masukkan password kamu untuk membuka ruang kerja AI & Cloud Panel.</p>
    ${err ? '<div class="err">Password belum cocok. Cek kembali password kamu.</div>' : ''}
    <label>Password</label>
    <input type="password" name="password" placeholder="Ketik password..." autofocus required />
    <button type="submit">Masuk Sekarang →</button>
  </form>
</body>
</html>`;

const PANEL_HTML = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>⚡ Cloud Control Panel — OpenCode Pro</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    body { margin: 0; background: #0b0d12; color: #f3f4f6; padding: 18px; }
    .wrap { max-width: 760px; margin: 0 auto; }
    .top { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 20px; }
    .back { padding: 9px 14px; border-radius: 10px; background: #2563eb; color: #fff; text-decoration: none; font-weight: 600; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #161922; border: 1px solid #262c3d; border-radius: 14px; padding: 14px; }
    .stat .k { font-size: 12px; color: #9ca3af; margin-bottom: 4px; }
    .stat .v { font-size: 18px; font-weight: 700; color: #60a5fa; }
    .card { background: #161922; border: 1px solid #262c3d; border-radius: 14px; padding: 18px; margin-bottom: 14px; }
    .card h2 { margin: 0 0 8px; font-size: 16px; }
    .card p { margin: 0 0 12px; font-size: 13px; color: #9ca3af; line-height: 1.5; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin-bottom: 10px; }
    input { padding: 10px 12px; border-radius: 9px; border: 1px solid #374151; background: #0b0d12; color: #fff; font-size: 13px; width: 100%; }
    input.short { width: 130px; }
    button, a.btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 14px; border: 0; border-radius: 9px; background: #3b82f6; color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; text-decoration: none; }
    button.green, a.btn.green { background: #059669; }
    button.amber { background: #d97706; }
    button.red { background: #dc2626; padding: 7px 11px; font-size: 12px; }
    .pill { display: inline-block; padding: 6px 10px; border-radius: 8px; background: #1f2937; font-size: 12px; margin: 4px 4px 0 0; cursor: pointer; border: 1px solid #374151; color: #e5e7eb; }
    .msg { margin-top: 10px; font-size: 13px; color: #6ee7b7; word-break: break-all; }
    .list-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; background: #0f1219; border: 1px solid #23293a; border-radius: 10px; margin-top: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <h1>⚡ OpenCode Cloud Control Panel</h1>
      <a class="back" href="/__oc_pair">← Kembali ke OpenCode Web</a>
    </div>

    <div class="grid">
      <div class="stat"><div class="k">Versi Engine</div><div class="v" id="st-ver">Memuat...</div></div>
      <div class="stat"><div class="k">Sisa Waktu Sesi</div><div class="v" id="st-time">Memuat...</div></div>
      <div class="stat"><div class="k">Project & Chat Aman</div><div class="v" id="st-sess">Memuat...</div></div>
      <div class="stat"><div class="k">RAM / Disk Bebas</div><div class="v" id="st-ram">Memuat...</div></div>
    </div>

    <div class="card">
      <h2>🔌 Penyedia Kustom (OpenAI-Compatible Provider)</h2>
      <p>Bisa ditambah langsung dari menu <b>Settings → Providers → Custom Provider</b> di dalam OpenCode Web <i>maupun</i> lewat form cepat di bawah ini (API key otomatis dienkripsi AES-256). Pakai <b>🔍 Ambil Daftar Model</b> & <b>⚡ Tes Koneksi 3-Tahap</b> dulu — tes ini mensimulasikan request asli OpenCode (tools + reasoning) dan otomatis mendeteksi penyebab error 400 "Invalid inference request"!</p>
      <div class="form-grid">
        <input id="cp-id" placeholder="Provider ID (cth: myprovider)" />
        <input id="cp-name" placeholder="Nama Tampilan (cth: My AI)" />
        <input id="cp-url" placeholder="Base URL (https://.../v1)" />
        <input id="cp-key" type="password" placeholder="API Key (sk-...)" />
        <input id="cp-mid" placeholder="Model ID (cth: gpt-4.1)" />
        <input id="cp-mname" placeholder="Nama Model (cth: GPT 4.1)" />
        <select id="cp-reason">
          <option value="">🧠 Reasoning: Default — tanpa parameter (paling kompatibel)</option>
          <option value="none">🧠 Reasoning: none (matikan thinking)</option>
          <option value="high">🧠 Reasoning: high</option>
          <option value="max">🧠 Reasoning: max</option>
        </select>
      </div>
      <select id="cp-model-sel" style="display:none" onchange="document.getElementById('cp-mid').value=this.value"></select>
      <div class="row">
        <button onclick="fetchCpModels()">🔍 Ambil Daftar Model</button>
        <button class="amber" onclick="testCpConn()">⚡ Tes Koneksi (3-Tahap)</button>
      </div>
      <button class="green" onclick="addCustomProvider()">➕ Simpan Penyedia Kustom</button>
      <button class="amber" id="cp-fix-btn" style="display:none" onclick="applyCpFix()">🛡️ Terapkan Perbaikan Otomatis</button>
      <div class="msg" id="cp-msg"></div>
      <div id="cp-list" style="margin-top:10px;"></div>
    </div>

    <div class="card">
      <h2>🌐 Live Preview Website / App Buatan OpenCode</h2>
      <p>Masukkan port web yang dijalankan OpenCode (misal <code>3000</code>, <code>5173</code>, <code>8000</code>) untuk membuat Link HTTPS Publik instan:</p>
      <div class="row">
        <input class="short" id="port-in" type="number" value="3000" placeholder="Port (cth: 3000)" />
        <button onclick="openPreview()">🚀 Buat & Buka Link Live Preview</button>
        <button class="green" onclick="openSubpath()">⚡ Preview Cepat (/preview/port)</button>
      </div>
      <div id="ports-detected" style="margin-top:10px;font-size:12px;color:#9ca3af;"></div>
      <div id="preview-list"></div>
    </div>

    <div class="card">
      <h2>📦 Download Project (.zip) & File Aplikasi (.apk)</h2>
      <p>Unduh seluruh folder project sebagai <code>.zip</code> atau unduh langsung file <code>.apk</code> hasil build Android:</p>
      <div class="row">
        <a class="btn green" href="/__api/zip">📥 Download Seluruh Project (.zip)</a>
      </div>
      <div id="apk-list" style="margin-top:10px;"></div>
    </div>

    <div class="card">
      <h2>🛠️ Kontrol Server & Link Permanen</h2>
      <p id="pages-info">Memuat link permanen GitHub Pages...</p>
      <div class="row">
        <button class="green" onclick="doAction('/__api/save', 'Menyimpan kode & chat ke GitHub...')">💾 Save & Backup Sekarang</button>
        <button class="amber" onclick="doAction('/__api/restart', 'Me-restart mesin OpenCode...')">🔄 Restart OpenCode</button>
        <a class="btn" href="/__oc_pair">🔗 Hubungkan Ulang Sesi Web</a>
      </div>
      <div class="msg" id="act-msg"></div>
    </div>
  </div>

  <script>
    async function loadStatus() {
      const r = await fetch('/__api/status');
      const d = await r.json();
      document.getElementById('st-ver').textContent = d.ocVersion || '-';
      document.getElementById('st-time').textContent = d.remainingMin + ' menit';
      document.getElementById('st-sess').textContent = (d.projectCount || 1) + ' proj · ' + (d.sessionCount || 0) + ' sesi';
      document.getElementById('st-ram').textContent = d.usedMemGB + '/' + d.totalMemGB + 'G · ' + d.freeDisk;
      document.getElementById('pages-info').innerHTML = '🔗 <b>Link Permanen GitHub Pages:</b> <a style="color:#60a5fa" target="_blank" href="' + d.pagesUrl + '">' + d.pagesUrl + '</a>';

      const cpl = document.getElementById('cp-list');
      if (d.customProviders && d.customProviders.length) {
        cpl.innerHTML = d.customProviders.map(p => '<div class="list-item"><span>🔌 <b>' + p.name + '</b> (<code>' + p.id + '</code> — ' + p.models.map(m => m.id + (m.effort ? ' <b style="color:#fbbf24">🧠' + m.effort + '</b>' : '')).join(', ') + ')</span><button class="red" onclick="delCustomProvider(\\'' + p.id + '\\')">Hapus</button></div>').join('');
      } else {
        cpl.innerHTML = '<div style="font-size:12px;color:#6b7280;margin-top:6px;">Belum ada penyedia kustom tersimpan.</div>';
      }

      const pd = document.getElementById('ports-detected');
      if (d.activePorts.length) {
        pd.innerHTML = 'Port aktif terdeteksi (klik untuk pilih): ' + d.activePorts.map(p => '<span class="pill" onclick="document.getElementById(\\'port-in\\').value=' + p + '">Port ' + p + '</span>').join('');
      } else {
        pd.textContent = 'Belum ada port web tambahan yang menyala.';
      }

      const pl = document.getElementById('preview-list');
      pl.innerHTML = d.tunnels.map(t => '<div class="list-item"><span>🌐 Port <b>' + t.port + '</b></span><a class="btn" target="_blank" href="' + t.url + '">Buka Website ↗</a></div>').join('');

      const al = document.getElementById('apk-list');
      if (d.artifacts.length) {
        al.innerHTML = d.artifacts.map(a => '<div class="list-item"><span>📱 <b>' + a.name + '</b> (' + a.sizeMB + ' MB)</span><a class="btn green" href="/__api/download?path=' + encodeURIComponent(a.relPath) + '">Download ⬇</a></div>').join('');
      } else {
        al.innerHTML = '<div style="font-size:12px;color:#6b7280;margin-top:6px;">Belum ada file .apk — suruh OpenCode membuat aplikasi Android untuk melihat tombol unduh otomatis di sini!</div>';
      }
    }

    async function addCustomProvider() {
      const providerID = document.getElementById('cp-id').value.trim().toLowerCase();
      const name = document.getElementById('cp-name').value.trim();
      const baseURL = document.getElementById('cp-url').value.trim();
      const key = document.getElementById('cp-key').value.trim();
      const mid = document.getElementById('cp-mid').value.trim();
      const mname = document.getElementById('cp-mname').value.trim() || mid;
      const msg = document.getElementById('cp-msg');
      if (!providerID || !name || !baseURL || !mid) {
        msg.textContent = '❌ Isi minimal Provider ID, Nama, Base URL, dan Model ID!';
        return;
      }
      const reason = document.getElementById('cp-reason') ? document.getElementById('cp-reason').value : '';
      const modelEntry = { name: mname };
      if (reason) modelEntry.options = { reasoningEffort: reason };
      const payload = {
        providerID,
        name,
        key: key || undefined,
        config: {
          npm: '@ai-sdk/openai-compatible',
          name,
          options: { baseURL },
          models: { [mid]: modelEntry }
        }
      };
      const r = await fetch('/__api/custom-provider', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (r.ok) {
        msg.textContent = '✅ Penyedia kustom "' + name + '" tersimpan & langsung aktif di OpenCode Web!';
        loadStatus();
      } else {
        msg.textContent = '❌ Gagal: ' + (d.error || 'Unknown error');
      }
    }

    async function delCustomProvider(id) {
      await fetch('/__api/custom-provider?id=' + encodeURIComponent(id), { method: 'DELETE' });
      loadStatus();
    }

    async function fetchCpModels() {
      const msg = document.getElementById('cp-msg');
      const baseURL = document.getElementById('cp-url').value.trim();
      const key = document.getElementById('cp-key').value.trim();
      if (!baseURL) { msg.textContent = '❌ Isi Base URL dulu!'; return; }
      msg.textContent = '⏳ Mengambil daftar model dari provider...';
      const r = await fetch('/__api/cp-models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseURL, key }) });
      const d = await r.json();
      if (d.models && d.models.length) {
        const sel = document.getElementById('cp-model-sel');
        sel.style.display = 'block';
        sel.innerHTML = d.models.map(m => '<option value="' + m.replace(/"/g, '&quot;') + '">' + m + '</option>').join('');
        if (!document.getElementById('cp-mid').value) document.getElementById('cp-mid').value = d.models[0];
        msg.textContent = '✅ Ditemukan ' + d.models.length + ' model! Pilih dari dropdown di atas.';
      } else {
        msg.textContent = '❌ ' + (d.error || 'Tidak ada model yang dikembalikan.');
      }
    }

    let __cpFixHigh = false;
    async function testCpConn() {
      const msg = document.getElementById('cp-msg');
      const baseURL = document.getElementById('cp-url').value.trim();
      const key = document.getElementById('cp-key').value.trim();
      const mid = document.getElementById('cp-mid').value.trim();
      if (!baseURL || !mid) { msg.textContent = '❌ Isi Base URL dan Model ID dulu!'; return; }
      msg.textContent = '⏳ Tes 3-tahap: dasar → +reasoning medium +tools → +tools saja...';
      try {
        const r = await fetch('/__api/cp-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseURL, key, mid }) });
        const d = await r.json();
        msg.textContent = d.message || d.error;
        __cpFixHigh = Boolean(d.reasoningHighWorks);
        const fb = document.getElementById('cp-fix-btn');
        if (fb) fb.style.display = d.fixReasoning ? 'block' : 'none';
      } catch (e) {
        msg.textContent = '❌ Tes gagal: ' + e.message;
      }
    }

    async function applyCpFix() {
      document.getElementById('cp-reason').value = __cpFixHigh ? 'high' : '';
      document.getElementById('cp-fix-btn').style.display = 'none';
      await addCustomProvider();
    }

    async function openPreview() {
      const port = document.getElementById('port-in').value;
      const msg = document.getElementById('act-msg');
      msg.textContent = '⏳ Membuat link HTTPS publik untuk port ' + port + ' (~5 detik)...';
      const r = await fetch('/__api/preview', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ port }) });
      const d = await r.json();
      if (d.url) {
        msg.innerHTML = '✅ Live Preview aktif: <a style="color:#6ee7b7" target="_blank" href="' + d.url + '">' + d.url + '</a>';
        loadStatus();
        window.open(d.url, '_blank');
      } else {
        msg.textContent = '❌ Gagal: ' + (d.error || 'Unknown error');
      }
    }

    function openSubpath() {
      const port = document.getElementById('port-in').value;
      window.open('/preview/' + port + '/', '_blank');
    }

    async function doAction(url, waitText) {
      const msg = document.getElementById('act-msg');
      msg.textContent = '⏳ ' + waitText;
      const r = await fetch(url, { method: 'POST' });
      const d = await r.json();
      msg.textContent = d.message || '✅ Selesai!';
      loadStatus();
    }

    loadStatus();
    setInterval(loadStatus, 10000);
  </script>
</body>
</html>`;

const buildWidgetJs = () => {
  const pMeta = getPersistenceMeta();
  return `(() => {
  const OC_WORKSPACE = ${JSON.stringify(WORKSPACE)};
  const OC_WORKTREES = ${JSON.stringify(pMeta.worktrees)};
  const OC_HAS_SESSIONS = ${JSON.stringify(pMeta.sessionCount > 0)};
  const OC_MODE = ${JSON.stringify(OC_VER)};
  const OC_CUSTOM_MODELS = ${JSON.stringify(getCustomModelEntries())};

  // 1. Daftarkan otomatis SEMUA project user & tampilkan semua model kustom walau domain *.trycloudflare.com berganti tiap 6 jam!
  if (OC_MODE !== 'v1') {
    try {
      if (OC_WORKTREES.length > 0) {
        const key = 'opencode.global.dat:server';
        const parsed = JSON.parse(localStorage.getItem(key) || 'null') || {
          list: [],
          hidden: {},
          projects: { local: [] },
          lastProject: {},
          recentlyClosed: {}
        };
        parsed.projects = parsed.projects || {};
        parsed.projects.local = Array.isArray(parsed.projects.local) ? parsed.projects.local : [];
        for (const wt of OC_WORKTREES) {
          if (wt && !parsed.projects.local.some((p) => p && p.worktree === wt)) {
            parsed.projects.local.push({ worktree: wt, expanded: true });
          }
        }
        parsed.lastProject = parsed.lastProject || {};
        if (!parsed.lastProject.local && OC_WORKSPACE) {
          parsed.lastProject.local = OC_WORKSPACE;
        }
        localStorage.setItem(key, JSON.stringify(parsed));
      }
      if (OC_CUSTOM_MODELS.length > 0) {
        const mKey = 'opencode.global.dat:model';
        const mData = JSON.parse(localStorage.getItem(mKey) || 'null') || { user: [], recent: [], variant: {} };
        mData.user = Array.isArray(mData.user) ? mData.user : [];
        for (const item of OC_CUSTOM_MODELS) {
          const existing = mData.user.find((x) => x && x.providerID === item.providerID && x.modelID === item.modelID);
          if (!existing) {
            mData.user.push({ providerID: item.providerID, modelID: item.modelID, visibility: 'show' });
          }
        }
        localStorage.setItem(mKey, JSON.stringify(mData));
      }
    } catch {}
  }

  // 2. Real-Time SSE-over-WebSocket Tunnel (mengatasi buffering HTTP chunked di *.trycloudflare.com!)
  if (!window.__ocSsePatched) {
    window.__ocSsePatched = true;
    const origFetch = window.fetch.bind(window);
    const isSseReq = (input, init) => {
      try {
        const rawUrl = typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.href
          : (input && input.url) || String(input || '');
        const u = new URL(rawUrl, location.origin);
        if (u.origin !== location.origin) return null;
        let accept = '';
        if (init && init.headers) {
          if (init.headers instanceof Headers) accept = init.headers.get('accept') || '';
          else if (Array.isArray(init.headers)) {
            const found = init.headers.find(([k]) => String(k).toLowerCase() === 'accept');
            accept = found ? found[1] : '';
          } else {
            for (const k of Object.keys(init.headers)) {
              if (k.toLowerCase() === 'accept') accept = init.headers[k];
            }
          }
        } else if (input instanceof Request) {
          accept = input.headers.get('accept') || '';
        }
        if (accept.includes('text/event-stream') || u.pathname === '/event' || u.pathname.endsWith('/event')) {
          return u.pathname + u.search;
        }
      } catch {}
      return null;
    };

    const openWsStream = (targetPath, signal) => new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(proto + '//' + location.host + '/__oc_sse_ws?path=' + encodeURIComponent(targetPath));
      ws.binaryType = 'arraybuffer';
      let settled = false;
      let controllerRef = null;
      const stream = new ReadableStream({
        start(controller) { controllerRef = controller; },
        cancel() { try { ws.close(); } catch {} }
      });
      if (signal) {
        if (signal.aborted) { try { ws.close(); } catch {} return reject(new DOMException('Aborted', 'AbortError')); }
        signal.addEventListener('abort', () => {
          try { ws.close(); } catch {}
          try { controllerRef && controllerRef.close(); } catch {}
        }, { once: true });
      }
      ws.onmessage = (ev) => {
        if (!settled) {
          settled = true;
          resolve(new Response(stream, {
            status: 200,
            headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }
          }));
        }
        try {
          const bytes = typeof ev.data === 'string' ? new TextEncoder().encode(ev.data) : new Uint8Array(ev.data);
          controllerRef.enqueue(bytes);
        } catch {}
      };
      ws.onerror = () => {
        if (!settled) { settled = true; reject(new TypeError('SSE WebSocket failed')); }
        else { try { controllerRef && controllerRef.close(); } catch {} }
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          resolve(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
        }
        try { controllerRef && controllerRef.close(); } catch {}
      };
    });

    window.fetch = function(input, init) {
      const method = (init && init.method) || (input instanceof Request ? input.method : 'GET');
      const ssePath = isSseReq(input, init);
      if (ssePath && String(method).toUpperCase() === 'GET') {
        return openWsStream(ssePath, (init && init.signal) || (input instanceof Request ? input.signal : undefined));
      }
      return origFetch(input, init);
    };
  }

  // 3. Jika di v2 belum ada chat tersimpan sama sekali di halaman awal, buka otomatis kolom chat baru!
  if (OC_MODE !== 'v1' && !OC_HAS_SESSIONS) {
    let tries = 0;
    let autoClicked = false;
    const autoTimer = setInterval(() => {
      tries++;
      if (autoClicked || tries > 25 || location.pathname !== '/') {
        clearInterval(autoTimer);
        return;
      }
      const newBtn = document.querySelector('[data-action="home-new-session"]');
      if (newBtn && document.body && document.body.innerText.includes('Nothing here yet')) {
        autoClicked = true;
        clearInterval(autoTimer);
        newBtn.click();
      }
    }, 300);
  }

  // 4. Tombol ⚡ Panel Mini di Atas Tengah + Bisa Digeser Bebas (Drag) & Diperkecil (Minimize)
  //    100% TIDAK PERNAH menghalangi tombol kirim chat, pilih model, atau menu OpenCode!
  const mountFab = () => {
    if (document.getElementById('__oc_cloud_fab') || !document.body) return;
    const wrap = document.createElement('div');
    wrap.id = '__oc_cloud_fab';
    let savedPos = null;
    try { savedPos = JSON.parse(localStorage.getItem('__oc_fab_pos') || 'null'); } catch {}
    let minimized = localStorage.getItem('__oc_fab_min') === '1';

    Object.assign(wrap.style, {
      position: 'fixed',
      top: savedPos && typeof savedPos.top === 'number' ? savedPos.top + 'px' : '88px',
      left: savedPos && typeof savedPos.left === 'number' ? savedPos.left + 'px' : 'auto',
      right: savedPos && typeof savedPos.left === 'number' ? 'auto' : '8px',
      transform: 'none',
      zIndex: '2147483647',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      borderRadius: '999px',
      background: 'rgba(22, 25, 34, 0.88)',
      color: '#60a5fa',
      border: '1px solid rgba(71, 85, 105, 0.85)',
      fontSize: '11px',
      fontWeight: '600',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 3px 12px rgba(0,0,0,0.28)',
      backdropFilter: 'blur(8px)',
      userSelect: 'none',
      touchAction: 'none',
    });

    const link = document.createElement('a');
    link.href = '/__panel';
    link.target = '_blank';
    link.title = 'Buka Cloud Control Panel (geser untuk pindah posisi)';
    Object.assign(link.style, {
      color: '#60a5fa',
      textDecoration: 'none',
      padding: '3px 8px 3px 9px',
      lineHeight: '1.2',
      whiteSpace: 'nowrap',
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.title = 'Kecilkan / Perbesar tombol panel';
    Object.assign(toggleBtn.style, {
      border: '0',
      background: 'transparent',
      color: '#94a3b8',
      fontSize: '11px',
      lineHeight: '1',
      padding: '3px 7px 3px 2px',
      cursor: 'pointer',
    });

    const renderState = () => {
      if (minimized) {
        link.textContent = '⚡';
        link.style.padding = '3px 7px';
        toggleBtn.style.display = 'none';
        wrap.style.opacity = '0.55';
      } else {
        link.textContent = '⚡ Panel';
        link.style.padding = '3px 4px 3px 9px';
        toggleBtn.textContent = '–';
        toggleBtn.style.display = 'inline-block';
        wrap.style.opacity = '0.92';
      }
    };
    renderState();

    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    wrap.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      const rect = wrap.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      wrap.setPointerCapture(e.pointerId);
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
      if (!moved) return;
      const nextLeft = Math.max(4, Math.min(window.innerWidth - wrap.offsetWidth - 4, origLeft + dx));
      const nextTop = Math.max(4, Math.min(window.innerHeight - wrap.offsetHeight - 4, origTop + dy));
      wrap.style.transform = 'none';
      wrap.style.left = nextLeft + 'px';
      wrap.style.top = nextTop + 'px';
    });

    const finishDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try { wrap.releasePointerCapture(e.pointerId); } catch {}
      if (moved) {
        const rect = wrap.getBoundingClientRect();
        try {
          localStorage.setItem('__oc_fab_pos', JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
        } catch {}
      }
    };
    wrap.addEventListener('pointerup', finishDrag);
    wrap.addEventListener('pointercancel', finishDrag);

    link.addEventListener('click', (e) => {
      if (moved) {
        e.preventDefault();
        moved = false;
        return;
      }
      if (minimized) {
        e.preventDefault();
        minimized = false;
        localStorage.setItem('__oc_fab_min', '0');
        renderState();
      }
    });

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (moved) { moved = false; return; }
      minimized = true;
      localStorage.setItem('__oc_fab_min', '1');
      renderState();
    });

    wrap.appendChild(link);
    wrap.appendChild(toggleBtn);
    document.body.appendChild(wrap);
  };
  document.addEventListener('DOMContentLoaded', mountFab);
  mountFab();
})();`;
};

let cachedOcVersion = "";
try {
  cachedOcVersion = execFileSync(path.join(HOME_DIR, ".local/bin/opencode"), ["--version"], { encoding: "utf8" }).trim();
} catch {}

function sendWsBinary(socket, buf) {
  if (socket.destroyed) return;
  const len = buf.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x82, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x82;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, buf]));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const targetPort = getUpstreamPort();

  if (url.pathname === "/__oc_health") {
    return sendJson(res, 200, { ok: true, version: cachedOcVersion });
  }

  if (url.pathname === "/__oc_login" && req.method === "POST") {
    const body = await readBody(req);
    const pw = (new URLSearchParams(body).get("password") || "").trim();
    if (pw === PASSWORD) {
      const isHttps = req.headers["x-forwarded-proto"] === "https";
      const svc = getUpstreamService();
      res.writeHead(302, {
        "Set-Cookie": [
          `oc_auth=${TOKEN}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax${isHttps ? "; Secure" : ""}`,
          `oc_svc_id=${svc.id}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`,
        ],
        "Location": getV2PairPath(),
      });
      return res.end();
    }
    res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
    return res.end(LOGIN_HTML(true));
  }

  if (!isAuthed(req)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(LOGIN_HTML(false));
  }

  if (url.pathname === "/__oc_pair") {
    const svc = getUpstreamService();
    res.writeHead(302, {
      "Set-Cookie": `oc_svc_id=${svc.id}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`,
      "Location": getV2PairPath(),
      "cache-control": "no-store",
    });
    return res.end();
  }

  if (url.pathname === "/__oc_widget.js") {
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
    return res.end(buildWidgetJs());
  }

  if (url.pathname === "/__panel") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(PANEL_HTML);
  }

  // Endpoint penyimpanan & penghapusan Custom OpenAI-Compatible Provider (aktif langsung & auto-reload!)
  if (url.pathname === "/__api/cp-models" && req.method === "POST") {
    try {
      const d = JSON.parse((await readBody(req)) || "{}");
      const base = String(d.baseURL || "").trim().replace(/\/+$/, "");
      const key = String(d.key || "").trim();
      if (!base) return sendJson(res, 400, { error: "Isi Base URL dulu." });
      const hdrs = { accept: "application/json" };
      if (key) hdrs.authorization = "Bearer " + key;
      const r = await fetch(base + "/models", { headers: hdrs, signal: AbortSignal.timeout(15000) });
      const txt = await r.text();
      if (!r.ok) return sendJson(res, 200, { error: "HTTP " + r.status + ": " + txt.slice(0, 160) });
      const j = JSON.parse(txt || "{}");
      const list = Array.isArray(j.data) ? j.data.map((m) => m && (m.id || m.name)).filter(Boolean) : [];
      return sendJson(res, 200, { models: [...new Set(list)].sort() });
    } catch (e) {
      return sendJson(res, 500, { error: "Gagal: " + e.message });
    }
  }

  if (url.pathname === "/__api/cp-test" && req.method === "POST") {
    try {
      const d = JSON.parse((await readBody(req)) || "{}");
      const base = String(d.baseURL || "").trim().replace(/\/+$/, "");
      const key = String(d.key || "").trim();
      const mid = String(d.mid || "").trim();
      if (!base || !mid) return sendJson(res, 400, { error: "Isi Base URL dan Model ID dulu." });
      const hdrs = { "content-type": "application/json" };
      if (key) hdrs.authorization = "Bearer " + key;
      const simTools = [{ type: "function", function: { name: "check_status", description: "Cek status sistem", parameters: { type: "object", properties: {}, additionalProperties: false } } }];
      const call = async (extra) => {
        const r = await fetch(base + "/chat/completions", {
          method: "POST",
          headers: hdrs,
          body: JSON.stringify({ model: mid, messages: [{ role: "user", content: "Jawab singkat: OK" }], max_tokens: 16, ...extra }),
          signal: AbortSignal.timeout(25000),
        });
        return { status: r.status, text: await r.text() };
      };
      const t0 = Date.now();
      const rA = await call({});
      if (rA.status >= 300) {
        return sendJson(res, 200, { error: "❌ Tes Dasar GAGAL (HTTP " + rA.status + ", " + (Date.now() - t0) + " ms): " + rA.text.slice(0, 160) });
      }
      const ms = Date.now() - t0;
      const rB = await call({ reasoning_effort: "medium", tools: simTools });
      if (rB.status < 300) {
        return sendJson(res, 200, { message: "⚡ Koneksi SEMPURNA (" + ms + " ms)! Key, model, tools & reasoning 'medium' semuanya diterima — siap dipakai OpenCode tanpa error." });
      }
      const rC = await call({ tools: simTools });
      if (rC.status < 300) {
        const rB2 = await call({ reasoning_effort: "high", tools: simTools });
        const highOk = rB2.status < 300;
        return sendJson(res, 200, {
          message: "⚠️ Masalah ketemu! Key & model valid (" + ms + " ms), TAPI provider menolak reasoning 'medium' (HTTP " + rB.status + ") — penyebab error 400 'Invalid inference request'. " + (highOk ? "Provider MENERIMA 'high' → klik 🛡️ Terapkan Perbaikan Otomatis di bawah." : "Provider juga menolak 'high' → pastikan Reasoning: Default (tanpa parameter) lalu klik Simpan ulang."),
          fixReasoning: true,
          reasoningHighWorks: highOk,
        });
      }
      return sendJson(res, 200, { error: "❌ Model ini tampaknya TIDAK mendukung tools/function-calling (HTTP " + rC.status + "): " + rC.text.slice(0, 140) + " — OpenCode butuh model yang support tools. Pilih model lain lewat 🔍 Ambil Daftar Model." });
    } catch (e) {
      return sendJson(res, 500, { error: "❌ Gagal konek: " + e.message });
    }
  }

  if (url.pathname === "/__api/custom-provider") {
    if (req.method === "POST") {
      try {
        const data = JSON.parse((await readBody(req)) || "{}");
        const providerID = String(data.providerID || "").trim();
        if (!providerID || !data.config) {
          return sendJson(res, 400, { error: "Data penyedia kustom tidak lengkap." });
        }
        const cfg = readGlobalConfig();
        cfg.provider = cfg.provider || {};
        const options = { ...(data.config.options || {}) };
        if (data.key) options.apiKey = String(data.key).trim();
        cfg.provider[providerID] = {
          ...data.config,
          options,
        };
        writeGlobalConfig(cfg);
        reloadOpenCodeEngine();
        return sendJson(res, 200, { ok: true, providerID, name: data.name || providerID });
      } catch (e) {
        return sendJson(res, 500, { error: e.message });
      }
    }
    if (req.method === "DELETE") {
      try {
        const id = String(url.searchParams.get("id") || "").trim();
        const cfg = readGlobalConfig();
        if (cfg.provider && cfg.provider[id]) {
          delete cfg.provider[id];
          writeGlobalConfig(cfg);
          reloadOpenCodeEngine();
        }
        return sendJson(res, 200, { ok: true });
      } catch (e) {
        return sendJson(res, 500, { error: e.message });
      }
    }
  }

  if (url.pathname === "/__api/status") {
    const elapsedMin = Math.floor((Date.now() - START_TIME) / 60000);
    const remainingMin = Math.max(0, DURATION_MIN - elapsedMin);
    const totalMemGB = (os.totalmem() / 1073741824).toFixed(1);
    const usedMemGB = ((os.totalmem() - os.freemem()) / 1073741824).toFixed(1);
    let freeDisk = "-";
    try {
      freeDisk = execSync("df -h / | awk 'NR==2{print $4}'", { encoding: "utf8" }).trim();
    } catch {}
    let pagesUrl = "";
    try { pagesUrl = fs.readFileSync("/tmp/pages_url.txt", "utf8").trim(); } catch {}
    const tunnels = [];
    for (const [port, info] of previewTunnels.entries()) {
      if (info.url && info.proc && info.proc.exitCode === null) tunnels.push({ port, url: info.url });
    }
    const cfg = readGlobalConfig();
    const customProviders = Object.entries(cfg.provider || {}).map(([id, val]) => ({
      id,
      name: (val && val.name) || id,
      models: Object.entries((val && val.models) || {}).map(([mid, mm]) => ({
        id: mid,
        effort: (mm && mm.options && mm.options.reasoningEffort) || "",
      })),
    }));
    const pMeta = getPersistenceMeta();
    return sendJson(res, 200, {
      ocVersion: cachedOcVersion,
      remainingMin,
      totalMemGB,
      usedMemGB,
      freeDisk,
      pagesUrl,
      projectCount: pMeta.worktrees.length || 1,
      sessionCount: pMeta.sessionCount || 0,
      customProviders,
      activePorts: detectActivePorts(),
      tunnels,
      artifacts: scanArtifacts(WORKSPACE),
    });
  }

  if (url.pathname === "/__api/preview" && req.method === "POST") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      const pUrl = await startPortPreviewTunnel(body.port);
      return sendJson(res, 200, { url: pUrl });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (url.pathname === "/__api/save" && req.method === "POST") {
    try {
      execFileSync(path.join(HOME_DIR, ".local/bin/oc-save"), ["chore: manual save dari Cloud Panel"], {
        env: { ...process.env, FINAL_PW: PASSWORD, WORKSPACE_DIR: WORKSPACE },
        timeout: 45000,
      });
      return sendJson(res, 200, { message: "✅ Berhasil! Semua kode & riwayat chat sudah tersimpan ke GitHub." });
    } catch (e) {
      return sendJson(res, 500, { message: "❌ Gagal save: " + e.message });
    }
  }

  if (url.pathname === "/__api/restart" && req.method === "POST") {
    try {
      if (OC_VER === "v1") {
        execSync('pkill -TERM -f "opencode web" || true');
      } else {
        const ocBin = path.join(HOME_DIR, ".local/bin/opencode");
        execFileSync(ocBin, ["service", "stop"], { env: { ...process.env, HOME: HOME_DIR }, timeout: 10000 });
        execFileSync(ocBin, ["service", "start"], { cwd: WORKSPACE, env: { ...process.env, HOME: HOME_DIR }, timeout: 10000 });
      }
      return sendJson(res, 200, { message: "✅ Mesin OpenCode di-restart! Klik tombol 'Hubungkan Ulang Sesi Web' di sebelah kanan untuk masuk kembali." });
    } catch (e) {
      return sendJson(res, 500, { message: "❌ Gagal restart: " + e.message });
    }
  }

  if (url.pathname === "/__api/zip") {
    const zipFile = `/tmp/project-${Date.now()}.zip`;
    try {
      execFileSync("zip", ["-rq", zipFile, ".", "-x", ".git/*", "node_modules/*", ".gradle/*", ".opencode-backup.enc"], {
        cwd: WORKSPACE,
        timeout: 60000,
      });
      const st = fs.statSync(zipFile);
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-length": st.size,
        "content-disposition": 'attachment; filename="opencode-project.zip"',
      });
      const stream = fs.createReadStream(zipFile);
      stream.pipe(res);
      stream.on("close", () => fs.unlink(zipFile, () => {}));
      return;
    } catch (e) {
      return sendJson(res, 500, { error: "Gagal membuat ZIP: " + e.message });
    }
  }

  if (url.pathname === "/__api/download") {
    const rel = url.searchParams.get("path") || "";
    const target = path.resolve(WORKSPACE, rel);
    if (!target.startsWith(path.resolve(WORKSPACE) + path.sep) || !fs.existsSync(target)) {
      return sendJson(res, 404, { error: "File tidak ditemukan" });
    }
    const st = fs.statSync(target);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": st.size,
      "content-disposition": `attachment; filename="${path.basename(target)}"`,
    });
    return fs.createReadStream(target).pipe(res);
  }

  const prevMatch = url.pathname.match(/^\/preview\/(\d+)(\/.*)?$/);
  if (prevMatch) {
    const appPort = Number(prevMatch[1]);
    const subPath = (prevMatch[2] || "/") + url.search;
    const pReq = http.request(
      {
        hostname: "127.0.0.1",
        port: appPort,
        path: subPath,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${appPort}` },
      },
      (pRes) => {
        res.writeHead(pRes.statusCode || 200, pRes.headers);
        pRes.pipe(res);
      }
    );
    pReq.on("error", () => {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Belum ada web server aktif di port ${appPort}. Suruh OpenCode menyalakan server di port ${appPort} terlebih dahulu.`);
    });
    return req.pipe(pReq);
  }

  // Patch otomatis bundle JS OpenCode v2 agar fitur Custom OpenAI-Compatible Provider & Disconnect berfungsi penuh!
  if (
    OC_VER !== "v1" &&
    req.method === "GET" &&
    (url.pathname.startsWith("/_assets/") || url.pathname.startsWith("/assets/")) &&
    url.pathname.endsWith(".js")
  ) {
    const jsHeaders = {
      ...req.headers,
      host: `127.0.0.1:${targetPort}`,
      origin: `http://127.0.0.1:${targetPort}`,
    };
    delete jsHeaders["accept-encoding"];
    delete jsHeaders["if-none-match"];
    const jsReq = http.request(
      { hostname: "127.0.0.1", port: targetPort, path: req.url, method: "GET", headers: jsHeaders },
      (jsRes) => {
        const chunks = [];
        jsRes.on("data", (c) => chunks.push(c));
        jsRes.on("end", () => {
          let code = Buffer.concat(chunks).toString("utf8");
          let patched = false;
          if (code.includes("provider.custom.unavailable")) {
            const next = code.replace(
              /throw\s+(?:new\s+)?Error\(([A-Za-z0-9_$]+)\.t\([`"']provider\.custom\.unavailable[`"']\)\)/g,
              'return await fetch("/__api/custom-provider",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(e)}).then(async _r=>{const _d=await _r.json();if(!_r.ok)throw Error(_d.error||"Gagal menyimpan penyedia kustom");setTimeout(()=>location.reload(),500);return e})'
            );
            if (next !== code) {
              code = next;
              patched = true;
            }
          }
          if (code.includes("provider.disconnect.toast.noCredentials.description")) {
            const next = code.replace(
              /if\(([A-Za-z0-9_$]+)\.length===0\)\{([A-Za-z0-9_$]+)\(\{title:([A-Za-z0-9_$]+)\.t\([`"']common\.requestFailed[`"']\),description:\3\.t\([`"']provider\.disconnect\.toast\.noCredentials\.description[`"'],\{provider:([A-Za-z0-9_$]+)\}\)\}\);return\}/g,
              'if($1.length===0){await fetch("/__api/custom-provider?id="+encodeURIComponent(o[0]),{method:"DELETE"});$2({variant:"success",icon:"circle-check",title:$3.t("provider.disconnect.toast.disconnected.title",{provider:$4}),description:$3.t("provider.disconnect.toast.disconnected.description",{provider:$4})});setTimeout(()=>location.reload(),500);return}'
            );
            if (next !== code) {
              code = next;
              patched = true;
            }
          }
          const outHeaders = { ...jsRes.headers };
          delete outHeaders["access-control-allow-origin"];
          if (patched) {
            delete outHeaders["content-length"];
            delete outHeaders["etag"];
            outHeaders["cache-control"] = "no-store";
          }
          res.writeHead(jsRes.statusCode || 200, outHeaders);
          res.end(code);
        });
      }
    );
    jsReq.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    return jsReq.end();
  }

  // Semua navigasi halaman HTML (/, /new-session, /session/..., F5 reload) -> auto-pair + injeksi <head> widget & SSE WS bridge!
  const acceptHdr = String(req.headers.accept || "");
  const isHtmlNav =
    req.method === "GET" &&
    acceptHdr.includes("text/html") &&
    !url.pathname.startsWith("/auth/") &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/_assets/") &&
    !url.pathname.startsWith("/assets/");

  if (isHtmlNav) {
    const cookies = parseCookies(req.headers.cookie || "");
    const svc = getUpstreamService();
    if (OC_VER !== "v1" && (!cookies[`opencode_session_${targetPort}`] || cookies.oc_svc_id !== svc.id)) {
      const pairPath = getV2PairPath();
      if (pairPath !== "/") {
        res.writeHead(302, {
          "Set-Cookie": `oc_svc_id=${svc.id}; Path=/; HttpOnly; Max-Age=2592000; SameSite=Lax`,
          "Location": pairPath,
          "cache-control": "no-store",
        });
        return res.end();
      }
    }

    // Jika tab HP/browser di-reload saat masih di draft kosong (?draftId=...), arahkan balik ke / agar draft segar dibuat otomatis
    if (url.pathname === "/new-session" && url.searchParams.has("draftId")) {
      res.writeHead(302, { "Location": "/", "cache-control": "no-store" });
      return res.end();
    }

    const cleanHeaders = {
      ...req.headers,
      host: `127.0.0.1:${targetPort}`,
      origin: `http://127.0.0.1:${targetPort}`,
    };
    delete cleanHeaders["accept-encoding"];
    const proxyReq = http.request(
      { hostname: "127.0.0.1", port: targetPort, path: req.url, method: "GET", headers: cleanHeaders },
      (proxyRes) => {
        const ct = String(proxyRes.headers["content-type"] || "");
        const outHeaders = { ...proxyRes.headers };
        delete outHeaders["access-control-allow-origin"];
        if (!ct.includes("text/html")) {
          res.writeHead(proxyRes.statusCode || 200, outHeaders);
          return proxyRes.pipe(res);
        }
        const chunks = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("end", () => {
          let html = Buffer.concat(chunks).toString("utf8");
          if (html.includes("<head>")) {
            html = html.replace("<head>", '<head><script src="/__oc_widget.js"></script>');
          } else if (html.includes("</body>")) {
            html = html.replace("</body>", '<script src="/__oc_widget.js"></script></body>');
          }
          delete outHeaders["content-length"];
          res.writeHead(proxyRes.statusCode || 200, outHeaders);
          res.end(html);
        });
      }
    );
    proxyReq.on("error", (err) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("OpenCode sedang menyala: " + err.message);
    });
    return proxyReq.end();
  }

  const upHeaders = {
    ...req.headers,
    host: `127.0.0.1:${targetPort}`,
    origin: `http://127.0.0.1:${targetPort}`,
  };
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: upHeaders,
    },
    (proxyRes) => {
      const outHeaders = { ...proxyRes.headers };
      delete outHeaders["access-control-allow-origin"];
      res.writeHead(proxyRes.statusCode || 200, outHeaders);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("OpenCode sedang menyala: " + err.message);
  });
  req.pipe(proxyReq);
});

server.on("upgrade", (req, socket, head) => {
  if (!isAuthed(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  const targetPort = getUpstreamPort();
  const upUrl = new URL(req.url || "/", "http://localhost");

  // Endpoint WebSocket khusus untuk streaming SSE real-time tanpa buffering Cloudflare Quick Tunnel!
  if (upUrl.pathname === "/__oc_sse_ws") {
    const wsKey = req.headers["sec-websocket-key"];
    const ssePath = upUrl.searchParams.get("path") || "/api/event";
    if (!wsKey || !ssePath.startsWith("/")) {
      socket.destroy();
      return;
    }
    const acceptKey = crypto
      .createHash("sha1")
      .update(wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
    );
    const sseHeaders = {
      cookie: req.headers.cookie || "",
      accept: "text/event-stream",
      host: `127.0.0.1:${targetPort}`,
      origin: `http://127.0.0.1:${targetPort}`,
    };
    const upstreamReq = http.request(
      { hostname: "127.0.0.1", port: targetPort, path: ssePath, method: "GET", headers: sseHeaders },
      (upstreamRes) => {
        sendWsBinary(socket, Buffer.from(": connected\n\n", "utf8"));
        upstreamRes.on("data", (chunk) => sendWsBinary(socket, Buffer.from(chunk)));
        upstreamRes.on("end", () => { try { socket.end(); } catch {} });
        upstreamRes.on("error", () => { try { socket.destroy(); } catch {} });
      }
    );
    upstreamReq.on("error", () => { try { socket.destroy(); } catch {} });
    upstreamReq.end();
    socket.on("data", (frame) => {
      if (frame.length >= 1) {
        const op = frame[0] & 0x0f;
        if (op === 0x08) {
          upstreamReq.destroy();
          try { socket.end(); } catch {}
        } else if (op === 0x09 && !socket.destroyed) {
          socket.write(Buffer.from([0x8a, 0x00]));
        }
      }
    });
    socket.on("close", () => upstreamReq.destroy());
    socket.on("error", () => upstreamReq.destroy());
    return;
  }

  const upstream = net.connect(targetPort, "127.0.0.1", () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      const kl = k.toLowerCase();
      const v =
        kl === "host"
          ? `127.0.0.1:${targetPort}`
          : kl === "origin"
          ? `http://127.0.0.1:${targetPort}`
          : req.rawHeaders[i + 1];
      raw += `${k}: ${v}\r\n`;
    }
    raw += "\r\n";
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(LISTEN_PORT, "127.0.0.1");
