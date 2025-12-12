require('dotenv').config();
const express = require('express');
const path = require('path');

// Token Gating Dependencies
// Token Gating Dependencies
const jwt = require('jsonwebtoken');
const bs58 = require('bs58');
const nacl = require('tweetnacl');
const cors = require('cors'); // New dependency
const { Connection, PublicKey } = require('@solana/web3.js');

const decode58 = (str) => {
    // Debug logging
    if (!decode58.logged) {
        console.log('BS58 Debug: Typeof:', typeof bs58);
        console.log('BS58 Debug: Is Decode Function?', typeof bs58.decode);
        console.log('BS58 Debug: Default Import?', typeof bs58.default);
        if (bs58.default) console.log('BS58 Debug: Default Decode?', typeof bs58.default.decode);
        decode58.logged = true;
    }

    if (typeof bs58.decode === 'function') return bs58.decode(str);
    if (bs58.default && typeof bs58.default.decode === 'function') return bs58.default.decode(str);
    if (typeof bs58 === 'function') return bs58(str); // unlikely fallback

    throw new Error(`bs58.decode is not available. bs58 type: ${typeof bs58}`);
};

const app = express();
const port = 3000;

// Token Gating Configuration
const TOKEN_MINT_ADDRESS = process.env.TOKEN_MINT_ADDRESS;
const MIN_TOKEN_AMOUNT = parseFloat(process.env.MIN_TOKEN_AMOUNT || '0');
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_please_change';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// --- SECURITY CONFIG ---

// 1. CORS Configuration
const allowedOrigins = [
    'http://localhost:3000',
    'https://www.quantycli.tech',
    'https://quantycli.tech' // Optional: handle non-www too
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true
}));

// 2. Rate Limiter (In-Memory)
// Map: WalletAddress -> { count: number, resetTime: number }
const USAGE_LIMIT = 3; // Max requests
const LIMIT_WINDOW = 24 * 60 * 60 * 1000; // 24 hours
const requestCounts = new Map();

const rateLimitMiddleware = (req, res, next) => {
    // Requires req.user to be populated by authMiddleware
    if (!req.user || !req.user.publicKey) {
        // If not auth, skip or block? Auth middleware runs first, so this is safe.
        return next();
    }

    const wallet = req.user.publicKey;
    const now = Date.now();

    let userStats = requestCounts.get(wallet);

    // Init or Reset if window expired
    if (!userStats || now > userStats.resetTime) {
        userStats = {
            count: 0,
            resetTime: now + LIMIT_WINDOW
        };
    }

    if (userStats.count >= USAGE_LIMIT) {
        const resetHours = ((userStats.resetTime - now) / 1000 / 60 / 60).toFixed(1);
        return res.status(429).json({
            error: `Daily limit reached (${USAGE_LIMIT}/${USAGE_LIMIT}). Resets in ${resetHours} hrs.`
        });
    }

    // Increment
    userStats.count++;
    requestCounts.set(wallet, userStats);

    console.log(`[Usage] Wallet: ${wallet} | Count: ${userStats.count}/${USAGE_LIMIT}`);
    next();
};

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Helper: Check Token Balance
async function checkTokenBalance(walletAddress) {
    try {
        const pubkey = new PublicKey(walletAddress);
        const mint = new PublicKey(TOKEN_MINT_ADDRESS);

        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { mint });

        if (tokenAccounts.value.length === 0) return 0;

        // Sum up balance from all accounts
        return tokenAccounts.value.reduce((acc, account) => {
            return acc + (account.account.data.parsed.info.tokenAmount.uiAmount || 0);
        }, 0);
    } catch (error) {
        console.error('Balance check error:', error);
        return 0;
    }
}

