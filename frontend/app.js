import { staticApi } from './static-api.js';

const $ = selector => document.querySelector(selector);
const money = value => Number(value ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = value => Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 8 });
const staticMode = !['localhost', '127.0.0.1'].includes(location.hostname);
const api = async (url, options = {}) => {
  if (staticMode) return staticApi(url, options);
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
};
const state = { coins: [], selected: null, days: 7, side: 'BUY', account: null, chartPane: null, chartProvider: null, toastTimer: null, chartReady: false, quotes: {}, chartBars: [], stream: null };

function toast(message, type = '') {
  const el = $('#toast'); el.textContent = message; el.className = `toast show ${type}`;
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.className = 'toast', 3800);
}
function setLoading(on) { $('#submit-order').disabled = on; $('#submit-order span').textContent = on ? 'Processing…' : `Place ${state.side === 'BUY' ? 'buy' : 'sell'} order`; }
function selectedCoin() { return state.coins.find(coin => coin.id === state.selected); }
function updateQuoteDisplay(price) {
  if (Number.isFinite(Number(price))) {
    $('#selected-price').textContent = money(price);
    if (document.activeElement !== $('#order-price')) $('#order-price').value = Number(price).toFixed(2);
  }
  const coin = selectedCoin();
  if (coin) {
    $('#selected-coin-name').textContent = coin.name;
    $('#order-symbol').value = coin.symbol;
    $('#qty-unit').textContent = coin.symbol;
    $('#chart-title').innerHTML = `${coin.name} <span>${coin.symbol} / USD</span>`;
  }
  updateEstimate();
}
function updateEstimate() {
  const qty = Number($('#order-qty').value), price = Number($('#order-price').value);
  $('#order-estimate strong').textContent = qty > 0 && price > 0 ? money(qty * price) : '—';
}
function symbolToId(symbol) { return state.coins.find(coin => coin.symbol.toUpperCase() === symbol.toUpperCase())?.id; }

async function initializeChart() {
  const chart = $('#chart');
  try {
    const { OakViewDataProvider } = await import('https://esm.sh/oakview');
    class ApiProvider extends OakViewDataProvider {
      async initialize() { return this; }
      async fetchHistorical(symbol, interval = state.days) {
        const coinId = symbolToId(symbol) || state.selected;
        if (!coinId) return [];
        const dayByInterval = { '1m': 1, '5m': 1, '15m': 1, '30m': 1, '1h': 1, '4h': 1, '1D': 1, '1W': 7, '1M': 30, '3M': 90, '1Y': 365 };
        const days = dayByInterval[interval] ?? (Number(interval) > 0 ? Number(interval) : state.days);
        return api(`/api/ohlc/${encodeURIComponent(coinId)}?days=${days}`);
      }
      async searchSymbols(query = '') {
        return state.coins.filter(coin => `${coin.name} ${coin.symbol}`.toLowerCase().includes(query.toLowerCase()));
      }
      getAvailableIntervals() { return ['1h', '4h', '1D', '1W', '1M']; }
    }
    await import('https://esm.sh/oakview');
    await customElements.whenDefined('oak-view');
    state.chartProvider = new ApiProvider();
    await state.chartProvider.initialize();
    chart.setDataProvider(state.chartProvider);
    state.chartPane = chart.getChartAt?.(0) ?? null;
    state.chartReady = true;
  } catch (error) {
    console.error('OakView initialization failed:', error);
    $('#chart-empty').classList.add('hidden');
    $('#chart-error').hidden = false;
    $('#chart-error').textContent = 'Chart library could not load. Check your internet connection and reload; market data and trading controls remain available.';
    state.chartReady = false;
  }
}

