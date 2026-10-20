'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cache = require('./lib/cache');
const moex = require('./lib/moex');
const analysis = require('./lib/analysis');
const forecast = require('./lib/forecast');
const newsMod = require('./lib/news');
const alerts = require('./lib/alerts');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const TICKER_RE = /^[A-Za-z0-9-]{1,20}$/;
const MIN = 60000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function isMarketOpen() {
  const now = new Date();
  const msk = new Date(now.getTime() + (now.getTimezoneOffset() + 180) * 60000);
  const dow = msk.getDay();
  const minutes = msk.getHours() * 60 + msk.getMinutes();
  return dow >= 1 && dow <= 5 && minutes >= 9 * 60 + 45 && minutes <= 19 * 60;
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function getSecurities() {
  const ttl = isMarketOpen() ? 30 * 1000 : 10 * MIN;
  let data = cache.get('securities', ttl);
  if (!data) {
    try {
      data = await moex.fetchSecurities();
      cache.set('securities', data);
    } catch (e) {
      const stale = cache.getStale('securities');
      if (stale) return { rows: stale, stale: true };
      throw e;
    }
  }
  return { rows: data, stale: false };
}

async function getCandles(secid, days, ttl) {
  const key = 'candles:' + secid + ':' + days;
  let data = cache.get(key, ttl);
  if (!data) {
    try {
      data = await moex.fetchCandles(secid, days);
      cache.set(key, data);
    } catch (e) {
      const stale = cache.getStale(key);
      if (stale) return { candles: stale, stale: true };
      throw e;
    }
  }
  return { candles: data, stale: false };
}

function advice(a, drawdownPct) {
  const rsi = a.rsi;
  const stabilized = a.sma[20] != null && a.price != null && a.price > a.sma[20];
  if (a.score <= -2) return { k: 'avoid', t: 'Не покупать сейчас' };
  if (rsi != null && rsi < 35 && a.score >= -1) {
    if (stabilized) return { k: 'buy', t: 'Хорошая точка входа' };
    return { k: 'wait', t: 'Понаблюдай', gate: 'fall' };
  }
  if (a.score >= 2 && drawdownPct != null && drawdownPct <= -10) {
    if (stabilized) return { k: 'buy', t: 'Хорошая точка входа' };
    return { k: 'wait', t: 'Понаблюдай', gate: 'fall' };
  }
  if (a.score >= 1 || (drawdownPct != null && drawdownPct <= -25 && a.score >= -1)) {
    return { k: 'small', t: 'Можно купить понемногу' };
  }
  if (a.score >= -1) return { k: 'hold', t: 'Держать / присмотреться' };
  return { k: 'wait', t: 'Подожди' };
}

function reasonText(a, drawdownPct) {
  const parts = [];
  if (a.rsi != null && a.rsi < 35) parts.push('RSI ' + a.rsi.toFixed(0) + ' — перепроданность');
  if (drawdownPct != null && drawdownPct <= -20) parts.push('на ' + Math.round(Math.abs(drawdownPct)) + '% ниже максимума за год');
  if (a.score >= 2) parts.push('сильные сигналы (' + a.verdict.toLowerCase() + ')');
  else if (a.score >= 1) parts.push('слабый перевес вверх');
  if (!parts.length) parts.push('ярких сигналов нет');
  return parts.join(', ');
}

async function handleApi(res, url) {
  const p = url.pathname;
  try {
    if (p === '/api/health') {
      return sendJson(res, 200, { ok: true, marketOpen: isMarketOpen(), uptime: Math.round(process.uptime()) });
    }
    if (p === '/api/securities') {
      const d = await getSecurities();
      return sendJson(res, 200, d);
    }
    if (p === '/api/alerts') {
      return sendJson(res, 200, { dropPct: alerts.DROP_PCT, alerts: alerts.list() });
    }
    if (p === '/api/candles') {
      const secid = url.searchParams.get('secid') || '';
      const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '365', 10) || 365, 30), 1460);
      if (!TICKER_RE.test(secid)) return sendJson(res, 400, { error: 'Некорректный тикер' });
      const d = await getCandles(secid, days, 60 * MIN);
      return sendJson(res, 200, { secid, ...d });
    }
    if (p === '/api/analysis') {
      const secid = url.searchParams.get('secid') || '';
      if (!TICKER_RE.test(secid)) return sendJson(res, 400, { error: 'Некорректный тикер' });
      const d = await getCandles(secid, 730, 60 * MIN);
      if (!d.candles.length) return sendJson(res, 404, { error: 'Нет данных по ' + secid });
      const result = analysis.analyze(d.candles);
      result.forecast = forecast.forecast(d.candles);
      result.secid = secid;
      result.stale = d.stale;
      return sendJson(res, 200, result);
    }
    if (p === '/api/news') {
      const secid = url.searchParams.get('secid') || '';
      if (!TICKER_RE.test(secid)) return sendJson(res, 400, { error: 'Некорректный тикер' });
      const feed = await newsMod.getFeed();
      const na = newsMod.matchCompany(feed.items, secid);
      return sendJson(res, 200, {
        secid,
        score: na ? na.score : null,
        pos: na ? na.pos : 0,
        neg: na ? na.neg : 0,
        items: na ? na.matched.slice(0, 8) : [],
        sources: feed.sources,
        errors: feed.errors,
        stale: !!feed.stale,
      });
    }
    if (p === '/api/ideas') {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 100);
      const secs = await getSecurities();
      let feed = null;
      try {
        feed = await newsMod.getFeed();
      } catch {}
      const universe = secs.rows
        .filter((s) => s.issueSize != null && s.price != null)
        .map((s) => ({ ...s, marketCap: s.issueSize * s.price }))
        .sort((a, b) => b.marketCap - a.marketCap)
        .slice(0, 40);
      const results = [];
      let idx = 0;
      async function worker() {
        while (idx < universe.length) {
          const s = universe[idx++];
          let d;
          try {
            d = await getCandles(s.secid, 730, 30 * MIN);
          } catch {
            continue;
          }
          if (!d.candles || d.candles.length < 30) continue;
          const a = analysis.analyze(d.candles);
          const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
          let yearMax = 0;
          for (const c of d.candles) {
            if (c.t >= cutoff && c.c > yearMax) yearMax = c.c;
          }
          const drawdownPct = yearMax ? (s.price / yearMax - 1) * 100 : null;
          const na = feed ? newsMod.matchCompany(feed.items, s.secid) : null;
          let adv = advice(a, drawdownPct);
          if (na && na.score <= -2 && adv.k === 'buy') adv = { k: 'wait', t: 'Понаблюдай', gate: 'news' };
          let reason = reasonText(a, drawdownPct);
          if (adv.gate === 'fall') reason += '; цена ещё ниже средней за 20 дней — падение не остановилось';
          if (adv.gate === 'news') reason += '; новостной фон негативный';
          results.push({
            secid: s.secid,
            name: s.name,
            price: s.price,
            changePct: s.changePct,
            marketCap: s.marketCap,
            score: a.score,
            verdict: a.verdict,
            rsi: a.rsi == null ? null : +a.rsi.toFixed(1),
            drawdownPct: drawdownPct == null ? null : +drawdownPct.toFixed(1),
            newsScore: na ? na.score : null,
            newsPos: na ? na.pos : null,
            newsNeg: na ? na.neg : null,
            newsTitle: na && na.matched[0] ? na.matched[0].title : null,
            advice: adv.t,
            adviceKey: adv.k,
            adviceGate: adv.gate || null,
            reason,
          });
        }
      }
      await Promise.all(Array.from({ length: 6 }, worker));
      const order = { buy: 0, small: 1, hold: 2, wait: 3, avoid: 4 };
      results.sort((x, y) => (order[x.adviceKey] - order[y.adviceKey]) || (y.score - x.score));
      return sendJson(res, 200, {
        scanned: results.length,
        stale: secs.stale,
        newsSources: feed ? feed.sources.join(', ') : '',
        newsErrors: feed ? feed.errors : [],
        results: results.slice(0, limit),
      });
    }
    if (p === '/api/scan') {
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
      const secs = await getSecurities();
      const top = secs.rows.slice().sort((a, b) => (b.turnover || 0) - (a.turnover || 0)).slice(0, limit);
      const results = [];
      let idx = 0;
      async function worker() {
        while (idx < top.length) {
          const s = top[idx++];
          let d;
          try {
            d = await getCandles(s.secid, 730, 30 * MIN);
          } catch {
            continue;
          }
          if (d.candles && d.candles.length >= 30) {
            const a = analysis.analyze(d.candles);
            results.push({
              secid: s.secid,
              name: s.name,
              price: s.price,
              changePct: s.changePct,
              issueSize: s.issueSize,
              score: a.score,
              verdict: a.verdict,
              rsi: a.rsi == null ? null : +a.rsi.toFixed(1),
            });
          }
        }
      }
      await Promise.all(Array.from({ length: 6 }, worker));
      results.sort((a, b) => b.score - a.score);
      return sendJson(res, 200, { scanned: results.length, stale: secs.stale, results });
    }
    return sendJson(res, 404, { error: 'Не найдено' });
  } catch (e) {
    return sendJson(res, 502, { error: String((e && e.message) || e) });
  }
}

