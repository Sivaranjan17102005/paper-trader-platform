# Paper Trader (Educational Crypto Simulation)

Paper Trader is a browser-based simulator for practicing crypto orders with a fictional USD balance. It uses CoinGecko market data for quotes and candles; orders are never sent to an exchange. Account and trade state lives in memory and resets when the server restarts.

## Prerequisites

- Node.js 18 or newer
- A free [CoinGecko Demo API account](https://www.coingecko.com/en/api/pricing) for a personal API key

## Setup

1. Open a terminal in the `paper-trader` directory.
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and set `COINGECKO_API_KEY` to your key. The backend sends the key in the `x-cg-demo-api-key` header.
4. Start the app: `npm start`
5. Open [http://localhost:3000](http://localhost:3000).

For automatic server restart while editing, use `npm run dev`.

## Publish a public demo with GitHub Pages

The repository includes a GitHub Actions workflow that publishes the `frontend/` static app on each push to `main`. After pushing the repository to GitHub, enable Pages in **Settings → Pages → Build and deployment → GitHub Actions**. The deployment job then provides the public link.

On GitHub Pages, CoinGecko requests run from each visitor's browser and each visitor's simulated portfolio is saved in that browser's local storage. Accounts are private to that browser and do not sync between devices. The Express backend remains available for local development; GitHub Pages cannot run it. No API key or `.env` file is needed for the Pages demo.

## CoinGecko key

Register for the free Demo plan at [coingecko.com/en/api/pricing](https://www.coingecko.com/en/api/pricing), then create a Demo API key in your CoinGecko developer dashboard. Put the key after `COINGECKO_API_KEY=` in `.env`; do not commit that file.

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Start the Express server |
| `npm run dev` | Start with Node's watch mode |

## Architecture

| Endpoint | Purpose |
|---|---|
| `GET /api/coins` | Supported crypto assets |
| `GET /api/ohlc/:coinId?days=7` | CoinGecko candlesticks |
| `GET /api/price/:coinId` | Current USD quote |
| `GET /api/market` | Latest batched market update |
| `GET /api/stream` | Server-Sent Events for market and portfolio updates |
| `GET /api/state` | Simulated cash, positions, trades, equity curve |
| `POST /api/trade/enter` | Open a long or short position |
| `POST /api/trade/exit` | Close all or part of a position |
| `POST /api/reset` | Reset the account to $1,000,000 |

`backend/server.js` serves the static `frontend/` directory and routes API requests. It fetches a batch of USD quotes for all supported coins about once per minute and streams quote and paper-portfolio updates to open browser tabs using Server-Sent Events. `backend/dataProvider.js` caches CoinGecko responses for 60 seconds and limits requests to 10 per minute. `backend/tradeEngine.js` maintains the paper account in memory. The frontend uses vanilla JavaScript modules and OakView, loaded from esm.sh, for candlestick charts and drawing tools.

## Known limitations

- CoinGecko Demo currently lists 10,000 call credits per month and a 100 calls/minute rate limit; this app imposes its own lower limit of 10 calls/minute. Plan limits can change. See [CoinGecko API pricing](https://www.coingecko.com/en/api/pricing).
- Demo access is intended for testing and exploration; review CoinGecko's current terms before redistributing market data or using it commercially.
- Account state is in memory and resets on server restart.
- The app supports crypto assets only; Indian equities are outside its data and trading scope.
- Market data availability and historical intervals depend on CoinGecko's plan and endpoint behavior.

## Attribution

Market data provided by CoinGecko.

## License

MIT

