'use strict';

function forecast(candles, horizon = 30) {
  const n = candles.length;
  const basis = Math.min(n, 120);
  if (basis < 30) return null;
  const slice = candles.slice(n - basis);
  const ys = slice.map((c) => Math.log(c.c));
  const N = ys.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < N; i++) {
    sx += i;
    sy += ys[i];
    sxx += i * i;
    sxy += i * ys[i];
  }
  const denom = N * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (N * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / N;
  const meanY = sy / N;
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < N; i++) {
    const f = intercept + slope * i;
    sse += (ys[i] - f) ** 2;
    sst += (ys[i] - meanY) ** 2;
  }
  const r2 = sst > 0 ? 1 - sse / sst : 0;
  const sd = Math.sqrt(sse / N);

  const lastDate = new Date(slice[N - 1].t + 'T00:00:00Z');
  const points = [];
  const r2f = (x) => +x.toFixed(2);
  for (let i = 1; i <= horizon; i++) {
    const ly = intercept + slope * (N - 1 + i);
    const band = sd * Math.sqrt(i);
    const d = new Date(lastDate.getTime());
    let added = 0;
    while (added < i) {
      d.setUTCDate(d.getUTCDate() + 1);
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    points.push({
      date: d.toISOString().slice(0, 10),
      forecast: r2f(Math.exp(ly)),
      lo1: r2f(Math.exp(ly - band)),
      hi1: r2f(Math.exp(ly + band)),
      lo2: r2f(Math.exp(ly - 2 * band)),
      hi2: r2f(Math.exp(ly + 2 * band)),
    });
  }
  const trendYearPct = +(Math.exp(slope * 252) - 1) * 100;
  return {
    points,
    r2: +r2.toFixed(3),
    trendYearPct: +trendYearPct.toFixed(1),
    basisDays: N,
  };
}

module.exports = { forecast };
