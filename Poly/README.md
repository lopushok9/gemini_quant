# Polymarket Large Trades Monitor

Real-time monitoring system for large trades (>$3,000) on Polymarket prediction markets.

## Features

- 🔍 **Real-time Trade Monitoring**: Continuously monitors Polymarket for large trades
- 💰 **Configurable Threshold**: Set minimum trade size (default: $3,000)
- 📊 **Market Information**: Displays market question, outcome, volume, and end date
- 🎯 **Trade Details**: Shows trade side (BUY/SELL), size, price, and notional value
- 📈 **Performance Optimized**: Efficient caching and trade deduplication
- 🎨 **Rich Console Output**: Color-coded alerts with formatted information

## Installation

### Prerequisites

- Node.js 18+ and npm
- TypeScript knowledge (optional, for development)

### Setup

1. Navigate to the Poly directory:
```bash
cd Poly
```

2. Install dependencies:
```bash
npm install
```

3. Create environment configuration:
```bash
cp .env.example .env
```

4. (Optional) Edit `.env` to customize settings:
```bash
# Default settings work fine, but you can adjust:
MIN_TRADE_SIZE=3000        # Minimum trade size in USD
POLL_INTERVAL=5000         # Polling interval in milliseconds
```

## Usage

### Development Mode (with TypeScript)

Run directly with ts-node:
```bash
npm run dev
```

### Production Mode

Build and run the compiled JavaScript:
```bash
npm run build
npm start
```

### Quick Test

```bash
npm test
```

## Output Format

When a large trade is detected, you'll see:

```
================================================================================
🟢 LARGE TRADE DETECTED | $5,250.00
================================================================================
Time:     12/18/2024, 3:45:23 PM
Side:     BUY
Size:     5000.00 shares
Price:    $1.0500
Value:    $5,250.00

--- Market Information ---
Question: Will Bitcoin reach $100,000 by end of 2024?
Outcome:  Yes
Volume:   $1,234,567.89
Ends:     12/31/2024

Trader:   0x1234...5678
================================================================================
```

## How It Works

1. **Polling**: The monitor polls the Polymarket API every 5 seconds (configurable)
2. **Trade Analysis**: Each trade is analyzed to calculate its notional value (size × price)
3. **Filtering**: Only trades exceeding the minimum threshold are displayed
4. **Market Lookup**: For each large trade, market information is fetched and cached
5. **Deduplication**: Processed trades are tracked to avoid duplicate alerts

## API Endpoints Used

- **Gamma API** (`https://gamma-api.polymarket.com`):
  - `/markets` - Fetch market information
  - `/markets/{conditionId}` - Get specific market details

- **CLOB API** (`https://clob.polymarket.com`):
  - `/trades` - Fetch recent trades

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MIN_TRADE_SIZE` | Minimum trade size in USD | `3000` |
| `POLL_INTERVAL` | Polling interval in milliseconds | `5000` |
| `POLYMARKET_API_URL` | CLOB API base URL | `https://clob.polymarket.com` |
| `POLYMARKET_WS_URL` | WebSocket URL (future use) | `wss://ws-subscriptions-clob.polymarket.com/ws` |

### Adjusting the Threshold

To monitor trades larger than $10,000:
```bash
# In .env file
MIN_TRADE_SIZE=10000
```

Or set it inline:
```bash
MIN_TRADE_SIZE=10000 npm run dev
```

## Architecture

```
src/
├── index.ts              # Entry point and signal handling
├── config.ts             # Configuration management
├── types.ts              # TypeScript type definitions
├── polymarket-api.ts     # API client for Polymarket
└── trade-monitor.ts      # Main monitoring logic
```

### Key Components

- **PolymarketAPI**: Handles all API interactions with Polymarket
- **TradeMonitor**: Core monitoring logic with caching and filtering
- **Config**: Centralized configuration management

## Performance Considerations

- **Trade Deduplication**: Up to 10,000 trade IDs are cached to prevent duplicate alerts
- **Market Caching**: Market information is cached indefinitely to reduce API calls
- **Efficient Polling**: Only fetches recent trades (last hour) to minimize data transfer

## Troubleshooting

### No trades appearing

1. Check if the threshold is too high:
   ```bash
   MIN_TRADE_SIZE=500 npm run dev
   ```

2. Verify API connectivity:
   ```bash
   curl https://clob.polymarket.com/trades?limit=10
   ```

### API Rate Limits

If you encounter rate limits, increase the `POLL_INTERVAL`:
```bash
POLL_INTERVAL=10000 npm run dev  # Poll every 10 seconds
```

## Development

### Building

```bash
npm run build
```

### Watch Mode

Automatically rebuild on file changes:
```bash
npm run watch
```

### Type Checking

TypeScript will check types during build. For explicit type checking:
```bash
npx tsc --noEmit
```

## Future Enhancements

- [ ] WebSocket support for real-time updates (instead of polling)
- [ ] Trade history export (CSV/JSON)
- [ ] Discord/Telegram notifications
- [ ] Web dashboard with historical data
- [ ] Multi-currency support
- [ ] Advanced filtering (by market, outcome, trader)

## References

- [Polymarket Documentation](https://docs.polymarket.com/)
- [Polymarket CLOB API](https://docs.polymarket.com/api/)
- [PolyWhales Repository](https://github.com/aghlichl/PolyWhales)

## License

MIT
