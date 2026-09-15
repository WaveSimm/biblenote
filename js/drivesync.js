// 구글 드라이브 동기화 — 설정 시트 (설교노트 설계 §12)
//
// 서버가 없다. 브라우저가 구글 로그인으로 1시간짜리 토큰을 받아 Drive API 를 직접 부르고,
// 사용자 본인의 드라이브에 `biblenote-notes.json` 하나를 두고 통째로 주고받는다.
// 권한은 drive.file — 이 앱이 만든 파일만 보인다. 드라이브의 다른 파일은 모른다.
//
// 합치는 규칙은 notes.js merge() 하나다 (나중에 바뀐 쪽이 이긴다, 지운 노트는 흔적으로).
//
// 토큰은 사용자가 단추를 누를 때만 새로 받는다. 구글 창은 팝업이라 사용자 동작 밖에서
// 띄우면 막힌다. 토큰이 살아 있는 동안(1시간)은 저장·앱 열기·앱 내리기에 맞춰 알아서 맞춘다.

import * as Notes from "./notes.js";

const CLIENT_ID = "406827665238-jnupodbmjsnkbskp27gj0rvhuhebacqh.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FILE = "biblenote-notes.json";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const GIS = "https://accounts.google.com/gsi/client";

const S_KEY = "biblenote.drive.v1";        // { on, email, fileId, last, dirty, backedUp }
const T_KEY = "biblenote.drive.token.v1";  // { token, exp } — 1시간짜리, 기기마다
const BACKUP_KEY = "biblenote.notes.backup.v1";

const $ = (id) => document.getElementById(id);
let hooks = {};            // { editingId, onChanged, toast }
let state = read(S_KEY) || {};
let running = null;        // 돌고 있는 sync() — 겹쳐 돌지 않게
let again = false;         // 도는 중에 또 바뀌면 끝나고 한 번 더
let saveTimer = null;
let lastError = "";

function read(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 사생활 모드 */ } }
const saveState = () => write(S_KEY, state);

/* ---------- 토큰 ---------- */

function cachedToken() {
  const t = read(T_KEY);
  return t && t.exp - 60_000 > Date.now() ? t.token : null;
}

let gisLoading = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) gisLoading = new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = GIS; s.async = true;
    s.onload = ok;
    s.onerror = () => { gisLoading = null; no(new Error("구글 로그인 스크립트를 받지 못했습니다")); };
    document.head.append(s);
  });
  return gisLoading;
}

/** 사용자가 누른 단추 안에서만 부른다 — 구글 창이 뜬다(이미 허락했으면 바로 닫힌다) */
function askToken() {
  return new Promise((ok, no) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (res) => {
        if (res.error) return no(new Error(res.error_description || res.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(res, SCOPE))
          return no(new Error("드라이브 권한을 허락해야 동기화할 수 있습니다"));
        write(T_KEY, { token: res.access_token, exp: Date.now() + res.expires_in * 1000 });
        ok(res.access_token);
      },
      error_callback: (err) => no(new Error(err.type === "popup_closed" ? "구글 창을 닫았습니다" : (err.message || err.type))),
    });
    client.requestAccessToken({ prompt: state.on ? "" : "consent", login_hint: state.email || undefined });
  });
}

/* ---------- Drive API ---------- */

class AuthError extends Error {}

async function api(url, init = {}) {
  const token = cachedToken();
  if (!token) throw new AuthError("연결이 만료됐습니다");
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401 || (res.status === 403 && /auth|scope|permission/i.test(await res.clone().text()))) {
    localStorage.removeItem(T_KEY);
    throw new AuthError("연결이 만료됐습니다");
  }
  if (!res.ok) throw new Error(`드라이브 응답 ${res.status}`);
  return res;
}

const q = (s) => encodeURIComponent(s);

async function listFiles() {
  const query = `name='${FILE}' and trashed=false`;
  const res = await api(`${API}/files?q=${q(query)}&spaces=drive&orderBy=createdTime&fields=files(id,version)`);
  return (await res.json()).files || [];
}

async function version(id) {
  return (await (await api(`${API}/files/${id}?fields=version`)).json()).version;
}

async function download(id) {
  const data = await (await api(`${API}/files/${id}?alt=media`)).json();
  // 앱에서 내보낸 옛 파일(노트 배열)을 드라이브에 직접 올려 둔 경우도 받아 준다
  return Array.isArray(data) ? { notes: data, gone: {} } : { notes: data.notes || [], gone: data.gone || {} };
}

const body = () => JSON.stringify(Notes.snapshot());

async function create() {
  const boundary = "biblenote" + Date.now();
  const meta = { name: FILE, mimeType: "application/json" };
  const payload =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body()}\r\n--${boundary}--`;
  const res = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: payload,
  });
  return (await res.json()).id;
}

async function upload(id) {
  await api(`${UPLOAD}/files/${id}?uploadType=media`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body(),
  });
}

async function trash(id) {
  await api(`${API}/files/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

async function whoami() {
  try {
    const res = await api(`${API}/about?fields=user(emailAddress)`);
    return (await res.json()).user?.emailAddress || "";
  } catch (e) {
    if (e instanceof AuthError) throw e;
    return "";                                     // 계정 표시는 없어도 된다
  }
}

/* ---------- 동기화 ---------- */

