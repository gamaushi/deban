/* 出番ですョ!  画面（Android版 ui/*.kt の移植） */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = v => Math.round(v).toLocaleString('ja-JP');
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const jpDate = d => `${dYear(d)}年${dMonth(d)}月${dDay(d)}日`;
const ymJp = ym => `${ymY(ym)}年${ymM(ym)}月`;

// ===== 保存（端末内 localStorage。Android版と同じJSON形式） =====
const LS_DATA = 'deban_data';
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function loadData() {
  const t = lsGet(LS_DATA);
  if (!t) return Store.fromJson({});
  try { return Store.fromJson(JSON.parse(t)); } catch (e) { return Store.fromJson({}); }
}
let data = loadData();
let simpleMode = false;          // 簡易表示は保存しない（起動し直したら詳細表示から）
let curYm = ymNow();
let ledgerCache = null;
let saveWarned = false;

const pattern = () => data.settings.pattern;
const storeFor = p => p === DAILY_NIGHT ? data.dailyNight : data.sales;
function ledger() {
  if (!ledgerCache) ledgerCache = new Ledger(storeFor(pattern()), pattern(), data.hireDate);
  return ledgerCache;
}
function update(nd, opts) {
  data = nd; ledgerCache = null;
  if (!lsSet(LS_DATA, JSON.stringify(Store.toJson(data))) && !saveWarned) {
    saveWarned = true;
    toast('⚠️ 保存できませんでした。プライベートブラウズでは保存されません。');
  }
  if (!(opts && opts.noRender)) refreshAll();
}
const updateSettings = f => update(Object.assign({}, data, { settings: f(Object.assign({}, data.settings)) }));

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ===== トースト =====
let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), Math.max(3000, msg.length * 90));
}

