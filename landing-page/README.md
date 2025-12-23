# Quanty Landing Page

A modern landing page for Quanty featuring real-time market monitoring tools.

## Features

### Poly Whales
- Real-time monitoring of large trades on Polymarket
- WebSocket connection to `wss://ws-live-data.polymarket.com`
- Filters for trade size, outcome type, probability range, and market search
- Displays trade details including wallet address, price, and notional value
- Market details fetched from CLOB API

### Insider Trades
- SEC Form 4 filings for insider trading activity
- Data sourced from SEC EDGAR RSS feed
- Fallback to sample data when SEC API is rate-limited
- Filters for minimum value, transaction type, and ticker search
- Displays ticker, company, insider name, transaction code, price, shares, and value

### Chat / Web Agent
- AI-powered chat interface
- Token-gated access via Solana token ownership
- Streaming responses from OpenRouter API

## Local Development

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
cd landing-page
npm install
```

### Environment Variables

Create a `.env` file (see `.env.example`):

```bash
# For Chat functionality
JWT_SECRET=your-secret-key-here
OPENROUTER_API_KEY=your-openrouter-api-key

# Optional: Token Gating
TOKEN_MINT_ADDRESS=
MIN_TOKEN_AMOUNT=
SOLANA_RPC_URL=
```

### Running the Server

```bash
npm start
```

The server will start on `http://localhost:3000` by default.

### Accessing the Application

- Home: `http://localhost:3000`
- About: `http://localhost:3000/about`
- Poly Whales: `http://localhost:3000/whales`
- Insider Trades: `http://localhost:3000/insider`
- How to Use: `http://localhost:3000/how-to-use`
- Chat: `http://localhost:3000/chat`

## API Endpoints

### `/api/insider` (GET)
Returns SEC Form 4 insider trading filings.

**Response:**
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

### `/api/proxy/whales` (GET)
Returns recent large trades from Polymarket.

**Response:**
```json
[
  {
    "proxyWallet": "0x...",
    "side": "BUY",
    "conditionId": "0x...",
    "size": 25,
    "price": 0.49,
    "timestamp": 1766523199,
    "title": "Bitcoin Up or Down...",
    "slug": "market-slug",
    "icon": "https://...",
    "outcome": "Up",
    "outcomeIndex": 0
  }
]
```

### `/api/auth/login` (POST)
Authenticates a Solana wallet via signature.

**Request:**
```json
{
  "publicKey": "...",
  "signature": "...",
  "timestamp": 1234567890
}
```

### `/api/chat` (POST)
Sends a message to the AI chat (requires authentication).

## Deployment

### Vercel

The application is configured for deployment on Vercel.

1. Push your code to a Git repository
2. Connect the repository to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy automatically on push

See `VERCEL_DEPLOYMENT.md` for more details.

## Important Notes

### SEC API Rate Limiting
The SEC EDGAR API is rate-limited (10 requests/second). When rate-limited:
- The API returns sample insider data
- The UI continues to display information
- No errors are shown to the user

### WebSocket Connection
Poly Whales uses a direct WebSocket connection to Polymarket. This:
- Requires WebSocket support (blocked in some corporate networks)
- Connects to `wss://ws-live-data.polymarket.com`
- Subscribes to trade updates in real-time

### Authentication
The chat feature requires authentication via:
1. Solana wallet connection
2. Token ownership check (if configured)
3. JWT token issued after successful auth

## Troubleshooting

### Poly Whales not loading
1. Check browser console for WebSocket errors
2. Ensure `wss://ws-live-data.polymarket.com` is accessible
3. Verify the API endpoint `/api/proxy/whales` is responding

### Insider Trades not loading
1. Check if SEC API is rate-limited (see server logs)
2. Fallback data should always be available
3. Verify `api/insider.js` exists

### Chat not working
1. Ensure JWT_SECRET and OPENROUTER_API_KEY are set
2. Check browser console for auth errors
3. Verify Solana RPC URL (if using token gating)

## File Structure

```
landing-page/
├── server.js                  # Express server
├── vercel.json               # Vercel configuration
├── package.json               # Dependencies
├── .env.example              # Environment variables template
├── api/
│   └── insider.js           # Insider trades API handler
└── public/
    ├── index.html            # Home page
    ├── about.html            # About page
    ├── whales.html          # Poly Whales page
    ├── insider.html         # Insider Trades page
    ├── how-to-use.html      # How to Use page
    ├── chat.html            # Chat page
    ├── terms.html           # Terms page
    └── style.css           # Styles
```

## License

See LICENSE file in project root.
