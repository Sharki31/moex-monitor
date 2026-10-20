'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let securities = [];
let sortKey = 'turnover';
let sortDir = -1;
let chart = null;
const S = {};

const fmtPrice = (v) => v == null ? '—' : (+v).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const fmtPct = (v) => v == null ? '—' : (v > 0 ? '+' : '') + (+v).toFixed(2) + '%';
const fmtTurn = (v) => {
  if (v == null) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + ' млрд ₽';
  if (v >= 1e6) return Math.round(v / 1e6) + ' млн ₽';
  return (+v).toLocaleString('ru-RU') + ' ₽';
};
const fmtCap = (v) => {
  if (v == null) return '—';
  if (v >= 1e12) return (v / 1e12).toFixed(2) + ' трлн ₽';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + ' млрд ₽';
  if (v >= 1e6) return Math.round(v / 1e6) + ' млн ₽';
  return (+v).toLocaleString('ru-RU') + ' ₽';
};
const fmtMoney = (v) => v == null ? '—' : (+v).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';

async function api(path) {
  const res = await fetch(path);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
  return d;
}

function verdictClass(v) {
  if (v === 'СИЛЬНАЯ ПОКУПКА') return 'b-strongbuy';
  if (v === 'ПОКУПКА') return 'b-buy';
  if (v === 'ПРОДАЖА') return 'b-sell';
  if (v === 'СИЛЬНАЯ ПРОДАЖА') return 'b-strongsell';
  return 'b-hold';
}

function adviceClass(k) {
  if (k === 'buy') return 'b-strongbuy';
  if (k === 'small') return 'b-buy';
  if (k === 'hold') return 'b-hold';
  if (k === 'wait') return 'b-wait';
  return 'b-avoid';
}

async function loadSecurities() {
  $('#status').textContent = 'Обновление…';
  try {
    const d = await api('/api/securities');
    securities = d.rows.map((r) => ({
      ...r,
      marketCap: r.issueSize != null && r.price != null ? r.issueSize * r.price : null,
    }));
    renderOverview();
    renderDatalist();
    renderCalc();
    $('#status').textContent = d.stale
      ? 'Данные из кэша (MOEX недоступен)'
      : 'Обновлено ' + new Date().toLocaleTimeString('ru-RU');
  } catch (e) {
    $('#status').textContent = 'Ошибка: ' + e.message;
  }
}

function renderDatalist() {
  $('#tickers').innerHTML = securities
    .map((s) => `<option value="${s.secid}">${s.name}</option>`)
    .join('');
}

function renderOverview() {
  const q = $('#search').value.trim().toLowerCase();
  let rows = securities;
  if (q) {
    rows = rows.filter((s) => s.secid.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }
  rows = rows.slice().sort((a, b) => {
    const x = a[sortKey];
    const y = b[sortKey];
    if (typeof x === 'string' || typeof y === 'string') {
      return sortDir * String(x).localeCompare(String(y), 'ru');
    }
    return sortDir * ((x == null ? -Infinity : x) - (y == null ? -Infinity : y));
  });
  $('#ov-meta').textContent = 'Бумаг: ' + rows.length + ' из ' + securities.length;
  $('#ov-table tbody').innerHTML = rows.map((s) => `
    <tr data-secid="${s.secid}">
      <td class="mono">${s.secid}</td>
      <td>${s.name}</td>
      <td class="num">${fmtPrice(s.price)}</td>
      <td class="num ${s.changePct > 0 ? 'up' : s.changePct < 0 ? 'down' : ''}">${fmtPct(s.changePct)}</td>
      <td class="num">${fmtTurn(s.turnover)}</td>
      <td class="num">${fmtCap(s.marketCap)}</td>
    </tr>`).join('');
}

function ensureChart() {
  if (chart) return;
  const el = $('#chart');
  chart = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: 420,
    layout: { background: { type: 'solid', color: '#141a23' }, textColor: '#8b98a9' },
    grid: { vertLines: { color: '#1c2430' }, horzLines: { color: '#1c2430' } },
    rightPriceScale: { borderColor: '#2a3442' },
    timeScale: { borderColor: '#2a3442' },
  });
  const noDeco = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
  S.candles = chart.addCandlestickSeries({
    upColor: '#26a69a', downColor: '#ef5350',
    borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  });
  S.sma20 = chart.addLineSeries({ color: '#f0b90b', lineWidth: 1, ...noDeco });
  S.sma50 = chart.addLineSeries({ color: '#e056fd', lineWidth: 1, ...noDeco });
  S.sma200 = chart.addLineSeries({ color: '#4fc3f7', lineWidth: 1, ...noDeco });
  S.bbU = chart.addLineSeries({ color: 'rgba(139,152,169,0.45)', lineWidth: 1, lineStyle: 2, ...noDeco });
  S.bbL = chart.addLineSeries({ color: 'rgba(139,152,169,0.45)', lineWidth: 1, lineStyle: 2, ...noDeco });
  S.fc = chart.addLineSeries({ color: '#66bb6a', lineWidth: 2, ...noDeco });
  S.fc1u = chart.addLineSeries({ color: 'rgba(102,187,106,0.6)', lineWidth: 1, lineStyle: 2, ...noDeco });
  S.fc1l = chart.addLineSeries({ color: 'rgba(102,187,106,0.6)', lineWidth: 1, lineStyle: 2, ...noDeco });
  S.fc2u = chart.addLineSeries({ color: 'rgba(102,187,106,0.3)', lineWidth: 1, lineStyle: 2, ...noDeco });
  S.fc2l = chart.addLineSeries({ color: 'rgba(102,187,106,0.3)', lineWidth: 1, lineStyle: 2, ...noDeco });
  window.addEventListener('resize', () => chart.applyOptions({ width: el.clientWidth }));
}

