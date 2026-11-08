/* 出番ですョ!  計算ロジック（Android版 logic/*.kt の移植）
 * 日付は "YYYY-MM-DD" の文字列、締め月などの年月は 年*12+(月-1) の整数で扱う。 */
'use strict';

// ===== 日付の道具 =====
const DAY_MS = 86400000;
const pad2 = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const toEpoch = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); };
const fromEpoch = e => { const t = new Date(e * DAY_MS); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
const addDays = (s, n) => fromEpoch(toEpoch(s) + n);
const dParts = s => s.split('-').map(Number);
const dYear = s => +s.slice(0, 4), dMonth = s => +s.slice(5, 7), dDay = s => +s.slice(8, 10);
const dow = s => new Date(toEpoch(s) * DAY_MS).getUTCDay();   // 0=日
const todayIso = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth() + 1, n.getDate()); };
function parseDate(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return fromEpoch(toEpoch(t)) === t ? t : null;   // 2月30日などは不正
}
// 年月
const YM = (y, m) => y * 12 + (m - 1);
const ymY = ym => Math.floor(ym / 12), ymM = ym => ym - ymY(ym) * 12 + 1;
const ymOf = s => YM(dYear(s), dMonth(s));
const ymNow = () => ymOf(todayIso());
const atDay = (ym, d) => iso(ymY(ym), ymM(ym), d);
const monthLen = ym => new Date(Date.UTC(ymY(ym), ymM(ym), 0)).getUTCDate();
const atEnd = ym => atDay(ym, monthLen(ym));
const ymStr = ym => `${ymY(ym)}-${pad2(ymM(ym))}`;
const parseYm = s => { const m = /^(\d{4})-(\d{2})$/.exec(String(s || '').trim()); return m && +m[2] >= 1 && +m[2] <= 12 ? YM(+m[1], +m[2]) : null; };
const floorMod = (a, n) => ((a % n) + n) % n;

// ===== 営収欄の値（Values.kt）=====
const Values = {
  ALLOWED_WORDS: new Set(['出', '休', '休み', '出変', '有給', '有休', '欠勤', '公出消', '公消']),
  MAX_DIGITS: 6,
  norm: v => String(v).trim().replace(/\s+/g, '').toLowerCase(),
  numberOrNull(v) {
    const t = String(v).trim();
    if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
    const d = Number(t); return Number.isFinite(d) ? d : null;
  },
  isRevenue: v => (Values.numberOrNull(v) ?? 0) > 0,
  revenue: v => Math.round(Values.numberOrNull(v) ?? 0),
  isWork: v => Values.norm(v) === '出',
  isPaid: v => { const n = Values.norm(v); return n === '有給' || n === '有休'; },
  isAbsent: v => Values.norm(v) === '欠勤',
  /** 入力値を検証して保存用の文字列を返す。不正なら null */
  normalizeInput(raw) {
    const t = String(raw).trim();
    if (t === '') return '';
    const n = Values.norm(t);
    if (Values.ALLOWED_WORDS.has(n)) return (n === '公出消' || n === '公消') ? '有給' : n;
    const half = t.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 48)).replace(/[、，,]/g, '');
    if (!new RegExp(`^\\d{1,${Values.MAX_DIGITS}}$`).test(half)) return null;
    return String(parseInt(half, 10));
  }
};

