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
const { spawn } = require('child_process');

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
if (!process.env.JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET is not defined. Server cannot start securely.');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Insider Data Cache and Background Worker
let insiderCache = {
    data: [],
    lastFetch: 0,
    isUpdating: false
};
const INSIDER_UPDATE_INTERVAL = 30 * 60 * 1000; // 30 minutes

const scriptPath = path.join(__dirname, '..', 'insider', 'insider.py');

function updateInsiderData() {
    if (insiderCache.isUpdating) return;
    insiderCache.isUpdating = true;
    console.log(`[Insider] Starting background update at ${new Date().toISOString()}...`);

    const pythonProcess = spawn('python3', [scriptPath, '--json', '--limit', '60']);

    let dataString = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data) => {
        dataString += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        errorString += data.toString();
    });

    pythonProcess.on('close', (code) => {
        insiderCache.isUpdating = false;
        
        if (code !== 0) {
            console.error(`[Insider] Script exited with code ${code}`);
            console.error(errorString);
            return;
        }

        try {
            const jsonData = JSON.parse(dataString);
            if (Array.isArray(jsonData) && jsonData.length > 0) {
                insiderCache.data = jsonData;
                insiderCache.lastFetch = Date.now();
                console.log(`[Insider] Cache updated with ${jsonData.length} records.`);
            } else {
                 console.warn('[Insider] Script returned empty data or invalid format.');
            }
        } catch (e) {
            console.error('[Insider] JSON Parse Error:', e);
        }
    });
}

// Initial fetch on server start
updateInsiderData();
// Schedule background updates
setInterval(updateInsiderData, INSIDER_UPDATE_INTERVAL);

// Insider Trading API - Returns Cached Data Instantly
app.get('/api/insider', (req, res) => {
    // If cache is empty and not updating, trigger an update (fallback)
    if (insiderCache.data.length === 0 && !insiderCache.isUpdating) {
        updateInsiderData();
    }
    
    // Return what we have (empty array initially, then populated data)
    res.json(insiderCache.data);
});

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

app.get('/whales', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'whales.html'));
});

app.get('/insider', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'insider.html'));
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