function smaSeriesData(candles, period) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].c;
    if (i >= period) sum -= candles[i - period].c;
    if (i >= period - 1) out.push({ time: candles[i].t, value: +(sum / period).toFixed(4) });
  }
  return out;
}

function bbSeriesData(candles, period = 20, mult = 2) {
  const up = [];
  const lo = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].c;
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (candles[j].c - mean) ** 2;
    const sd = Math.sqrt(sq / period);
    up.push({ time: candles[i].t, value: +(mean + mult * sd).toFixed(4) });
    lo.push({ time: candles[i].t, value: +(mean - mult * sd).toFixed(4) });
  }
  return { up, lo };
}

async function runAnalysis(secidArg) {
  const secid = (secidArg || $('#ticker').value || '').trim().toUpperCase();
  if (!secid) return;
  $('#ticker').value = secid;
  $('#an-error').textContent = '';
  try {
    const [an, cd] = await Promise.all([
      api('/api/analysis?secid=' + encodeURIComponent(secid)),
      api('/api/candles?secid=' + encodeURIComponent(secid) + '&days=730'),
    ]);
    ensureChart();
    const candles = cd.candles || [];
    S.candles.setData(candles.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c })));
    S.sma20.setData(smaSeriesData(candles, 20));
    S.sma50.setData(smaSeriesData(candles, 50));
    S.sma200.setData(smaSeriesData(candles, 200));
    const bb = bbSeriesData(candles);
    S.bbU.setData(bb.up);
    S.bbL.setData(bb.lo);
    if (an.forecast && an.forecast.points) {
      const f = an.forecast.points;
      S.fc.setData(f.map((p) => ({ time: p.date, value: p.forecast })));
      S.fc1u.setData(f.map((p) => ({ time: p.date, value: p.hi1 })));
      S.fc1l.setData(f.map((p) => ({ time: p.date, value: p.lo1 })));
      S.fc2u.setData(f.map((p) => ({ time: p.date, value: p.hi2 })));
      S.fc2l.setData(f.map((p) => ({ time: p.date, value: p.lo2 })));
    }
    chart.timeScale().fitContent();
    renderAnalysis(an);
    loadNews(secid);
  } catch (e) {
    $('#an-error').textContent = e.message;
  }
}

async function loadNews(secid) {
  const box = $('#an-news');
  box.innerHTML = 'Ищу новости…';
  try {
    const d = await api('/api/news?secid=' + encodeURIComponent(secid));
    if (!d.items.length) {
      box.innerHTML = 'Упоминаний в новостях за последние дни не найдено' +
        (d.errors.length ? ' (недоступны: ' + d.errors.join(', ') + ')' : '') + '.';
      return;
    }
    const toneCls = d.score > 0 ? 'up' : d.score < 0 ? 'down' : '';
    box.innerHTML = `
      <p>Новостной фон: <b class="${toneCls}">${d.score > 0 ? '+' : ''}${d.score}</b>
      (${d.pos} позитивных / ${d.neg} негативных заголовков; источники: ${d.sources.join(', ')})</p>
      <ul class="news-list">` +
      d.items.map((n) => `<li class="${n.tone > 0 ? 'sig-up' : n.tone < 0 ? 'sig-down' : 'sig-neutral'}"><a href="${n.link}" target="_blank" rel="noopener">${n.title}</a> <span class="meta">${n.source}</span></li>`).join('') +
      '</ul>';
  } catch (e) {
    box.innerHTML = '<span class="error">Новости: ' + e.message + '</span>';
  }
}

