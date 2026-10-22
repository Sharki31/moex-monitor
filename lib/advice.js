'use strict';

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

module.exports = { advice, reasonText };
