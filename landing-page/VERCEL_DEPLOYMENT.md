# Vercel Deployment Notes

## Overview
This application is deployed on Vercel and provides:
- Poly Whales: Real-time large trades from Polymarket
- Insider Trades: SEC Form 4 filings

## API Endpoints

### Insider Trades (`/api/insider`)
- **Handler**: `api/insider.js` (Node.js)
- **Data Source**: SEC EDGAR RSS feed
- **Fallback**: Sample data when SEC is rate-limited
- **Response Format**:
```json
[
  {
    "filing_date": "2025-12-23",
    "trade_date": "2025-12-20",
    "ticker": "AAPL",
    "company": "Apple Inc.",
    "insider": "TIMOTHY D COOK",
    "code": "P",
    "price": 190.5,
    "shares": 5000,
    "owned": "875000",
    "ownership": "D",
    "value": 952500,
    "derivative": false
  }
]
```

**Transaction Codes**:
- `P` - Purchase
- `S` - Sale
- `A` - Award/Grant
- `M` - Exercise of option
- `F` - Payment of tax

### Poly Whales (`/api/proxy/whales`)
- **Handler**: Proxy endpoint in `server.js`
- **Data Source**: `https://data-api.polymarket.com/trades?limit=1500`
- **WebSocket**: Frontend connects directly to `wss://ws-live-data.polymarket.com`
- **Response Format**:
```json
[
  {
    "proxyWallet": "0x...",
    "side": "BUY",
    "conditionId": "0x...",
    "size": 25,
    "price": 0.49,
    "timestamp": 1766523199,
    "title": "Market Title",
    "slug": "market-slug",
    "icon": "https://...",
    "outcome": "Up",
    "outcomeIndex": 0
  }
]
```

## Vercel Configuration

### `vercel.json`
```json
{
  "cleanUrls": true,
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/server.js"
    }
  ]
}
```

All requests are routed to `server.js`, which handles:
- Static files from `public/`
- API endpoints (`/api/insider`, `/api/proxy/whales`)
- Authentication (`/api/auth/login`)
- Chat (`/api/chat`)

## Environment Variables

Required for chat functionality:
- `JWT_SECRET` - Secret for JWT tokens
- `OPENROUTER_API_KEY` - API key for OpenRouter

Optional:
- `TOKEN_MINT_ADDRESS` - Solana token mint address
- `MIN_TOKEN_AMOUNT` - Minimum token balance required
- `SOLANA_RPC_URL` - Solana RPC endpoint

## SEC API Rate Limiting

The SEC EDGAR API is rate-limited. This application:
1. Uses proper User-Agent headers
2. Implements fallback to sample data when rate-limited
3. Returns 200 status with fallback data to ensure UI always displays something

Sample data includes realistic insider trades for major tech companies.

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Run server:
```bash
npm start
```

3. Access:
- Home: http://localhost:3000
- Poly Whales: http://localhost:3000/whales
- Insider Trades: http://localhost:3000/insider

## Deployment to Vercel

1. Connect your Git repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on push to main branch

The `package.json` start script is used:
```json
"scripts": {
  "start": "node server.js"
}
```

## Troubleshooting

### Insider Trades not loading
- Check server logs for SEC API errors
- Fallback data should always be available
- Ensure `api/insider.js` is present

### Poly Whales not loading
- Check browser console for WebSocket connection errors
- Polymarket API must be accessible
- Firewall may block WebSocket connections

### CORS Errors
- All endpoints return proper CORS headers
- Check `allowedOrigins` in `server.js`

## Files Structure

```
landing-page/
├── server.js                 # Main Express server
├── vercel.json              # Vercel configuration
├── package.json              # Dependencies
├── api/
│   └── insider.js          # Insider trades API handler
└── public/
    ├── index.html
    ├── whales.html          # Poly Whales page
    ├── insider.html        # Insider Trades page
    └── style.css
```