// ===== ダイアログ =====
function openDialog({ title, body, buttons, onMount, dismissable = true }) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><div class="dh"></div><div class="db"></div><div class="df"></div></div>`;
  ov.querySelector('.dh').innerHTML = title;
  ov.querySelector('.db').innerHTML = body;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && dismissable) close(); };
  document.addEventListener('keydown', onKey);
  const df = ov.querySelector('.df');
  for (const b of buttons || []) {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls === undefined ? 'ghost' : b.cls); el.textContent = b.label;
    if (b.id) el.id = b.id;
    el.addEventListener('click', () => { if (b.onClick) { if (b.onClick(close) !== false) close(); } else close(); });
    df.appendChild(el);
  }
  ov.addEventListener('click', e => { if (e.target === ov && dismissable) close(); });
  document.body.appendChild(ov);
  if (onMount) onMount(ov, close);
  return close;
}
function showAlert(msg, pensionFrom) {
  openDialog({
    title: '確認してください', body: `<pre>${esc(msg)}</pre>`,
    buttons: pensionFrom != null
      ? [{ label: 'あとで' }, { label: '今すぐ登録', cls: '', onClick: () => { setTimeout(() => pensionDialog(pensionFrom), 0); } }]
      : [{ label: 'OK', cls: '' }]
  });
}
function confirmDialog(title, msg, okLabel, onOk) {
  openDialog({ title: esc(title), body: `<div>${esc(msg)}</div>`, buttons: [{ label: 'やめる' }, { label: okLabel, cls: '', onClick: () => { onOk(); } }] });
}

// ===== 天気（Open-Meteo。予報8時間キャッシュ＋過去の実況） =====
const Weather = {
  LAT: 35.670738, LON: 139.771963,       // 中央区役所付近
  MAX_AGE: 8 * 3600e3, HIST_INTERVAL: 12 * 3600e3, BACKFILL_DAYS: 365,
  data: {}, loading: false,
  icon(code) {
    if (code === 0) return '☀️';
    if (code === 1 || code === 2) return '🌤️';
    if (code === 3) return '☁️';
    if (code === 45 || code === 48) return '🌫️';
    if (code >= 51 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 80 && code <= 82) return '🌦️';
    if (code >= 95 && code <= 99) return '⛈️';
    return '';
  },
  read(k) { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } },
  loadCached() {
    const c = Weather.read('wx_cache'), h = Weather.read('wx_hist');
    Weather.data = Object.assign({}, c && c.data, h);    // 過去日付は実況を優先
  },
  async getJson(url, ms) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, { signal: ctl.signal }); return r.ok ? await r.json() : null; }
    catch (e) { return null; } finally { clearTimeout(t); }
  },
  arr: (daily, name, sfx) => daily[name + sfx] || daily[name] || null,
  num: (a, i) => (a && i < a.length && a[i] != null) ? a[i] : null,
  async fetchOne(model) {
    let url = `https://api.open-meteo.com/v1/forecast?latitude=${Weather.LAT}&longitude=${Weather.LON}` +
      '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum' +
      '&timezone=Asia%2FTokyo&forecast_days=16&past_days=7';
    if (model) url += '&models=' + model;
    const j = await Weather.getJson(url, 8000);
    const daily = j && j.daily; if (!daily || !daily.time) return null;
    const sfx = model ? '_' + model : '', A = n => Weather.arr(daily, n, sfx), N = Weather.num;
    const codes = A('weathercode'), tmax = A('temperature_2m_max'), tmin = A('temperature_2m_min'), prob = A('precipitation_probability_max'), sum = A('precipitation_sum');
    const out = {};
    daily.time.forEach((t, i) => {
      const code = N(codes, i), d = parseDate(t); if (code == null || !d) return;
      out[d] = { code, max: N(tmax, i), min: N(tmin, i), precip_prob: N(prob, i), precip_sum: N(sum, i) };
    });
    return out;
  },
  async fetchForecast() {
    const [jma, best] = await Promise.all([Weather.fetchOne('jma_seamless'), Weather.fetchOne(null)]);
    if (!jma) return best; if (!best) return jma;
    const out = Object.assign({}, best);
    for (const [d, j] of Object.entries(jma)) {
      const b = out[d];
      out[d] = !b ? j : { code: j.code, max: j.max ?? b.max, min: j.min ?? b.min, precip_prob: j.precip_prob ?? b.precip_prob, precip_sum: j.precip_sum ?? b.precip_sum };
    }
    return out;
  },
  async fetchHistory(start, end) {
    if (start > end) return null;
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${Weather.LAT}&longitude=${Weather.LON}` +
      `&start_date=${start}&end_date=${end}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FTokyo`;
    const j = await Weather.getJson(url, 15000);
    const daily = j && j.daily; if (!daily || !daily.time) return null;
    const N = Weather.num, out = {};
    daily.time.forEach((t, i) => {
      const code = N(daily.weathercode, i), d = parseDate(t); if (code == null || !d) return;
      out[d] = { code, max: N(daily.temperature_2m_max, i), min: N(daily.temperature_2m_min, i), precip_prob: null, precip_sum: N(daily.precipitation_sum, i) };
    });
    return out;
  },
  async refresh(force) {
    if (Weather.loading) return;
    Weather.loading = true; renderSettingWeatherBtn();
    try {
      const now = Date.now();
      const c = Weather.read('wx_cache');
      if (force || !c || now - c.ts >= Weather.MAX_AGE) {
        const f = await Weather.fetchForecast();
        if (f) lsSet('wx_cache', JSON.stringify({ ts: now, data: f }));
      }
      const checked = Number(lsGet('wx_hist_checked') || 0);
      if (force || now - checked >= Weather.HIST_INTERVAL) {
        const hist = Weather.read('wx_hist') || {};
        const yesterday = addDays(todayIso(), -1);
        const keys = Object.keys(hist).sort(); const last = keys[keys.length - 1];
        const start = !last ? addDays(todayIso(), -Weather.BACKFILL_DAYS) : last < yesterday ? addDays(last, 1) : null;
        if (start) {
          const got = await Weather.fetchHistory(start, yesterday);
          if (got) {
            if (Object.keys(got).length) lsSet('wx_hist', JSON.stringify(Object.assign(hist, got)));
            lsSet('wx_hist_checked', String(Date.now()));
          }
        }
      }
      Weather.loadCached();
      if (force) toast(Object.keys(Weather.data).length ? '天気を更新しました' : '天気を取得できませんでした');
      refreshMonths();
    } finally { Weather.loading = false; renderSettingWeatherBtn(); }
  }
};

// ===== 入力（AppViewModel.submit） =====
function saveValue(date, value) {
  const p = pattern();
  const store = Object.assign({}, storeFor(p)); store[date] = value;
  update(Object.assign({}, data, p === DAILY_NIGHT ? { dailyNight: store } : { sales: store }));
}
function submit(date, raw) {
  const value = Values.normalizeInput(raw);
  if (value === null) return { ok: false, msg: '営収は6桁（999,999円）までの数字で入力してください' };
  const p = pattern(), led = ledger();
  let info = null;
  if (Values.isAbsent(value) && p !== DAILY_NIGHT && !Shift.isShiftDay(date, p)) return { ok: false, msg: '⚠️ 欠勤は出番日にのみ入力できます。' };
  if (Values.isPaid(value)) {
    const warns = []; let pensionFrom = null;
    if (!data.hireDate) warns.push('入社年月日が未入力です。設定画面で入力してください。');
    let consumed = false;
    const c = led.checkPaid(date);
    if (c.type === 'blocked') return { ok: false, msg: '⚠️ ' + c.reason };   // 何も保存しない
    if (c.type === 'consumed') { consumed = true; info = '🔶 公出を1回消化しました（有給残は減りません）。'; }
    const payYm = Shift.periodMonthOf(date);
    if (!consumed && !Pension.entryFor(data.settings.pensionHistory, payYm)) {
      warns.push(`${ymJp(payYm)}分の標準報酬月額が未登録です。このままだと有給手当が0円で計算されます。給与明細の「厚生年金」の額を登録してください。`);
      pensionFrom = Pension.latestChangeMonth(payYm);
    }
    if (warns.length) {
      saveValue(date, value);
      showAlert((info ? info + '\n\n' : '') + '⚠️ ' + warns.join('\n\n⚠️ '), pensionFrom);
      return { ok: true, msg: null };
    }
  }
  saveValue(date, value);
  return { ok: true, msg: info };
}

/** 日勤・夜勤：未入力の日に初期値（平日=出、土日祝=休）を入れる（表示中の前月〜翌月） */
function fillDailyNightDefaults() {
  if (pattern() !== DAILY_NIGHT) return false;
  const store = Object.assign({}, data.dailyNight); let changed = false;
  for (let d = atDay(curYm - 1, 1), end = atEnd(curYm + 1); d <= end; d = addDays(d, 1)) {
    if (!(d in store)) { store[d] = Shift.dailyNightDefault(d); changed = true; }
  }
  if (changed) update(Object.assign({}, data, { dailyNight: store }));
  return changed;
}
function setPattern(p) {
  updateSettings(s => p === DAILY_NIGHT ? Object.assign(s, { pattern: p }) : Object.assign(s, { pattern: p, hann: p }));
  fillDailyNightDefaults();
}

// ===== カレンダー =====
function valueColor(v, dn) {
  const n = Values.norm(v);
  if (Values.isRevenue(v)) return 'var(--c-revenue)';
  if (dn && n === '出') return 'var(--c-work)';
  if (n === '有給' || n === '有休' || n === '公出消') return 'var(--c-paid)';
  if (n === '欠勤') return 'var(--c-absent)';
  return null;
}
const shortValue = v => Values.isRevenue(v) ? yen(Values.revenue(v)) : v;
const union = (a, b) => new Set([...a, ...b]);

function cellHtml(d, led, red, marks, today, simple) {
  const p = led.pattern, dn = p === DAILY_NIGHT;
  const value = led.displayValue(d);
  const w = dow(d), hol = Holidays.isHoliday(d), closing = dDay(d) === 18 && !simple;
  const bg = dn ? (valueColor(value, true) || '#fff') : (Shift.isShiftDay(d, p) ? Shift.PATTERN_COLORS[p] : '#fff');
  const dnCls = ['dn', closing ? 'cl' : '', hol ? 'hol' : '', d === today ? 'td' : '', w === 0 ? 'su' : '', w === 6 ? 'sa' : ''].join(' ');
  const wx = Weather.data[d]; const wxIcon = wx ? Weather.icon(wx.code) : '';
  let h = `<div class="cell day${red.has(d) ? ' red' : ''}" data-d="${d}" style="background:${bg}">` +
    `<div class="r1"><span class="${dnCls}">${closing ? '&lt;18&gt;' : dDay(d)}</span>${marks.has(d) ? '<span class="gm">㊒</span>' : ''}<span class="sp"></span>` +
    (wxIcon ? `<span class="wx${closing ? ' sm' : ''}">${wxIcon}</span>` : '') + '</div>';
  if (simple) {
    if (value !== '' && !Values.isWork(value) && Values.norm(value) !== '休') h += `<div class="val bare${Values.isRevenue(value) ? ' rev' : ''}">${esc(shortValue(value))}</div>`;
    return h + '</div>';
  }
  const vbg = dn ? 'rgba(255,255,255,.13)' : (valueColor(value, false) || '#fff');
  h += `<div class="drv">${Shift.workingDrivers(d)}</div><div class="duty">${Shift.dutyOfficer(d)}</div>` +
    `<div class="val${Values.isRevenue(value) ? ' rev' : ''}" style="background:${vbg}">${esc(shortValue(value))}</div></div>`;
  return h;
}

function summaryHtml(s, p) {
  const it = (t, cls) => `<span class="${cls || ''}">${esc(t)}</span>`;
  const row = (label, items) => `<div class="srow"><div class="slabel">${label}</div><div class="sitems">${items.join('')}</div></div>`;
  const ps = s.periodStart, pe = s.periodEnd;
  const r1 = [it(`${Shift.PATTERN_LABELS[p]}：${dMonth(ps)}/${dDay(ps)}～${dMonth(pe)}/${dDay(pe)}`)];
  if (s.dailyNight) { r1.push(it(`責任出番：${s.base}回`)); r1.push(it(`平日${s.weekdays}日（祝${s.weekdayHolidays}）土${s.saturdays} 日${s.sundays}`)); }
  else r1.push(it(`合計：${s.shiftTotal}日（${s.shiftBase}出番と${s.shiftExtra}公出）`));
  const r2 = [];
  if (s.dailyNight) {
    r2.push(it(s.scheduledExtra > 0 ? `予定：${s.scheduledBase}回＋公出${s.scheduledExtra}回` : `予定出番：${s.scheduledWork}回`));
    r2.push(it(`乗務：${s.actualWork}回` + (s.actualExtra > 0 ? `（公出${s.actualExtra}）` : '')));
    r2.push(it(`欠勤：${s.absent}回`, 'c-red'));
    r2.push(it(`有給：${s.paid}出番`));
  } else {
    r2.push(it(`出番数：${s.baseShifts}回`)); r2.push(it(`公出数：${s.extraCount}回`));
    r2.push(it(`欠勤数：${s.absent}回`, 'c-red b')); r2.push(it(`有給取得数：${s.paid}出番`));
    if (Shift.isNewRulePeriod(s.ym) && s.consumedPaid > 0) r2.push(it(`公出取消し：${s.consumedPaid}出番`, 'c-orange b'));
  }
  if (s.remainingToClear <= 0) { const over = -s.remainingToClear; r2.push(it('責任出番：クリア' + (s.dailyNight && over > 0 ? `（+${over}）` : ''), 'c-green b')); }
  else r2.push(it(`クリアまで：${s.remainingToClear}${s.dailyNight ? '回' : '出番'}`, 'c-amber b'));
  if (!s.hasHireDate) r2.push(it('有給残：--', 'c-gray'));
  else r2.push(it(`有給残：${s.paidRemaining ? s.paidRemaining.shifts : 0}出番`, 'c-orange b'));
  if (s.dailyNight && s.shortage > 0) r2.push(it(`⚠ 予定が${s.shortage}回不足`, 'c-alert b'));
  const r3 = [];
  if (!s.dailyNight || s.extraCount > 0) { r3.push(it(`出番：${yen(s.baseRevenue)}円`)); r3.push(it(`公出：${yen(s.extraRevenue)}円`)); }
  r3.push(it(`月間：${yen(s.totalRevenue)}円`, 'b'));
  r3.push(`<button class="salbtn" data-sal="${s.ym}">給料計算</button>`);
  return `<div class="sum">${row('期間情報', r1)}${row('回数集計', r2)}${row('営収集計', r3)}</div>`;
}

function monthInner(ym) {
  const led = ledger(), p = pattern(), simple = p === DAILY_NIGHT && simpleMode;
  const red = union(led.publicDutyDates(ym), led.publicDutyDates(ym + 1));
  const marks = led.allGrantMarks, today = todayIso();
  const offset = dow(atDay(ym, 1)), len = monthLen(ym), rows = Math.ceil((offset + len) / 7);
  let g = '';
  for (let i = 0; i < rows * 7; i++) {
    const day = i - offset + 1;
    g += (day >= 1 && day <= len) ? cellHtml(atDay(ym, day), led, red, marks, today, simple) : '<div class="cell"></div>';
  }
  return `<div class="mtitle${ym === ymNow() ? ' now' : ''}">${ymJp(ym)}</div><div class="grid${simple ? ' simple' : ''}">${g}</div>` +
    (simple ? '' : summaryHtml(led.summary(ym), p));
}

const monthsEl = $('#months');
let rangeStart = 0, rangeEnd = -1;
const CHUNK = 6;
function makeSection(ym) {
  const s = document.createElement('section'); s.className = 'month'; s.dataset.ym = ym; s.innerHTML = monthInner(ym); return s;
}
function headerBottom() { return $('#top').getBoundingClientRect().bottom; }
function buildRange(center) {
  rangeStart = center - CHUNK; rangeEnd = center + CHUNK;
  monthsEl.textContent = '';
  for (let ym = rangeStart; ym <= rangeEnd; ym++) monthsEl.appendChild(makeSection(ym));
}
function sectionOf(ym) { return monthsEl.querySelector(`section[data-ym="${ym}"]`); }
function scrollToMonth(ym, smooth) {
  if (ym < rangeStart || ym > rangeEnd) buildRange(ym);
  const s = sectionOf(ym);
  const y = window.scrollY + s.getBoundingClientRect().top - headerBottom();
  window.scrollTo({ top: Math.max(0, Math.round(y)), behavior: smooth ? 'smooth' : 'auto' });
  ensureRange();
}
function extendTop() {
  const before = document.documentElement.scrollHeight, y = window.scrollY;
  const frag = document.createDocumentFragment();
  for (let ym = rangeStart - CHUNK; ym < rangeStart; ym++) frag.appendChild(makeSection(ym));
  monthsEl.insertBefore(frag, monthsEl.firstChild);
  rangeStart -= CHUNK;
  window.scrollTo(0, y + document.documentElement.scrollHeight - before);
}
function extendBottom() {
  for (let ym = rangeEnd + 1; ym <= rangeEnd + CHUNK; ym++) monthsEl.appendChild(makeSection(ym));
  rangeEnd += CHUNK;
}
function ensureRange() {
  if (calHidden()) return;
  const margin = window.innerHeight * 2;
  if (window.scrollY < margin) extendTop();
  if (document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) < margin) extendBottom();
}
function refreshMonths() {
  for (const s of monthsEl.children) s.innerHTML = monthInner(Number(s.dataset.ym));
}
function refreshAll() { refreshMonths(); renderHeader(); }
const calHidden = () => $('#calView').hidden;

/** 画面の上半分を占めている月 */
function topMonth() {
  const hb = headerBottom(), half = (window.innerHeight - hb) / 2;
  const secs = monthsEl.children;
  for (let i = 0; i < secs.length; i++) {
    const r = secs[i].getBoundingClientRect();
    if (r.bottom > hb) {
      if (r.bottom - hb < half && i + 1 < secs.length) return Number(secs[i + 1].dataset.ym);
      return Number(secs[i].dataset.ym);
    }
  }
  return curYm;
}
let shownYm = null;
function setTitle(ym) {
  if (ym === shownYm) return;
  const btn = $('#title'); const old = btn.querySelector('span:last-child');
  const sp = document.createElement('span'); sp.textContent = ymJp(ym);
  if (shownYm !== null && old) {
    const up = ym > shownYm;
    btn.querySelectorAll('span').forEach(x => { if (x !== old) x.remove(); });
    old.className = up ? 'out-up' : 'out-down';
    sp.className = up ? 'in-up' : 'in-down';
    setTimeout(() => old.remove(), 460);
  } else btn.textContent = '';
  btn.appendChild(sp);
  shownYm = ym;
}
let scrollTimer = null, ticking = false;
window.addEventListener('scroll', () => {
  if (calHidden()) return;
  if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; setTitle(topMonth()); ensureRange(); }); }
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {   // スクロールが止まってから
    const t = topMonth();
    if (t !== curYm) { curYm = t; fillDailyNightDefaults(); }
  }, 250);
}, { passive: true });

function renderHeader() {
  const p = pattern(), dn = p === DAILY_NIGHT;
  const pb = $('#patBtn'); pb.textContent = `${Shift.PATTERN_LABELS[p] || p} ▼`; pb.style.background = Shift.PATTERN_COLORS[p] || '#fff';
  const sw = $('#modeSw'); sw.hidden = !dn;
  sw.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.simple === '1') === simpleMode));
}

// 班の選択メニュー
$('#patBtn').addEventListener('click', e => {
  e.stopPropagation();
  const old = document.querySelector('.patmenu'); if (old) { old.remove(); return; }
  const m = document.createElement('div'); m.className = 'patmenu';
  for (const k of Shift.PATTERN_KEYS) {
    const b = document.createElement('button'); b.textContent = Shift.PATTERN_LABELS[k]; b.style.background = Shift.PATTERN_COLORS[k];
    b.addEventListener('click', () => { m.remove(); if (k !== pattern()) setPattern(k); });
    m.appendChild(b);
  }
  $('#top').appendChild(m);
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!m.contains(ev.target)) m.remove(); document.removeEventListener('click', off); }), 0);
});
$('#modeSw').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const want = b.dataset.simple === '1'; if (want === simpleMode) return;
  const keep = topMonth(); simpleMode = want; refreshAll(); scrollToMonth(keep);
});
$('#title').addEventListener('click', () => monthPicker(topMonth()));
$('#gear').addEventListener('click', () => go('setting'));
monthsEl.addEventListener('click', e => {
  const sal = e.target.closest('[data-sal]');
  if (sal) { const ym = Number(sal.dataset.sal); salaryInput = ledger().summary(ym).salary; go('salary'); return; }
  const c = e.target.closest('.cell.day'); if (c) dayDialog(c.dataset.d);
});

// ===== 年月の選択 =====
function monthPicker(initial) {
  let year = ymY(initial); const now = ymNow();
  const grid = () => {
    let h = '';
    for (let m = 1; m <= 12; m++) {
      const ym = YM(year, m);
      h += `<button data-ym="${ym}" class="${ym === initial ? 'cur' : ym === now ? 'now' : ''}">${m}月</button>`;
    }
    return h;
  };
  openDialog({
    title: `<div class="hrow" style="justify-content:space-between"><button class="btn ghost" id="py">◀</button><span id="yv">${year}年</span><button class="btn ghost" id="ny">▶</button></div>`,
    body: `<div class="mgrid" id="mg">${grid()}</div>`,
    buttons: [{ label: '閉じる' }, { label: '今月へ', onClick: () => scrollToMonth(now) }],
    onMount: (ov, close) => {
      const redraw = () => { ov.querySelector('#yv').textContent = `${year}年`; ov.querySelector('#mg').innerHTML = grid(); };
      ov.querySelector('#py').onclick = () => { year--; redraw(); };
      ov.querySelector('#ny').onclick = () => { year++; redraw(); };
      ov.querySelector('#mg').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        close(); const t = Number(b.dataset.ym); scrollToMonth(t, Math.abs(t - topMonth()) <= 3);
      });
    }
  });
}

// ===== 日付の入力ダイアログ =====
function dayDialog(d) {
  const led = ledger(), p = led.pattern, dn = p === DAILY_NIGHT;
  const current = led.displayValue(d);
  const red = union(led.publicDutyDates(ymOf(d)), led.publicDutyDates(ymOf(d) + 1)).has(d);
  const grant = led.allGrantMarks.get(d);
  const hn = Holidays.nameOf(d);
  let info = `<div>乗務：${Shift.workingDrivers(d)}　当番：${Shift.dutyOfficer(d)}</div>`;
  if (!dn && Shift.isShiftDay(d, p)) info += `<div style="font-size:14px;color:#555">この日は${Shift.PATTERN_LABELS[p]}の出番日です</div>`;
  const w = Weather.data[d];
  if (w) {
    let t = Weather.icon(w.code) + ' ';
    if (w.max != null && w.min != null) t += `最高${w.max}℃ / 最低${w.min}℃`;
    if (w.precip_prob != null) t += `　降水確率${Math.trunc(w.precip_prob)}%`;
    else if (w.precip_sum != null) t += `　降水量${w.precip_sum}mm`;
    info += `<div style="font-size:14px">${t}</div>`;
  }
  if (grant) info += `<div style="font-size:14px;color:var(--orange)">㊒ 有給${grant.days}日付与（累計${grant.cumulative}日）　有給残：${grant.remainingShifts}出番</div>`;
  if (red) info += `<div style="font-size:14px;color:red">赤枠：残っている公出の日</div>`;
  info += `<div>現在の入力：${current === '' ? '（なし）' : esc(shortValue(current))}</div>`;
  const init = Values.isRevenue(current) ? String(Values.revenue(current)) : '';
  const words = dn ? ['出', '休', '有給', '欠勤', '出変', 'クリア'] : ['出', '有給', '欠勤', '出変', '休', 'クリア'];
  const body = info +
    `<div class="field" style="margin-top:6px"><label for="rev">営収（円）</label><div class="inwrap">` +
    `<input id="rev" class="inp" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" enterkeyhint="done" placeholder="例：45270" value="${init.length <= Values.MAX_DIGITS ? init : ''}">` +
    `<button class="clr" id="clr" aria-label="入力を消す" ${init ? '' : 'hidden'}>✕</button></div><div class="errtxt" id="err"></div></div>` +
    `<div class="wbtns">${words.map(x => `<button data-w="${x}">${x}</button>`).join('')}</div>`;
  openDialog({
    title: `${dMonth(d)}月${dDay(d)}日（${WEEK[dow(d)]}）` + (hn ? `<div class="hn">${esc(hn)}</div>` : ''),
    body,
    buttons: [{ label: '閉じる' }, { label: '営収を保存', cls: '', id: 'saveRev', onClick: () => false }],
    onMount: (ov, close) => {
      const inp = ov.querySelector('#rev'), err = ov.querySelector('#err'), clr = ov.querySelector('#clr');
      const setErr = m => { err.textContent = m || ''; inp.classList.toggle('err', !!m); };
      const send = raw => {
        const r = submit(d, raw);
        if (!r.ok && r.msg && r.msg.startsWith('営収は')) { setErr(r.msg); return; }
        if (r.msg) toast(r.msg);
        close();
      };
      inp.addEventListener('input', () => {
        const digits = inp.value.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 48)).replace(/\D/g, '');
        if (digits.length <= Values.MAX_DIGITS) { setErr(''); inp.value = digits; }
        else { inp.value = digits.slice(0, Values.MAX_DIGITS); setErr('営収は6桁（999,999円）までです'); }
        clr.hidden = inp.value === '';
      });
      clr.addEventListener('click', () => { inp.value = ''; clr.hidden = true; setErr(''); inp.focus(); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && inp.value.trim()) send(inp.value); });
      ov.querySelector('.wbtns').addEventListener('click', e => { const b = e.target.closest('button'); if (b) send(b.dataset.w === 'クリア' ? '' : b.dataset.w); });
      ov.querySelector('#saveRev').addEventListener('click', () => {
        if (!inp.value.trim()) setErr('営収を入力するか、上のボタンを選んでください'); else send(inp.value);
      });
    }
  });
}

