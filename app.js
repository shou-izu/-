'use strict';

// ---------- IndexedDB ----------
const DB_NAME = 'koe-memo';
const STORE = 'memos';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbPromise = openDB();

async function tx(mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

const getAll = () => tx('readonly', (s) => s.getAll());
const putMemo = (memo) => tx('readwrite', (s) => s.put(memo));
const deleteMemo = (id) => tx('readwrite', (s) => s.delete(id));

// ---------- UI refs ----------
const $ = (id) => document.getElementById(id);
const micBtn = $('mic');
const listEl = $('list');
const emptyEl = $('empty');
const searchEl = $('search');
const liveEl = $('live');
const liveFinal = liveEl.querySelector('.final');
const liveInterim = liveEl.querySelector('.interim');
const liveStatus = $('liveStatus');
const keepAudioEl = $('keepAudio');
const noticeEl = $('notice');
const tpl = $('itemTpl');

let memos = [];

// ---------- Rendering ----------
const fmt = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
});

function render() {
  const q = searchEl.value.trim().toLowerCase();
  const shown = memos
    .filter((m) => !q || m.text.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);

  listEl.replaceChildren(...shown.map(renderItem));
  emptyEl.hidden = memos.length > 0;
}

function renderItem(memo) {
  const li = tpl.content.firstElementChild.cloneNode(true);
  const time = li.querySelector('time');
  time.dateTime = new Date(memo.createdAt).toISOString();
  time.textContent = fmt.format(memo.createdAt);

  const text = li.querySelector('.text');
  text.textContent = memo.text;
  text.addEventListener('blur', async () => {
    const next = text.innerText.trim();
    if (next === memo.text) return;
    memo.text = next;
    await putMemo(memo);
  });

  if (memo.audio) {
    li.querySelector('.badge').hidden = false;
    const audio = li.querySelector('audio');
    audio.hidden = false;
    audio.src = URL.createObjectURL(memo.audio);
  }

  li.querySelector('.copy').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(memo.text);
      flash(e.currentTarget, 'コピー済');
    } catch {
      flash(e.currentTarget, '失敗');
    }
  });

  const shareBtn = li.querySelector('.share');
  if (navigator.share) {
    shareBtn.addEventListener('click', () => {
      navigator.share({ text: memo.text }).catch(() => {});
    });
  } else {
    shareBtn.hidden = true;
  }

  li.querySelector('.del').addEventListener('click', async () => {
    if (!confirm('このメモを削除しますか？')) return;
    await deleteMemo(memo.id);
    memos = memos.filter((m) => m.id !== memo.id);
    render();
  });

  return li;
}

function flash(btn, label) {
  const orig = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

function showNotice(msg) {
  noticeEl.textContent = msg;
  noticeEl.hidden = false;
}

async function addMemo(text, audio = null) {
  const memo = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    text,
    createdAt: Date.now(),
    audio,
  };
  await putMemo(memo);
  memos.push(memo);
  render();
}

// ---------- Recording ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
  showNotice('このブラウザは音声の文字起こしに対応していません。音声のみ保存されます（Chrome / Safari 推奨）。');
  keepAudioEl.checked = true;
  keepAudioEl.disabled = true;
}

try {
  if (localStorage.getItem('keepAudio') === '1') keepAudioEl.checked = true;
} catch { /* storage unavailable */ }
keepAudioEl.addEventListener('change', () => {
  try { localStorage.setItem('keepAudio', keepAudioEl.checked ? '1' : '0'); } catch { /* ignore */ }
});

let recording = false;
let recognition = null;
let finalText = '';
let mediaRecorder = null;
let chunks = [];
let stream = null;

async function start() {
  if (recording) return;
  recording = true;
  finalText = '';
  chunks = [];
  liveFinal.textContent = '';
  liveInterim.textContent = '';
  liveStatus.textContent = '聞き取り中… もう一度押すと保存';
  liveEl.hidden = false;
  micBtn.classList.add('recording');
  micBtn.setAttribute('aria-pressed', 'true');
  micBtn.setAttribute('aria-label', '録音停止して保存');

  if (keepAudioEl.checked && window.MediaRecorder) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mediaRecorder.start();
    } catch (err) {
      showNotice('マイクを使用できません: ' + err.message);
      mediaRecorder = null;
    }
  }

  if (SR) startRecognition();
}

function startRecognition() {
  recognition = new SR();
  recognition.lang = 'ja-JP';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    liveFinal.textContent = finalText;
    liveInterim.textContent = interim;
    liveEl.querySelector('.live-text').scrollTop = 1e9;
  };

  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      showNotice('マイクの使用が許可されていません。ブラウザの設定で許可してください。');
      recording = false;
    }
  };

  // Mobile browsers end recognition after a pause; keep listening until the user stops.
  recognition.onend = () => {
    if (recording) {
      try { recognition.start(); } catch { /* already started */ }
    } else {
      finish();
    }
  };

  try {
    recognition.start();
  } catch (err) {
    showNotice('音声認識を開始できません: ' + err.message);
  }
}

function stop() {
  if (!recording) return;
  recording = false;
  liveStatus.textContent = '保存中…';
  if (recognition) {
    recognition.stop(); // finish() runs from onend
  } else {
    finish();
  }
}

let finishing = false;
async function finish() {
  if (finishing) return;
  finishing = true;

  const audio = await stopMediaRecorder();
  const text = (finalText + liveInterim.textContent).trim();

  if (text || audio) {
    await addMemo(text || '（音声メモ）', audio);
  }

  recognition = null;
  liveEl.hidden = true;
  micBtn.classList.remove('recording');
  micBtn.setAttribute('aria-pressed', 'false');
  micBtn.setAttribute('aria-label', '録音開始');
  finishing = false;
}

function stopMediaRecorder() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      cleanupStream();
      return resolve(null);
    }
    mediaRecorder.onstop = () => {
      const blob = chunks.length ? new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' }) : null;
      cleanupStream();
      resolve(blob);
    };
    mediaRecorder.stop();
  });
}

function cleanupStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  mediaRecorder = null;
}

micBtn.addEventListener('click', () => (recording ? stop() : start()));

// Space bar toggles recording on desktop (when not typing).
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  e.preventDefault();
  recording ? stop() : start();
});

$('addText').addEventListener('click', async () => {
  const text = prompt('メモを入力');
  if (text && text.trim()) await addMemo(text.trim());
});

searchEl.addEventListener('input', render);

// ---------- Init ----------
getAll().then((all) => {
  memos = all;
  render();
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