// ===== 祝日（Holidays.kt）=====
const Holidays = {
  cache: new Map(),
  nameOf(d) { return Holidays.forYear(dYear(d)).get(d) || null; },
  isHoliday(d) { return Holidays.nameOf(d) !== null; },
  forYear(y) { if (!Holidays.cache.has(y)) Holidays.cache.set(y, Holidays.generate(y)); return Holidays.cache.get(y); },
  happyMonday(y, m, nth) {
    const wday = dow(iso(y, m, 1));
    const offset = (8 - wday) % 7;
    return iso(y, m, 1 + offset + 7 * (nth - 1));
  },
  generate(y) {
    const h = new Map();
    const add = (m, d, name) => h.set(iso(y, m, d), name);
    add(1, 1, '元日'); add(2, 11, '建国記念の日'); add(2, 23, '天皇誕生日'); add(4, 29, '昭和の日');
    add(5, 3, '憲法記念日'); add(5, 4, 'みどりの日'); add(5, 5, 'こどもの日'); add(8, 11, '山の日');
    add(11, 3, '文化の日'); add(11, 23, '勤労感謝の日');
    h.set(Holidays.happyMonday(y, 1, 2), '成人の日');
    h.set(Holidays.happyMonday(y, 7, 3), '海の日');
    h.set(Holidays.happyMonday(y, 9, 3), '敬老の日');
    h.set(Holidays.happyMonday(y, 10, 2), 'スポーツの日');
    const k = y - 1980;
    add(3, Math.trunc(20.8431 + 0.242194 * k) - Math.trunc(k / 4), '春分の日');
    add(9, Math.trunc(23.2488 + 0.242194 * k) - Math.trunc(k / 4), '秋分の日');
    // 振替休日
    for (const [d, name] of [...h.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      if (dow(d) === 0) {
        let next = addDays(d, 1);
        while (h.has(next)) next = addDays(next, 1);
        h.set(next, name + 'の振替休日');
      }
    }
    // 国民の休日
    for (const d of [...h.keys()].sort()) {
      const next = addDays(d, 1), next2 = addDays(d, 2);
      if (h.has(next2) && !h.has(next)) { const w = dow(next); if (w !== 0 && w !== 6) h.set(next, '国民の休日'); }
    }
    return h;
  }
};

// ===== 出番・当番・締め期間（Shift.kt）=====
const DAILY_NIGHT = 'daily_night';
const Shift = {
  START: '2025-01-01',
  DUTY_PATTERNS: ['1-4', '2-5', '1-3', '2-4', '3-5'],
  NEW_RULE_DATE: '2026-04-19',
  PATTERN_KEYS: [DAILY_NIGHT, '1', '2', '3', '4', '5', '1-3', '2-4', '3-5', '1-4', '2-5'],
  PATTERN_LABELS: {
    [DAILY_NIGHT]: '日勤・夜勤', '1': '1班', '2': '2班', '3': '3班', '4': '4班', '5': '5班',
    '1-3': '1-3班', '2-4': '2-4班', '3-5': '3-5班', '1-4': '1-4班', '2-5': '2-5班'
  },
  PATTERN_COLORS: {
    [DAILY_NIGHT]: '#FFE4B5', '1': '#FFCCFF', '2': '#E2CCFF', '3': '#CCFAFF', '4': '#DBFFE2', '5': '#FAFFCE',
    '1-3': '#FFDBFB', '2-4': '#E5CCFF', '3-5': '#87CEFA', '1-4': '#DBFFE2', '2-5': '#FAFFCE'
  },
  daysFromStart: d => toEpoch(d) - toEpoch(Shift.START),
  workingDrivers: d => Shift.DUTY_PATTERNS[floorMod(Shift.daysFromStart(d) + 3, 5)],
  isShiftDay(d, pattern) {
    if (pattern === DAILY_NIGHT) return false;
    const w = Shift.workingDrivers(d);
    return pattern.length === 1 ? w.includes(pattern) : w === pattern;
  },
  dutyOfficer(d) {
    let o = d >= '2025-09-14' ? ['大久保', '🗻', '🀄'] : d >= '2025-06-01' ? ['大久保', '村加', '🀄'] : ['大久保', '村加', '金沢'];
    if (d >= '2026-04-24') o = o.map(x => x === '大久保' ? '🚕' : x);
    return o[floorMod(Shift.daysFromStart(d), 3)];
  },
  periodStart: ym => atDay(ym - 1, 19),
  periodEnd: ym => atDay(ym, 18),
  periodMonthOf: d => dDay(d) >= 19 ? ymOf(d) + 1 : ymOf(d),
  baseLimit(month, dailyNight) {
    const short = month === 1 || month === 5;
    return dailyNight ? (short ? 20 : 22) : (short ? 10 : 11);
  },
  isNewRulePeriod: ym => Shift.periodEnd(ym) >= Shift.NEW_RULE_DATE,
  datesOf(ym) {
    const out = []; let d = Shift.periodStart(ym); const e = Shift.periodEnd(ym);
    while (d <= e) { out.push(d); d = addDays(d, 1); }
    return out;
  },
  shiftDaysInPeriod: (ym, p) => Shift.datesOf(ym).filter(d => Shift.isShiftDay(d, p)),
  dailyNightDefault(d) {
    const w = dow(d);
    return (w !== 0 && w !== 6 && !Holidays.isHoliday(d)) ? '出' : '休';
  }
};

// ===== 有給（PaidLeave.kt）=====
const PaidLeave = {
  TABLE: [10, 11, 12, 14, 16, 18, 20],
  MAX_GRANT: 20,
  daysFor: i => i < PaidLeave.TABLE.length ? PaidLeave.TABLE[i] : PaidLeave.MAX_GRANT,
  firstGrantDate(hire) {
    const base = addDays(atDay(ymOf(hire) + 6, 1), dDay(hire) - 1);
    return dDay(base) >= 19 ? atDay(ymOf(base) + 1, 18) : atDay(ymOf(base), 18);
  },
  grantDate(hire, i) { const f = PaidLeave.firstGrantDate(hire); return iso(dYear(f) + i, dMonth(f), 18); },
  grants(hire, until) {
    const out = [];
    for (let i = 0; i <= 100; i++) {
      const d = PaidLeave.grantDate(hire, i);
      if (d > until) break;
      out.push({ date: d, days: PaidLeave.daysFor(i), index: i, expire: addDays(PaidLeave.grantDate(hire, i + 2), -1) });
    }
    return out;
  },
  simulate(hire, until, usage, daysPerShift, onGrant) {
    const gs = PaidLeave.grants(hire, until);
    if (gs.length === 0) return null;
    let buckets = [];
    gs.forEach((g, i) => {
      buckets = buckets.filter(b => b.expire >= g.date);
      buckets.push({ days: Math.min(g.days, PaidLeave.MAX_GRANT), expire: g.expire });
      if (onGrant) onGrant(g, buckets.reduce((s, b) => s + b.days, 0));
      const next = i + 1 < gs.length ? gs[i + 1].date : null;
      const used = usage.filter(u => u >= g.date && (next !== null ? u < next : u <= until)).length;
      let usedDays = used * daysPerShift;
      for (const b of buckets) {
        if (usedDays <= 0) break;
        const c = Math.min(b.days, usedDays); b.days -= c; usedDays -= c;
      }
      buckets = buckets.filter(b => b.days > 0);
    });
    return buckets.reduce((s, b) => s + b.days, 0);
  },
  remaining(hire, asOf, usage, dps) {
    const days = PaidLeave.simulate(hire, asOf, usage, dps);
    return days === null ? null : { days, shifts: Math.floor(days / dps) };
  },
  grantMarks(hire, until, usage, dps) {
    const out = new Map();
    PaidLeave.simulate(hire, until, usage, dps, (g, total) => out.set(g.date, { days: g.days, cumulative: total, remainingShifts: Math.floor(total / dps) }));
    return out;
  }
};

// ===== 月の集計・公出・有給チェック（Ledger.kt）=====
class Ledger {
  /** store: { "YYYY-MM-DD": "35000" | "出" | "有給" ... } */
  constructor(store, pattern, hireDate) {
    this.store = store; this.pattern = pattern; this.hireDate = hireDate || null;
    this.dailyNight = pattern === DAILY_NIGHT;
    this.dps = this.dailyNight ? 1 : 2;
    this._consumed = new Map(); this._red = new Map(); this._summary = new Map();
    this._usage = null; this._marks = null;
  }
  valuesIn(ym) {
    const s = Shift.periodStart(ym), e = Shift.periodEnd(ym);
    return Object.entries(this.store).filter(([k, v]) => k >= s && k <= e && String(v).trim() !== '').sort((a, b) => a[0] < b[0] ? -1 : 1);
  }
  initialExtra(ym) { return Math.max(0, Shift.shiftDaysInPeriod(ym, this.pattern).length - Shift.baseLimit(ymM(ym), false)); }

  /** 日勤・夜勤の公出の数：（出番＋有給＋欠勤の日）が責任出番を超えた分。有給・欠勤の日も、もともと出番だった日として数える */
  dailyNightInitialExtra(ym) {
    const vs = this.valuesIn(ym);
    const days = vs.filter(x => Values.isRevenue(x[1]) || Values.isWork(x[1]) || Values.isPaid(x[1]) || Values.isAbsent(x[1])).length;
    return Math.max(0, days - Shift.baseLimit(ymM(ym), true));
  }
  /** 公出消化扱いの有給（隔日は2026/4/19以降、日勤・夜勤は全期間）。欠勤が先に公出を消し、残った公出の数だけ日付の早い有給から公出消になる */
  consumedPaidIn(ym) {
    if (this._consumed.has(ym)) return this._consumed.get(ym);
    let r = new Set();
    if (this.dailyNight) {
      const vs = this.valuesIn(ym);
      const slot = Math.max(0, this.dailyNightInitialExtra(ym) - vs.filter(x => Values.isAbsent(x[1])).length);
      r = new Set(vs.filter(x => Values.isPaid(x[1])).slice(0, slot).map(x => x[0]));
    } else if (Shift.isNewRulePeriod(ym)) {
      const vs = this.valuesIn(ym);
      const slot = Math.max(0, this.initialExtra(ym) - vs.filter(x => Values.isAbsent(x[1])).length);
      r = new Set(vs.filter(x => Values.isPaid(x[1])).slice(0, slot).map(x => x[0]));
    }
    this._consumed.set(ym, r); return r;
  }
  isConsumed(d) { return this.consumedPaidIn(Shift.periodMonthOf(d)).has(d); }
  paidUsage() {
    if (!this._usage) this._usage = Object.entries(this.store).filter(([k, v]) => Values.isPaid(v) && !this.isConsumed(k)).map(x => x[0]).sort();
    return this._usage;
  }
  paidRemaining(asOf) { return this.hireDate ? PaidLeave.remaining(this.hireDate, asOf, this.paidUsage(), this.dps) : null; }
  get allGrantMarks() {
    if (!this._marks) {
      const n = new Date(); const until = iso(n.getFullYear() + 3, n.getMonth() + 1, Math.min(n.getDate(), 28));
      this._marks = this.hireDate ? PaidLeave.grantMarks(this.hireDate, until, this.paidUsage(), this.dps) : new Map();
    }
    return this._marks;
  }
  displayValue(d) {
    const v = this.store[d];
    if (v === undefined) return '';
    return Values.isPaid(v) && this.isConsumed(d) ? '公出消' : v;
  }
  /** 赤枠（残っている公出の日） */
  publicDutyDates(ym) {
    if (this._red.has(ym)) return this._red.get(ym);
    let r;
    if (this.dailyNight) r = this.summary(ym).extraDates;
    else {
      const shiftDays = Shift.shiftDaysInPeriod(ym, this.pattern);
      const initial = this.initialExtra(ym);
      const newRule = Shift.isNewRulePeriod(ym);
      const vs = this.valuesIn(ym);
      const absent = vs.filter(x => Values.isAbsent(x[1])).length;
      const consumed = this.consumedPaidIn(ym);
      const paid = vs.filter(x => Values.isPaid(x[1]) && (!newRule || consumed.has(x[0]))).length;
      const extra = initial - Math.min(absent + paid, initial);
      r = new Set(shiftDays.slice().sort().reverse().slice(0, extra));
    }
    this._red.set(ym, r); return r;
  }
  summary(ym) {
    if (!this._summary.has(ym)) this._summary.set(ym, this.dailyNight ? this.dailyNightSummary(ym) : this.shiftSummary(ym));
    return this._summary.get(ym);
  }
  shiftSummary(ym) {
    const month = ymM(ym), base = Shift.baseLimit(month, false);
    const total = Shift.shiftDaysInPeriod(ym, this.pattern).length;
    const vs = this.valuesIn(ym);
    const consumed = this.consumedPaidIn(ym);
    const records = vs.filter(x => Values.isRevenue(x[1])).sort((a, b) => a[0] < b[0] ? 1 : -1);
    const scheduled = vs.filter(x => Values.isWork(x[1])).length;
    const paidAll = vs.filter(x => Values.isPaid(x[1]));
    const consumedPaid = paidAll.filter(x => consumed.has(x[0])).length;
    const paid = paidAll.length - consumedPaid;
    const absent = vs.filter(x => Values.isAbsent(x[1])).length;
    const extraCount = Math.max(0, records.length - base);
    let baseRev = 0, extraRev = 0, baseCount = 0;
    records.forEach((r, i) => { if (i < extraCount) extraRev += Values.revenue(r[1]); else { baseRev += Values.revenue(r[1]); baseCount++; } });
    const baseShifts = Math.max(0, records.length + scheduled - extraCount);
    return {
      ym, dailyNight: false, periodStart: Shift.periodStart(ym), periodEnd: Shift.periodEnd(ym), base,
      shiftTotal: total, shiftBase: Math.min(total, base), shiftExtra: Math.max(0, total - base),
      baseRevenue: baseRev, extraRevenue: extraRev, totalRevenue: baseRev + extraRev,
      baseShifts, extraCount, absent, paid, consumedPaid, remainingToClear: base - (baseShifts + paid),
      scheduledWork: scheduled, actualWork: records.length,
      paidRemaining: this.paidRemaining(Shift.periodEnd(ym)), hasHireDate: !!this.hireDate, extraDates: new Set(),
      salary: { year: ymY(ym), month, uriage: baseRev, koushutsu: extraRev, jyoumusu: baseCount, yuukyu: paid,
        noAbsence: baseShifts + paid >= base, sekinin: !(month === 1 || month === 5), dailyNight: false }
    };
  }
  dailyNightSummary(ym) {
    const month = ymM(ym), base = Shift.baseLimit(month, true);
    let wd = 0, hol = 0, sat = 0, sun = 0;
    for (const d of Shift.datesOf(ym)) {
      const w = dow(d);
      if (w === 0) sun++; else if (w === 6) sat++; else { wd++; if (Holidays.isHoliday(d)) hol++; }
    }
    const vs = this.valuesIn(ym);
    const records = vs.filter(x => Values.isRevenue(x[1]));
    const scheduledList = vs.filter(x => Values.isWork(x[1]));
    const consumed = this.consumedPaidIn(ym);
    const paidAll = vs.filter(x => Values.isPaid(x[1]));
    const consumedPaid = paidAll.filter(x => consumed.has(x[0])).length;
    const paid = paidAll.length - consumedPaid;   // 公出消の分は有給に数えない
    const absent = vs.filter(x => Values.isAbsent(x[1])).length;
    const all = records.map(x => [x[0], Values.revenue(x[1])]).concat(scheduledList.map(x => [x[0], 0]))
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const extraDays = Math.max(0, all.length - base);
    let baseRev = 0, extraRev = 0, baseCount = 0, actualExtra = 0;
    const extraDates = new Set();
    all.forEach(([d, v], i) => {
      if (i >= base) { extraDates.add(d); if (v > 0) { extraRev += v; actualExtra++; } }
      else if (v > 0) { baseRev += v; baseCount++; }
    });
    const scheduledExtra = Math.max(0, extraDays - actualExtra);
    const current = records.length + paid;
    const planned = scheduledList.length + records.length + paid;
    return {
      ym, dailyNight: true, periodStart: Shift.periodStart(ym), periodEnd: Shift.periodEnd(ym), base,
      weekdays: wd, weekdayHolidays: hol, saturdays: sat, sundays: sun,
      baseRevenue: baseRev, extraRevenue: extraRev, totalRevenue: baseRev + extraRev,
      extraCount: extraDays, absent, paid, consumedPaid, remainingToClear: base - current,
      scheduledWork: scheduledList.length, actualWork: records.length,
      scheduledBase: Math.max(0, scheduledList.length - scheduledExtra), scheduledExtra, actualExtra,
      shortage: Math.max(0, base - planned),
      paidRemaining: this.paidRemaining(Shift.periodEnd(ym)), hasHireDate: !!this.hireDate, extraDates,
      salary: { year: ymY(ym), month, uriage: baseRev, koushutsu: extraRev, jyoumusu: baseCount, yuukyu: paid,
        noAbsence: current >= base, sekinin: !(month === 1 || month === 5), dailyNight: true }
    };
  }
  /** 有給を入れるときの判定 → {type:'normal'|'consumed'|'blocked', reason} */
  checkPaid(d) {
    const ym = Shift.periodMonthOf(d);
    if (this.dailyNight) {
      // その日に有給を入れたと仮定して、公出消になるかを見る
      const trial = Object.assign({}, this.store); trial[d] = '有給';
      if (new Ledger(trial, this.pattern, this.hireDate).isConsumed(d)) return { type: 'consumed' };
      return this.checkRemaining(d, ym);
    }
    if (d < Shift.NEW_RULE_DATE) return { type: 'normal' };
    const used = this.valuesIn(ym).filter(x => x[0] !== d && (Values.isPaid(x[1]) || Values.isAbsent(x[1]))).length;
    if (this.initialExtra(ym) - used > 0) return { type: 'consumed' };
    return this.checkRemaining(d, ym);
  }
  /** 普通の有給として入れられるか（有給残が1出番以上あるか） */
  checkRemaining(d, ym) {
    if (!this.hireDate) return { type: 'blocked', reason: '入社年月日が未入力のため有給残を確認できません。設定画面で入社年月日を入力してください。' };
    const without = Object.assign({}, this.store); delete without[d];
    const rem = new Ledger(without, this.pattern, this.hireDate).paidRemaining(Shift.periodEnd(ym));
    if (!rem || rem.shifts < 1) return { type: 'blocked', reason: '有給残がありません。' };
    return { type: 'normal' };
  }
}

// ===== 給料計算（Salary.kt）=====
const Salary = {
  RATES_KAKUJITSU: [
    48.00, 48.50, 49.00, 49.50, 50.00, 50.50, 51.00, 52.00, 52.54, 52.83,
    53.11, 53.38, 53.64, 53.88, 54.11, 54.34, 54.56, 54.78, 54.82, 55.06,
    55.30, 55.53, 55.76, 55.99, 56.21, 56.54, 56.65, 56.86, 57.02, 57.20,
    57.37, 57.54, 57.71, 57.88, 58.04, 58.20, 58.36, 58.52, 58.68, 58.84,
    59.09, 59.64, 59.80, 59.95, 60.09, 60.24, 60.39, 60.43, 60.48, 60.52,
    60.56, 60.60, 60.64, 60.68, 60.72, 60.76, 60.80],
  TOP_KAKUJITSU: 60.84,
  RATES_NIKKIN: [
    50.07, 50.50, 50.94, 51.38, 51.81, 52.25, 52.69, 53.38, 53.63, 53.89,
    54.14, 54.39, 54.50, 55.00, 55.50, 56.00, 56.50, 57.00, 57.11, 57.23,
    57.34, 57.46, 58.16, 58.43, 58.70, 58.97],
  isNewWage: (y, m) => y > 2026 || (y === 2026 && m >= 7),
  stepRate(u, start, step, table) { if (u < start) return null; const i = Math.floor((u - start) / step); return i < table.length ? table[i] : null; },
  oldRate(kind, u, sekinin) {
    if (u < (sekinin ? 330000 : 300000)) return 52.00;
    if (kind !== 'nikkin') {
      if (u < 330000) return 48.00;
      if (u >= 900000) return Salary.TOP_KAKUJITSU;
      return Salary.stepRate(u, 330000, 10000, Salary.RATES_KAKUJITSU);
    }
    if (u < 330000) return Salary.RATES_NIKKIN[0];
    if (u >= 600000) return 60.25;
    if (u >= 599990) return 59.50;
    if (u >= 590000) return 59.24;
    return Salary.stepRate(u, 330000, 10000, Salary.RATES_NIKKIN);
  },
  newRate(kind, u) {
    if (kind !== 'nikkin') {
      if (u < 379500) return 48.00;
      if (u >= 1035000) return Salary.TOP_KAKUJITSU;
      return Salary.stepRate(u, 379500, 11500, Salary.RATES_KAKUJITSU);
    }
    if (u < 379500) return Salary.RATES_NIKKIN[0];
    if (u >= 690000) return 60.25;
    if (u >= 689989) return 59.50;
    if (u >= 678500) return 59.24;
    return Salary.stepRate(u, 379500, 11500, Salary.RATES_NIKKIN);
  },
  round: x => Math.floor(x + 0.5),
  koushutsuTeate: (kind, k) => kind === 'kakujitsu' ? Salary.round(k * 0.65) : Math.ceil(k * 0.65),
  yuukyuTeate: p => p.yuukyu * (p.kind === 'kakujitsu' ? 2 : 1) * Math.floor(p.hyoujyun / 300) * 10,
  /** 責任出番の回数（隔日勤務 11/10回、日勤・夜勤 22/20回） */
  sekininCount: p => p.kind === 'kakujitsu' ? (p.sekinin ? 11 : 10) : (p.sekinin ? 22 : 20),
  /** 責任出番をクリアしたか（乗務数＋有給） */
  sekininCleared: p => (p.jyoumusu + p.yuukyu) >= Salary.sekininCount(p),
  tsukin: p => Math.min(p.jyoumusu * (p.kind === 'kakujitsu' ? 500 : 250), p.sekinin ? 5500 : 5000),
  wage(p, isNew) {
    const rate = isNew ? Salary.newRate(p.kind, p.uriage) : Salary.oldRate(p.kind, p.uriage, p.sekinin);
    const ok = p.uriage >= (isNew ? (p.sekinin ? 379500 : 345000) : (p.sekinin ? 330000 : 300000));
    const w = {
      honkyu: Salary.round(p.uriage * rate / 100),
      seikin: ok && p.noAbsence ? 10000 : 0,
      mujiko: ok && p.noAccident ? (isNew ? 8100 : 5000) : 0,   // 責任出番に届かない月は画面側でチェックを外す（手で入れ直すこともできる）
      tsukin: ok ? Salary.tsukin(p) : 0,
      kyouiku: p.meeting ? 2000 : 0,
      koushutsuTeate: Salary.koushutsuTeate(p.kind, p.koushutsu),
      yuukyuTeate: Salary.yuukyuTeate(p),
      rate
    };
    w.total = w.honkyu + w.seikin + w.mujiko + w.tsukin + w.kyouiku + w.koushutsuTeate + w.yuukyuTeate;
    return w;
  },
  /** p: {year, month, kind:'kakujitsu'|'nikkin'|'yakin', uriage, koushutsu, jyoumusu, yuukyu, noAbsence, noAccident, meeting, hyoujyun, sekinin} */
  calc(p) {
    const isNew = Salary.isNewWage(p.year, p.month);
    const o = Salary.wage(p, false), n = Salary.wage(p, true);
    const note = (!isNew && p.kind !== 'nikkin' && p.uriage >= 510000 && p.uriage < 520000) ? '歩率表に誤りあり（54.90% → 54.82%）' : null;
    const main = isNew ? n : o, compare = isNew ? o : n;
    const diff = main.total - compare.total;
    const diffPct = compare.total !== 0 ? Math.abs(diff) / Math.abs(compare.total) * 100 : 0;
    return { isNewWage: isNew, main, compare, note, diff, diffPct };
  }
};

// ===== 厚生年金の標準報酬月額（Pension.kt）=====
// 履歴: [{ from: ym(整数), hyoujyun, premium|null }]
const Pension = {
  EMPLOYEE_RATE: 0.0915,
  CHANGE_MONTH: 10,
  GRADES: [88000, 98000, 104000, 110000, 118000, 126000, 134000, 142000, 150000, 160000,
    170000, 180000, 190000, 200000, 220000, 240000, 260000, 280000, 300000, 320000,
    340000, 360000, 380000, 410000, 440000, 470000, 500000, 530000, 560000, 590000, 620000, 650000],
  RAISES: [[YM(2027, 10), 680000], [YM(2028, 10), 710000], [YM(2029, 10), 750000]],
  grades: ym => Pension.GRADES.concat(Pension.RAISES.filter(r => ym >= r[0]).map(r => r[1])),
  fromPremium(premium, ym) {
    if (!(premium > 0)) return null;
    const raw = premium / Pension.EMPLOYEE_RATE;
    let best = null;
    for (const g of Pension.grades(ym)) if (best === null || Math.abs(g - raw) < Math.abs(best - raw)) best = g;
    return best;
  },
  premiumOf: h => Math.round(h * Pension.EMPLOYEE_RATE),
  entryFor(history, ym) {
    let best = null;
    for (const e of history) if (e.from <= ym && (!best || e.from > best.from)) best = e;
    return best;
  },
  latestChangeMonth: ym => ymM(ym) >= Pension.CHANGE_MONTH ? YM(ymY(ym), Pension.CHANGE_MONTH) : YM(ymY(ym) - 1, Pension.CHANGE_MONTH),
  needsReview(history, ym, confirmedYears) {
    if (history.length === 0) return false;
    const change = Pension.latestChangeMonth(ym);
    if (confirmedYears.includes(ymY(change))) return false;
    return !history.some(e => e.from >= change);
  }
};

// ===== 保存データ（Repository.kt と同じJSON形式）=====
const DEFAULT_SETTINGS = () => ({ pattern: '1', hann: '1', pensionHistory: [], pensionConfirmed: [], noAccident: true, meeting: true, nikkin: true });
const Store = {
  pensionToJson: list => list.slice().sort((a, b) => a.from - b.from).map(e => {
    const o = { from: ymStr(e.from), hyoujyun: e.hyoujyun }; if (e.premium != null) o.premium = e.premium; return o;
  }),
  pensionFromJson(a) {
    if (!Array.isArray(a)) return [];
    const out = [];
    for (const o of a) {
      if (!o || typeof o !== 'object') continue;
      const ym = parseYm(o.from); if (ym === null) continue;
      const h = Math.trunc(Number(o.hyoujyun) || 0); if (h <= 0) continue;
      out.push({ from: ym, hyoujyun: h, premium: o.premium != null && o.premium !== '' ? Math.trunc(Number(o.premium)) : null });
    }
    return out.sort((a, b) => a.from - b.from);
  },
  mapFromJson(o) {
    const out = {};
    if (o && typeof o === 'object') for (const k of Object.keys(o)) { const d = parseDate(k); if (d) out[d] = o[k] == null ? '' : String(o[k]); }
    return out;
  },
  sortObj: m => Object.fromEntries(Object.keys(m).sort().map(k => [k, m[k]])),
  toJson(d) {
    return {
      sales: Store.sortObj(d.sales), dailyNightSales: Store.sortObj(d.dailyNight), hireDate: d.hireDate || '',
      settings: {
        pattern: d.settings.pattern, hann: d.settings.hann,
        pensionHistory: Store.pensionToJson(d.settings.pensionHistory),
        pensionConfirmed: d.settings.pensionConfirmed.slice().sort(),
        noAccident: d.settings.noAccident, meeting: d.settings.meeting, nikkin: d.settings.nikkin
      }
    };
  },
  fromJson(o) {
    const def = DEFAULT_SETTINGS();
    const s = o && o.settings;
    const settings = !s ? def : {
      pattern: Shift.PATTERN_KEYS.includes(s.pattern) ? s.pattern : def.pattern,
      hann: (s.hann && s.hann !== DAILY_NIGHT && Shift.PATTERN_KEYS.includes(s.hann)) ? s.hann
        : (s.pattern && s.pattern !== DAILY_NIGHT && Shift.PATTERN_KEYS.includes(s.pattern) ? s.pattern : def.hann),
      pensionHistory: (() => {
        const h = Store.pensionFromJson(s.pensionHistory);
        if (h.length) return h;
        const old = Math.trunc(Number(s.hyoujyun) || 0);
        return old > 0 ? [{ from: YM(2000, 1), hyoujyun: old, premium: null }] : [];
      })(),
      pensionConfirmed: Array.isArray(s.pensionConfirmed) ? s.pensionConfirmed.map(Number).filter(Number.isFinite) : [],
      noAccident: typeof s.noAccident === 'boolean' ? s.noAccident : def.noAccident,
      meeting: typeof s.meeting === 'boolean' ? s.meeting : def.meeting,
      nikkin: typeof s.nikkin === 'boolean' ? s.nikkin : def.nikkin
    };
    return { sales: Store.mapFromJson(o && o.sales), dailyNight: Store.mapFromJson(o && o.dailyNightSales), hireDate: parseDate(o && o.hireDate), settings };
  }
};

// ===== バックアップ（Web版 cal.cgi と同じ形式）=====
const Backup = {
  export(data) {
    const hann = data.settings.pattern !== DAILY_NIGHT ? data.settings.pattern : data.settings.hann;
    const ledger = new Ledger(data.sales, hann, data.hireDate);
    const arr = (m, withConsumed) => Object.keys(m).sort().map(k => {
      const o = { date: k, value: m[k] };
      if (withConsumed && Values.isPaid(m[k]) && ledger.isConsumed(k)) o.consumedExtra = true;
      return o;
    });
    return JSON.stringify({
      version: 1, exportDate: new Date().toISOString(),
      appPensionHistory: Store.pensionToJson(data.settings.pensionHistory),
      stores: {
        sales: arr(data.sales, true), dailyNightSales: arr(data.dailyNight, false),
        employeeInfo: data.hireDate ? [{ key: 'hireDate', value: data.hireDate }] : []
      }
    }, null, 2);
  },
  /** 今のデータを優先し、空いているところだけ戻す */
  import(current, text) {
    const root = JSON.parse(text);
    const stores = root && root.stores;
    if (!stores || typeof stores !== 'object') throw new Error('バックアップファイルの形式が正しくありません');
    let written = 0, skipped = 0;
    const merge = (cur, arr, dailyNight) => {
      if (!Array.isArray(arr)) return cur;
      const out = Object.assign({}, cur);
      for (const o of arr) {
        if (!o || typeof o !== 'object') continue;
        const d = parseDate(o.date); if (!d) continue;
        const v = o.value == null ? '' : String(o.value);
        const c = out[d];
        const curIsAutoDefault = dailyNight && c != null && c === Shift.dailyNightDefault(d);
        if (v === '' || v === c || (c != null && c !== '' && !curIsAutoDefault)) { skipped++; continue; }
        out[d] = v; written++;
      }
      return out;
    };
    let hire = current.hireDate;
    if (Array.isArray(stores.employeeInfo)) for (const o of stores.employeeInfo) {
      if (o && o.key === 'hireDate') { const d = parseDate(o.value); if (d && !hire) { hire = d; written++; } else skipped++; }
    }
    let pension = current.settings.pensionHistory.slice();
    for (const e of Store.pensionFromJson(root.appPensionHistory)) {
      if (pension.some(x => x.from === e.from)) skipped++; else { pension.push(e); written++; }
    }
    pension.sort((a, b) => a.from - b.from);
    const data = Object.assign({}, current, {
      settings: Object.assign({}, current.settings, { pensionHistory: pension }),
      sales: merge(current.sales, stores.sales, false),
      dailyNight: merge(current.dailyNight, stores.dailyNightSales, true),
      hireDate: hire
    });
    return { data, written, skipped };
  }
};

if (typeof module !== 'undefined') module.exports = {
  iso, toEpoch, fromEpoch, addDays, dow, parseDate, YM, ymY, ymM, ymOf, atDay, monthLen, ymStr, parseYm,
  Values, Holidays, DAILY_NIGHT, Shift, PaidLeave, Ledger, Salary, Pension, Store, Backup
};
