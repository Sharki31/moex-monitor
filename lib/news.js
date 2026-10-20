'use strict';

const cache = require('./cache');

const FEEDS = [
  { name: 'Интерфакс', url: 'https://www.interfax.ru/rss.asp' },
  { name: 'Коммерсантъ', url: 'https://www.kommersant.ru/RSS/news.xml' },
  { name: 'Ведомости', url: 'https://www.vedomosti.ru/rss/news' },
  { name: 'ТАСС', url: 'https://tass.ru/rss/v2.xml' },
];

const FEED_TTL = 10 * 60 * 1000;
const MAX_AGE = 7 * 86400000;
const PER_SOURCE = 80;
const MAX_ITEMS = 400;

const POS = [
  [/превзош[её]?л|превосход|лучше ожидан|выше ожидан/i, 2],
  [/байбэк|выкуп акци/i, 2],
  [/рекордн/i, 1],
  [/вырос|подорожал|прибавил/i, 1],
  [/повысил|повышен|увеличил/i, 1],
  [/прибыл|выручк|доход/i, 1],
  [/дивиденд/i, 1],
  [/восстановл|оживлен|расширил|запустил|подписал контракт|выиграл тендер/i, 1],
];

const NEG = [
  [/дефолт|банкрот/i, 3],
  [/убыток|убыточн/i, 2],
  [/санкц/i, 2],
  [/штраф|арест|обыск|расследован|уголовн/i, 2],
  [/иск против|иск к /i, 1],
  [/упал|обвал|паден|снизил|снижен|просел|дешеве|понизил|понижен/i, 1],
  [/сократ|уволен|увольнен/i, 1],
  [/прекрат|приостанов|остановил|остановка|отзыв лиценз|отозвал/i, 1],
  [/реструктуризац|проблем|кризис|скандал/i, 1],
];

const ALIASES = {
  SBER: 'сбербанк|сбер',
  SBERP: 'сбербанк|сбер',
  VTBR: 'втб',
  GAZP: 'газпром',
  LKOH: 'лукойл',
  ROSN: 'роснефт',
  TATN: 'татнефт',
  NVTK: 'новатэк',
  SNGS: 'сургутнефтегаз',
  SNGSP: 'сургутнефтегаз',
  GMKN: 'норникель|норильский никель',
  PLZL: 'полюс',
  YDEX: 'яндекс',
  T: 'т-технолог|тинькофф|т-банк|\\btcs\\b',
  MGNT: 'магнит(?!огорск)',
  X5: '\\bx5\\b',
  MTSS: 'мтс',
  CHMF: 'северсталь',
  NLMK: 'нлмк',
  MAGN: 'ммк|магнитогорск',
  ALRS: 'алроса',
  PHOR: 'фосагро',
  RUAL: 'русал|en\\+',
  AFLT: 'аэрофлот',
  IRAO: 'интер рао|интеррао',
  FEES: 'россет',
  HYDR: 'русгидро',
  RTKM: 'ростелеком',
  SIBN: 'газпром нефть|газпромнефт',
  BANEP: 'башнефть',
  AFKS: 'афк система',
  PIKK: '«пик»|группа пик',
  OZON: 'озон',
  VKCO: 'вконтакте|\\bvk\\b',
  SMLT: 'самолет',
  TRNFP: 'транснефт',
};

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.text();
}

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  if (m) {
    const v = decode(m[1]);
    if (v) return v;
  }
  if (tag === 'link') {
    const h = block.match(/<link[^>]*href="([^"]+)"/i);
    if (h) return h[1];
  }
  return null;
}

function parseRss(xml, source) {
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/\1>/g) || [];
  const items = [];
  for (const b of blocks) {
    const title = pick(b, 'title');
    if (!title) continue;
    const link = pick(b, 'link');
    const pub = pick(b, 'pubDate') || pick(b, 'updated') || pick(b, 'published');
    let ts = pub ? Date.parse(pub) : NaN;
    if (isNaN(ts)) ts = Date.now();
    items.push({ source, title, link, ts });
  }
  return items;
}

function scoreHeadline(title) {
  const t = title.replace(/ё/g, 'е');
  let score = 0;
  for (const [re, w] of POS) if (re.test(t)) score += w;
  for (const [re, w] of NEG) if (re.test(t)) score -= w;
  return Math.max(-3, Math.min(3, score));
}

const reCache = {};

function companyRe(secid) {
  if (!ALIASES[secid]) return null;
  if (!(secid in reCache)) {
    try {
      reCache[secid] = new RegExp('(?<![а-яёa-z])(' + ALIASES[secid] + ')', 'i');
    } catch {
      reCache[secid] = null;
    }
  }
  return reCache[secid];
}

function matchCompany(items, secid) {
  const re = companyRe(secid);
  if (!re) return null;
  let pos = 0;
  let neg = 0;
  const matched = [];
  for (const it of items) {
    if (!re.test(it.title)) continue;
    const tone = scoreHeadline(it.title);
    if (tone > 0) pos++;
    else if (tone < 0) neg++;
    matched.push({ ...it, tone });
  }
  matched.sort((a, b) => b.ts - a.ts);
  return { score: pos - neg, pos, neg, matched: matched.slice(0, 12) };
}

async function getFeed() {
  const fresh = cache.get('news:feed', FEED_TTL);
  if (fresh) return fresh;
  const settled = await Promise.allSettled(FEEDS.map(async (fd) => parseRss(await fetchText(fd.url), fd.name)));
  let items = [];
  const sources = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const latest = r.value.sort((a, b) => b.ts - a.ts).slice(0, PER_SOURCE);
      items = items.concat(latest);
      sources.push(FEEDS[i].name);
    } else {
      errors.push(FEEDS[i].name);
    }
  });
  const cutoff = Date.now() - MAX_AGE;
  const seen = new Set();
  items = items
    .filter((it) => it.ts >= cutoff)
    .filter((it) => {
      const k = it.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_ITEMS);
  if (items.length) {
    const feed = { items, sources, errors, fetchedAt: new Date().toISOString() };
    cache.set('news:feed', feed);
    return feed;
  }
  const stale = cache.getStale('news:feed');
  if (stale) return { ...stale, stale: true };
  return { items: [], sources, errors, fetchedAt: new Date().toISOString() };
}

module.exports = { getFeed, matchCompany, scoreHeadline };