function renderAnalysis(an) {
  const badge = $('#an-verdict');
  badge.hidden = false;
  badge.textContent = an.verdict + ' (' + (an.score > 0 ? '+' : '') + an.score + ')';
  badge.className = 'badge ' + verdictClass(an.verdict);

  const cards = [
    ['Цена', fmtPrice(an.price)],
    ['SMA 20', fmtPrice(an.sma['20'])],
    ['SMA 50', fmtPrice(an.sma['50'])],
    ['SMA 200', fmtPrice(an.sma['200'])],
    ['RSI (14)', an.rsi == null ? '—' : an.rsi.toFixed(1)],
    ['MACD hist', an.macd.hist == null ? '—' : an.macd.hist.toFixed(3)],
    ['Bollinger (20,2)', an.bollinger ? fmtPrice(an.bollinger.lower) + ' … ' + fmtPrice(an.bollinger.upper) : '—'],
    ['Скор сигналов', (an.score > 0 ? '+' : '') + an.score],
  ];
  $('#indicators').innerHTML = cards
    .map((c) => `<div class="card"><div class="card-t">${c[0]}</div><div class="card-v">${c[1]}</div></div>`)
    .join('');

  $('#signals').innerHTML = an.signals.length
    ? an.signals.map((s) => `<li class="${s.w > 0 ? 'sig-up' : 'sig-down'}">${s.s}</li>`).join('')
    : '<li class="sig-neutral">Явных сигналов нет</li>';

  const f = an.forecast;
  if (f && f.points) {
    const lastP = f.points[f.points.length - 1];
    $('#forecast-info').innerHTML = `
      <div class="cards">
        <div class="card"><div class="card-t">Тренд (годовых)</div><div class="card-v ${f.trendYearPct > 0 ? 'up' : 'down'}">${fmtPct(f.trendYearPct)}</div></div>
        <div class="card"><div class="card-t">Качество (R²)</div><div class="card-v">${f.r2}</div></div>
        <div class="card"><div class="card-t">Прогноз через 30 дней</div><div class="card-v">${fmtPrice(lastP.forecast)}</div></div>
        <div class="card"><div class="card-t">Коридор 68%</div><div class="card-v">${fmtPrice(lastP.lo1)} … ${fmtPrice(lastP.hi1)}</div></div>
        <div class="card"><div class="card-t">Коридор 95%</div><div class="card-v">${fmtPrice(lastP.lo2)} … ${fmtPrice(lastP.hi2)}</div></div>
      </div>
      <p class="meta">Зелёная линия — средний прогноз, пунктир — коридоры 68% и 95%. Расчёт по ${f.basisDays} торговым дням (лог-регрессия).</p>`;
  } else {
    $('#forecast-info').innerHTML = '<p class="meta">Недостаточно данных для прогноза</p>';
  }
}

async function runScan() {
  const limit = $('#scan-limit').value;
  $('#scan-meta').textContent = 'Сканирование… (первый раз может занять минуту)';
  $('#btn-scan').disabled = true;
  try {
    const d = await api('/api/scan?limit=' + limit);
    $('#rec-table tbody').innerHTML = d.results.map((r, i) => `
      <tr data-secid="${r.secid}">
        <td>${i + 1}</td>
        <td class="mono">${r.secid}</td>
        <td>${r.name}</td>
        <td class="num">${fmtPrice(r.price)}</td>
        <td class="num ${r.changePct > 0 ? 'up' : r.changePct < 0 ? 'down' : ''}">${fmtPct(r.changePct)}</td>
        <td class="num">${fmtCap(r.issueSize != null && r.price != null ? r.issueSize * r.price : null)}</td>
        <td class="num">${r.rsi == null ? '—' : r.rsi}</td>
        <td class="num">${r.score > 0 ? '+' : ''}${r.score}</td>
        <td><span class="badge ${verdictClass(r.verdict)}">${r.verdict}</span></td>
      </tr>`).join('');
    $('#scan-meta').textContent = 'Просканировано: ' + d.scanned + (d.stale ? ' (данные из кэша)' : '');
  } catch (e) {
    $('#scan-meta').textContent = 'Ошибка: ' + e.message;
  } finally {
    $('#btn-scan').disabled = false;
  }
}

let portfolio = loadPortfolio();
let pfBusy = false;

