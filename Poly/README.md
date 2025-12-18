# Polymarket Large Trades Monitor

Real-time monitoring system for large trades (>$5,000) on Polymarket prediction markets, **focusing on middle probability range (25%-75%)** where market uncertainty is highest.

## Features

- 🔍 **Real-time Trade Monitoring**: Continuously monitors Polymarket for large trades
- 💰 **Configurable Threshold**: Set minimum trade size (default: $5,000)
- 🎯 **Smart Price Filtering**: Only shows trades in 25%-75% probability range (filters out near-certain outcomes)
- 📊 **Market Information**: Displays market question, outcome (YES/NO), volume, and end date
- 🎯 **Trade Details**: Shows trade side (BUY/SELL), size, price, and notional value
- 📈 **Performance Optimized**: Efficient caching and order book analysis
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
MIN_TRADE_SIZE=5000        # Minimum trade size in USD
POLL_INTERVAL=5000         # Polling interval in milliseconds
MIN_PRICE=0.25             # Minimum price (25% probability)
MAX_PRICE=0.75             # Maximum price (75% probability)
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
🚨 INTERESTING POSITION DETECTED
================================================================================
Market:      Will Bitcoin reach $100,000 by end of 2024?
Outcome:     ✅ YES
Side:        🟢 BUY
Price:       $0.4500 (45.0%)
Size:        12,000 shares
Value:       $5,400
================================================================================
```

**Note**: Only trades in the 25%-75% probability range are shown, filtering out near-certain outcomes (>75% or <25%) where there is little market uncertainty.

## How It Works

1. **Market Discovery**: Fetches top 30 markets by volume
2. **Order Book Analysis**: Analyzes order books for each market outcome
3. **Smart Filtering**: 
   - Filters by minimum order size (default: $5,000)
   - Filters by price range (default: 0.25-0.75 / 25%-75%)
   - Excludes near-certain outcomes to focus on genuine market uncertainty
4. **Market Information**: Displays market question, outcome (YES/NO), and trade details
5. **Continuous Monitoring**: Polls every 5 seconds (configurable)

## API Endpoints Used

- **Gamma API** (`https://gamma-api.polymarket.com`):
  - `/markets` - Fetch market information and top volume markets
  - `/markets/{conditionId}` - Get specific market details

- **CLOB API** (`https://clob.polymarket.com`):
  - `/book` - Fetch order book for each market outcome

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MIN_TRADE_SIZE` | Minimum trade size in USD | `5000` |
| `MIN_PRICE` | Minimum price filter (0.0-1.0) | `0.25` |
| `MAX_PRICE` | Maximum price filter (0.0-1.0) | `0.75` |
| `POLL_INTERVAL` | Polling interval in milliseconds | `5000` |
| `POLYMARKET_API_URL` | CLOB API base URL | `https://clob.polymarket.com` |
| `POLYMARKET_WS_URL` | WebSocket URL (future use) | `wss://ws-subscriptions-clob.polymarket.com/ws` |

### Adjusting Settings

To monitor trades larger than $10,000:
```bash
# In .env file
MIN_TRADE_SIZE=10000
```

To expand the price range (e.g., 20%-80%):
```bash
# In .env file
MIN_PRICE=0.20
MAX_PRICE=0.80
```

To focus on maximum uncertainty (40%-60%):
```bash
# In .env file
MIN_PRICE=0.40
MAX_PRICE=0.60
```

Or set inline:
```bash
MIN_TRADE_SIZE=10000 MIN_PRICE=0.30 MAX_PRICE=0.70 npm run dev
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

- **Efficient Filtering**: Price range filter reduces noise by focusing on uncertain outcomes
- **Smart Scanning**: Only scans top 30 markets by volume
- **Rate Limiting**: 100ms delay between market scans to avoid rate limits
- **Focused Monitoring**: Analyzes order books instead of historical trades

## Troubleshooting

### No orders appearing

1. Check if the threshold is too high or price range too narrow:
   ```bash
   MIN_TRADE_SIZE=1000 MIN_PRICE=0.20 MAX_PRICE=0.80 npm run dev
   ```

2. Verify API connectivity:
   ```bash
   curl https://gamma-api.polymarket.com/markets?limit=5
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
