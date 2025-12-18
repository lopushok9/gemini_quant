# Polymarket Large Trades Monitor - Project Summary

## Overview

A TypeScript-based monitoring system for tracking large trades and orders (>$3,000) on Polymarket prediction markets. The system scans top volume markets, analyzes order books, and monitors volume changes to identify significant trading activity.

## Technology Stack

- **Language**: TypeScript
- **Runtime**: Node.js 18+
- **Main Dependencies**:
  - axios (HTTP client)
  - dotenv (environment config)
  - ethers (Ethereum utilities)
  - @polymarket/order-utils (Polymarket SDK)

## Architecture

### Core Components

1. **PolymarketAPI** (`src/polymarket-api.ts`)
   - Handles all API interactions with Polymarket
   - Uses Gamma API for market data (no auth required)
   - Uses CLOB API for order book data
   - Implements caching and rate limiting considerations

2. **TradeMonitor** (`src/trade-monitor.ts`)
   - Main monitoring logic
   - Scans markets for large orders in order books
   - Tracks volume changes over time
   - Manages state and deduplication

3. **Configuration** (`src/config.ts`)
   - Centralized configuration management
   - Environment variable support
   - Default values for all settings

4. **Types** (`src/types.ts`)
   - TypeScript type definitions
   - Ensures type safety across the application

## API Integration

### Gamma API (Public, No Auth)
- **Base URL**: `https://gamma-api.polymarket.com`
- **Endpoints Used**:
  - `GET /markets` - Fetch active markets
  - `GET /markets/{conditionId}` - Get specific market details

### CLOB API (Some endpoints require auth)
- **Base URL**: `https://clob.polymarket.com`
- **Endpoints Used**:
  - `GET /book?token_id={tokenId}` - Get order book (public)

## Features Implemented

### 1. Large Order Detection
- Scans order books of top volume markets
- Identifies BUY and SELL orders exceeding threshold
- Displays detailed order information:
  - Market question
  - Outcome (Yes/No, etc.)
  - Order side (BUY/SELL)
  - Size (number of shares)
  - Price per share
  - Notional value

### 2. Volume Monitoring
- Tracks total volume for each market
- Detects significant volume increases
- Alerts when volume increase exceeds threshold within time window

### 3. Real-time Updates
- Continuous polling (default: 5 seconds)
- Automatic market discovery (top 30 by volume)
- Efficient caching to minimize API calls

### 4. Rich Console Output
- Color-coded alerts (🟢 for BUY, 🔴 for SELL)
- Formatted tables and sections
- Clear, readable information display

## Configuration Options

### Environment Variables
```
MIN_TRADE_SIZE=3000      # Minimum order size in USD
POLL_INTERVAL=5000       # Polling interval in milliseconds
POLYMARKET_API_URL=...   # CLOB API base URL
POLYMARKET_WS_URL=...    # WebSocket URL (future use)
```

### Adjustable Parameters
- Minimum trade size threshold
- Polling interval
- Number of markets to scan
- Volume change detection window

## File Structure

```
Poly/
├── src/
│   ├── index.ts              # Entry point
│   ├── config.ts             # Configuration
│   ├── types.ts              # TypeScript types
│   ├── polymarket-api.ts     # API client
│   ├── trade-monitor.ts      # Monitoring logic
│   └── test.ts               # Test script
├── dist/                     # Compiled JavaScript (gitignored)
├── node_modules/             # Dependencies (gitignored)
├── .env                      # Local config (gitignored)
├── .env.example              # Example config
├── .gitignore                # Git ignore rules
├── package.json              # NPM dependencies
├── tsconfig.json             # TypeScript config
├── run.sh                    # Shell runner script
├── demo.sh                   # Demo script
├── README.md                 # Full documentation
├── QUICKSTART.md             # Quick start guide
├── EXAMPLES.md               # Usage examples
└── PROJECT_SUMMARY.md        # This file
```

## Usage Patterns

### Basic Usage
```bash
npm install    # Install dependencies
npm test       # Run quick test
npm start      # Start monitoring
```

### Advanced Usage
```bash
./run.sh 10000              # Custom threshold
MIN_TRADE_SIZE=5000 npm start  # Environment override
npm run dev                 # Development mode
```

## Testing

### Test Script (`npm test`)
1. Fetches top 5 markets
2. Displays market information
3. Analyzes one market for large orders
4. Shows results
5. Confirms system is working

### Manual Testing
Run the monitor for 30 seconds:
```bash
timeout 30 npm start
```

## Performance Considerations

### Optimization Strategies
1. **Market Caching**: Markets are cached to reduce API calls
2. **Volume Snapshots**: Only store necessary data for volume tracking
3. **Efficient Polling**: Alternates between order scanning and volume monitoring
4. **Smart Filtering**: Only processes top volume markets

### Resource Usage
- **Memory**: ~50-100 MB typical
- **Network**: ~1-2 MB per minute (depends on market count)
- **CPU**: Minimal, mostly I/O bound

## Limitations & Considerations

### Current Limitations
1. **No Real-time Trades**: Uses order book analysis, not executed trades
2. **Polling-based**: Not truly real-time (5 second delay)
3. **Public Data Only**: No authenticated endpoints used
4. **Order Book Snapshots**: Shows standing orders, not historical trades

### Why This Approach?
- **No API Keys**: Works out of the box
- **Reliable**: Public APIs are stable
- **Informative**: Large orders indicate market sentiment
- **Legal**: Uses only public data

## Future Enhancements

### Potential Additions
1. **WebSocket Support**: True real-time updates
2. **Trade History**: Store and analyze historical data
3. **Notifications**: Discord/Telegram/Email alerts
4. **Web Dashboard**: Visual interface with charts
5. **Advanced Analytics**: Volume analysis, price impact estimation
6. **Multi-asset Correlation**: Track related markets
7. **Export Features**: CSV/JSON export of detected orders

### Scaling Considerations
- Database integration for historical data
- Redis for distributed caching
- Message queue for high-frequency updates
- Load balancing for multiple monitors

## Maintenance

### Dependencies
- Keep TypeScript and Node.js updated
- Monitor for security vulnerabilities: `npm audit`
- Update dependencies: `npm update`

### API Changes
- Monitor Polymarket docs for API changes
- Test regularly to catch breaking changes
- Have fallbacks for deprecated endpoints

## References

- [Polymarket Documentation](https://docs.polymarket.com/)
- [CLOB API Docs](https://docs.polymarket.com/api/)
- [PolyWhales Reference](https://github.com/aghlichl/PolyWhales)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

## Author Notes

This project was created to provide an accessible way to monitor large trading activity on Polymarket without requiring API keys or complex setup. The focus is on ease of use, reliability, and clear output.

The system is designed to be:
- **Beginner-friendly**: Simple setup and usage
- **Extensible**: Easy to modify and enhance
- **Reliable**: Handles errors gracefully
- **Informative**: Clear, actionable output

## License

MIT License - See LICENSE file for details

---

**Version**: 1.0.0  
**Last Updated**: December 2024  
**Status**: Production Ready ✅
