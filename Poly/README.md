# Poly - Polymarket Trade Monitor

Real-time monitoring system for large trades on Polymarket prediction markets. It focuses on the **middle probability range (25%-75%)** where market uncertainty and information value are highest.

## Key Features
- **Real-time Monitoring**: Tracks large trades (default >$5,000).
- **Uncertainty Filter**: Focuses on outcomes with 25%-75% probability.
- **Detailed Alerts**: Shows market details, outcome, side (BUY/SELL), price, and trade value.

## Quick Start

### 1. Installation
```bash
cd Poly
npm install
cp .env.example .env
```

### 2. Run
```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

## Configuration
You can adjust the minimum trade size and price range in the `.env` file:
- `MIN_TRADE_SIZE`: Default is `5000`.
- `MIN_PRICE` / `MAX_PRICE`: Probability range (default `0.25` - `0.75`).