// ===== 標準報酬月額の登録 =====
function pensionLabel(e) {
  const since = ymY(e.from) <= 2000 ? '以前から' : `${ymJp(e.from)}分〜`;
  const src = e.premium != null ? `厚生年金 ${yen(e.premium)}円 → ` : '';
  return `${since}　${src}標準報酬 ${yen(e.hyoujyun)}円`;
}
function savePension(e) {
  updateSettings(s => Object.assign(s, { pensionHistory: s.pensionHistory.filter(x => x.from !== e.from).concat([e]).sort((a, b) => a.from - b.from) }));
  rerenderView();
}
function pensionDialog(initialFrom) {
  const initial = data.settings.pensionHistory.find(x => x.from === initialFrom) || null;
  let from = initialFrom, direct = !!(initial && initial.premium == null);
  let text = !initial ? '' : String(initial.premium == null ? initial.hyoujyun : initial.premium);
  openDialog({
    title: '標準報酬月額の登録',
    body: `<div style="font-size:14px;color:#555">何月分の給料から使う値ですか</div>
      <div class="stepper" style="justify-content:space-between"><button id="pf">◀</button><span class="v" id="fv"></span><button id="nf">▶</button></div>
      <div class="sub" style="font-size:12px">※ 毎年9月に見直され、10月分の給料から変わります</div>
      <label class="frow" style="min-height:36px"><input type="radio" name="pm" value="0" class="radio-i"> 給与明細の「厚生年金」の額を入れる</label>
      <label class="frow" style="min-height:36px"><input type="radio" name="pm" value="1" class="radio-i"> 標準報酬月額を直接入れる</label>
      <div class="field"><label for="pv" id="pl"></label><input id="pv" class="inp" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"></div>
      <div id="pres"></div>`,
    buttons: [{ label: 'やめる' }, { label: '保存', cls: '', id: 'psave', onClick: () => false }],
    onMount: (ov, close) => {
      const inp = ov.querySelector('#pv'), res = ov.querySelector('#pres'), sv = ov.querySelector('#psave');
      ov.querySelectorAll('.radio-i').forEach(r => { r.style.cssText = 'width:20px;height:20px;accent-color:var(--blue)'; });
      inp.value = text;
      let hyoujyun = null;
      const calc = () => {
        ov.querySelector('#fv').textContent = `${ymJp(from)}分から`;
        ov.querySelectorAll('input[name=pm]').forEach(r => { r.checked = (r.value === '1') === direct; });
        ov.querySelector('#pl').textContent = direct ? '標準報酬月額（円）' : '厚生年金（円）';
        inp.placeholder = direct ? '例：360000' : '例：32940';
        const value = Number(inp.value) || 0;
        hyoujyun = direct ? (value > 0 ? value : null) : Pension.fromPremium(value, from);
        if (hyoujyun != null) {
          const perDay = Math.floor(hyoujyun / 300) * 10;
          let h = `<div style="font-size:16px;font-weight:700;color:var(--blue)">→ 標準報酬月額：${yen(hyoujyun)}円</div>` +
            `<div style="font-size:13px;color:#444">有給手当：隔日 1出番 ${yen(perDay * 2)}円 ／ 日勤・夜勤 1出番 ${yen(perDay)}円</div>`;
          if (!direct && Math.abs(Pension.premiumOf(hyoujyun) - value) > 100)
            h += `<div style="font-size:13px;color:var(--orange)">⚠ この区分の厚生年金は ${yen(Pension.premiumOf(hyoujyun))}円です。金額を確認してください</div>`;
          res.innerHTML = h;
        } else res.innerHTML = value > 0 ? '<div style="font-size:13px;color:red">金額が正しくありません</div>' : '';
        sv.disabled = hyoujyun == null;
      };
      ov.querySelector('#pf').onclick = () => { from--; calc(); };
      ov.querySelector('#nf').onclick = () => { from++; calc(); };
      ov.querySelectorAll('input[name=pm]').forEach(r => r.addEventListener('change', () => { direct = r.value === '1'; inp.value = ''; calc(); }));
      inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 7); calc(); });
      sv.addEventListener('click', () => {
        if (hyoujyun == null) return;
        savePension({ from, hyoujyun, premium: direct ? null : Number(inp.value) });
        close();
      });
      calc();
    }
  });
}