async function loadChart() {
  if (!state.selected) return;
  const empty = $('#chart-empty'), errorBox = $('#chart-error');
  empty.classList.remove('hidden'); empty.querySelector('p').textContent = 'Loading market data'; errorBox.hidden = true;
  try {
    const coin = selectedCoin();
    const bars = await api(`/api/ohlc/${encodeURIComponent(state.selected)}?days=${state.days}`);
    if (!Array.isArray(bars) || bars.length === 0) throw new Error('No chart bars were returned for this range.');
    const pane = state.chartPane;
    if (!pane && state.chartReady) state.chartPane = $('#chart').getChartAt?.(0) ?? null;
    const activePane = state.chartPane;
    state.chartBars = bars;
    if (activePane?.setData) activePane.setData(bars);
    else if (state.chartReady) throw new Error('Chart pane did not initialize. Reload the page to retry.');
    else throw new Error('Chart library is not available.');
    await state.chartProvider?.fetchHistorical(coin.symbol, state.days);
    $('#chart-updated').textContent = `UPDATED ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    console.error('Chart data load failed:', error);
    errorBox.hidden = false;
    errorBox.textContent = `${error.message} ${error.message.includes('CoinGecko') ? 'A free Demo API key can be added as COINGECKO_API_KEY in .env.' : ''}`;
  } finally { empty.classList.add('hidden'); }
}

async function loadPrice(coinId = state.selected) {
  if (!coinId) return;
  try { const data = await api(`/api/price/${encodeURIComponent(coinId)}`); if (coinId === state.selected) updateQuoteDisplay(data.price); }
  catch (error) { console.error('Price request failed:', error); if (coinId === state.selected) { $('#selected-price').textContent = 'Unavailable'; toast(error.message, 'error'); } }
}

function updateMarketChart(coinId, price, updatedAt) {
  if (coinId !== state.selected || !state.chartBars.length || !state.chartPane?.updateRealtime) return;
  const last = state.chartBars.at(-1), previous = state.chartBars.at(-2);
  const step = previous ? Math.max(60, last.time - previous.time) : 3600;
  const now = Math.floor(Date.now() / 1000), bucket = Math.floor(now / step) * step;
  const bar = bucket > last.time
    ? { time: bucket, open: last.close, high: Math.max(last.close, price), low: Math.min(last.close, price), close: price, volume: 0 }
    : { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
  state.chartPane.updateRealtime(bar);
  if (bucket > last.time) state.chartBars.push(bar); else state.chartBars[state.chartBars.length - 1] = bar;
  $('#chart-updated').textContent = `LIVE ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function setFeedStatus(status, detail = '') {
  const badge = $('#feed-status');
  badge.textContent = status === 'live' ? 'AUTO' : status === 'delayed' ? 'DELAYED' : status.toUpperCase();
  badge.title = detail || (status === 'live' ? 'CoinGecko quotes refresh about once per minute.' : 'Waiting for market data connection.');
  badge.parentElement.classList.toggle('feed-delayed', status === 'delayed');
}

function connectMarketStream() {
  if (staticMode) {
    setFeedStatus('connecting', 'Connecting to CoinGecko directly from this browser.');
    const refresh = async () => {
      try {
        const update = await api('/api/market');
        state.quotes = update.quotes ?? {};
        renderState(update.state);
        setFeedStatus('live', `Last update ${new Date(update.updatedAt).toLocaleString()}. Refreshes about once per minute.`);
        const selected = selectedCoin(), quote = selected && state.quotes[selected.symbol];
        if (quote) {
          updateQuoteDisplay(quote.price);
          updateMarketChart(selected.id, quote.price, update.updatedAt);
        }
      } catch (error) { setFeedStatus('delayed', error.message); }
    };
    refresh();
    state.stream = setInterval(refresh, 60_000);
    return;
  }
  state.stream?.close();
  setFeedStatus('connecting');
  const stream = new EventSource('/api/stream');
  state.stream = stream;
  stream.addEventListener('open', () => setFeedStatus('connecting', 'Connected; waiting for the next quote batch.'));
  stream.addEventListener('market', event => {
    const update = JSON.parse(event.data);
    state.quotes = update.quotes ?? {};
    renderState(update.state);
    setFeedStatus('live', `Last update ${new Date(update.updatedAt).toLocaleString()}. Refreshes about once per minute.`);
    const selected = selectedCoin(), quote = selected && state.quotes[selected.symbol];
    if (quote) {
      updateQuoteDisplay(quote.price);
      updateMarketChart(selected.id, quote.price, update.updatedAt);
    }
  });
  stream.addEventListener('feed-status', event => {
    const update = JSON.parse(event.data);
    setFeedStatus('delayed', update.error || 'Market feed is delayed.');
  });
  stream.onerror = () => setFeedStatus('delayed', 'Reconnecting to the market feed.');
}

function renderState(account) {
  state.account = account;
  $('#equity-value').textContent = money(account.totalEquity);
  $('#cash-value').textContent = money(account.cash);
  $('#position-count').textContent = account.positions.length;
  $('#trade-count').textContent = account.trades.length;
  const positionsBody = $('#positions-body'); positionsBody.replaceChildren();
  for (const position of account.positions) {
    const coin = state.coins.find(item => item.symbol === position.symbol);
    const row = document.createElement('tr');
    const side = position.qty > 0 ? 'LONG' : 'SHORT';
    const pnlClass = position.unrealizedPnL >= 0 ? 'positive' : 'negative';
    row.innerHTML = `<td class="asset-cell">${coin?.name ?? position.symbol}<small>${position.symbol}</small></td><td><span class="side-pill ${side.toLowerCase()}">${side}</span></td><td>${quantity(Math.abs(position.qty))}</td><td>${money(position.entryPrice)}</td><td>${money(position.currentPrice)}</td><td class="${pnlClass}">${money(position.unrealizedPnL)}</td><td><button class="close-position" data-symbol="${position.symbol}">Close</button></td>`;
    positionsBody.append(row);
  }
  $('#positions-empty').classList.toggle('hidden', account.positions.length > 0);
  const historyBody = $('#history-body'); historyBody.replaceChildren();
  for (const trade of account.trades.slice(0, 100)) {
    const row = document.createElement('tr');
    const realized = Number(trade.realizedPnL ?? 0);
    const cls = realized > 0 ? 'positive' : realized < 0 ? 'negative' : '';
    row.innerHTML = `<td>${new Date(trade.time).toLocaleString()}</td><td class="asset-cell">${trade.symbol}</td><td><span class="side-pill ${trade.side === 'BUY' ? 'long' : 'short'}">${trade.action} ${trade.side}</span></td><td>${quantity(trade.qty)}</td><td>${money(trade.price)}</td><td class="${cls}">${realized ? money(realized) : '—'}</td>`;
    historyBody.append(row);
  }
  $('#history-empty').classList.toggle('hidden', account.trades.length > 0);
  const pnl = account.totalEquity - 1_000_000;
  $('#portfolio-pnl').innerHTML = `NET P&amp;L <b class="${pnl >= 0 ? 'positive' : 'negative'}">${pnl > 0 ? '+' : ''}${money(pnl)}</b>`;
  renderEquityCurve(account.equityCurve);
}

function renderEquityCurve(points) {
  const canvas = $('#equity-canvas'), empty = $('#equity-empty'), rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio)); canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  empty.classList.toggle('hidden', points.length > 0);
  if (points.length < 2) return;
  const width = rect.width, height = rect.height, pad = { top: 18, right: 58, bottom: 20, left: 18 };
  const values = points.map(point => point.equity), min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  const x = index => pad.left + index * (width - pad.left - pad.right) / (points.length - 1);
  const y = value => pad.top + (max - value) / span * (height - pad.top - pad.bottom);
  ctx.strokeStyle = '#1c2935'; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { const gy = pad.top + i * (height - pad.top - pad.bottom) / 3; ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(width - pad.right, gy); ctx.stroke(); }
  ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(x(index), y(point.equity)) : ctx.moveTo(x(index), y(point.equity)));
  ctx.lineWidth = 2; ctx.strokeStyle = values.at(-1) >= values[0] ? '#40d6a0' : '#ff7184'; ctx.stroke();
  ctx.lineTo(x(points.length - 1), height - pad.bottom); ctx.lineTo(x(0), height - pad.bottom); ctx.closePath();
  const gradient = ctx.createLinearGradient(0, pad.top, 0, height); gradient.addColorStop(0, values.at(-1) >= values[0] ? '#40d6a033' : '#ff718433'); gradient.addColorStop(1, '#0d121a00'); ctx.fillStyle = gradient; ctx.fill();
  ctx.fillStyle = '#8190a2'; ctx.font = '10px "DM Mono", monospace';
  for (let i = 0; i < 4; i++) { const value = max - i * span / 3; ctx.fillText(`$${(value / 1000).toFixed(1)}k`, width - pad.right + 8, pad.top + i * (height - pad.top - pad.bottom) / 3 + 3); }
}