function loadPortfolio() {
  try {
    const raw = JSON.parse(localStorage.getItem('moex_portfolio') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p) => p && typeof p.secid === 'string' && +p.qty > 0)
      .map((p) => ({
        secid: p.secid,
        qty: +p.qty,
        buyPrice: p.buyPrice != null && +p.buyPrice > 0 ? +p.buyPrice : null,
        divPerShare: p.divPerShare != null && +p.divPerShare > 0 ? +p.divPerShare : null,
      }));
  } catch {
    return [];
  }
}

function savePortfolio() {
  localStorage.setItem('moex_portfolio', JSON.stringify(portfolio));
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

async function renderPortfolio() {
  if (pfBusy) return;
  pfBusy = true;
  $('#pf-error').textContent = '';
  try {
    const analyses = await mapLimit(portfolio, 4, async (p) => {
      try {
        return await api('/api/analysis?secid=' + encodeURIComponent(p.secid));
      } catch {
        return null;
      }
    });
    const bySec = {};
    analyses.forEach((a) => { if (a) bySec[a.secid] = a; });

    let totalValue = 0, totalBuy = 0, hasBuy = false, totalDiv = 0;
    const rows = portfolio.map((p, i) => {
      const s = securities.find((x) => x.secid === p.secid);
      const a = bySec[p.secid];
      const price = s ? s.price : null;
      const value = price != null ? p.qty * price : null;
      if (value != null) totalValue += value;
      let pl = null, plPct = null;
      if (p.buyPrice != null && value != null) {
        pl = value - p.qty * p.buyPrice;
        plPct = (price / p.buyPrice - 1) * 100;
        totalBuy += p.qty * p.buyPrice;
        hasBuy = true;
      }
      const divIncome = p.divPerShare != null ? p.qty * p.divPerShare : null;
      if (divIncome != null) totalDiv += divIncome;
      const divYield = p.divPerShare != null && price ? (p.divPerShare / price) * 100 : null;

      let signal = '<span class="meta">—</span>';
      if (a) {
        let hint = '';
        if (a.rsi != null && a.rsi < 35 && a.verdict !== 'ПРОДАЖА' && a.verdict !== 'СИЛЬНАЯ ПРОДАЖА') {
          hint = '<div class="meta up">RSI ' + a.rsi.toFixed(1) + ' — зона докупления</div>';
        }
        signal = '<span class="badge ' + verdictClass(a.verdict) + '">' + a.verdict + '</span>' + hint;
      }

      return `
      <tr data-secid="${p.secid}">
        <td class="mono">${p.secid}</td>
        <td>${s ? s.name : p.secid}</td>
        <td class="num">${p.qty.toLocaleString('ru-RU')}</td>
        <td class="num">${fmtPrice(p.buyPrice)}</td>
        <td class="num">${fmtPrice(price)}</td>
        <td class="num">${fmtMoney(value)}</td>
        <td class="num ${pl > 0 ? 'up' : pl < 0 ? 'down' : ''}">${fmtMoney(pl)}</td>
        <td class="num ${plPct > 0 ? 'up' : plPct < 0 ? 'down' : ''}">${fmtPct(plPct)}</td>
        <td class="num">${fmtMoney(divIncome)}</td>
        <td class="num">${fmtPct(divYield)}</td>
        <td>${signal}</td>
        <td><button class="btn-del" data-del="${i}" title="Удалить">×</button></td>
      </tr>`;
    });

    $('#pf-table tbody').innerHTML = portfolio.length
      ? rows.join('')
      : '<tr><td colspan="12" class="meta">Портфель пуст — добавьте первую позицию выше</td></tr>';

    if (portfolio.length) {
      const pl = hasBuy ? totalValue - totalBuy : null;
      const plPct = hasBuy && totalBuy ? (pl / totalBuy) * 100 : null;
      const yieldPct = totalValue ? (totalDiv / totalValue) * 100 : null;
      $('#pf-summary').innerHTML = `
        <div class="card"><div class="card-t">Стоимость портфеля</div><div class="card-v">${fmtMoney(totalValue)}</div></div>
        <div class="card"><div class="card-t">Прибыль / убыток</div><div class="card-v ${pl > 0 ? 'up' : pl < 0 ? 'down' : ''}">${fmtMoney(pl)} ${plPct == null ? '' : '(' + fmtPct(plPct) + ')'}</div></div>
        <div class="card"><div class="card-t">Ожид. дивиденды за год</div><div class="card-v">${fmtMoney(totalDiv)}</div></div>
        <div class="card"><div class="card-t">Див. доходность портфеля</div><div class="card-v">${fmtPct(yieldPct)}</div></div>`;
    } else {
      $('#pf-summary').innerHTML = '';
    }
  } catch (e) {
    $('#pf-error').textContent = e.message;
  } finally {
    pfBusy = false;
    renderCalc();
  }
}

function addPosition() {
  $('#pf-error').textContent = '';
  const t = $('#pf-ticker').value.trim().toUpperCase();
  const qty = parseFloat($('#pf-qty').value);
  if (!securities.some((s) => s.secid === t)) {
    $('#pf-error').textContent = 'Неизвестный тикер';
    return;
  }
  if (!(qty > 0)) {
    $('#pf-error').textContent = 'Укажите количество акций';
    return;
  }
  const buy = parseFloat($('#pf-buy').value);
  const div = parseFloat($('#pf-div').value);
  const pos = {
    secid: t,
    qty,
    buyPrice: isFinite(buy) && buy > 0 ? buy : null,
    divPerShare: isFinite(div) && div > 0 ? div : null,
  };
  const ex = portfolio.findIndex((p) => p.secid === t);
  if (ex >= 0) {
    const old = portfolio[ex];
    const qtySum = old.qty + qty;
    let buyPrice = pos.buyPrice;
    if (old.buyPrice != null && pos.buyPrice != null) {
      buyPrice = (old.buyPrice * old.qty + pos.buyPrice * qty) / qtySum;
    } else if (old.buyPrice != null) {
      buyPrice = old.buyPrice;
    }
    portfolio[ex] = {
      secid: t,
      qty: qtySum,
      buyPrice,
      divPerShare: pos.divPerShare != null ? pos.divPerShare : old.divPerShare,
    };
  } else {
    portfolio.push(pos);
  }
  savePortfolio();
  $('#pf-ticker').value = '';
  $('#pf-qty').value = '';
  $('#pf-buy').value = '';
  $('#pf-div').value = '';
  renderPortfolio();
}

const calcIds = ['calc-goal', 'calc-monthly', 'calc-yield', 'calc-divgrowth', 'calc-pricegrowth', 'calc-inflation'];

function loadCalcInputs() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('moex_calc') || '{}') || {};
  } catch {
    saved = {};
  }
  calcIds.forEach((id) => {
    const v = saved[id.replace('calc-', '')];
    if (v != null) $('#' + id).value = v;
  });
}