function serveStatic(res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  const check = path.relative(PUBLIC_DIR, file);
  if (check.startsWith('..') || path.isAbsolute(check)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Не найдено');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }
  const rawPath = req.url.split('?')[0];
  if (rawPath.includes('..')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  let url;
  try {
    url = new URL(req.url, 'http://' + HOST);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (url.pathname.startsWith('/api/')) handleApi(res, url);
  else serveStatic(res, url.pathname);
});

function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) out.push('http://' + i.address + ':' + PORT);
    }
  }
  return out;
}

function checkAlerts() {
  if (!isMarketOpen()) return;
  getSecurities()
    .then((d) => alerts.check(d.rows))
    .catch(() => {});
}

server.listen(PORT, HOST, () => {
  console.log('Монитор акций MOEX:');
  console.log('  на этом компьютере: http://127.0.0.1:' + PORT);
  const lan = lanAddresses();
  lan.forEach((u) => console.log('  в домашней сети (телефон): ' + u));
  if (!lan.length) console.log('  (Wi-Fi/сеть не найдены — телефон подключить к той же сети)');
  console.log('Фоновый прогрев кэша топ-100 бумаг запустится через 2 с…');
  setTimeout(checkAlerts, 10000);
  setInterval(checkAlerts, 5 * MIN);
  setTimeout(async () => {
    try {
      const secs = await moex.fetchSecurities();
      cache.set('securities', secs);
      const top = secs.slice().sort((a, b) => (b.turnover || 0) - (a.turnover || 0)).slice(0, 100);
      let idx = 0;
      async function worker() {
        while (idx < top.length) {
          const s = top[idx++];
          try {
            const candles = await moex.fetchCandles(s.secid, 730);
            cache.set('candles:' + s.secid + ':730', candles);
          } catch {}
        }
      }
      await Promise.all(Array.from({ length: 6 }, worker));
      console.log('Прогрев завершён: ' + top.length + ' бумаг в кэше');
    } catch (e) {
      console.error('Прогрев не удался: ' + e.message);
    }
  }, 2000);
});