// Middleware: Verify JWT
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// API: Login with Wallet
app.post('/api/auth/login', async (req, res) => {
    try {
        const { publicKey, signature, timestamp } = req.body;

        if (!publicKey || !signature || !timestamp) {
            return res.status(400).json({ error: 'Missing credentials' });
        }

        const now = Date.now();
        // Allow 5 min tolerance
        if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
            return res.status(400).json({ error: 'Expired request' });
        }

        // Verify Signature
        const message = new TextEncoder().encode(`Access Quanty AI - Date: ${timestamp}`);
        const signatureBytes = decode58(signature);
        const publicKeyBytes = new PublicKey(publicKey).toBytes();

        const verified = nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);

        if (!verified) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        // Check Token Balance
        if (!TOKEN_MINT_ADDRESS) {
            console.warn('TOKEN_MINT_ADDRESS not set, skipping balance check');
        } else {
            const balance = await checkTokenBalance(publicKey);
            if (balance < MIN_TOKEN_AMOUNT) {
                return res.status(403).json({
                    error: 'Insufficient token balance',
                    balance,
                    required: MIN_TOKEN_AMOUNT
                });
            }
        }

        // Generate Token
        const token = jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: '24h' });

        res.json({ token, success: true });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// System Prompts
const PROMPTS = {
    'default': `You are a professional equity research analyst providing institutional-grade trading analysis. When given a stock ticker, conduct comprehensive research and analysis using this exact framework:

RESEARCH METHODOLOGY:
- Financial Performance: earnings, revenue growth, margins, key business metrics
- Market Positioning: peer comparisons, sector performance, competitive analysis
- Advanced Intelligence: technical analysis, options flow, insider activity

OUTPUT FORMAT - Generate analysis using this EXACT structure:

# [TICKER] - ENHANCED EQUITY RESEARCH

## EXECUTIVE SUMMARY
[BUY/SELL/HOLD] with $[X] price target ([X]% upside/downside) over [timeframe]. [Key catalyst and investment thesis].

## FUNDAMENTAL ANALYSIS
- **Recent Financial Metrics**: Revenue growth %, margins, key business KPIs
- **Peer Comparison**: Valuation multiples vs competitors (P/E, P/S ratios)
- **Forward Outlook**: Management guidance, analyst consensus, growth projections

## CATALYST ANALYSIS
- **Near-term (0-6 months)**: Specific upcoming events with dates
- **Medium-term (6-24 months)**: Strategic initiatives, market expansion

## RISK ASSESSMENT
- **Company risks**: Competitive threats, regulatory issues, operational challenges
- **Macro risks**: Interest rate sensitivity, economic cycle impact
- **Position sizing**: Recommended allocation based on risk factors

## TECHNICAL CONTEXT
- Current price vs 52-week range
- Key support/resistance levels
- Recent volume patterns and momentum indicators

## RECOMMENDATION SUMMARY

| Metric | Value |
|--------|-------|
| Rating | [BUY/SELL/HOLD] |
| Conviction | [High/Medium/Low] |
| Price Target | $[X] |
| Timeframe | [X] months |
| Upside/Downside | [X]% |

## INVESTMENT THESIS

**Bull Case**: [2-3 sentences explaining optimistic scenario]

**Bear Case**: [2-3 sentences explaining pessimistic scenario]

**Conclusion**: [Summary recommendation with key drivers]

---
*DISCLAIMER: This analysis is for educational purposes only. Not financial advice. DYOR.*`
};

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'about.html'));
});

app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

app.get('/how-to-use', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'how-to-use.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Chat API endpoint with streaming and Auth
app.post('/api/chat', authMiddleware, rateLimitMiddleware, async (req, res) => {
    const { message, mode } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    if (!process.env.OPENROUTER_API_KEY) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const systemPrompt = PROMPTS['default'];

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://quanty.ai',
                'X-Title': 'Quanty AI'
            },
            body: JSON.stringify({
                model: 'amazon/nova-2-lite-v1:free:online',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: message
                    }
                ],
                stream: true
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') {
                        res.write('data: [DONE]\n\n');
                        continue;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            res.write(`data: ${JSON.stringify({ content })}\n\n`);
                        }
                    } catch (e) {
                        // Skip invalid JSON chunks
                    }
                }
            }
        }

        res.end();

    } catch (error) {
        console.error('OpenRouter API error:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}

module.exports = app;
