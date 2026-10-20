'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

function loadEnvFile() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '..', 'ai.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && m[2] !== '' && process.env[m[1]] == null) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnvFile();

const MAX_PER_HOUR = 20;
const TIMEOUT_MS = 90000;
const hits = [];
let gigaToken = null;

function cfg() {
  return {
    provider: (process.env.AI_PROVIDER || 'giga').toLowerCase(),
    key: (process.env.AI_API_KEY || '').trim(),
    model: (process.env.AI_MODEL || '').trim(),
    baseUrl: (process.env.AI_BASE_URL || '').trim(),
    folderId: (process.env.AI_FOLDER_ID || '').trim(),
  };
}

function isConfigured() {
  return !!cfg().key;
}

function getStatus() {
  const c = cfg();
  const defModel = { yandex: 'yandexgpt-lite', giga: 'GigaChat', openai: 'gpt-4o-mini' }[c.provider] || 'gpt-4o-mini';
  return {
    enabled: !!c.key,
    provider: c.provider,
    model: c.model || defModel,
    dryRun: process.env.AI_DRY_RUN === '1',
    limitPerHour: MAX_PER_HOUR,
  };
}

function checkRate() {
  const now = Date.now();
  while (hits.length && now - hits[0] > 3600 * 1000) hits.shift();
  if (hits.length >= MAX_PER_HOUR) {
    return { ok: false, retrySec: Math.ceil((3600 * 1000 - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  return { ok: true };
}

function buildSystemPrompt(context) {
  const d = context;
  const lines = [];
  lines.push('Ты — вежливый помощник по акциям внутри веб-приложения «Монитор акций Мосбиржи».');
  lines.push('Пользователь — начинающий частный инвестор из России с целью пассивного дивидендного дохода.');
  lines.push('Отвечай по-русски, простым языком, коротко и по делу.');
  lines.push('');
  lines.push('ДАННЫЕ ПРИЛОЖЕНИЯ НА СЕГОДНЯ:');
  lines.push('Дата: ' + d.now + '; торги открыты: ' + (d.marketOpen ? 'да' : 'нет') + '.');
  if (d.ideas && d.ideas.length) {
    lines.push('ТОП-ИДЕИ (технический скоринг крупнейших 40 компаний рынка):');
    for (const i of d.ideas) {
      lines.push('- ' + i.secid + ' (' + i.name + '): цена ' + i.price + ' ₽, совет: ' + i.advice +
        ', скор ' + i.score + ', RSI ' + i.rsi + ', от максимума года ' + i.drawdownPct + '%' +
        ', новостной тон ' + (i.newsScore == null ? '—' : i.newsScore) + '. Почему: ' + i.reason);
    }
  }
  if (d.alerts && d.alerts.length) {
    lines.push('СИГНАЛЫ РЕЗКИХ ПАДЕНИЙ ЗА ПОСЛЕДНИЕ СУТКИ:');
    for (const a of d.alerts) lines.push('- ' + a.secid + ' (' + a.name + '): ' + a.changePct + '% за день, цена ' + a.price + ' ₽');
  } else {
    lines.push('Сигналов резких падений сейчас нет.');
  }
  if (d.focus && d.focus.length) {
    lines.push('ЗАПРОШЕННЫЕ ПОЛЬЗОВАТЕЛЕМ БУМАГИ (подробно):');
    for (const f of d.focus) {
      const a = f.analysis || {};
      let s = '- ' + f.secid + ' (' + (f.name || '') + '): цена ' + f.price + ' ₽, вердикт ' + a.verdict +
        ', скор ' + a.score + ', RSI ' + a.rsi +
        ', SMA20 ' + a.sma20 + ', SMA50 ' + a.sma50 + ', SMA200 ' + a.sma200 +
        ', тренд за год ' + a.trendPct + '%, прогноз на 30 дней ' + a.forecast30 + ' ₽';
      if (f.news) {
        s += '; новости: тон ' + f.news.score + ' (' + f.news.pos + ' поз. / ' + f.news.neg + ' нег.)';
        if (f.news.titles.length) s += ', например: «' + f.news.titles.join('»; «') + '»';
      }
      lines.push(s);
    }
  }
  if (d.portfolio && d.portfolio.length) {
    lines.push('ПОРТФЕЛЬ ПОЛЬЗОВАТЕЛЯ (хранится только у него в браузере):');
    for (const p of d.portfolio) {
      lines.push('- ' + p.secid + ': ' + p.qty + ' шт.' +
        (p.buyPrice ? ', куплено по ' + p.buyPrice + ' ₽' : '') +
        (p.divPerShare ? ', дивиденд ' + p.divPerShare + ' ₽ на акцию в год' : ''));
    }
  } else {
    lines.push('Портфель пользователя пуст или не передан.');
  }
  lines.push('');
  lines.push('ПРАВИЛА:');
  lines.push('1) Ты образовательный помощник, а не индивидуальная инвестиционная рекомендация. Не обещай доходность и не говори «обязательно покупай».');
  lines.push('2) Конкретные бумаги обсуждай только на основе данных выше. Не выдумывай цены, дивиденды и новости, которых нет в данных.');
  lines.push('3) На вопрос «что купить» — выбери 2-3 кандидата из ТОП-ИДЕЙ с лучшим советом, объясни причины (скор, RSI, тренд, просадка), напомни про диверсификацию: 3-5 бумаг из разных отраслей, равными частями, и малые суммы на старте.');
  lines.push('4) Если данных не хватает (например, история дивидендов) — честно скажи и подскажи, где проверить: moex.com (страница бумаги, вкладка «Дивиденды») и smart-lab.ru.');
  lines.push('5) Термины (RSI, SMA, скор, дивидендный гэп, отсечка) объясняй простыми словами с примерами, если пользователь может их не знать.');
  lines.push('6) Отвечай компактно — обычно до 150-200 слов.');
  return lines.join('\n');
}

async function fetchChatCompletion(url, headers, bodyObj) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(bodyObj),
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let j = null;
    try { j = JSON.parse(txt); } catch {}
    if (!res.ok) {
      const msg = j && j.error && (j.error.message || j.error.description || j.error.code);
      throw new Error('HTTP ' + res.status + (msg ? ': ' + msg : ': ' + String(txt).slice(0, 200)));
    }
    const m = j && j.choices && j.choices[0] && j.choices[0].message;
    if (!m || !m.content) throw new Error('Пустой ответ модели');
    return String(m.content);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Модель отвечала слишком долго — попробуй ещё раз');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function httpsPostJson(urlStr, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({ 'Content-Length': Buffer.byteLength(bodyStr) }, headers),
      rejectUnauthorized: false,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode, json: j, text: buf });
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Таймаут запроса')));
    req.write(bodyStr);
    req.end();
  });
}