function saveCalcInputs() {
  const out = {};
  calcIds.forEach((id) => {
    const v = $('#' + id).value.trim();
    if (v !== '') out[id.replace('calc-', '')] = v;
  });
  localStorage.setItem('moex_calc', JSON.stringify(out));
}

function pfTotals() {
  let value = 0;
  let divYear = 0;
  for (const p of portfolio) {
    const s = securities.find((x) => x.secid === p.secid);
    if (s && s.price != null) value += p.qty * s.price;
    if (p.divPerShare != null) divYear += p.qty * p.divPerShare;
  }
  return { value, divYear };
}

function ruYears(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  const w = (m10 === 1 && m100 !== 11) ? 'год'
    : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? 'года' : 'лет';
  return n + ' ' + w;
}

function hitLabel(m) {
  if (m === 0) return 'сейчас';
  const y = Math.floor(m / 12);
  const mm = m % 12;
  if (!y) return mm + ' мес.';
  return mm ? ruYears(y) + ' ' + mm + ' мес.' : ruYears(y);
}

function simulateCalc(cap0, monthly, y0, dg, pg, infl, goal) {
  const rows = [];
  let C = cap0;
  for (let m = 0; m <= 600; m++) {
    const t = m / 12;
    const dy = (y0 * Math.pow(1 + dg, t)) / Math.pow(1 + pg, t);
    const incNom = (C * dy) / 12;
    const incReal = incNom / Math.pow(1 + infl, t);
    if (goal != null && incReal >= goal) {
      rows.push({ label: hitLabel(m), cap: C, incNom, incReal, pct: 100, hit: true });
      return { rows, hitMonths: m };
    }
    if (m > 0 && m % 12 === 0) {
      rows.push({ label: hitLabel(m), cap: C, incNom, incReal, pct: goal == null ? null : (incReal / goal) * 100 });
    }
    const t1 = (m + 1) / 12;
    const dy1 = (y0 * Math.pow(1 + dg, t1)) / Math.pow(1 + pg, t1);
    C = C * (1 + (dy1 + pg) / 12) + monthly;
  }
  return { rows, hitMonths: null };
}

