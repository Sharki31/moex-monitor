'use strict';

const analysis = require('./analysis');
const forecast = require('./forecast');
const newsMod = require('./news');

const SCAN_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_SCAN_DELAY_MS = 60 * 1000;
const UNIVERSE_TOP = 40;
const WORKERS = 6;
const MAX_ITEMS = 20;
const MIN_TURNOVER = 10e6;

let deps = null;
let items = [];
let lastScan = null;
let lastError = null;
let scanning = false;

function init(d) {
  deps = d;
}

function buildUniverse(rows) {
  return rows
    .filter((s) => s.issueSize != null && s.price != null && (s.turnover || 0) >= MIN_TURNOVER)
    .map((s) => ({ ...s, marketCap: s.issueSize * s.price }))
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, UNIVERSE_TOP);
}

function yearDrawdown(candles, price) {
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  let yearMax = 0;
  for (const c of candles) {
    if (c.t >= cutoff && c.c > yearMax) yearMax = c.c;
  }
  return yearMax ? (price / yearMax - 1) * 100 : null;
}

async function scanBuys() {
  if (!deps || scanning) return;
  scanning = true;
  try {
    const secs = await deps.getSecurities();
    let feed = null;
    try {
      feed = await newsMod.getFeed();
    } catch {}
    const universe = buildUniverse(secs.rows);
    const found = [];
    let idx = 0;
    async function worker() {
      while (idx < universe.length) {
        const s = universe[idx++];
        let d;
        try {
          d = await deps.getCandles(s.secid, 730, 30 * 60 * 1000);
        } catch {
          continue;
        }
        if (!d.candles || d.candles.length < 30) continue;
        const a = analysis.analyze(d.candles);
        const drawdownPct = yearDrawdown(d.candles, s.price);
        const na = feed ? newsMod.matchCompany(feed.items, s.secid) : null;
        let adv = deps.advice(a, drawdownPct);
        if (na && na.score <= -2 && adv.k === 'buy') adv = { k: 'wait', t: 'Понаблюдай', gate: 'news' };
        const isBuy = adv.k === 'buy' || (adv.k === 'small' && a.score >= 2);
        if (!isBuy) continue;
        let reason = deps.reasonText(a, drawdownPct);
        if (adv.gate === 'fall') reason += '; цена ещё ниже средней за 20 дней — падение не остановилось';
        if (adv.gate === 'news') reason += '; новостной фон негативный';
        found.push({
          secid: s.secid,
          name: s.name,
          price: s.price,
          changePct: s.changePct,
          score: a.score,
          verdict: a.verdict,
          rsi: a.rsi == null ? null : +a.rsi.toFixed(1),
          drawdownPct: drawdownPct == null ? null : +drawdownPct.toFixed(1),
          newsScore: na ? na.score : null,
          advice: adv.t,
          adviceKey: adv.k,
          reason,
        });
      }
    }
    await Promise.all(Array.from({ length: WORKERS }, worker));
    found.sort((a, b) => b.score - a.score);
    const now = Date.now();
    const prev = new Map(items.map((x) => [x.secid, x]));
    items = found.slice(0, MAX_ITEMS).map((f) => {
      const old = prev.get(f.secid);
      return { ...f, ts: old ? old.ts : now };
    });
    lastScan = { ts: now, scanned: universe.length, candidates: items.length, stale: secs.stale };
    lastError = null;
  } catch (e) {
    lastError = String((e && e.message) || e);
  } finally {
    scanning = false;
  }
}

function list() {
  return items.slice().sort((a, b) => (b.score - a.score) || (b.ts - a.ts));
}

function status() {
  return { lastScan, lastError, scanning };
}

async function portfolioAdvice(watch) {
  const out = { generated: new Date().toISOString(), results: [], errors: [] };
  if (!deps) return out;
  let secs = { rows: [], stale: false };
  try {
    secs = await deps.getSecurities();
  } catch {}
  const bySec = new Map(secs.rows.map((s) => [s.secid, s]));
  let feed = null;
  try {
    feed = await newsMod.getFeed();
  } catch {}
  const uniq = Array.from(new Set((watch || []).map((s) => String(s || '').trim().toUpperCase()).filter(Boolean))).slice(0, 30);
  await Promise.all(uniq.map(async (secid) => {
    try {
      const d = await deps.getCandles(secid, 730, 60 * 60 * 1000);
      if (!d.candles || !d.candles.length) {
        out.errors.push({ secid, error: 'Нет данных по ' + secid });
        return;
      }
      const a = analysis.analyze(d.candles);
      const s = bySec.get(secid);
      const price = s && s.price != null ? s.price : a.price;
      const drawdownPct = yearDrawdown(d.candles, price);
      const na = feed ? newsMod.matchCompany(feed.items, secid) : null;
      const adv = deps.advice(a, drawdownPct);
      let action = 'hold';
      let actionText = 'Держать';
      if (adv.k === 'buy' || adv.k === 'small') {
        action = 'buy_more';
        actionText = adv.k === 'buy' ? 'Хорошая точка входа — можно докупить' : 'Можно докупить понемногу';
      } else if (adv.k === 'avoid' || (a.rsi != null && a.rsi >= 70)) {
        action = 'sell';
        actionText = a.rsi != null && a.rsi >= 70 ? 'Перекупленность — можно зафиксировать прибыль' : 'Сигналы против бумаги — рассмотреть продажу';
      }
      const f = forecast.forecast(d.candles);
      const lastF = f && f.points && f.points[f.points.length - 1];
      let reason = deps.reasonText(a, drawdownPct);
      if (adv.gate === 'fall') reason += '; цена ещё ниже средней за 20 дней — падение не остановилось';
      out.results.push({
        secid,
        name: s ? s.name : secid,
        price,
        changePct: s ? s.changePct : null,
        score: a.score,
        verdict: a.verdict,
        rsi: a.rsi == null ? null : +a.rsi.toFixed(1),
        drawdownPct: drawdownPct == null ? null : +drawdownPct.toFixed(1),
        newsScore: na ? na.score : null,
        advice: adv.t,
        adviceKey: adv.k,
        action,
        actionText,
        reason,
        forecast30: lastF && lastF.forecast != null ? +lastF.forecast.toFixed(2) : null,
        trendYearPct: f && f.trendYearPct != null ? +f.trendYearPct.toFixed(1) : null,
        stale: d.stale,
      });
    } catch (e) {
      out.errors.push({ secid, error: String((e && e.message) || e) });
    }
  }));
  const order = { sell: 0, buy_more: 1, hold: 2 };
  out.results.sort((x, y) => (order[x.action] - order[y.action]) || (y.score - x.score));
  return out;
}

function start() {
  setTimeout(() => {
    scanBuys();
    setInterval(scanBuys, SCAN_INTERVAL_MS);
  }, FIRST_SCAN_DELAY_MS);
}

module.exports = { init, start, scanBuys, list, status, portfolioAdvice };
