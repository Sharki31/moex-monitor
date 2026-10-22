'use strict';

const ISS = 'https://iss.moex.com/iss';
const TIMEOUT_MS = 15000;
const MAX_PAGES = 200;

const SECID_ALIAS = { TCSG: 'T' };

function resolveSecid(secid) {
  const s = String(secid || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(SECID_ALIAS, s) ? SECID_ALIAS[s] : s;
}

async function issGet(pathAndQuery) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ISS + pathAndQuery, {
      signal: controller.signal,
      headers: { 'User-Agent': 'stock-monitor/1.0 (personal)' },
    });
    if (!res.ok) throw new Error('MOEX HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSecurities() {
  const url = '/engines/stock/markets/shares/boards/TQBR/securities.json'
    + '?iss.meta=off'
    + '&securities.columns=SECID,SHORTNAME,PREVPRICE,ISSUESIZE'
    + '&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,OPEN,LOW,HIGH,VALTODAY';
  const data = await issGet(url);
  const sec = (data.securities && data.securities.data) || [];
  const md = (data.marketdata && data.marketdata.data) || [];
  const mdMap = new Map();
  for (const r of md) mdMap.set(r[0], r);
  const out = [];
  for (const r of sec) {
    const secid = r[0];
    const name = r[1];
    const prev = r[2];
    const issueSize = r[3] != null ? r[3] : null;
    const m = mdMap.get(secid) || [];
    const last = m[1] != null ? m[1] : prev;
    if (!secid || last == null) continue;
    const changePct = m[2] != null
      ? m[2]
      : (prev ? +(((last - prev) / prev) * 100).toFixed(2) : null);
    out.push({
      secid,
      name: name || secid,
      price: last,
      issueSize,
      prev: prev == null ? null : prev,
      changePct,
      open: m[3] != null ? m[3] : null,
      low: m[4] != null ? m[4] : null,
      high: m[5] != null ? m[5] : null,
      turnover: m[6] != null ? m[6] : 0,
    });
  }
  return out;
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchCandles(secid, days) {
  secid = resolveSecid(secid);
  const today = isoDay(new Date());
  let from = isoDay(new Date(Date.now() - days * 86400000));
  const rows = [];
  for (let round = 0; round < 10; round++) {
    const base = '/engines/stock/markets/shares/boards/TQBR/securities/'
      + encodeURIComponent(secid) + '/candles.json'
      + '?iss.meta=off&interval=24&from=' + from;
    let start = 0;
    let collected = 0;
    let lastEnd = null;
    let capped = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await issGet(base + '&start=' + start);
      const block = (data.candles && data.candles.data) || [];
      if (!block.length) break;
      rows.push(...block);
      collected += block.length;
      lastEnd = String(block[block.length - 1][7]).slice(0, 10);
      const cur = data.candles.cursor && data.candles.cursor.data && data.candles.cursor.data[0];
      if (!cur) break;
      const pageSize = cur[2] || block.length;
      const total = cur[1];
      start += pageSize;
      if (start >= total) break;
    }
    capped = collected >= 500;
    if (!capped || !lastEnd) break;
    const next = new Date(new Date(lastEnd + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
    if (next > today) break;
    from = next;
  }
  const seen = new Set();
  const candles = [];
  for (const r of rows) {
    const t = String(r[7]).slice(0, 10);
    if (seen.has(t)) continue;
    seen.add(t);
    candles.push({ t, o: r[0], c: r[1], h: r[2], l: r[3], v: r[5] });
  }
  candles.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return candles;
}

module.exports = { fetchSecurities, fetchCandles, resolveSecid };