function renderCalc() {
  const num = (id) => {
    const v = parseFloat($('#' + id).value);
    return isFinite(v) && v >= 0 ? v : null;
  };
  const goal = num('calc-goal');
  const monthly = num('calc-monthly') || 0;
  const typedYield = num('calc-yield');
  const { value, divYear } = pfTotals();
  const curYield = value > 0 && divYear > 0 ? (divYear / value) * 100 : null;
  $('#calc-yield').placeholder = curYield ? 'напр. ' + curYield.toFixed(1) : 'напр. 10';
  const yieldPct = typedYield != null ? typedYield : (curYield != null ? curYield : 10);
  const y0 = yieldPct / 100;
  const dg = (num('calc-divgrowth') ?? 5) / 100;
  const pg = (num('calc-pricegrowth') ?? 5) / 100;
  const infl = (num('calc-inflation') ?? 8) / 100;

  const needCap = goal != null && y0 > 0 ? (goal * 12) / y0 : null;
  const curMonth = divYear / 12;
  const sim = simulateCalc(value, monthly, y0, dg, pg, infl, goal);

  const card = (t, v, cls) => '<div class="card"><div class="card-t">' + t + '</div><div class="card-v ' + (cls || '') + '">' + v + '</div></div>';
  const status = goal == null
    ? '<span class="meta">укажи желаемый доход</span>'
    : sim.hitMonths != null
      ? (sim.hitMonths === 0 ? 'уже достигнута' : 'через ' + hitLabel(sim.hitMonths))
      : 'за 50 лет не выходит';

  $('#calc-summary').innerHTML =
    card('Капитал сейчас', fmtMoney(value)) +
    card('Дивиденды сейчас', fmtMoney(curMonth) + ' /мес') +
    card('Нужный капитал для цели', needCap == null ? '—' : fmtMoney(needCap)) +
    card('Осталось накопить', needCap == null ? '—' : fmtMoney(Math.max(0, needCap - value))) +
    card('Цель', status, goal != null && sim.hitMonths != null ? 'up' : '');

  $('#calc-note').textContent = y0 <= 0
    ? 'Без дивидендов пассивного дохода не будет — укажи доходность в поле выше.'
    : (typedYield == null && curYield != null ? 'Доходность ' + curYield.toFixed(1) + '% взята фактическая из твоего портфеля.' : '');

  $('#calc-table tbody').innerHTML = sim.rows.length
    ? sim.rows.map((r) =>
      '<tr' + (r.hit ? ' class="calc-hit"' : '') + '><td>' + r.label + '</td>' +
      '<td class="num">' + fmtMoney(r.cap) + '</td>' +
      '<td class="num">' + fmtMoney(r.incNom) + '</td>' +
      '<td class="num">' + fmtMoney(r.incReal) + '</td>' +
      '<td class="num">' + (r.pct == null ? '—' : Math.min(100, r.pct).toFixed(0) + '%') + '</td></tr>').join('')
    : '<tr><td colspan="5" class="meta">Заполни поля выше — покажу прогноз по годам</td></tr>';
}

async function runIdeas() {
  $('#ideas-meta').textContent = 'Подбор идей…';
  $('#btn-ideas').disabled = true;
  try {
    const d = await api('/api/ideas?limit=20');
    $('#ideas-table tbody').innerHTML = d.results.map((r) => `
      <tr data-secid="${r.secid}">
        <td class="mono">${r.secid}</td>
        <td>${r.name}</td>
        <td class="num">${fmtPrice(r.price)}</td>
        <td class="num">${fmtCap(r.marketCap)}</td>
        <td class="num ${r.drawdownPct != null && r.drawdownPct > 0 ? 'up' : 'down'}">${r.drawdownPct == null ? '—' : fmtPct(r.drawdownPct)}</td>
        <td class="num">${ideaNewsCell(r)}</td>
        <td><span class="badge ${adviceClass(r.adviceKey)}">${r.advice}</span></td>
        <td class="why">${r.reason}</td>
        <td><button class="btn-add" data-add="${r.secid}">В портфель →</button></td>
      </tr>`).join('');
    $('#ideas-meta').textContent = 'Идей: ' + d.results.length + (d.stale ? ' (данные из кэша)' : '') +
      (d.newsSources ? ' · Новости: ' + d.newsSources : '') +
      (d.newsErrors && d.newsErrors.length ? ' (недоступны: ' + d.newsErrors.join(', ') + ')' : '');
  } catch (e) {
    $('#ideas-meta').textContent = 'Ошибка: ' + e.message;
  } finally {
    $('#btn-ideas').disabled = false;
  }
}

