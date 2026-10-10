// Browser-only backend used on GitHub Pages. Each visitor keeps an isolated
// paper account in their own browser; no server or credentials are exposed.
const BASE_URL = 'https://api.coingecko.com/api/v3';
const ACCOUNT_KEY = 'paper-trader-account-v1';
const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }, { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' }, { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' }, { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot' }, { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin' }, { id: 'matic-network', symbol: 'POL', name: 'Polygon' }
];
const coinBySymbol = Object.fromEntries(COINS.map(coin => [coin.symbol, coin]));
const startingState = () => ({ cash: 1_000_000, positions: [], trades: [], equityCurve: [], totalEquity: 1_000_000 });

function readState() {
  try { return { ...startingState(), ...JSON.parse(localStorage.getItem(ACCOUNT_KEY) || '{}') }; }
  catch { return startingState(); }
}
let account = readState();
function snapshot() {
  account.totalEquity = account.cash + account.positions.reduce((total, position) => total + position.qty * (position.currentPrice ?? position.entryPrice), 0);
  return structuredClone(account);
}
function persist() { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account)); return snapshot(); }
function positive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a number greater than zero.`);
  return number;
}
async function getPrices(ids) {
  const query = new URLSearchParams({ ids: ids.join(','), vs_currencies: 'usd', include_last_updated_at: 'true' });
  const response = await fetch(`${BASE_URL}/simple/price?${query}`);
  if (!response.ok) throw new Error(`CoinGecko returned ${response.status}.`);
  return response.json();
}
async function marketUpdate() {
  const data = await getPrices(COINS.map(coin => coin.id));
  const quotes = {};
  for (const coin of COINS) {
    const quote = data[coin.id];
    if (Number.isFinite(quote?.usd)) quotes[coin.symbol] = { price: quote.usd, sourceUpdatedAt: quote.last_updated_at ?? null };
  }
  if (!Object.keys(quotes).length) throw new Error('CoinGecko returned no prices.');
  const priceMap = Object.fromEntries(Object.entries(quotes).map(([symbol, quote]) => [symbol, quote.price]));
  for (const position of account.positions) {
    if (priceMap[position.symbol]) {
      position.currentPrice = priceMap[position.symbol];
      position.unrealizedPnL = (position.currentPrice - position.entryPrice) * position.qty;
    }
  }
  account.equityCurve.push({ time: Date.now(), equity: account.cash + account.positions.reduce((sum, position) => sum + position.qty * position.currentPrice, 0) });
  if (account.equityCurve.length > 1000) account.equityCurve.splice(0, account.equityCurve.length - 1000);
  persist();
  return { status: 'live', updatedAt: new Date().toISOString(), quotes, state: snapshot() };
}
async function handle(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (url === '/api/coins') return COINS;
  if (url === '/api/state') return snapshot();
  if (url === '/api/market' && method === 'GET') return marketUpdate();
  const parsed = new URL(url, location.origin);
  const priceRoute = parsed.pathname.match(/^\/api\/price\/([^/]+)$/);
  if (priceRoute && method === 'GET') {
    const id = decodeURIComponent(priceRoute[1]);
    if (!COINS.some(coin => coin.id === id)) throw new Error('Unknown coin.');
    const data = await getPrices([id]);
    if (!Number.isFinite(data[id]?.usd)) throw new Error(`No USD price returned for ${id}.`);
    return { price: data[id].usd };
  }
  const ohlcRoute = parsed.pathname.match(/^\/api\/ohlc\/([^/]+)$/);
  if (ohlcRoute && method === 'GET') {
    const id = decodeURIComponent(ohlcRoute[1]);
    if (!COINS.some(coin => coin.id === id)) throw new Error('Unknown coin.');
    const days = Math.min(365, Math.max(1, Number(parsed.searchParams.get('days')) || 7));
    const response = await fetch(`${BASE_URL}/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`);
    if (!response.ok) throw new Error(`CoinGecko returned ${response.status} for chart data.`);
    return (await response.json()).map(([time, open, high, low, close]) => ({ time: Math.floor(time / 1000), open, high, low, close, volume: 0 }));
  }
  const body = JSON.parse(options.body || '{}');
  if (url === '/api/trade/enter' && method === 'POST') {
    const symbol = String(body.symbol || '').trim().toUpperCase(), side = String(body.side || '').trim().toUpperCase();
    const qty = positive(body.qty, 'Quantity'), price = positive(body.price, 'Price');
    if (!coinBySymbol[symbol]) throw new Error('Unknown asset.');
    if (!['BUY', 'SELL'].includes(side)) throw new Error('Side must be BUY or SELL.');
    let position = account.positions.find(item => item.symbol === symbol);
    const signedQty = side === 'BUY' ? qty : -qty;
    if (position && Math.sign(position.qty) !== Math.sign(signedQty)) throw new Error(`Close the existing ${symbol} position before opening the other side.`);
    if (side === 'BUY' && account.cash < qty * price) throw new Error('Insufficient cash for this buy order.');
    if (side === 'SELL' && account.cash + qty * price < 0) throw new Error('Insufficient cash to support this short position.');
    if (!position) { position = { symbol, qty: 0, entryPrice: price, currentPrice: price, unrealizedPnL: 0, realizedPnL: 0 }; account.positions.push(position); }
    const previousQty = Math.abs(position.qty);
    position.entryPrice = ((position.entryPrice * previousQty) + price * qty) / (previousQty + qty);
    position.qty += signedQty; position.currentPrice = price; position.unrealizedPnL = (price - position.entryPrice) * position.qty;
    account.cash += side === 'BUY' ? -qty * price : qty * price;
    account.trades.unshift({ id: crypto.randomUUID(), time: Date.now(), symbol, side, action: 'OPEN', qty, price, realizedPnL: 0 });
    return persist();
  }
  if (url === '/api/trade/exit' && method === 'POST') {
    const symbol = String(body.symbol || '').trim().toUpperCase(), qty = positive(body.qty, 'Quantity'), price = positive(body.price, 'Price');
    const position = account.positions.find(item => item.symbol === symbol);
    if (!position) throw new Error(`No open position for ${symbol}.`);
    if (qty > Math.abs(position.qty) + 1e-10) throw new Error(`Cannot close more than ${Math.abs(position.qty)} ${symbol}.`);
    const direction = Math.sign(position.qty), realizedPnL = (price - position.entryPrice) * qty * direction;
    account.cash += direction > 0 ? qty * price : -qty * price;
    position.realizedPnL += realizedPnL; position.qty -= direction * qty;
    if (Math.abs(position.qty) < 1e-10) account.positions = account.positions.filter(item => item !== position);
    else { position.currentPrice = price; position.unrealizedPnL = (price - position.entryPrice) * position.qty; }
    account.trades.unshift({ id: crypto.randomUUID(), time: Date.now(), symbol, side: direction > 0 ? 'SELL' : 'BUY', action: 'CLOSE', qty, price, realizedPnL });
    return persist();
  }
  if (url === '/api/reset' && method === 'POST') { account = startingState(); return persist(); }
  throw new Error(`Unsupported app request: ${method} ${url}`);
}

export { handle as staticApi };