/** 드라이브와 한 번 맞춘다. 토큰이 없으면 아무것도 하지 않는다 (앱은 로컬로 그대로 동작). */
export function sync() {
  if (!state.on || !cachedToken()) { paint(); return Promise.resolve(false); }
  if (running) { again = true; return running; }
  running = (async () => {
    paint("동기화 중…");
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
      lastError = "";
      return true;
    } catch (e) {
      lastError = e instanceof AuthError ? "" : (e.message || String(e));
      if (!(e instanceof AuthError)) console.error("드라이브 동기화 실패", e);
      return false;
    } finally {
      running = null;
      paint();
    }
  })();
  return running;
}

async function syncOnce() {
  // 첫 동기화 전에 이 기기의 노트를 한 번 떠 둔다 — 합치기가 잘못돼도 되돌릴 수 있게
  if (!state.backedUp) {
    try { localStorage.setItem(BACKUP_KEY, Notes.exportNotes()); } catch { /* 공간 부족 — 그래도 진행 */ }
    state.backedUp = Date.now();
    saveState();
  }

  for (let attempt = 0; ; attempt++) {
    if (attempt === 3) throw new Error("다른 기기와 동시에 올리는 중입니다 — 잠시 뒤 다시");
    const files = await listFiles();
    if (!files.length) {
      state.fileId = await create();
      break;
    }
    // 두 기기가 처음에 동시에 연결하면 파일이 둘 생길 수 있다 — 전부 합치고 하나만 남긴다
    const [main, ...extra] = files;
    const before = main.version;
    let changed = false, behind = extra.length > 0;
    for (const f of [main, ...extra]) {
      const r = Notes.merge(await download(f.id), { skip: hooks.editingId?.(), quiet: true });
      changed ||= !!(r.added || r.updated || r.removed);
      behind ||= r.behind;
    }
    if (changed && hooks.onChanged) hooks.onChanged();
    if (behind) {
      if ((await version(main.id)) !== before) continue;   // 그 사이 다른 기기가 올렸다 — 다시 받는다
      await upload(main.id);
      for (const f of extra) await trash(f.id);
    }
    state.fileId = main.id;
    break;
  }
  state.last = Date.now();
  state.dirty = false;
  saveState();
}

/* ---------- 연결·해제 ---------- */

async function connect() {
  try {
    paint("구글 연결 중…");
    await loadGis();
    await askToken();
    state.on = true;
    state.email = (await whoami()) || state.email || "";
    saveState();
    const n = Notes.all().length;
    const ok = await sync();
    if (ok && hooks.toast) hooks.toast(n ? `이 기기의 노트 ${n}개를 드라이브와 맞췄습니다` : "드라이브의 노트를 받았습니다", 3000);
  } catch (e) {
    lastError = e.message || String(e);
    paint();
  }
}

function disconnect() {
  const token = cachedToken();
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  localStorage.removeItem(T_KEY);
  state = {};
  saveState();
  lastError = "";
  paint();
  if (hooks.toast) hooks.toast("연결을 해제했습니다. 이 기기의 노트와 드라이브 파일은 그대로 남습니다", 3500);
}

/* ---------- 화면 ---------- */

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

function paint(busy = "") {
  const stat = $("driveStat"), btn = $("driveBtn"), off = $("driveOff");
  if (!stat) return;
  off.hidden = !state.on;
  btn.disabled = !!busy;
  stat.className = lastError ? "io-bad" : "";
  if (busy) { stat.textContent = busy; return; }
  if (!state.on) {
    btn.textContent = "구글 드라이브 연결";
    stat.textContent = lastError || "연결하면 폰·PC에서 같은 노트를 봅니다";
    return;
  }
  const who = state.email ? `${state.email} · ` : "";
  if (lastError) {
    btn.textContent = "다시 시도";
    stat.textContent = `${who}동기화 실패 — ${lastError}`;
  } else if (!cachedToken()) {
    btn.textContent = "동기화";
    stat.textContent = `${who}${state.dirty ? "올릴 변경이 있습니다 — " : ""}누르면 동기화합니다`;
  } else {
    btn.textContent = "지금 동기화";
    stat.textContent = `${who}${state.last ? ago(state.last) + " 동기화" : "연결됨"}${state.dirty ? " · 올릴 변경 있음" : ""}`;
  }
}

/** 설정 시트를 열 때 — 상태를 새로 그리고, 단추를 누르기 전에 구글 스크립트를 미리 받아 둔다
 *  (누른 뒤에 받으면 그 사이 '사용자 동작'이 식어 구글 창이 막힐 수 있다) */
export function paintDrive() {
  paint(running ? "동기화 중…" : "");
  if (navigator.onLine) loadGis().catch(() => {});
}

export function initDriveSync(h) {
  hooks = h || {};
  $("driveBtn").onclick = async () => {
    if (!state.on) return connect();
    if (!cachedToken()) {
      try { await loadGis(); await askToken(); } catch (e) { lastError = e.message || String(e); paint(); return; }
    }
    lastError = "";
    sync();
  };
  $("driveOff").onclick = disconnect;

  // 노트를 저장·삭제하면 잠시 모았다가 올린다 (글자마다 올리지 않게)
  Notes.onLocalChange(() => {
    if (!state.on) return;
    state.dirty = true;
    saveState();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => sync(), 4000);
  });

  // 앱으로 돌아오면 받고, 앱을 내리면 남은 변경을 올린다
  document.addEventListener("visibilitychange", () => {
    if (!state.on || !cachedToken()) return;
    if (document.visibilityState === "hidden") { if (state.dirty) { clearTimeout(saveTimer); sync(); } }
    else if (!state.last || Date.now() - state.last > 60_000) sync();
  });
  addEventListener("online", () => { if (state.on && state.dirty) sync(); });

  paint();
  if (state.on && cachedToken()) sync();
  return { needsTap: !!(state.on && state.dirty && !cachedToken()) };
}