let ideasLoaded = false;

function ideaNewsCell(r) {
  if (r.newsScore == null) return '<span class="meta">—</span>';
  const cls = r.newsScore > 0 ? 'up' : r.newsScore < 0 ? 'down' : '';
  const t = r.newsTitle ? ' title="' + r.newsTitle.replace(/"/g, '&quot;') + '"' : '';
  return `<span class="${cls}"${t}>${r.newsPos}/${r.newsNeg}</span>`;
}

let currentAlerts = [];
let seenAlertTs = +(localStorage.getItem('moex_alerts_seen') || 0);

function updateAlertBadge() {
  const n = currentAlerts.filter((a) => a.ts > seenAlertTs).length;
  $('#alerts-badge').hidden = !n;
  $('#alerts-badge').textContent = n;
}

function renderAlerts() {
  $('#alerts-list').innerHTML = currentAlerts.length
    ? currentAlerts.map((a) =>
      '<li data-secid="' + a.secid + '"><span class="mono">' + a.secid + '</span>' +
      '<span class="a-name">' + a.name + '</span>' +
      '<span class="num down">' + fmtPct(a.changePct) + '</span>' +
      '<span class="num">' + fmtPrice(a.price) + ' ₽</span>' +
      '<span class="a-time">' + new Date(a.ts).toLocaleTimeString('ru-RU') + '</span></li>').join('')
    : '<li class="a-empty">Сигналов пока нет — рынок проверяется каждые 5 минут в торговое время</li>';
}

async function pollAlerts() {
  try {
    const d = await api('/api/alerts');
    currentAlerts = d.alerts || [];
    renderAlerts();
    updateAlertBadge();
    const fresh = currentAlerts.filter((a) => a.ts > seenAlertTs);
    if (fresh.length && 'Notification' in window && Notification.permission === 'granted') {
      fresh.slice(0, 3).forEach((a) => {
        const n = new Notification(a.secid + ' ' + a.changePct.toFixed(1) + '% — резкое падение', {
          body: a.name + ' · ' + fmtPrice(a.price) + ' ₽. Открой приложение и оцени сигнал.',
          icon: '/icon-192.png',
          tag: 'moex-alert-' + a.secid,
        });
        n.onclick = () => { window.focus(); openAnalysis(a.secid); n.close(); };
      });
      seenAlertTs = Math.max.apply(null, fresh.map((a) => a.ts));
      localStorage.setItem('moex_alerts_seen', String(seenAlertTs));
      updateAlertBadge();
    }
  } catch {}
}

function refreshNotifyButton() {
  const b = $('#btn-notify');
  if (!('Notification' in window)) {
    b.disabled = true;
    b.textContent = 'Уведомления недоступны';
    return;
  }
  if (Notification.permission === 'granted') {
    b.disabled = true;
    b.textContent = 'Уведомления включены';
  } else if (Notification.permission === 'denied') {
    b.disabled = true;
    b.textContent = 'Уведомления запрещены в браузере';
  } else {
    b.disabled = false;
    b.textContent = 'Включить уведомления';
  }
}

function switchTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'portfolio') renderPortfolio();
  if (name === 'ideas' && !ideasLoaded) {
    ideasLoaded = true;
    runIdeas();
  }
}

function openAnalysis(secid) {
  $('#ticker').value = secid;
  switchTab('analysis');
  runAnalysis(secid);
}