async function refreshState() { try { renderState(await api('/api/state')); } catch (error) { console.error('State refresh failed:', error); } }
async function onCoinChange() {
  state.selected = $('#coin-select').value;
  const selectedQuote = state.quotes[selectedCoin()?.symbol];
  if (selectedQuote) updateQuoteDisplay(selectedQuote.price);
  await Promise.all([loadPrice(), loadChart()]);
}

$('#coin-select').addEventListener('change', onCoinChange);
document.querySelectorAll('.timeframes button').forEach(button => button.addEventListener('click', async () => {
  document.querySelectorAll('.timeframes button').forEach(item => item.classList.toggle('active', item === button));
  state.days = Number(button.dataset.days);
  const range = state.days === 365 ? '1 YEAR' : `${state.days} DAYS`;
  document.querySelector('.chart-range-label').textContent = `LAST ${range}`;
  await loadChart();
}));
document.querySelectorAll('.side-toggle button').forEach(button => button.addEventListener('click', () => {
  state.side = button.dataset.side;
  document.querySelectorAll('.side-toggle button').forEach(item => item.classList.toggle('active', item === button));
  const submit = $('#submit-order'); submit.classList.toggle('sell-button', state.side === 'SELL');
  setLoading(false);
}));
$('#order-qty').addEventListener('input', updateEstimate);
$('#order-price').addEventListener('input', updateEstimate);