// ===== 画面の切り替え（戻るジェスチャーで戻れるよう履歴を使う） =====
let salaryInput = null;
let savedScroll = 0;
function go(view) {
  if (view === currentView()) return;
  history.pushState({ v: view }, '', '#' + view);
  showView(view);
}
const currentView = () => !$('#salaryView').hidden ? 'salary' : !$('#settingView').hidden ? 'setting' : 'cal';
function showView(view) {
  const was = currentView();
  if (was === 'cal' && view !== 'cal') savedScroll = window.scrollY;
  $('#calView').hidden = view !== 'cal';
  $('#salaryView').hidden = view !== 'salary';
  $('#settingView').hidden = view !== 'setting';
  if (view === 'salary') { salaryState = null; renderSalary(); window.scrollTo(0, 0); }
  else if (view === 'setting') { renderSetting(); window.scrollTo(0, 0); }
  else { refreshAll(); window.scrollTo(0, savedScroll); }
}
window.addEventListener('popstate', () => {
  document.querySelectorAll('.ov').forEach(o => o.remove());
  const h = location.hash.slice(1);
  showView(h === 'salary' || h === 'setting' ? h : 'cal');
});
function back() { if (history.state && history.state.v) history.back(); else { history.replaceState(null, '', location.pathname); showView('cal'); } }
function rerenderView() { const v = currentView(); if (v === 'salary') renderSalaryDynamic(); else if (v === 'setting') renderSetting(); }

