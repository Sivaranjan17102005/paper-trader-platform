const STARTING_CASH = 1_000_000;
let state;

function freshState() {
  return { cash: STARTING_CASH, positions: [], trades: [], equityCurve: [], totalEquity: STARTING_CASH };
}
state = freshState();

function snapshot() {
  return structuredClone({ ...state, totalEquity: calculateEquity() });
}

function calculateEquity() {
  return state.cash + state.positions.reduce((sum, p) => sum + p.qty * (p.currentPrice ?? p.entryPrice), 0);
}

function assertPositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw Object.assign(new Error(`${label} must be a number greater than zero.`), { status: 400 });
}

export function getState() { return snapshot(); }

export function enterTrade({ symbol, side, qty, price }) {
  symbol = String(symbol ?? '').trim().toUpperCase();
  side = String(side ?? '').trim().toUpperCase();
  if (!symbol) throw Object.assign(new Error('Symbol is required.'), { status: 400 });
  if (!['BUY', 'SELL'].includes(side)) throw Object.assign(new Error('Side must be BUY or SELL.'), { status: 400 });
  assertPositive(Number(qty), 'Quantity');
  assertPositive(Number(price), 'Price');
  qty = Number(qty); price = Number(price);
  const signedQty = side === 'BUY' ? qty : -qty;
  let position = state.positions.find(p => p.symbol === symbol);
  if (position && Math.sign(position.qty) !== Math.sign(signedQty)) {
    throw Object.assign(new Error(`Close the existing ${position.qty > 0 ? 'long' : 'short'} ${symbol} position before opening the other side.`), { status: 409 });
  }
  if (side === 'BUY' && state.cash < qty * price) throw Object.assign(new Error('Insufficient cash for this buy order.'), { status: 400 });
  if (side === 'SELL' && state.cash + qty * price < 0) throw Object.assign(new Error('Insufficient cash to support this short position.'), { status: 400 });
  if (!position) {
    position = { symbol, qty: 0, entryPrice: price, currentPrice: price, unrealizedPnL: 0, realizedPnL: 0 };
    state.positions.push(position);
  }
  const oldAbs = Math.abs(position.qty);
  position.entryPrice = ((position.entryPrice * oldAbs) + price * qty) / (oldAbs + qty);
  position.qty += signedQty;
  position.currentPrice = price;
  position.unrealizedPnL = (price - position.entryPrice) * position.qty;
  state.cash += side === 'BUY' ? -qty * price : qty * price;
  state.trades.unshift({ id: crypto.randomUUID(), time: Date.now(), symbol, side, action: 'OPEN', qty, price, realizedPnL: 0 });
  state.totalEquity = calculateEquity();
  return snapshot();
}

export function exitTrade({ symbol, qty, price }) {
  symbol = String(symbol ?? '').trim().toUpperCase();
  if (!symbol) throw Object.assign(new Error('Symbol is required.'), { status: 400 });
  assertPositive(Number(qty), 'Quantity'); assertPositive(Number(price), 'Price');
  qty = Number(qty); price = Number(price);
  const position = state.positions.find(p => p.symbol === symbol);
  if (!position) throw Object.assign(new Error(`No open position for ${symbol}.`), { status: 404 });
  const held = Math.abs(position.qty);
  if (qty > held + 1e-10) throw Object.assign(new Error(`You hold ${held} ${symbol}; cannot close ${qty}.`), { status: 400 });
  const direction = Math.sign(position.qty);
  const realizedPnL = (price - position.entryPrice) * qty * direction;
  const exitSide = direction > 0 ? 'SELL' : 'BUY';
  state.cash += direction > 0 ? qty * price : -qty * price;
  position.realizedPnL += realizedPnL;
  position.qty -= direction * qty;
  if (Math.abs(position.qty) < 1e-10) state.positions = state.positions.filter(p => p !== position);
  else {
    position.currentPrice = price;
    position.unrealizedPnL = (price - position.entryPrice) * position.qty;
  }
  state.trades.unshift({ id: crypto.randomUUID(), time: Date.now(), symbol, side: exitSide, action: 'CLOSE', qty, price, realizedPnL });
  state.totalEquity = calculateEquity();
  return snapshot();
}

export function updatePrices(priceMap) {
  for (const [rawSymbol, rawPrice] of Object.entries(priceMap ?? {})) {
    const symbol = rawSymbol.toUpperCase(), price = Number(rawPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    const p = state.positions.find(item => item.symbol === symbol);
    if (p) { p.currentPrice = price; p.unrealizedPnL = (price - p.entryPrice) * p.qty; }
  }
  const equity = calculateEquity();
  state.equityCurve.push({ time: Date.now(), equity });
  if (state.equityCurve.length > 1000) state.equityCurve.splice(0, state.equityCurve.length - 1000);
  state.totalEquity = equity;
  return snapshot();
}

export function resetAccount() { state = freshState(); return snapshot(); }

