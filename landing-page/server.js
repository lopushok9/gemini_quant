require('dotenv').config();
const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bs58 = require('bs58');
const nacl = require('tweetnacl');
const cors = require('cors');
const { Connection, PublicKey } = require('@solana/web3.js');
const { spawn } = require('child_process');

const decode58 = (str) => {
    if (typeof bs58.decode === 'function') return bs58.decode(str);
    if (bs58.default && typeof bs58.default.decode === 'function') return bs58.default.decode(str);
    if (typeof bs58 === 'function') return bs58(str);
    throw new Error(`bs58.decode is not available.`);
};

const app = express();
const port = process.env.PORT || 3000;

// Token Gating Configuration
const TOKEN_MINT_ADDRESS = process.env.TOKEN_MINT_ADDRESS;
const MIN_TOKEN_AMOUNT = parseFloat(process.env.MIN_TOKEN_AMOUNT || '0');
const JWT_SECRET = process.env.JWT_SECRET;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

if (!JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET is not defined.');
}

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// --- CORS & SECURITY ---
const allowedOrigins = [
    'http://localhost:3000',
    'https://www.quantycli.tech',
    'https://quantycli.tech'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            return callback(new Error('CORS policy violation'), false);
        }
        return callback(null, true);
    },
    credentials: true
}));

app.use(express.static(path.join(process.cwd(), 'public')));
app.use(express.json());

// --- RATE LIMITER ---
const USAGE_LIMIT = 3;
const LIMIT_WINDOW = 24 * 60 * 60 * 1000;
const requestCounts = new Map();

const rateLimitMiddleware = (req, res, next) => {
    if (!req.user || !req.user.publicKey) return next();
    const wallet = req.user.publicKey;
    const now = Date.now();
    let userStats = requestCounts.get(wallet);

    if (!userStats || now > userStats.resetTime) {
        userStats = { count: 0, resetTime: now + LIMIT_WINDOW };
    }

    if (userStats.count >= USAGE_LIMIT) {
        const resetHours = ((userStats.resetTime - now) / 1000 / 60 / 60).toFixed(1);
        return res.status(429).json({ error: `Daily limit reached. Resets in ${resetHours} hrs.` });
    }

    userStats.count++;
    requestCounts.set(wallet, userStats);
    next();
};

// --- AUTH MIDDLEWARE ---
async function checkTokenBalance(walletAddress) {
    try {
        const pubkey = new PublicKey(walletAddress);
        const mint = new PublicKey(TOKEN_MINT_ADDRESS);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { mint });
        if (tokenAccounts.value.length === 0) return 0;
        return tokenAccounts.value.reduce((acc, account) => {
            return acc + (account.account.data.parsed.info.tokenAmount.uiAmount || 0);
        }, 0);
    } catch (error) {
        console.error('Balance check error:', error);
        return 0;
    }
}

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

// --- INSIDER DATA CACHE (Local Only) ---
let insiderCache = { data: [], lastFetch: 0, isUpdating: false };
const INSIDER_UPDATE_INTERVAL = 30 * 60 * 1000;
const scriptPath = path.join(process.cwd(), '..', 'insider', 'insider.py');

function updateInsiderData() {
    if (process.env.VERCEL) return; // Не запускаем на Vercel

    if (insiderCache.isUpdating) return;
    insiderCache.isUpdating = true;
    console.log(`[Insider] Updating data (local)...`);

    const pythonProcess = spawn('python3', [scriptPath, '--json', '--limit', '60']);
    let dataString = '';

    pythonProcess.stdout.on('data', (data) => { dataString += data.toString(); });
    pythonProcess.on('close', (code) => {
        insiderCache.isUpdating = false;
        if (code !== 0) return console.error(`[Insider] Script error code ${code}`);
        try {
            const jsonData = JSON.parse(dataString);
            if (Array.isArray(jsonData)) {
                insiderCache.data = jsonData;
                insiderCache.lastFetch = Date.now();
                console.log(`[Insider] Cache updated: ${jsonData.length} records.`);
            }
        } catch (e) { console.error('[Insider] Parse error'); }
    });
}

if (!process.env.VERCEL) {
    updateInsiderData();
    setInterval(updateInsiderData, INSIDER_UPDATE_INTERVAL);
}

// --- API ENDPOINTS ---

app.post('/api/auth/login', async (req, res) => {
    try {
        const { publicKey, signature, timestamp } = req.body;
        if (!publicKey || !signature || !timestamp) return res.status(400).json({ error: 'Missing credentials' });
        if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) return res.status(400).json({ error: 'Expired request' });

        const message = new TextEncoder().encode(`Access Quanty AI - Date: ${timestamp}`);
        const verified = nacl.sign.detached.verify(message, decode58(signature), new PublicKey(publicKey).toBytes());
        if (!verified) return res.status(401).json({ error: 'Invalid signature' });

        const balance = await checkTokenBalance(publicKey);
        if (balance < MIN_TOKEN_AMOUNT) {
            return res.status(403).json({ error: 'Insufficient balance', balance, required: MIN_TOKEN_AMOUNT });
        }

        const token = jwt.sign({ publicKey }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, success: true, balance });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.get('/api/insider', (req, res) => {
    // На Vercel этот запрос будет перехвачен vercel.json и направлен в api/insider_feed.py
    res.json(insiderCache.data);
});

app.get('/api/proxy/whales', async (req, res) => {
    try {
        const response = await fetch('https://data-api.polymarket.com/trades?limit=1500');
        const data = await response.json();
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Proxy error' }); }
});

// Routes - Using absolute paths for Vercel compatibility
app.get('/', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'index.html')))
app.get('/about', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'about.html')))
app.get('/terms', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'terms.html')))
app.get('/how-to-use', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'how-to-use.html')))
app.get('/whales', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'whales.html')))
app.get('/leaderboard', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'leaderboard.html')))
app.get('/insider', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'insider.html')))
app.get('/chat', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'chat.html')))

const PROMPTS = { default: `You are a professional equity research analyst...` };

app.post('/api/chat', authMiddleware, rateLimitMiddleware, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'amazon/nova-2-lite-v1:free:online',
                messages: [{ role: 'system', content: PROMPTS.default }, { role: 'user', content: message }],
                stream: true
            })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const lines = decoder.decode(value).split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
                    try {
                        const content = JSON.parse(data).choices?.[0]?.delta?.content;
                        if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
                    } catch (e) { }
                }
            }
        }
        res.end();
    } catch (e) {
        console.error('Chat error:', e);
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
    }
});

if (!process.env.VERCEL) {
    app.listen(port, () => console.log(`Server running on port ${port}`));
}

module.exports = app;
