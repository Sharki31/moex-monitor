'use strict';

const DROP_PCT = -5;
const MIN_TURNOVER = 10e6;
const COOLDOWN_MS = 3 * 3600 * 1000;
const WORSE_BY = 2;
const MAX_AGE = 24 * 3600 * 1000;
const MAX_ITEMS = 50;

let items = [];
const bySec = new Map();

function check(rows) {
  const now = Date.now();
  items = items.filter((a) => now - a.ts < MAX_AGE);
  for (const r of rows) {
    if (r.changePct == null || r.changePct > DROP_PCT) continue;
    if ((r.turnover || 0) < MIN_TURNOVER) continue;
    const prev = bySec.get(r.secid);
    if (prev) {
      const existing = items.find((x) => x.secid === r.secid);
      if (existing) {
        const worseEnough = r.changePct <= prev.changePct - WORSE_BY;
        if (now - existing.ts < COOLDOWN_MS && !worseEnough) continue;
        existing.name = r.name;
        existing.price = r.price;
        existing.changePct = r.changePct;
        existing.ts = now;
        bySec.set(r.secid, { changePct: r.changePct, ts: now });
        continue;
      }
      bySec.delete(r.secid);
    }
    items.push({ secid: r.secid, name: r.name, price: r.price, changePct: r.changePct, ts: now });
    bySec.set(r.secid, { changePct: r.changePct, ts: now });
  }
  items.sort((a, b) => a.ts - b.ts);
  items = items.slice(-MAX_ITEMS);
  return items;
}

function list() {
  return items.slice().reverse();
}

module.exports = { check, list, DROP_PCT };
