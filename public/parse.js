// 音声で話した文章から「日付・時間・担当・取引先・現場・内容」を取り出す。
// ブラウザ(window.GenbaParse)とNode(require)の両方で使える。
(function (root) {
  'use strict';

  var KANJI_DIGITS = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var WEEKDAYS = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };

  function kanjiToNumber(s) {
    // 「十二」「二十五」「三」などの小さい漢数字を数値に
    var total = 0, current = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '十') {
        total += (current || 1) * 10;
        current = 0;
      } else if (c in KANJI_DIGITS) {
        current = current * 10 + KANJI_DIGITS[c];
      } else {
        return NaN;
      }
    }
    return total + current;
  }

  function normalize(text) {
    var t = String(text || '');
    // 全角英数字・記号を半角に
    t = t.replace(/[０-９Ａ-Ｚａ-ｚ：／]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
    t = t.replace(/　/g, ' ');
    // 漢数字 + 単位 を算用数字に(例: 三時 → 3時, 二十五日 → 25日)
    t = t.replace(/([〇零一二三四五六七八九十]+)(?=時|日|月|分|:)/g, function (m) {
      var n = kanjiToNumber(m);
      return isNaN(n) ? m : String(n);
    });
    return t.trim();
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { var r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() + n); return r; }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function validDate(y, m, d) {
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
  }

  function parseDate(text, now) {
    var today = startOfDay(now);
    var m;

    if ((m = text.match(/しあさって|明々後日|明明後日/))) return { date: addDays(today, 3), match: m[0] };
    if ((m = text.match(/明後日|あさって/))) return { date: addDays(today, 2), match: m[0] };
    if ((m = text.match(/明日|あした|あす/))) return { date: addDays(today, 1), match: m[0] };
    if ((m = text.match(/一昨日|おととい/))) return { date: addDays(today, -2), match: m[0] };
    if ((m = text.match(/昨日|きのう/))) return { date: addDays(today, -1), match: m[0] };
    if ((m = text.match(/今日|本日|きょう/))) return { date: today, match: m[0] };

    if ((m = text.match(/(\d{1,2})月(\d{1,2})日/)) || (m = text.match(/(\d{1,2})\/(\d{1,2})/))) {
      var mo = +m[1], da = +m[2], y = today.getFullYear();
      var dt = validDate(y, mo, da);
      // 1か月以上前の日付なら来年の話とみなす
      if (dt && dt < addDays(today, -30)) dt = validDate(y + 1, mo, da);
      if (dt) return { date: dt, match: m[0] };
    }

    if ((m = text.match(/(再来週|来週|今週)?の?([日月火水木金土])曜(日)?/))) {
      var target = WEEKDAYS[m[2]];
      var d;
      if (m[1]) {
        // 週は月曜はじまり
        var mondayOffset = (today.getDay() + 6) % 7;
        var monday = addDays(today, -mondayOffset);
        var weeks = m[1] === '再来週' ? 2 : m[1] === '来週' ? 1 : 0;
        d = addDays(monday, weeks * 7 + (target + 6) % 7);
      } else {
        var diff = (target - today.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        d = addDays(today, diff);
      }
      return { date: d, match: m[0] };
    }

    if ((m = text.match(/(^|[^\d月\/])(\d{1,2})日/))) {
      var day = +m[2];
      var dt2 = validDate(today.getFullYear(), today.getMonth() + 1, day);
      if (!dt2 || dt2 < today) {
        var next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        dt2 = validDate(next.getFullYear(), next.getMonth() + 1, day);
      }
      if (dt2) return { date: dt2, match: m[0].slice(m[1].length) };
    }
    return null;
  }

  var TIME_RE = /(午前|午後|朝の?|昼の?|夕方の?|夜の?)?\s*(\d{1,2})(?:時(半|(\d{1,2})分)?|:(\d{2}))/g;

  function toTime(marker, h, half, min, colonMin) {
    h = +h;
    var mm = half === '半' ? 30 : min ? +min : colonMin ? +colonMin : 0;
    if (h > 24 || mm > 59) return null;
    marker = (marker || '').replace('の', '');
    if ((marker === '午後' || marker === '夕方' || marker === '夜') && h < 12) h += 12;
    else if (marker === '昼' && h < 6) h += 12;
    else if (!marker && h >= 1 && h <= 6) h += 12; // 仕事の時間帯なので「3時」は15時とみなす
    if (h === 24) h = 0;
    return pad(h) + ':' + pad(mm);
  }

  function parseTimes(text) {
    var found = [], m;
    TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(text))) {
      var t = toTime(m[1], m[2], m[3], m[4], m[5]);
      if (t) found.push({ time: t, match: m[0], index: m.index });
    }
    var result = { time: null, endTime: null, matches: [], note: null };
    if (found.length) {
      result.time = found[0].time;
      result.matches.push(found[0].match);
      if (found.length > 1) {
        var between = text.slice(found[0].index + found[0].match.length, found[1].index);
        if (/から|〜|~|ー|-/.test(between) || /^\s*まで/.test(text.slice(found[1].index + found[1].match.length))) {
          result.endTime = found[1].time;
          result.matches.push(found[1].match);
        }
      }
    } else {
      var n = text.match(/午前中|午後から|午後|夕方|朝一|朝イチ|朝いち|夜/);
      if (n) { result.note = n[0].replace(/から$/, ''); result.matches.push(n[0]); }
    }
    return result;
  }

  var COMPANY_RE = /([^\s、。,は|]{1,12}?(?:建設|工務店|電設|電気|電工|設備|不動産|商事|工業|産業|興業|組|ハウス|ホーム|住建|管理|サービス))/;
  var PLACE_RE = /([^\s、。,はでにの|]{1,15}?(?:様邸|さん宅|邸|宅|ビル|マンション|アパート|ハイツ|コーポ|荘|団地|工場|店|病院|医院|クリニック|学校|保育園|幼稚園|事務所|倉庫|センター|ホテル|会館|寺|神社|駅)(?:\d+号室|\d+階)?)/;

  function longestMatch(text, list) {
    var best = null;
    (list || []).forEach(function (name) {
      if (name && text.indexOf(name) !== -1 && (!best || name.length > best.length)) best = name;
    });
    return best;
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function parseSchedule(input, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var members = opts.members || [];
    var clients = opts.clients || [];
    var raw = String(input || '').trim();
    var work = normalize(raw);
    // 見つけた部分は区切り記号に置き換えて、次の抽出や「内容」に残らないようにする
    function consume(re) {
      if (typeof re === 'string') re = new RegExp(escapeRe(re));
      var hit = work.match(re);
      if (hit) work = work.replace(hit[0], ' | ');
      return hit;
    }
    var m;

    var d = parseDate(work, now);
    if (d) consume(d.match);

    var t = parseTimes(work);
    t.matches.forEach(function (s) { consume(s); });

    var assignees = [];
    if ((m = consume(/(全員|みんな)(で)?/))) {
      assignees = members.slice();
    } else {
      members.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (name) {
        if (name && consume(new RegExp(escapeRe(name) + '(さん|君|くん|ちゃん)?(が|と|に|で|は)?(お願い(します)?)?'))) assignees.push(name);
      });
      assignees.sort(function (a, b) { return members.indexOf(a) - members.indexOf(b); });
    }

    // 取引先: 登録済みの取引先 > 会社名っぽい語 > 「〇〇さんから」
    var client = longestMatch(work, clients);
    if (!client && (m = work.match(COMPANY_RE))) client = m[1];
    if (!client && (m = work.match(/([^\s、。,|]{1,12}?)(?:さん|様|さま)(?:から|より)/))) client = m[1];
    if (client) client = client.replace(/^(に|で|の|を|と|が|へ|は)(?=.)/, '');
    if (client) consume(new RegExp(escapeRe(client) + '(さん|様|さま)?(から|より)?(の|で)?(依頼|電話)?(で|の|が)?'));

    var place = null;
    if ((m = work.match(/現場は\s*([^\s、。,|]+)/))) place = m[1];
    else if ((m = work.match(PLACE_RE))) place = m[1];
    if (place) consume(new RegExp('(現場は)?\\s*' + escapeRe(place) + '(で|に|の)?'));

    var title = work
      .split('|')
      .map(function (part) {
        return part
          .replace(/^[\s、。,]*(の|に|で|は|を|が|から|まで|と)?(?=\s|$)/, '')
          .replace(/^[\s、。,]*(の|に|で|は|から)(?=[^\s])/, '')
          .replace(/(の|に|で|は|を|が|から|まで|と)?[\s、。,]*$/, '')
          .trim();
      })
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (title.length < 2) title = raw;

    return {
      date: d ? ymd(d.date) : null,
      time: t.time,
      endTime: t.endTime,
      timeNote: t.note,
      assignees: assignees,
      client: client,
      place: place,
      title: title,
      raw: raw
    };
  }

  var api = { parseSchedule: parseSchedule, normalize: normalize, ymd: ymd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GenbaParse = api;
})(typeof self !== 'undefined' ? self : this);
