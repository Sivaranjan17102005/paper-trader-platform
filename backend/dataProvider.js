import fetch from 'node-fetch';

const BASE_URL = 'https://api.coingecko.com/api/v3';
const TTL_MS = 60_000;
const cache = new Map();
const requestTimes = [];

async function request(path) {
  const url = `${BASE_URL}${path}`;
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < TTL_MS) return cached.data;
  const now = Date.now();
  while (requestTimes.length && now - requestTimes[0] >= 60_000) requestTimes.shift();
  if (requestTimes.length >= 10) {
    const wait = 60_000 - (now - requestTimes[0]);
    await new Promise(resolve => setTimeout(resolve, wait));
    return request(path);
  }
  requestTimes.push(Date.now());
  const headers = { accept: 'application/json' };
  if (process.env.COINGECKO_API_KEY?.trim()) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY.trim();
  let response;
  try { response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) }); }
  catch (error) { throw Object.assign(new Error(`CoinGecko request failed: ${error.message}`), { status: 502 }); }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`CoinGecko returned ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`), { status: response.status });
  }
  const data = await response.json();
  cache.set(url, { time: Date.now(), data });
  return data;
}

function rangeSize(days) { return Number(days) <= 1 ? 60 * 60 : Number(days) <= 90 ? 24 * 60 * 60 : 24 * 60 * 60; }

export async function getOHLC(coinId, days = 7) {
  days = Math.min(365, Math.max(1, Number(days) || 7));
  const rows = await request(`/coins/${encodeURIComponent(coinId)}/ohlc?vs_currency=usd&days=${days}`);
  return rows.map(([time, open, high, low, close]) => ({ time: Math.floor(time / 1000), open, high, low, close, volume: 0 }));
}

export async function getMarketChart(coinId, days = 7) {
  days = Math.min(365, Math.max(1, Number(days) || 7));
  const data = await request(`/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}`);
  const bucketSeconds = rangeSize(days), buckets = new Map();
  for (const [timestamp, price] of data.prices ?? []) {
    const time = Math.floor(timestamp / 1000 / bucketSeconds) * bucketSeconds;
    const bar = buckets.get(time);
    if (!bar) buckets.set(time, { time, open: price, high: price, low: price, close: price, volume: 0 });
    else { bar.high = Math.max(bar.high, price); bar.low = Math.min(bar.low, price); bar.close = price; }
  }
  for (const [timestamp, volume] of data.total_volumes ?? []) {
    const time = Math.floor(timestamp / 1000 / bucketSeconds) * bucketSeconds;
    if (buckets.has(time)) buckets.get(time).volume = volume;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

export async function getCurrentPrice(coinId) {
  const prices = await getCurrentPrices([coinId]);
  return prices[coinId].price;
}

export async function getCurrentPrices(coinIds) {
  const ids = [...new Set(coinIds)].filter(Boolean);
  const data = await request(`/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_last_updated_at=true`);
  const prices = {};
  for (const id of ids) {
    const price = data?.[id]?.usd;
    if (Number.isFinite(price)) prices[id] = { price, sourceUpdatedAt: data[id].last_updated_at ?? null };
  }
  if (!Object.keys(prices).length) throw Object.assign(new Error('CoinGecko returned no USD prices.'), { status: 404 });
  return prices;
}

