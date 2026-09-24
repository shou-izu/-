const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSchedule } = require('../public/parse.js');

// 2026-09-24(木) 9:00 を「今」とする
const now = new Date(2026, 8, 24, 9, 0);
const opts = { now, members: ['田中', '佐藤', '鈴木'], clients: ['山本建設'] };
const p = (s) => parseSchedule(s, opts);

test('明日・時間・取引先・現場・担当を取り出す(区切りなし)', () => {
  const r = p('明日の10時に山本建設さんから駅前ビルの照明交換佐藤さんお願い');
  assert.equal(r.date, '2026-09-25');
  assert.equal(r.time, '10:00');
  assert.equal(r.client, '山本建設');
  assert.equal(r.place, '駅前ビル');
  assert.deepEqual(r.assignees, ['佐藤']);
  assert.equal(r.title, '照明交換');
});

test('午後・開始と終了', () => {
  const r = p('あさって午後3時から5時まで 田中 ○○マンション305号室 エアコン専用回路');
  assert.equal(r.date, '2026-09-26');
  assert.equal(r.time, '15:00');
  assert.equal(r.endTime, '17:00');
  assert.equal(r.place, '○○マンション305号室');
});

test('時刻に午前午後がなければ1〜6時は午後とみなす', () => {
  assert.equal(p('25日 2時 伊藤さん宅 漏電調査').time, '14:00');
  assert.equal(p('明日 8時 現場確認').time, '08:00');
});

test('漢数字の時間と「半」', () => {
  const r = p('10月3日 九時半 高橋工務店 新築 配線 全員');
  assert.equal(r.date, '2026-10-03');
  assert.equal(r.time, '09:30');
  assert.equal(r.client, '高橋工務店');
  assert.deepEqual(r.assignees, ['田中', '佐藤', '鈴木']);
});

test('曜日と来週', () => {
  assert.equal(p('金曜日 午前中 コンセント増設').date, '2026-09-25');
  assert.equal(p('金曜日 午前中 コンセント増設').timeNote, '午前中');
  assert.equal(p('来週の月曜 朝一 中村様邸 分電盤交換').date, '2026-09-28');
  assert.equal(p('再来週水曜 点検').date, '2026-10-07');
  // 今日と同じ曜日は来週のその日
  assert.equal(p('木曜 点検').date, '2026-10-01');
});

test('過ぎた日付は翌月・翌年', () => {
  assert.equal(p('20日 点検').date, '2026-10-20');
  assert.equal(p('1月10日 点検').date, '2027-01-10');
});

test('日時が言われていなければ未定のまま(要確認に回る)', () => {
  const r = p('佐々木さんから電話 ブレーカーが落ちる 折り返し');
  assert.equal(r.date, null);
  assert.equal(r.client, '佐々木');
  assert.equal(r.title, 'ブレーカーが落ちる 折り返し');
});

test('全角数字も読める', () => {
  const r = p('１０月５日　１３：３０　分電盤交換');
  assert.equal(r.date, '2026-10-05');
  assert.equal(r.time, '13:30');
});

test('取引先の前の助詞はつかない(登録済みの取引先がなくても)', () => {
  const r = parseSchedule('明日の10時に山本建設さんから駅前ビルの照明交換', { now, members: [], clients: [] });
  assert.equal(r.client, '山本建設');
  assert.equal(r.place, '駅前ビル');
  assert.equal(r.title, '照明交換');
});

test('昨日・おととい(あとから記録する時)', () => {
  assert.equal(p('昨日の2時 中村様邸 分電盤交換').date, '2026-09-23');
  assert.equal(p('おととい 点検').date, '2026-09-22');
});
