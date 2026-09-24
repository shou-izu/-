// 現場カレンダー 画面の動き
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var POLL_MS = 15000;

  // ---------- 保存(端末内) ----------
  function load(key, def) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 容量不足などは無視 */ }
  }

  var server = load('genba-cache', { version: 0, members: [], events: [] });
  var outbox = load('genba-outbox', []); // 電波がない時の送信待ち
  var me = load('genba-me', '');
  var ui = { tab: 'cal', selDate: GenbaParse.ymd(new Date()), month: startOfMonth(new Date()), filter: load('genba-filter', null) };
  var online = true;
  var needLogin = false;
  var editing = null; // シートで開いている予定

  // ---------- 日付の道具 ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { return GenbaParse.ymd(new Date()); }
  function parseYmd(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function fmtDate(s) {
    if (!s) return '日時未定';
    var d = parseYmd(s);
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')';
  }
  function dayLabel(s) {
    var t = today();
    if (s === t) return '今日';
    if (s === GenbaParse.ymd(addDays(new Date(), 1))) return '明日';
    if (s === GenbaParse.ymd(addDays(new Date(), -1))) return '昨日';
    return '';
  }
  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- 通信 ----------
  function api(method, url, body, isBlob) {
    var opt = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      if (isBlob) { opt.body = body; opt.headers['Content-Type'] = 'image/jpeg'; }
      else { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    }
    return fetch(url, opt).then(function (res) {
      if (res.status === 401 && url !== '/api/login') { needLogin = true; showScreen('login'); }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var err = new Error(data.error || res.statusText); err.status = res.status; throw err; }
        return data;
      });
    });
  }

  function opRequest(op) {
    if (op.kind === 'create') return api('POST', '/api/events', op.body);
    if (op.kind === 'update') return api('PUT', '/api/events/' + op.id, op.body);
    if (op.kind === 'delete') return api('DELETE', '/api/events/' + op.id);
  }

  // 送信待ちの変更を画面上の予定に反映する
  function applyOp(events, op) {
    var i = events.findIndex(function (e) { return e.id === op.id; });
    if (op.kind === 'create' && i === -1) {
      events.push(Object.assign({ photos: [], assignees: [], status: 'todo', createdBy: me }, op.body, { _pending: true }));
    } else if (op.kind === 'update' && i !== -1) {
      events[i] = Object.assign({}, events[i], op.body, { _pending: true });
    } else if (op.kind === 'delete' && i !== -1) {
      events.splice(i, 1);
    }
  }

  function events() {
    var list = server.events.slice();
    outbox.forEach(function (op) { applyOp(list, op); });
    return list;
  }

  function queue(op) {
    op.body = op.body || {};
    op.body.by = me;
    outbox.push(op);
    store('genba-outbox', outbox);
    render();
    return flush();
  }

  var flushing = null;
  function flush() {
    if (flushing) return flushing;
    var run = (async function () {
      await null; // flushing に代入されてから動かす
      while (outbox.length) {
        var op = outbox[0];
        try {
          await opRequest(op);
        } catch (e) {
          if (!e.status || e.status >= 500 || e.status === 401) { setOnline(false); break; }
          // 4xx(もう消された予定など)は再送しても直らないので捨てる
        }
        outbox.shift();
        store('genba-outbox', outbox);
      }
      await sync();
    })();
    flushing = run.finally(function () {
      flushing = null;
      if (outbox.length && online) flush(); // 送信中に追加された分
    });
    return flushing;
  }

  async function sync() {
    try {
      var data = await api('GET', '/api/state?v=' + (server.version || 0));
      setOnline(true);
      if (!data.unchanged) {
        server = data;
        store('genba-cache', server);
        render();
      }
      return true;
    } catch (e) {
      if (e.status !== 401) setOnline(false);
      return false;
    }
  }

  function setOnline(v) {
    online = v;
    var el = $('sync-state');
    if (!v) {
      el.textContent = '📵 オフライン' + (outbox.length ? '（送信待ち ' + outbox.length + '件）' : '');
      el.className = 'sync offline';
    } else {
      el.textContent = outbox.length ? '送信中…' : '共有済み ✓';
      el.className = 'sync';
    }
  }

  // ---------- メンバー ----------
  function member(name) {
    return server.members.find(function (m) { return m.name === name; });
  }
  function colorOf(name) {
    var m = member(name);
    return m ? m.color : '#868e96';
  }
  function eventColor(ev) {
    return ev.assignees && ev.assignees.length ? colorOf(ev.assignees[0]) : '#adb5bd';
  }
  function saveMembers(list) {
    server.members = list;
    render();
    return api('PUT', '/api/members', { members: list }).then(function (d) {
      server.members = d.members;
      store('genba-cache', server);
      render();
    }).catch(function () { toast('メンバーの保存に失敗しました。電波を確認してください'); });
  }

  // ---------- 画面切り替え ----------
  function showScreen(name) {
    ['login', 'whoami', 'main'].forEach(function (s) { $(s).classList.toggle('hidden', s !== name); });
    if (name === 'whoami') renderWhoami();
  }

  function showTab(tab) {
    ui.tab = tab;
    ['cal', 'check', 'settings'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== tab); });
    document.querySelectorAll('.bottom [data-tab]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    window.scrollTo(0, 0);
    render();
  }

  // ---------- 描画 ----------
  function visible(ev) {
    return !ui.filter || (ev.assignees || []).indexOf(ui.filter) !== -1;
  }

  function sortEvents(list) {
    return list.sort(function (a, b) {
      if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
      return (a.time || '99') < (b.time || '99') ? -1 : (a.time || '99') > (b.time || '99') ? 1 : 0;
    });
  }

  function render() {
    $('me-btn').textContent = '👤 ' + (me || '名前未設定');
    renderBadge();
    if (ui.tab === 'cal') { renderMonth(); renderFilter(); renderDay(); }
    if (ui.tab === 'check') renderCheck();
    if (ui.tab === 'settings') renderMembers();
    if (online) setOnline(true);
  }

  function renderMonth() {
    var m = ui.month;
    $('month-title').textContent = m.getFullYear() + '年' + (m.getMonth() + 1) + '月';
    var start = addDays(m, -((m.getDay() + 6) % 7)); // 月曜はじまり
    var byDate = {};
    events().forEach(function (ev) {
      if (ev.date && visible(ev)) (byDate[ev.date] = byDate[ev.date] || []).push(ev);
    });
    var t = today();
    var html = '';
    for (var i = 0; i < 42; i++) {
      var d = addDays(start, i);
      var key = GenbaParse.ymd(d);
      var list = byDate[key] || [];
      var cls = 'cell';
      if (d.getMonth() !== m.getMonth()) cls += ' other';
      if (key === t) cls += ' today';
      if (key === ui.selDate) cls += ' sel';
      if (key < t && list.some(function (e) { return e.status !== 'done'; })) cls += ' warn';
      var dots = list.slice(0, 6).map(function (e) {
        return '<i style="background:' + (e.status === 'done' ? '#ced4da' : eventColor(e)) + '"></i>';
      }).join('');
      var numCls = d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : '';
      html += '<button class="' + cls + '" data-date="' + key + '"><span class="n ' + numCls + '">' + d.getDate() + '</span>' +
        '<span class="dots">' + dots + '</span>' + (list.length > 6 ? '<span class="more">+' + (list.length - 6) + '</span>' : '') + '</button>';
      if (i === 34 && addDays(start, 35).getMonth() !== m.getMonth()) break; // 5週で足りる月
    }
    $('month-grid').innerHTML = html;
  }

  function renderFilter() {
    var html = '<button class="chip' + (!ui.filter ? ' on' : '') + '" data-filter="" style="' + (!ui.filter ? 'background:#1f3a5f;border-color:#1f3a5f' : '') + '">全員</button>';
    server.members.forEach(function (m) {
      var on = ui.filter === m.name;
      html += '<button class="chip' + (on ? ' on' : '') + '" data-filter="' + esc(m.name) + '" style="border-color:' + m.color + ';' + (on ? 'background:' + m.color : 'color:' + m.color) + '">' + esc(m.name) + '</button>';
    });
    $('member-filter').innerHTML = html;
  }

  function renderDay() {
    var key = ui.selDate;
    var label = dayLabel(key);
    $('day-title').textContent = fmtDate(key) + (label ? '  ' + label : '') + (ui.filter ? '  ・' + ui.filter : '');
    var list = sortEvents(events().filter(function (e) { return e.date === key && visible(e); }));
    $('day-list').innerHTML = list.length ? list.map(card).join('') :
      '<div class="empty">予定はありません<br><small>🎤を押して話すと追加できます</small></div>';
  }

  function card(ev) {
    var t = today();
    var timeHtml = ev.time ? esc(ev.time) + (ev.endTime ? '<small>〜' + esc(ev.endTime) + '</small>' : '') :
      '<small>' + esc(ev.timeNote || '時間未定') + '</small>';
    var tags = (ev.assignees || []).map(function (n) {
      return '<span class="tag" style="background:' + colorOf(n) + '">' + esc(n) + '</span>';
    }).join('');
    if (!ev.assignees || !ev.assignees.length) tags += '<span class="tag gray">担当未定</span>';
    if (ev.status === 'done') tags += '<span class="tag done">✓ 完了' + (ev.photos && ev.photos.length ? ' 📷' + ev.photos.length : '') + '</span>';
    else if (ev.date && ev.date < t) tags += '<span class="tag warn">報告待ち</span>';
    if (ev._pending) tags += '<span class="tag pending">送信待ち</span>';
    var sub = [ev.client, ev.place].filter(Boolean).map(esc).join(' ／ ');
    var thumbs = (ev.photos || []).slice(0, 4).map(function (p) {
      return '<img loading="lazy" src="/photos/' + encodeURIComponent(p.file) + '" alt="">';
    }).join('');
    return '<div class="card' + (ev.status === 'done' ? ' done' : '') + '" data-id="' + esc(ev.id) + '" style="border-left-color:' + eventColor(ev) + '">' +
      '<div class="time">' + (ui.tab === 'check' ? '<small>' + fmtDate(ev.date) + '</small>' : '') + timeHtml + '</div>' +
      '<div class="body"><div class="ttl">' + esc(ev.title) + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') +
      '<div class="tags">' + tags + '</div>' + (thumbs ? '<div class="thumbs">' + thumbs + '</div>' : '') + '</div></div>';
  }

  // 予定のもれを防ぐチェック
  function checkGroups() {
    var t = today();
    var weekLater = GenbaParse.ymd(addDays(new Date(), 7));
    var open = events().filter(function (e) { return e.status !== 'done'; });
    return [
      { title: '📷 報告待ち', hint: '日にちが過ぎたのに完了になっていない予定。写真と完了をつけてください。',
        list: open.filter(function (e) { return e.date && e.date < t; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }) },
      { title: '📅 日時未定', hint: '電話で受けたけど日にちが決まっていない予定。決まったら日付を入れてください。',
        list: open.filter(function (e) { return !e.date; }) },
      { title: '👷 担当未定（1週間以内）', hint: 'だれが行くか決まっていない予定。',
        list: open.filter(function (e) { return e.date && e.date >= t && e.date <= weekLater && !(e.assignees || []).length; })
          .sort(function (a, b) { return a.date < b.date ? -1 : 1; }) }
    ];
  }

  function renderBadge() {
    var ids = {};
    checkGroups().forEach(function (g) { g.list.forEach(function (e) { ids[e.id] = 1; }); });
    var n = Object.keys(ids).length;
    $('check-badge').textContent = n;
    $('check-badge').classList.toggle('hidden', !n);
  }

  function renderCheck() {
    var html = '';
    checkGroups().forEach(function (g) {
      html += '<div class="check-group"><h3>' + g.title + (g.list.length ? ' <span class="count">' + g.list.length + '</span>' : '') + '</h3>';
      html += g.list.length ? '<p class="hint">' + g.hint + '</p><div class="list">' + g.list.map(card).join('') + '</div>' :
        '<div class="empty">ありません 👍</div>';
      html += '</div>';
    });
    $('check-list').innerHTML = html;
  }

  function renderMembers() {
    $('member-edit').innerHTML = server.members.map(function (m, i) {
      return '<div class="member-row"><input type="color" value="' + m.color + '" data-color="' + i + '">' +
        '<input value="' + esc(m.name) + '" readonly><button class="btn" data-remove="' + i + '">削除</button></div>';
    }).join('') || '<p class="empty">まだメンバーがいません</p>';
  }

  function renderWhoami() {
    $('whoami-list').innerHTML = server.members.map(function (m) {
      return '<button data-me="' + esc(m.name) + '" style="border-color:' + m.color + ';color:' + m.color + '">' + esc(m.name) + '</button>';
    }).join('');
  }

  // ---------- 音声認識 ----------
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function listen(onText, onEnd) {
    if (!SR) return null;
    var rec = new SR();
    rec.lang = 'ja-JP';
    rec.interimResults = true;
    rec.continuous = true;
    var text = '';
    var silence = null;
    var ended = false;
    function stopSoon(ms) {
      clearTimeout(silence);
      silence = setTimeout(function () { try { rec.stop(); } catch (e) { /* もう止まっている */ } }, ms);
    }
    rec.onresult = function (e) {
      text = '';
      for (var i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onText(text);
      stopSoon(2500); // 2.5秒だまったら終わり
    };
    rec.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('マイクの使用を許可してください（ブラウザの設定）');
    };
    rec.onend = function () {
      clearTimeout(silence);
      if (!ended) { ended = true; onEnd(text); }
    };
    try { rec.start(); } catch (e) { return null; }
    stopSoon(8000); // 何も話さなければ8秒で終わり
    return rec;
  }

  var voice = { rec: null, countdown: null };

  function openVoice() {
    $('voice').classList.remove('hidden');
    $('voice-text').value = '';
    updatePreview();
    startListening();
  }

  function startListening() {
    cancelCountdown();
    $('voice-text').value = '';
    updatePreview();
    voice.rec = listen(function (text) {
      $('voice-text').value = text;
      updatePreview();
    }, function (text) {
      voice.rec = null;
      $('voice-wave').classList.remove('on');
      if (text.trim()) {
        $('voice-status').textContent = 'この内容で登録します';
        startCountdown();
      } else {
        $('voice-status').textContent = '聞き取れませんでした';
      }
    });
    if (voice.rec) {
      $('voice-status').textContent = '🎤 話してください…';
      $('voice-wave').classList.add('on');
    } else {
      $('voice-wave').classList.remove('on');
      $('voice-text').focus();
      $('voice-status').textContent = 'キーボードの🎤で話してください';
    }
  }

  function stopListening() {
    if (voice.rec) { try { voice.rec.abort(); } catch (e) { /* 無視 */ } voice.rec = null; }
    $('voice-wave').classList.remove('on');
  }

  // 手がふさがっていても登録されるように、話し終わったら数秒で自動登録
  function startCountdown() {
    var n = 4;
    $('voice-save').textContent = '登録 (' + n + ')';
    voice.countdown = setInterval(function () {
      n--;
      if (n <= 0) { cancelCountdown(); saveVoice(); return; }
      $('voice-save').textContent = '登録 (' + n + ')';
    }, 1000);
  }
  function cancelCountdown() {
    clearInterval(voice.countdown);
    voice.countdown = null;
    $('voice-save').textContent = '登録';
  }

  function closeVoice() {
    stopListening();
    cancelCountdown();
    $('voice').classList.add('hidden');
  }

  function knownClients() {
    var seen = {};
    events().forEach(function (e) { if (e.client) seen[e.client] = 1; });
    return Object.keys(seen);
  }

  function parseNow(text) {
    return GenbaParse.parseSchedule(text, {
      members: server.members.map(function (m) { return m.name; }),
      clients: knownClients()
    });
  }

  function updatePreview() {
    var text = $('voice-text').value.trim();
    if (!text) { $('voice-preview').innerHTML = ''; return; }
    var r = parseNow(text);
    function row(k, v, missing) {
      return '<dt>' + k + '</dt><dd' + (v ? '' : ' class="missing"') + '>' + (v ? esc(v) : missing) + '</dd>';
    }
    var when = r.date ? fmtDate(r.date) + ' ' + (r.time ? r.time + (r.endTime ? '〜' + r.endTime : '') : (r.timeNote || '')) : '';
    $('voice-preview').innerHTML = row('日時', when, '未定 → 要確認に入ります') + row('内容', r.title) +
      row('取引先', r.client, '—') + row('現場', r.place, '—') + row('担当', r.assignees.join('・'), '未定');
  }

  function saveVoice() {
    stopListening();
    cancelCountdown();
    var text = $('voice-text').value.trim();
    if (!text) { closeVoice(); return; }
    var r = parseNow(text);
    var id = uid();
    queue({ kind: 'create', id: id, body: {
      id: id, date: r.date, time: r.time, endTime: r.endTime, timeNote: r.timeNote || '',
      title: r.title, client: r.client || '', place: r.place || '', assignees: r.assignees, raw: r.raw
    } });
    closeVoice();
    if (r.date) { ui.selDate = r.date; ui.month = startOfMonth(parseYmd(r.date)); render(); }
    toast((r.date ? '登録 ' + fmtDate(r.date) + ' ' + (r.time || r.timeNote || '') : '日時未定で登録（要確認）') + '｜' + r.title, '直す', function () {
      openSheet(events().find(function (e) { return e.id === id; }));
    });
  }

  // ---------- 詳細シート ----------
  function openSheet(ev) {
    editing = ev ? JSON.parse(JSON.stringify(ev)) : { id: null, date: ui.selDate, assignees: ui.filter ? [ui.filter] : [], photos: [], status: 'todo' };
    $('sheet-title').textContent = ev ? '予定' : '予定を追加';
    $('f-title').value = editing.title || '';
    $('f-date').value = editing.date || '';
    $('f-time').value = editing.time || '';
    $('f-end').value = editing.endTime || '';
    $('f-note').value = editing.timeNote || '';
    $('f-client').value = editing.client || '';
    $('f-place').value = editing.place || '';
    $('f-phone').value = editing.phone || '';
    $('f-memo').value = editing.memo || '';
    $('f-report').value = editing.report || '';
    $('f-raw').textContent = editing.raw ? '🎤 ' + editing.raw : '';
    $('client-options').innerHTML = knownClients().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
    var meta = [];
    if (editing.createdBy) meta.push('登録: ' + editing.createdBy);
    if (editing.doneBy) meta.push('完了: ' + editing.doneBy);
    $('f-meta').textContent = meta.join('　');
    $('delete-btn').classList.toggle('hidden', !ev);
    renderSheetAssignees();
    renderSheetPhotos();
    renderDoneBtn();
    $('sheet').classList.remove('hidden');
    $('sheet').querySelector('.sheet-body').scrollTop = 0;
  }

  function renderSheetAssignees() {
    $('f-assignees').innerHTML = server.members.map(function (m) {
      var on = editing.assignees.indexOf(m.name) !== -1;
      return '<button class="chip' + (on ? ' on' : '') + '" data-assign="' + esc(m.name) + '" style="border-color:' + m.color + ';' + (on ? 'background:' + m.color : 'color:' + m.color) + '">' + esc(m.name) + '</button>';
    }).join('');
  }

  function renderSheetPhotos(uploading) {
    var html = (editing.photos || []).map(function (p) {
      var src = '/photos/' + encodeURIComponent(p.file);
      return '<div class="ph"><img src="' + src + '" data-view="' + src + '" alt=""><button data-delphoto="' + esc(p.file) + '">✕</button>' +
        (p.by ? '<small>' + esc(p.by) + '</small>' : '') + '</div>';
    }).join('');
    for (var i = 0; i < (uploading || 0); i++) html += '<div class="ph uploading">送信中…</div>';
    $('photo-grid').innerHTML = html;
  }

  function renderDoneBtn() {
    var done = editing.status === 'done';
    $('done-btn').textContent = done ? '↩ 未完了に戻す' : '✓ 完了にする';
    $('done-btn').className = 'btn big ' + (done ? '' : 'done');
  }

  function formValues() {
    return {
      title: $('f-title').value.trim() || '(内容なし)',
      date: $('f-date').value || null,
      time: $('f-time').value || null,
      endTime: $('f-end').value || null,
      timeNote: $('f-note').value.trim(),
      client: $('f-client').value.trim(),
      place: $('f-place').value.trim(),
      phone: $('f-phone').value.trim(),
      memo: $('f-memo').value.trim(),
      report: $('f-report').value.trim(),
      assignees: editing.assignees.slice(),
      status: editing.status
    };
  }

  // シートの内容を保存。新規なら作成する。
  function saveSheet(close) {
    var body = formValues();
    var p;
    if (!editing.id) {
      editing.id = uid();
      body.id = editing.id;
      p = queue({ kind: 'create', id: editing.id, body: body });
    } else {
      p = queue({ kind: 'update', id: editing.id, body: body });
    }
    if (close) closeSheet();
    return p;
  }

  function closeSheet() {
    $('sheet').classList.add('hidden');
    editing = null;
  }

  // ---------- 写真 ----------
  function toJpeg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1600;
        var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('変換失敗')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('読み込めない画像です')); };
      img.src = url;
    });
  }

  async function addPhotos(files) {
    if (!files || !files.length || !editing) return;
    var target = editing;
    // まず予定そのものをサーバーに届ける
    await saveSheet(false);
    if (outbox.some(function (op) { return op.id === target.id; })) await flush();
    if (outbox.some(function (op) { return op.id === target.id; })) {
      toast('電波がないため写真を送れませんでした。電波のある所でもう一度どうぞ');
      return;
    }
    var left = files.length;
    renderSheetPhotos(left);
    for (var i = 0; i < files.length; i++) {
      try {
        var blob = await toJpeg(files[i]);
        var data = await api('POST', '/api/events/' + target.id + '/photos?by=' + encodeURIComponent(me), blob, true);
        target.photos = data.event.photos;
      } catch (e) {
        toast('写真を送れませんでした：' + e.message);
      }
      left--;
      if (editing === target) renderSheetPhotos(left);
    }
    sync();
  }

  // ---------- お知らせ ----------
  var toastTimer = null;
  function toast(msg, actionLabel, action) {
    var el = $('toast');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button>' + esc(actionLabel) + '</button>' : '');
    el.classList.remove('hidden');
    if (actionLabel) el.querySelector('button').onclick = function () { el.classList.add('hidden'); action(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, actionLabel ? 7000 : 4000);
  }

  // ---------- 操作 ----------
  function on(id, ev, fn) { $(id).addEventListener(ev, fn); }

  on('login-btn', 'click', function () {
    api('POST', '/api/login', { passcode: $('login-pass').value }).then(function () {
      $('login-err').textContent = '';
      start();
    }).catch(function (e) {
      $('login-err').textContent = e.status === 401 ? '合言葉がちがいます' : '接続できません';
    });
  });
  on('login-pass', 'keydown', function (e) { if (e.key === 'Enter') $('login-btn').click(); });

  on('whoami-list', 'click', function (e) {
    var b = e.target.closest('[data-me]');
    if (!b) return;
    me = b.dataset.me;
    store('genba-me', me);
    showScreen('main');
    render();
  });
  on('whoami-add', 'click', function () {
    var name = $('whoami-new').value.trim();
    if (!name || member(name)) return;
    $('whoami-new').value = '';
    saveMembers(server.members.concat([{ name: name, color: '' }])).then(renderWhoami);
  });

  document.querySelector('.bottom').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  on('mic-fab', 'click', openVoice);
  on('add-fab', 'click', function () { openSheet(null); });
  on('me-btn', 'click', function () { showScreen('whoami'); });
  on('change-me', 'click', function () { showScreen('whoami'); });

  on('prev-month', 'click', function () { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() - 1, 1); render(); });
  on('next-month', 'click', function () { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + 1, 1); render(); });
  on('month-title', 'click', function () { ui.month = startOfMonth(new Date()); ui.selDate = today(); render(); });
  on('month-grid', 'click', function (e) {
    var c = e.target.closest('[data-date]');
    if (c) { ui.selDate = c.dataset.date; render(); }
  });
  on('member-filter', 'click', function (e) {
    var c = e.target.closest('[data-filter]');
    if (!c) return;
    ui.filter = c.dataset.filter || null;
    store('genba-filter', ui.filter);
    render();
  });

  // 予定カードを開く(予定タブ・要確認タブ共通)
  document.addEventListener('click', function (e) {
    var c = e.target.closest('.card[data-id]');
    if (!c) return;
    var ev = events().find(function (x) { return x.id === c.dataset.id; });
    if (ev) openSheet(ev);
  });

  // 音声画面
  on('voice-cancel', 'click', closeVoice);
  on('voice-retry', 'click', function () { stopListening(); startListening(); });
  on('voice-save', 'click', saveVoice);
  on('voice-text', 'input', function () { cancelCountdown(); updatePreview(); });
  on('voice-text', 'focus', function () { cancelCountdown(); stopListening(); $('voice-status').textContent = '直してから「登録」'; });

  // シート
  on('sheet-close', 'click', closeSheet);
  on('sheet-save', 'click', function () { saveSheet(true); toast('保存しました'); });
  on('f-assignees', 'click', function (e) {
    var c = e.target.closest('[data-assign]');
    if (!c) return;
    var n = c.dataset.assign;
    var i = editing.assignees.indexOf(n);
    if (i === -1) editing.assignees.push(n); else editing.assignees.splice(i, 1);
    renderSheetAssignees();
  });
  on('done-btn', 'click', function () {
    editing.status = editing.status === 'done' ? 'todo' : 'done';
    var done = editing.status === 'done';
    saveSheet(true);
    toast(done ? '完了にしました 👍' : '未完了に戻しました');
  });
  on('delete-btn', 'click', function () {
    if (!confirm('この予定を削除しますか？')) return;
    queue({ kind: 'delete', id: editing.id });
    closeSheet();
    toast('削除しました');
  });
  on('photo-cam', 'change', function (e) { addPhotos(Array.from(e.target.files)); e.target.value = ''; });
  on('photo-lib', 'change', function (e) { addPhotos(Array.from(e.target.files)); e.target.value = ''; });
  on('photo-grid', 'click', function (e) {
    var del = e.target.closest('[data-delphoto]');
    if (del) {
      if (!confirm('この写真を削除しますか？')) return;
      var target = editing;
      api('DELETE', '/api/events/' + target.id + '/photos/' + encodeURIComponent(del.dataset.delphoto)).then(function (d) {
        target.photos = d.event.photos;
        if (editing === target) renderSheetPhotos();
        sync();
      }).catch(function () { toast('削除できませんでした'); });
      return;
    }
    var img = e.target.closest('[data-view]');
    if (img) { $('viewer-img').src = img.dataset.view; $('viewer').classList.remove('hidden'); }
  });
  on('viewer', 'click', function () { $('viewer').classList.add('hidden'); });
  on('report-mic', 'click', function (e) {
    e.preventDefault();
    var before = $('f-report').value;
    var rec = listen(function (text) {
      $('f-report').value = (before ? before + ' ' : '') + text;
    }, function () { $('report-mic').textContent = '🎤'; });
    if (rec) $('report-mic').textContent = '⏺';
    else { $('f-report').focus(); toast('キーボードの🎤で話してください'); }
  });

  // 設定
  on('member-add', 'click', function () {
    var name = $('member-new').value.trim();
    if (!name || member(name)) return;
    $('member-new').value = '';
    saveMembers(server.members.concat([{ name: name, color: '' }]));
  });
  on('member-edit', 'change', function (e) {
    var i = e.target.dataset.color;
    if (i === undefined) return;
    var list = server.members.slice();
    list[i] = Object.assign({}, list[i], { color: e.target.value });
    saveMembers(list);
  });
  on('member-edit', 'click', function (e) {
    var i = e.target.dataset.remove;
    if (i === undefined) return;
    if (!confirm(server.members[i].name + ' さんをメンバーから外しますか？（予定は残ります）')) return;
    var list = server.members.slice();
    list.splice(i, 1);
    saveMembers(list);
  });

  // ---------- 起動 ----------
  var pollTimer = null;
  async function start() {
    needLogin = false;
    var ok = await sync();
    if (needLogin) return; // ログイン画面が出ている
    if (!ok && !server.version) {
      showScreen('login');
      $('login-err').textContent = 'サーバーに接続できません';
      return;
    }
    if (!me || !member(me)) { showScreen('whoami'); } else { showScreen('main'); }
    render();
    flush();
    clearInterval(pollTimer);
    pollTimer = setInterval(function () { if (!document.hidden) flush(); }, POLL_MS);
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) flush(); });
  window.addEventListener('online', function () { flush(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});

  start();
})();