$('#order-form').addEventListener('submit', async event => {
  event.preventDefault();
  const coin = selectedCoin(), qty = Number($('#order-qty').value), price = Number($('#order-price').value);
  if (!coin) return toast('Choose an asset first.', 'error');
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) return toast('Enter a quantity and price greater than zero.', 'error');
  setLoading(true);
  try {
    const next = await api(state.side === 'BUY' ? '/api/trade/enter' : '/api/trade/enter', { method: 'POST', body: JSON.stringify({ symbol: coin.symbol, side: state.side, qty, price }) });
    renderState(next); $('#order-qty').value = ''; updateEstimate(); toast(`${state.side === 'BUY' ? 'Buy / long' : 'Sell / short'} order placed for ${quantity(qty)} ${coin.symbol}.`, 'success');
  } catch (error) { console.error('Order submission failed:', error); toast(error.message, 'error'); }
  finally { setLoading(false); }
});

$('#positions-body').addEventListener('click', async event => {
  const button = event.target.closest('.close-position'); if (!button) return;
  const position = state.account?.positions.find(item => item.symbol === button.dataset.symbol);
  if (!position) return;
  button.disabled = true;
  try {
    const next = await api('/api/trade/exit', { method: 'POST', body: JSON.stringify({ symbol: position.symbol, qty: Math.abs(position.qty), price: position.currentPrice }) });
    renderState(next); toast(`${position.symbol} position closed.`, 'success');
  } catch (error) { console.error('Position close failed:', error); toast(error.message, 'error'); button.disabled = false; }
});

$('#reset-button').addEventListener('click', async () => {
  if (!window.confirm('Reset the paper account? This clears every open position and trade.')) return;
  try { renderState(await api('/api/reset', { method: 'POST' })); toast('Paper account reset to $1,000,000.', 'success'); }
  catch (error) { console.error('Account reset failed:', error); toast(error.message, 'error'); }
});

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === button));
  document.querySelectorAll('.tab-view').forEach(item => item.classList.toggle('active', item.id === `${button.dataset.tab}-view`));
  if (button.dataset.tab === 'equity') renderEquityCurve(state.account?.equityCurve ?? []);
}));

document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
  const pane = $('#chart').getChartAt?.(0) ?? state.chartPane;
  if (!pane?.setActiveTool) return toast('Drawing tools are unavailable until the chart loads.', 'error');
  const isActive = button.classList.contains('active');
  document.querySelectorAll('[data-tool]').forEach(item => item.classList.remove('active'));
  if (isActive) { pane.setActiveTool(null); $('#drawing-status').textContent = 'Select a tool, then draw on chart'; return; }
  pane.setActiveTool(button.dataset.tool); button.classList.add('active');
  $('#drawing-status').textContent = 'Click and drag on chart · Esc to cancel';
}));
$('#clear-drawings').addEventListener('click', () => {
  const pane = $('#chart').getChartAt?.(0) ?? state.chartPane;
  if (pane?.clearDrawings) pane.clearDrawings();
  else if (pane?.importDrawings) pane.importDrawings('{"version":"2.0","drawings":[]}');
  else { toast('Clear drawings is not available in this OakView version.', 'error'); return; }
  document.querySelectorAll('[data-tool]').forEach(item => item.classList.remove('active'));
  $('#drawing-status').textContent = 'Drawings cleared';
});

window.addEventListener('resize', () => { if (state.account) renderEquityCurve(state.account.equityCurve); });

async function boot() {
  try {
    await initializeChart();
    state.coins = await api('/api/coins');
    const select = $('#coin-select');
    select.replaceChildren(...state.coins.map(coin => { const option = document.createElement('option'); option.value = coin.id; option.textContent = `${coin.symbol} · ${coin.name}`; return option; }));
    state.selected = state.coins[0]?.id;
    connectMarketStream();
    await refreshState();
    await onCoinChange();
    setInterval(refreshState, 10_000);
    setInterval(() => loadPrice(), 10_000);
  } catch (error) { console.error('Application startup failed:', error); toast(`Startup failed: ${error.message}`, 'error'); }
}
boot();