async function getGigaToken(key) {
  if (gigaToken && gigaToken.exp > Date.now() + 60 * 1000) return gigaToken.tok;
  const r = await httpsPostJson('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    Authorization: 'Basic ' + key,
    RqUID: crypto.randomUUID(),
    Accept: 'application/json',
  }, JSON.stringify({ scope: process.env.AI_GIGA_SCOPE || 'GIGACHAT_API_PERS' }));
  if (r.status !== 200 || !r.json || !r.json.access_token) {
    throw new Error('GigaChat: не удалось получить токен (HTTP ' + r.status + ') ' + String(r.text).slice(0, 200));
  }
  gigaToken = { tok: r.json.access_token, exp: r.json.expires_at || Date.now() + 25 * 60 * 1000 };
  return gigaToken.tok;
}

async function gigaChat(c, messages) {
  const tok = await getGigaToken(c.key);
  const r = await httpsPostJson('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
    Authorization: 'Bearer ' + tok,
    Accept: 'application/json',
  }, JSON.stringify({ model: c.model || 'GigaChat', messages, temperature: 0.4, max_tokens: 800 }));
  if (r.status !== 200) throw new Error('GigaChat HTTP ' + r.status + ': ' + String(r.text).slice(0, 200));
  const m = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message;
  if (!m || !m.content) throw new Error('GigaChat: пустой ответ');
  return String(m.content);
}

async function yandexChat(c, messages) {
  const url = c.baseUrl || 'https://llm.api.cloud.yandex.net/openai/v1/chat/completions';
  const headers = { Authorization: 'Api-Key ' + c.key };
  if (c.folderId) headers['x-folder-id'] = c.folderId;
  return fetchChatCompletion(url, headers, {
    model: c.model || 'yandexgpt-lite',
    messages,
    temperature: 0.4,
    max_tokens: 800,
  });
}

async function openaiChat(c, messages) {
  const url = c.baseUrl || 'https://api.openai.com/v1/chat/completions';
  return fetchChatCompletion(url, { Authorization: 'Bearer ' + c.key }, {
    model: c.model || 'gpt-4o-mini',
    messages,
    temperature: 0.4,
    max_tokens: 800,
  });
}

async function chat({ message, history, context }) {
  if (process.env.AI_DRY_RUN === '1') {
    return {
      answer: '[DRY RUN] Вопрос: ' + message + '\n\nКонтекст, который ушёл бы модели:\n' +
        JSON.stringify(context, null, 1).slice(0, 2500),
      dryRun: true,
    };
  }
  const c = cfg();
  if (!c.key) throw new Error('Ключ ИИ не настроен');
  const messages = [{ role: 'system', content: buildSystemPrompt(context) }]
    .concat(history || [])
    .concat([{ role: 'user', content: message }]);
  let text;
  if (c.provider === 'giga') text = await gigaChat(c, messages);
  else if (c.provider === 'yandex') text = await yandexChat(c, messages);
  else text = await openaiChat(c, messages);
  return { answer: String(text).trim() };
}

module.exports = { isConfigured, getStatus, checkRate, chat };