// ===== 給料計算 =====
let salaryState = null;
function salaryKind() {
  const src = salaryState.src;
  return !src.dailyNight ? 'kakujitsu' : data.settings.nikkin ? 'nikkin' : 'yakin';
}
function renderSalary() {
  const v = $('#salaryView');
  if (!salaryState) {
    let src = salaryInput;
    if (!src) { const next = ymNow() + 1; const m = ymM(next); src = { year: ymY(next), month: m, uriage: 0, koushutsu: 0, jyoumusu: 0, yuukyu: 0, noAbsence: true, sekinin: !(m === 1 || m === 5), dailyNight: false }; }
    salaryState = { src, uriage: String(src.uriage), koushutsu: String(src.koushutsu), jyoumusu: String(src.jyoumusu), yuukyu: String(src.yuukyu),
      noAbsence: src.noAbsence, payYm: YM(src.year, src.month), sekinin: src.sekinin };
  }
  const st = salaryState, dn = st.src.dailyNight, sekHi = dn ? 22 : 11, sekLo = dn ? 20 : 10;
  const numField = (id, label) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" class="inp" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(st[id])}"></div>`;
  const tg = (id, label, on) => `<label class="frow"><span class="lbl">${label}</span><input type="checkbox" class="tg" id="${id}" ${on ? 'checked' : ''}></label>`;
  v.innerHTML = `<div class="vbar"><button class="back" aria-label="戻る">←</button>給料明細書</div>
  <div class="vbody">
    <div class="card" id="salResult"></div>
    <div class="card">
      <h2>入力内容</h2>
      <div class="sub">カレンダーの集計値が入っています。必要なら直してください。</div>
      <div class="frow"><span class="lbl">給与年月</span><div class="stepper"><button id="pm">◀</button><span class="v" id="pymv"></span><button id="nm">▶</button></div></div>
      <div class="note">※2026年7月分から新賃率適用</div>
      <div class="frow"><span class="lbl">責任出番</span>
        <label class="radio"><input type="radio" name="sek" value="1">${sekHi}回</label><label class="radio"><input type="radio" name="sek" value="0">${sekLo}回</label></div>
      ${dn ? `<div class="frow"><span class="lbl">勤務区分</span>
        <label class="radio"><input type="radio" name="kbn" value="1" ${data.settings.nikkin ? 'checked' : ''}>日勤</label><label class="radio"><input type="radio" name="kbn" value="0" ${data.settings.nikkin ? '' : 'checked'}>夜勤</label></div>` : ''}
      ${numField('uriage', '営業収入（円）')}
      ${numField('koushutsu', '公出営収（円）')}
      <div class="note">※責任出番を超えた分の営収（65%が公出手当）</div>
      ${numField('jyoumusu', dn ? '乗務数' : '乗務数（公出除く）')}
      ${numField('yuukyu', '有給（出番）')}
      ${tg('noAbsence', '欠勤なし（精勤手当）', st.noAbsence)}
      ${tg('noAccident', '事故なし（無事故手当）', data.settings.noAccident)}
      ${tg('meeting', '明け集 出席・先月（教育手当）', data.settings.meeting)}
      <div class="pen" id="penSec"></div>
    </div>
    <div class="memo">
      ＊ 有給手当／1出番 ＝ 標準報酬月額 ÷ ${dn ? 30 : 15}（10円未満切捨て）<br>
      ＊ 標準報酬月額 ＝ 給与明細の厚生年金 ÷ 0.0915（毎年10月分の給料から変わります）<br>
      ＊ 新賃金は2026年7月分から適用
    </div>
    <div class="hrow">${dn ? '<button class="btn line" data-rt="nikkin">日勤歩率表</button><button class="btn line" data-rt="yakin">夜勤歩率表</button>' : '<button class="btn line" data-rt="kakujitsu">歩率表</button>'}</div>
  </div>`;
  v.querySelector('.back').onclick = back;
  for (const id of ['uriage', 'koushutsu', 'jyoumusu', 'yuukyu']) v.querySelector('#' + id).addEventListener('input', e => { st[id] = e.target.value; renderSalaryDynamic(); });
  v.querySelector('#pm').onclick = () => changeMonth(-1);
  v.querySelector('#nm').onclick = () => changeMonth(1);
  v.querySelectorAll('input[name=sek]').forEach(r => r.addEventListener('change', () => { st.sekinin = r.value === '1'; renderSalaryDynamic(); }));
  v.querySelectorAll('input[name=kbn]').forEach(r => r.addEventListener('change', () => { updateSettings(s => Object.assign(s, { nikkin: r.value === '1' })); renderSalaryDynamic(); }));
  v.querySelector('#noAbsence').addEventListener('change', e => { st.noAbsence = e.target.checked; renderSalaryDynamic(); });
  v.querySelector('#noAccident').addEventListener('change', e => { updateSettings(s => Object.assign(s, { noAccident: e.target.checked })); renderSalaryDynamic(); });
  v.querySelector('#meeting').addEventListener('change', e => { updateSettings(s => Object.assign(s, { meeting: e.target.checked })); renderSalaryDynamic(); });
  v.querySelectorAll('[data-rt]').forEach(b => b.addEventListener('click', () => rateTable(b.dataset.rt)));
  function changeMonth(delta) { st.payYm += delta; const m = ymM(st.payYm); st.sekinin = !(m === 1 || m === 5); renderSalaryDynamic(); }
  renderSalaryDynamic();
}
function renderSalaryDynamic() {
  const v = $('#salaryView'); if (v.hidden || !salaryState) return;
  const st = salaryState, s = data.settings, dn = st.src.dailyNight;
  const num = x => { const n = parseInt(String(x).replace(/,/g, '').trim(), 10); return Number.isFinite(n) ? n : 0; };
  const pension = Pension.entryFor(s.pensionHistory, st.payYm);
  const needReview = Pension.needsReview(s.pensionHistory, st.payYm, s.pensionConfirmed);
  const kind = salaryKind();
  const r = Salary.calc({ year: ymY(st.payYm), month: ymM(st.payYm), kind, uriage: num(st.uriage), koushutsu: num(st.koushutsu),
    jyoumusu: num(st.jyoumusu), yuukyu: num(st.yuukyu), noAbsence: st.noAbsence, noAccident: s.noAccident, meeting: s.meeting,
    hyoujyun: pension ? pension.hyoujyun : 0, sekinin: st.sekinin });
  const w = r.main;
  const badge = (t, bg, fg) => `<span class="badge" style="background:${bg};color:${fg}">${t}</span>`;
  const irow = (l, val) => `<div class="irow"><span>${l}</span><b>${val}</b></div>`;
  const d = r.diff, col = d > 0 ? '#2F855A' : d < 0 ? '#C53030' : 'gray', sg = d >= 0 ? '+' : '-';
  v.querySelector('#salResult').innerHTML =
    `<div class="hrow"><h2>${ymJp(st.payYm)}分給与</h2>` +
    (dn ? badge(kind === 'nikkin' ? '日勤' : '夜勤', '#FFF1DE', '#C2670A') : '') +
    badge(r.isNewWage ? '新賃金適用' : '旧賃金適用', r.isNewWage ? '#E7F7ED' : '#E8F3FC', r.isNewWage ? '#1F8A4C' : 'var(--blue)') + '</div>' +
    (r.note ? `<div style="color:#C53030;font-weight:700">${r.note}</div>` : '') +
    irow('本給・深夜手当・時間外手当', yen(w.honkyu) + '円') + irow('精勤手当', yen(w.seikin) + '円') + irow('無事故手当', yen(w.mujiko) + '円') +
    irow('通勤手当', yen(w.tsukin) + '円') + irow('教育手当', yen(w.kyouiku) + '円') + irow('公出手当（65%）', yen(w.koushutsuTeate) + '円') +
    irow('有給手当', yen(w.yuukyuTeate) + '円') + irow('歩率（手当除く）', w.rate.toFixed(2) + '%') +
    `<div class="total"><span>総支給額</span><span class="n">${yen(w.total)}円</span></div>` +
    `<div class="diff"><span>${r.isNewWage ? '旧賃金' : '新賃金'}との差額</span><b style="color:${col}">${sg}${yen(Math.abs(d))}円（${sg}${r.diffPct.toFixed(2)}%）</b></div>`;
  v.querySelector('#pymv').textContent = `${ymJp(st.payYm)}分`;
  v.querySelectorAll('input[name=sek]').forEach(x => { x.checked = (x.value === '1') === st.sekinin; });
  // 標準報酬月額
  const yk = num(st.yuukyu);
  let ph = `<div class="hrow" style="justify-content:space-between"><b style="font-size:14px">標準報酬月額（有給手当に使用）</b><button class="btn ghost" id="penEdit">${pension ? '変更' : '登録する'}</button></div>`;
  if (!pension) ph += `<div style="font-size:13px;color:${yk >= 1 ? 'red' : 'gray'};font-weight:${yk >= 1 ? 700 : 400}">${ymJp(st.payYm)}分に使う値が未登録です。給与明細の「厚生年金」の額を入れてください。</div>`;
  else {
    const perDay = Math.floor(pension.hyoujyun / 300) * 10;
    ph += `<div style="font-size:14px">${esc(pensionLabel(pension))}</div><div style="font-size:13px;color:#555">有給手当 1出番 ${yen(dn ? perDay : perDay * 2)}円</div>`;
  }
  if (needReview) ph += `<div class="warn">⚠ ${ymY(Pension.latestChangeMonth(st.payYm))}年10月分から標準報酬月額が変わっている可能性があります。給与明細の厚生年金の額を確認してください。
    <div class="hrow"><button class="btn ghost" id="penNew">新しい額を登録</button><button class="btn ghost" id="penSame">変わっていない</button></div></div>`;
  const ps = v.querySelector('#penSec'); ps.innerHTML = ph;
  const edit = () => pensionDialog(needReview || !pension ? Pension.latestChangeMonth(st.payYm) : pension.from);
  ps.querySelector('#penEdit').onclick = edit;
  if (needReview) {
    ps.querySelector('#penNew').onclick = edit;
    ps.querySelector('#penSame').onclick = () => { const y = ymY(Pension.latestChangeMonth(st.payYm)); updateSettings(s2 => Object.assign(s2, { pensionConfirmed: s2.pensionConfirmed.concat([y]) })); renderSalaryDynamic(); };
  }
}

/** 歩率表（プログラム内の表から作る） */
function rateTable(kind) {
  const nik = kind === 'nikkin';
  const tbl = nik ? Salary.RATES_NIKKIN : Salary.RATES_KAKUJITSU;
  const man = v => (v / 10000).toFixed(v % 10000 ? 2 : 0).replace(/0$/, '') + '万';
  let rows = '';
  tbl.forEach((rate, i) => {
    rows += `<tr><td>${man(330000 + i * 10000)}〜</td><td>${man(379500 + i * 11500)}〜</td><td>${rate.toFixed(2)}%</td></tr>`;
  });
  rows += nik ? `<tr><td>59万〜</td><td>67.85万〜</td><td>59.24%</td></tr><tr><td>599,990〜</td><td>689,989〜</td><td>59.50%</td></tr><tr><td>60万〜</td><td>69万〜</td><td>60.25%</td></tr>`
    : `<tr><td>90万〜</td><td>103.5万〜</td><td>${Salary.TOP_KAKUJITSU.toFixed(2)}%</td></tr>`;
  const title = nik ? '日勤歩率表' : kind === 'yakin' ? '夜勤歩率表' : '歩率表（隔日）';
  const low = nik ? `責任出番に届かない営収は旧52.00%。旧33万未満（責任10回で30万以上）・新37.95万未満は${Salary.RATES_NIKKIN[0].toFixed(2)}%`
    : '責任出番に届かない営収は旧52.00%。旧33万未満（責任10回で30万以上）・新37.95万未満は48.00%';
  openDialog({ title, body: `<div class="sub">${low}</div><div style="overflow-x:auto"><table class="rt"><tr><th>旧賃金 営収</th><th>新賃金 営収</th><th>歩率</th></tr>${rows}</table></div>`, buttons: [{ label: '閉じる', cls: '' }] });
}

// ===== 設定 =====
function renderSettingWeatherBtn() {
  const b = document.querySelector('#wxBtn'); if (!b) return;
  b.disabled = Weather.loading; b.textContent = Weather.loading ? '取得中…' : '今すぐ更新';
}
function renderSetting() {
  const v = $('#settingView'); if (v.hidden) return;
  const hire = data.hireDate;
  let grantInfo = '';
  if (hire) {
    const n = new Date(); const until = iso(n.getFullYear() + 1, n.getMonth() + 1, Math.min(n.getDate(), 28));
    const gs = PaidLeave.grants(hire, until).slice(-3);
    grantInfo = gs.length ? '付与日（直近）：' + gs.map(g => `${jpDate(g.date)} ${g.days}日`).join('、') : `初回付与日：${jpDate(PaidLeave.firstGrantDate(hire))}`;
  }
  const hist = data.settings.pensionHistory.slice().sort((a, b) => b.from - a.from);
  const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  v.innerHTML = `<div class="vbar"><button class="back" aria-label="戻る">←</button>設定</div>
  <div class="vbody">
    <div class="card" style="background:#F0FFF0"><h2>📅 入社年月日</h2>
      <div class="big">${hire ? jpDate(hire) : '未設定'}</div>
      <div class="hrow"><input type="date" id="hire" class="inp" style="max-width:220px" value="${hire || ''}" aria-label="入社年月日">${hire ? '<button class="btn ghost" id="hireClr">クリア</button>' : ''}</div>
      ${grantInfo ? `<div style="font-size:13px;color:#555">${grantInfo}</div>` : ''}
      <div style="font-size:13px;color:#666">※ 入社年月日を入れると、カレンダーの有給付与日に ㊒ が付き、有給残が計算されます。</div>
    </div>
    <div class="card" style="background:#FFFDF5"><h2>💴 標準報酬月額（有給手当の計算に使用）</h2>
      <div style="font-size:13px;color:#555">毎年9月に見直され、10月分の給料から変わります。給与明細の「厚生年金」の額を、変わった月ごとに登録してください。過去の月の給料は、その当時の値で計算されます。</div>
      ${hist.length ? '' : '<div style="color:gray">未登録</div>'}
      ${hist.map(e => `<div class="hrow" style="justify-content:space-between"><span style="font-size:14px;flex:1;min-width:0">${esc(pensionLabel(e))}</span><span><button class="btn ghost" data-pe="${e.from}">変更</button><button class="btn ghost danger" data-pd="${e.from}">削除</button></span></div>`).join('')}
      <div><button class="btn" id="penAdd">＋ 登録する</button></div>
    </div>
    <div class="card" style="background:#F0F8FF"><h2>💾 データのバックアップと復元</h2>
      <div style="font-size:14px">データはこのスマホのブラウザ内に保存されています。機種変更やブラウザのデータ消去に備えて、ときどきバックアップを保存してください。Android版・Web版（出番ですョ!）のバックアップファイルからも復元できます。</div>
      <button class="btn wide" id="exp" style="background:#2196F3">📥 バックアップを保存</button>
      <button class="btn wide" id="imp" style="background:#FF9800">📤 バックアップから復元</button>
      <div style="font-size:14px">${(() => { const m = backupMeta(); const c = inputCount(data);
        if (!m) return `最終バックアップ：<b style="color:#C53030">まだありません</b>（今のデータ ${c}件）`;
        const d = daysSince(m.date);
        return `最終バックアップ：<b style="color:${d >= REMIND_DAYS ? '#C53030' : 'inherit'}">${jpDate(m.date)}（${d === 0 ? '今日' : d + '日前'}）</b>　${m.count}件 → 今 ${c}件`; })()}</div>
      <div style="font-size:13px;color:#666">※ 復元しても今のデータは消えません。空いている日だけ、バックアップの内容を戻します。</div>
    </div>
    <div class="card"><h2>🌤 天気</h2>
      <div style="font-size:14px">Open-Meteo（気象庁モデル優先）。予報は8時間ごとに自動更新、過去は実際の天気を表示します。地点：中央区役所付近</div>
      <div><button class="btn line" id="wxBtn"></button></div>
    </div>
    ${standalone ? '' : `<div class="card" style="background:#FFF8E8"><h2>📱 ホーム画面に追加</h2>
      <div style="font-size:14px">Safariの共有ボタン（□↑）→「ホーム画面に追加」で、アプリのように全画面で使えます。ホーム画面から開くと、しばらく使わなくてもデータが消されにくくなります。</div></div>`}
    <div class="card" style="background:#F8F8FF"><h2>📖 使い方</h2><ul class="help">
      <li>日付をタップすると入力画面が開きます。営収（数字）か、ボタン（出・休・有給・欠勤・出変）で入力します。</li>
      <li>背景色：濃い紫＝営収入力済み、薄い赤＝有給、赤＝欠勤。</li>
      <li>赤枠：まだ残っている公出の日。</li>
      <li>隔日：2026年4月19日以降、公出が残っている月に有給を入れると「公出消」（公出の取消し）になり、有給残は減りません。公出がなく有給残もないと入力できません。欠勤は出番日にだけ入力できます。</li>
      <li>日勤・夜勤：空欄の平日は自動で「出」、土日祝は「休」が入ります。責任出番クリアの条件は 乗務回数＋有給取得数 ≧ 責任出番数（1月・5月は20回、他は22回）。</li>
      <li>締め期間は前月19日〜当月18日。カレンダーの &lt;18&gt; が締め日です。</li>
      <li>上の年月をタップすると、好きな年月へ移動できます。</li>
    </ul></div>
  </div>`;
  v.querySelector('.back').onclick = back;
  v.querySelector('#hire').addEventListener('change', e => { const d = parseDate(e.target.value); if (d) { update(Object.assign({}, data, { hireDate: d })); renderSetting(); } });
  const hc = v.querySelector('#hireClr'); if (hc) hc.onclick = () => { update(Object.assign({}, data, { hireDate: null })); renderSetting(); };
  v.querySelector('#penAdd').onclick = () => pensionDialog(Pension.latestChangeMonth(ymNow()));
  v.querySelectorAll('[data-pe]').forEach(b => b.onclick = () => pensionDialog(Number(b.dataset.pe)));
  v.querySelectorAll('[data-pd]').forEach(b => b.onclick = () => {
    const e = data.settings.pensionHistory.find(x => x.from === Number(b.dataset.pd));
    confirmDialog('削除しますか？', pensionLabel(e), '削除', () => { updateSettings(s => Object.assign(s, { pensionHistory: s.pensionHistory.filter(x => x.from !== e.from) })); renderSetting(); });
  });
  v.querySelector('#exp').onclick = exportBackup;
  v.querySelector('#imp').onclick = pickRestoreFile;
  v.querySelector('#wxBtn').onclick = () => Weather.refresh(true);
  renderSettingWeatherBtn();
}

// ===== バックアップの見張り（空のデータで保存しない・忘れたら知らせる） =====
const LS_BK = 'backup_meta';          // { date: 'YYYY-MM-DD', count: 件数 }
const LS_BK_SNOOZE = 'backup_snooze'; // 「あとで」を押した日
const LS_WELCOME = 'welcome_shown';
const REMIND_DAYS = 7;
/** 自分で入力した件数（日勤・夜勤で自動的に入る「出」「休」は数えない） */
function inputCount(d) {
  let n = 0;
  for (const v of Object.values(d.sales)) if (String(v).trim() !== '') n++;
  for (const [k, v] of Object.entries(d.dailyNight)) if (String(v).trim() !== '' && v !== Shift.dailyNightDefault(k)) n++;
  return n;
}
function backupMeta() { try { return JSON.parse(lsGet(LS_BK) || 'null'); } catch (e) { return null; } }
function daysSince(isoDate) { return toEpoch(todayIso()) - toEpoch(isoDate); }
function markBackedUp(count) { lsSet(LS_BK, JSON.stringify({ date: todayIso(), count })); }

/** 保存の前の確認。問題なければそのまま保存する */
function exportBackup() {
  const count = inputCount(data);
  const meta = backupMeta();
  if (count === 0) {
    openDialog({
      title: 'データがありません',
      body: '<div>このブラウザには、まだ営収などの入力がありません。このまま保存すると<b>空のバックアップ</b>になります。</div>' +
        '<div style="margin-top:8px">以前のデータがある場合は、先に「バックアップから復元」をしてください。</div>',
      buttons: [{ label: 'やめる', cls: '' }, { label: '空のまま保存', cls: 'ghost danger', onClick: () => { doExport(count); } }]
    });
    return;
  }
  if (meta && meta.count >= 10 && count < meta.count / 2) {
    openDialog({
      title: '件数が大きく減っています',
      body: `<div>前回のバックアップ（${jpDate(meta.date)}）：<b>${meta.count}件</b><br>今のデータ：<b>${count}件</b></div>` +
        '<div style="margin-top:8px">データが消えている可能性があります。前回のバックアップファイルを残したまま、別のファイルとして保存しますか？</div>',
      buttons: [{ label: 'やめる', cls: '' }, { label: '保存する', cls: 'ghost', onClick: () => { doExport(count); } }]
    });
    return;
  }
  doExport(count);
}
function doExport(count) {
  const json = Backup.export(data);
  const name = 'taxiSales_' + todayIso().replace(/-/g, '') + '.json';
  const file = new File([json], name, { type: 'application/json' });
  // iPhone は共有シートから「ファイルに保存」できる
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|iPod|Android/.test(navigator.userAgent)) {
    navigator.share({ files: [file], title: name })
      .then(() => { markBackedUp(count); toast('バックアップを保存しました ✅'); renderSetting(); })
      .catch(e => { if (e && e.name !== 'AbortError') downloadFile(file, count); });
    return;
  }
  downloadFile(file, count);
}
function downloadFile(file, count) {
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    markBackedUp(count);
    toast('バックアップを保存しました ✅');
    renderSetting();
  } catch (e) { toast('バックアップに失敗しました ❌'); }
}
function importBackup(file) {
  const rd = new FileReader();
  rd.onerror = () => toast('ファイルを読み込めませんでした ❌');
  rd.onload = () => {
    try {
      const r = Backup.import(data, String(rd.result));
      update(r.data);
      fillDailyNightDefaults();
      toast(`復元しました ✅ 戻した件数：${r.written}件（入力済みのため残した件数：${r.skipped}件）`);
      renderSetting();
    } catch (e) { toast('バックアップファイルの形式が正しくありません ❌'); }
  };
  rd.readAsText(file, 'utf-8');
}


// 復元用のファイル選択（起動時の案内からも使う）
const restoreInput = document.createElement('input');
restoreInput.type = 'file'; restoreInput.accept = '.json,application/json,text/plain'; restoreInput.hidden = true;
document.body.appendChild(restoreInput);
restoreInput.addEventListener('change', () => {
  const file = restoreInput.files && restoreInput.files[0]; if (!file) return;
  confirmDialog('バックアップから復元しますか？', '今のデータは消えません。空いている日だけ、バックアップの内容を戻します。', '復元する', () => importBackup(file));
});
function pickRestoreFile() { restoreInput.value = ''; restoreInput.click(); }

/** 起動時の案内：初めてなら復元の案内、データがあってバックアップが古ければ保存の案内 */
function backupCheck() {
  if (document.querySelector('.ov') || currentView() !== 'cal') return;
  const count = inputCount(data);
  if (count === 0) {
    if (lsGet(LS_WELCOME)) return;
    lsSet(LS_WELCOME, '1');
    openDialog({
      title: 'はじめに',
      body: '<div>以前に使っていたスマホやブラウザのデータがある場合は、先に<b>バックアップから復元</b>してください。</div>' +
        '<div style="margin-top:8px;font-size:13px;color:#666">あとからでも ⚙設定 →「バックアップから復元」でできます。</div>',
      buttons: [{ label: '新しく始める' }, { label: '復元する', cls: '', onClick: () => { pickRestoreFile(); } }]
    });
    return;
  }
  const meta = backupMeta();
  const days = meta ? daysSince(meta.date) : null;
  if (meta && days < REMIND_DAYS) return;
  if (lsGet(LS_BK_SNOOZE) === todayIso()) return;
  const msg = meta
    ? `前回のバックアップから<b>${days}日</b>たちました（${jpDate(meta.date)}・${meta.count}件）。`
    : 'まだ一度もバックアップしていません。';
  openDialog({
    title: 'バックアップのお願い',
    body: `<div>${msg}</div><div style="margin-top:8px">スマホの故障や機種変更でデータが消えないよう、保存しておきましょう。iPhoneは「"ファイル"に保存」→ iCloud Drive、Androidは Googleドライブ がおすすめです。</div>`,
    buttons: [{ label: 'あとで', onClick: () => { lsSet(LS_BK_SNOOZE, todayIso()); } }, { label: '今すぐ保存', cls: '', onClick: () => { exportBackup(); } }]
  });
}

// ===== 端末の文字サイズ設定の打ち消し（カレンダー部分だけ。Android版の FixedFontScale と同じ考え方） =====
// 実際に表示された文字の幅と、文字サイズ設定の影響を受けない canvas で測った幅を比べて倍率を求める
function fixFontScale() {
  try {
    const fam = getComputedStyle(document.body).fontFamily;
    const txt = '0123456789日月火水木金土年';
    const sp = document.createElement('span');
    sp.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:400 40px ${fam};`;
    sp.textContent = txt; document.body.appendChild(sp);
    const dom = sp.getBoundingClientRect().width; sp.remove();
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `400 40px ${fam}`;
    const ref = ctx.measureText(txt).width;
    if (!(dom > 0 && ref > 0)) return;
    const ratio = dom / ref;
    const k = ratio > 1.04 ? 1 / ratio : 1;   // 大きくなっているときだけ縮める
    document.documentElement.style.setProperty('--k', k.toFixed(3));
  } catch (e) { /* 測れなければそのまま */ }
}
fixFontScale();
window.addEventListener('resize', fixFontScale);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fixFontScale(); });

// ===== 起動 =====
(function start() {
  Weather.loadCached();
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  fillDailyNightDefaults();
  renderHeader();
  buildRange(curYm);
  setTitle(curYm);
  requestAnimationFrame(() => { scrollToMonth(curYm); setTitle(curYm); });
  Weather.refresh(false);
  setTimeout(backupCheck, 800);
  // 日付が変わったら「今日」の印を付け直す
  let lastDay = todayIso();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (todayIso() !== lastDay) { lastDay = todayIso(); ledgerCache = null; if (!calHidden()) refreshMonths(); }
    Weather.refresh(false);
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
