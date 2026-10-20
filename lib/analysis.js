'use strict';

function sma(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += values[i];
  e /= period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function macd(closes) {
  if (closes.length < 35) return { macd: null, signal: null, hist: null, cross: null };
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const line = closes.map((_, i) => (fast[i] != null && slow[i] != null) ? fast[i] - slow[i] : null);
  const valid = line.filter((v) => v != null);
  if (valid.length < 10) return { macd: null, signal: null, hist: null, cross: null };
  const sig = emaSeries(valid, 9);
  const macdVal = line[line.length - 1];
  const signalVal = sig[sig.length - 1];
  const prevMacd = line[line.length - 2];
  const prevSignal = sig[sig.length - 2];
  let cross = null;
  if (prevMacd != null && prevSignal != null && macdVal != null && signalVal != null) {
    if (prevMacd <= prevSignal && macdVal > signalVal) cross = 'up';
    else if (prevMacd >= prevSignal && macdVal < signalVal) cross = 'down';
  }
  return {
    macd: macdVal,
    signal: signalVal,
    hist: macdVal != null && signalVal != null ? macdVal - signalVal : null,
    cross,
  };
}

function bollinger(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const mean = sma(closes, period);
  let sq = 0;
  for (let i = closes.length - period; i < closes.length; i++) sq += (closes[i] - mean) ** 2;
  const sd = Math.sqrt(sq / period);
  return { mid: mean, upper: mean + mult * sd, lower: mean - mult * sd };
}

function analyze(candles) {
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes);
  const m = macd(closes);
  const bb = bollinger(closes);

  const signals = [];
  let score = 0;

  if (sma20 != null && sma50 != null) {
    if (last > sma20 && sma20 > sma50) {
      score += 2;
      signals.push({ s: 'Тренд вверх: цена выше SMA20, SMA20 выше SMA50', w: 2 });
    } else if (last < sma20 && sma20 < sma50) {
      score -= 2;
      signals.push({ s: 'Тренд вниз: цена ниже SMA20, SMA20 ниже SMA50', w: -2 });
    }
  }
  if (sma50 != null && sma200 != null) {
    if (sma50 > sma200) {
      score += 2;
      signals.push({ s: 'Золотой крест: SMA50 выше SMA200', w: 2 });
    } else {
      score -= 2;
      signals.push({ s: 'Мёртвый крест: SMA50 ниже SMA200', w: -2 });
    }
  }
  if (rsi14 != null) {
    if (rsi14 < 30) {
      score += 2;
      signals.push({ s: 'Перепроданность: RSI ' + rsi14.toFixed(1) + ' < 30', w: 2 });
    } else if (rsi14 > 70) {
      score -= 2;
      signals.push({ s: 'Перекупленность: RSI ' + rsi14.toFixed(1) + ' > 70', w: -2 });
    }
  }
  if (m.cross === 'up') {
    score += 1.5;
    signals.push({ s: 'MACD пересёк сигнальную линию снизу вверх', w: 1.5 });
  } else if (m.cross === 'down') {
    score -= 1.5;
    signals.push({ s: 'MACD пересёк сигнальную линию сверху вниз', w: -1.5 });
  }
  if (bb) {
    if (last <= bb.lower) {
      score += 1;
      signals.push({ s: 'Цена у нижней границы Bollinger', w: 1 });
    } else if (last >= bb.upper) {
      score -= 1;
      signals.push({ s: 'Цена у верхней границы Bollinger', w: -1 });
    }
  }

  let verdict = 'ДЕРЖАТЬ';
  if (score >= 4) verdict = 'СИЛЬНАЯ ПОКУПКА';
  else if (score >= 2) verdict = 'ПОКУПКА';
  else if (score <= -4) verdict = 'СИЛЬНАЯ ПРОДАЖА';
  else if (score <= -2) verdict = 'ПРОДАЖА';

  return {
    price: last,
    sma: { 20: sma20, 50: sma50, 200: sma200 },
    rsi: rsi14,
    macd: { macd: m.macd, signal: m.signal, hist: m.hist },
    bollinger: bb,
    score,
    verdict,
    signals,
    candlesCount: closes.length,
  };
}

module.exports = { analyze, sma, emaSeries, rsi, macd, bollinger };