let aiHistory = [];
let aiBusy = false;
let aiEnabled = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderAiChat(typing) {
  const box = $('#ai-chat');
  let html = aiHistory.map((m) =>
    '<div class="msg ' + (m.role === 'user' ? 'msg-user' : 'msg-bot') + '">' +
    esc(m.content).replace(/\n/g, '<br>') + '</div>').join('');
  if (typing) html += '<div class="msg msg-bot msg-typing">Думаю…</div>';
  if (!html) {
    html = '<div class="msg msg-bot">Привет! Я помощник по акциям. Спроси, что лучше купить из идей и почему, ' +
      'или упомяни тикер — расскажу, что видно по бумаге прямо сейчас.</div>';
  }
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

async function initAi() {
  try {
    const d = await api('/api/ai/status');
    aiEnabled = !!d.enabled;
  } catch {
    aiEnabled = false;
  }
  if (!aiEnabled) {
    $('#ai-text').disabled = true;
    $('#btn-ai-send').disabled = true;
    $$('#ai-panel .ai-suggest button').forEach((b) => { b.disabled = true; });
    $('#ai-error').textContent = 'Помощник не настроен: нужен бесплатный API-ключ (GigaChat или ЯндексGPT). Инструкция — в README, раздел «ИИ-помощник».';
  }
  renderAiChat(false);
}

async function sendAi(text) {
  const msg = (text || $('#ai-text').value || '').trim();
  if (!msg || aiBusy || aiEnabled === false) return;
  $('#ai-text').value = '';
  aiHistory.push({ role: 'user', content: msg });
  renderAiChat(true);
  aiBusy = true;
  $('#btn-ai-send').disabled = true;
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        history: aiHistory.slice(0, -1).slice(-6),
        portfolio: portfolio.map((p) => ({ secid: p.secid, qty: p.qty, buyPrice: p.buyPrice, divPerShare: p.divPerShare })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    aiHistory.push({ role: 'assistant', content: String(d.answer || '(пустой ответ)') });
  } catch (e) {
    aiHistory.push({ role: 'assistant', content: 'Ошибка: ' + e.message });
  } finally {
    aiBusy = false;
    $('#btn-ai-send').disabled = aiEnabled === false;
    renderAiChat(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#search').addEventListener('input', renderOverview);
  $$('#ov-table th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    sortDir = (sortKey === k) ? -sortDir : -1;
    sortKey = k;
    renderOverview();
  }));
  $('#ov-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-secid]');
    if (tr) openAnalysis(tr.dataset.secid);
  });
  $('#rec-table').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-secid]');
    if (tr && !e.target.closest('button')) openAnalysis(tr.dataset.secid);
  });
  $('#pf-table').addEventListener('click', (e) => {
    const del = e.target.closest('button[data-del]');
    if (del) {
      portfolio.splice(+del.dataset.del, 1);
      savePortfolio();
      renderPortfolio();
      return;
    }
    const tr = e.target.closest('tr[data-secid]');
    if (tr) openAnalysis(tr.dataset.secid);
  });
  $('#btn-analyze').addEventListener('click', () => runAnalysis());
  $('#ticker').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnalysis(); });
  $('#btn-scan').addEventListener('click', runScan);
  $('#btn-ideas').addEventListener('click', runIdeas);
  $('#ideas-table').addEventListener('click', (e) => {
    const add = e.target.closest('button[data-add]');
    if (add) {
      $('#pf-ticker').value = add.dataset.add;
      switchTab('portfolio');
      $('#pf-qty').focus();
      return;
    }
    const tr = e.target.closest('tr[data-secid]');
    if (tr) openAnalysis(tr.dataset.secid);
  });
  $('#btn-pf-add').addEventListener('click', addPosition);
  $('#btn-pf-refresh').addEventListener('click', renderPortfolio);
  $$('#pf-toolbar input').forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPosition(); }));
  $('#btn-alerts').addEventListener('click', () => {
    const p = $('#alerts-panel');
    p.hidden = !p.hidden;
    if (!p.hidden) {
      seenAlertTs = Date.now();
      localStorage.setItem('moex_alerts_seen', String(seenAlertTs));
      updateAlertBadge();
    }
  });
  $('#alerts-list').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-secid]');
    if (li) {
      $('#alerts-panel').hidden = true;
      openAnalysis(li.dataset.secid);
    }
  });
  $('#btn-notify').addEventListener('click', async () => {
    if (!('Notification' in window)) return;
    try { await Notification.requestPermission(); } catch {}
    refreshNotifyButton();
    pollAlerts();
  });
  refreshNotifyButton();
  renderAlerts();
  pollAlerts();
  setInterval(pollAlerts, 60000);
  $('#btn-ai').addEventListener('click', () => {
    const p = $('#ai-panel');
    p.hidden = !p.hidden;
    if (!p.hidden) $('#ai-text').focus();
  });
  $('#btn-ai-send').addEventListener('click', () => sendAi());
  $('#ai-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAi(); });
  $('#btn-ai-clear').addEventListener('click', () => { aiHistory = []; renderAiChat(false); });
  $$('#ai-panel .ai-suggest button').forEach((b) => b.addEventListener('click', () => sendAi(b.dataset.q)));
  initAi();
  loadCalcInputs();
  $$('#tab-portfolio .calc-grid input').forEach((inp) => inp.addEventListener('input', () => {
    saveCalcInputs();
    renderCalc();
  }));
  renderCalc();
  loadSecurities();
  setInterval(() => {
    if ($('#tab-overview').classList.contains('active')) loadSecurities();
    else if ($('#tab-portfolio').classList.contains('active')) renderPortfolio();
  }, 60000);
});
