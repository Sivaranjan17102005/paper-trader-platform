import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dataProvider from './dataProvider.js';
import * as tradeEngine from './tradeEngine.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendPath = path.resolve(__dirname, '../frontend');
const coins = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }, { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' }, { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' }, { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot' }, { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin' }, { id: 'matic-network', symbol: 'POL', name: 'Polygon' }
];
const coinBySymbol = Object.fromEntries(coins.map(c => [c.symbol, c.id]));
const subscribers = new Set();
let latestMarketUpdate = null;
const marketIntervalMs = 60_000;

app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use(express.static(frontendPath));

const route = handler => async (req, res) => {
  try { await handler(req, res); }
  catch (error) {
    console.error(`[${req.method} ${req.originalUrl}]`, error);
    res.status(Number(error.status) || 500).json({ error: error.message || 'Unexpected server error.' });
  }
};

app.get('/api/coins', route((_req, res) => res.json(coins)));
app.get('/api/ohlc/:coinId', route(async (req, res) => {
  const coin = coins.find(c => c.id === req.params.coinId);
  if (!coin) return res.status(404).json({ error: 'Unknown coin.' });
  res.json(await dataProvider.getOHLC(coin.id, req.query.days ?? 7));
}));
app.get('/api/price/:coinId', route(async (req, res) => {
  if (!coins.some(c => c.id === req.params.coinId)) return res.status(404).json({ error: 'Unknown coin.' });
  res.json({ price: await dataProvider.getCurrentPrice(req.params.coinId) });
}));
app.get('/api/state', route((_req, res) => res.json(tradeEngine.getState())));
app.get('/api/market', route((_req, res) => res.json(latestMarketUpdate ?? { status: 'connecting', quotes: {} })));
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  if (latestMarketUpdate) res.write(`event: market\ndata: ${JSON.stringify(latestMarketUpdate)}\n\n`);
  subscribers.add(res);
  req.on('close', () => subscribers.delete(res));
});
app.post('/api/trade/enter', route((req, res) => res.json(tradeEngine.enterTrade(req.body ?? {}))));
app.post('/api/trade/exit', route((req, res) => res.json(tradeEngine.exitTrade(req.body ?? {}))));
app.post('/api/reset', route((_req, res) => res.json(tradeEngine.resetAccount())));

app.use((err, _req, res, _next) => {
  console.error('[Express error]', err);
  res.status(400).json({ error: err.message || 'Bad request.' });
});

app.listen(PORT, () => console.log(`Paper Trader running on http://localhost:${PORT}`));

async function refreshMarket() {
  try {
    const byId = await dataProvider.getCurrentPrices(coins.map(coin => coin.id));
    const quotes = Object.fromEntries(coins.filter(coin => byId[coin.id]).map(coin => [coin.symbol, byId[coin.id]]));
    tradeEngine.updatePrices(Object.fromEntries(Object.entries(quotes).map(([symbol, quote]) => [symbol, quote.price])));
    latestMarketUpdate = { status: 'live', updatedAt: new Date().toISOString(), quotes, state: tradeEngine.getState() };
    const event = `event: market\ndata: ${JSON.stringify(latestMarketUpdate)}\n\n`;
    for (const client of subscribers) client.write(event);
    console.log(`Market feed refreshed: ${Object.keys(quotes).join(', ')}`);
  } catch (error) {
    console.error(`Market feed refresh failed: ${error.message}`);
    const update = { status: 'delayed', updatedAt: latestMarketUpdate?.updatedAt ?? null, error: error.message };
    const event = `event: feed-status\ndata: ${JSON.stringify(update)}\n\n`;
    for (const client of subscribers) client.write(event);
  }
}

refreshMarket();
setInterval(refreshMarket, marketIntervalMs).unref();

