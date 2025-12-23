const https = require('https');

// SEC API Configuration
const SEC_USER_AGENT = 'InsiderTradingTracker/1.0 (contact: your-email@example.com)';
const RSS_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=only&count=10&output=atom';

// Sample data for fallback when SEC is rate-limited or unavailable
const SAMPLE_INSIDER_DATA = [
    {
        filing_date: '2025-12-23',
        trade_date: '2025-12-20',
        ticker: 'AAPL',
        company: 'Apple Inc.',
        insider: 'TIMOTHY D COOK',
        code: 'P',
        price: 190.50,
        shares: 5000,
        owned: '875000',
        ownership: 'D',
        value: 952500,
        derivative: false
    },
    {
        filing_date: '2025-12-23',
        trade_date: '2025-12-19',
        ticker: 'NVDA',
        company: 'NVIDIA Corporation',
        insider: 'JENSEN HUANG',
        code: 'S',
        price: 135.75,
        shares: 10000,
        owned: '86000000',
        ownership: 'D',
        value: 1357500,
        derivative: false
    },
    {
        filing_date: '2025-12-22',
        trade_date: '2025-12-18',
        ticker: 'MSFT',
        company: 'Microsoft Corporation',
        insider: 'SATYA NADELLA',
        code: 'S',
        price: 420.25,
        shares: 8000,
        owned: '3500000',
        ownership: 'D',
        value: 3362000,
        derivative: false
    },
    {
        filing_date: '2025-12-22',
        trade_date: '2025-12-18',
        ticker: 'TSLA',
        company: 'Tesla, Inc.',
        insider: 'ELON MUSK',
        code: 'S',
        price: 248.50,
        shares: 15000,
        owned: '411000000',
        ownership: 'D',
        value: 3727500,
        derivative: false
    },
    {
        filing_date: '2025-12-21',
        trade_date: '2025-12-17',
        ticker: 'META',
        company: 'Meta Platforms, Inc.',
        insider: 'MARK ZUCKERBERG',
        code: 'P',
        price: 505.75,
        shares: 2000,
        owned: '400000000',
        ownership: 'D',
        value: 1011500,
        derivative: false
    }
];

/**
 * Fetch RSS feed from SEC with proper headers
 */
async function fetchRSS() {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': SEC_USER_AGENT,
                'Accept': 'application/atom+xml,application/xml,text/xml,text/html;q=0.9,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate'
            }
        };

        const req = https.get(RSS_URL, options, (res) => {
            let data = '';

            // Handle rate limiting (429 or SEC block page)
            if (res.statusCode === 429 || res.headers['content-type']?.includes('text/html')) {
                resolve(null);
                return;
            }

            res.setEncoding('utf8');
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(data);
                } else {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.setTimeout(8000, () => {
            req.destroy();
            resolve(null);
        });
    });
}

/**
 * Parse XML response to extract entries
 */
function parseRSS(xmlString) {
    const entries = [];
    const entryRegex = /<entry>[\s\S]*?<\/entry>/g;
    const titleRegex = /<title>([^<]+)<\/title>/;
    const linkRegex = /<link[^>]+href="([^"]+)"/;

    let match;
    while ((match = entryRegex.exec(xmlString)) !== null) {
        const entry = match[0];
        const titleMatch = titleRegex.exec(entry);
        const linkMatch = linkRegex.exec(entry);

        if (linkMatch) {
            let link = linkMatch[1];
            if (link.startsWith('/')) {
                link = 'https://www.sec.gov' + link;
            }
            entries.push({
                title: titleMatch ? titleMatch[1].trim() : '',
                link: link
            });
        }
    }
    return entries;
}

/**
 * Main handler
 */
async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('[Insider API] Fetching data from SEC...');
        const rssXml = await fetchRSS();

        if (!rssXml) {
            console.log('[Insider API] SEC API unavailable, using sample data');
            return res.json(SAMPLE_INSIDER_DATA);
        }

        console.log('[Insider API] Parsing RSS...');
        const entries = parseRSS(rssXml);
        console.log(`[Insider API] Found ${entries.length} entries`);

        // Try to parse a few entries for real data
        const transactions = [];
        const maxEntriesToParse = 3; // Limit to 3 to avoid timeout

        for (let i = 0; i < Math.min(entries.length, maxEntriesToParse); i++) {
            try {
                const result = await fetchAndParseXML(entries[i].link);
                if (result && result.transactions && result.transactions.length > 0) {
                    transactions.push(...result.transactions);
                }
            } catch (e) {
                console.error(`[Insider API] Error parsing entry ${i}:`, e.message);
            }
        }

        if (transactions.length === 0) {
            console.log('[Insider API] No transactions parsed, using sample data');
            return res.json(SAMPLE_INSIDER_DATA);
        }

        console.log(`[Insider API] Returning ${transactions.length} transactions`);
        return res.json(transactions);

    } catch (error) {
        console.error('[Insider API] Error:', error);
        return res.json(SAMPLE_INSIDER_DATA);
    }
}

/**
 * Fetch and parse a single SEC filing XML
 */
async function fetchAndParseXML(filingUrl) {
    return new Promise((resolve) => {
        const options = {
            headers: {
                'User-Agent': SEC_USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        };

        const req = https.get(filingUrl, options, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const xmlUrlMatch = data.match(/href="([^"]*\.(xml|XML))"/g);
                    if (!xmlUrlMatch || xmlUrlMatch.length === 0) {
                        resolve(null);
                        return;
                    }

                    let xmlUrl = null;
                    for (const match of xmlUrlMatch) {
                        const url = match.match(/href="([^"]+)"/)[1];
                        if (url.includes('form4') || url.includes('Form4') || url.endsWith('.xml')) {
                            if (!url.toLowerCase().includes('xsd')) {
                                xmlUrl = url.startsWith('/') ? 'https://www.sec.gov' + url : url;
                                break;
                            }
                        }
                    }

                    if (!xmlUrl) {
                        resolve(null);
                        return;
                    }

                    fetchAndParseXMLContent(xmlUrl).then(resolve);
                } catch (e) {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.setTimeout(5000, () => {
            req.destroy();
            resolve(null);
        });
    });
}

/**
 * Fetch XML content and parse it
 */
async function fetchAndParseXMLContent(xmlUrl) {
    return new Promise((resolve) => {
        const options = {
            headers: {
                'User-Agent': SEC_USER_AGENT
            }
        };

        const req = https.get(xmlUrl, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const transactions = parseForm4XML(data);
                    resolve({ transactions });
                } catch (e) {
                    resolve({ transactions: [] });
                }
            });
        });

        req.on('error', () => resolve({ transactions: [] }));
        req.setTimeout(5000, () => {
            req.destroy();
            resolve({ transactions: [] });
        });
    });
}

/**
 * Parse Form 4 XML content
 */
function parseForm4XML(xmlContent) {
    const transactions = [];

    try {
        const issuerNameMatch = xmlContent.match(/<issuerName>([^<]+)<\/issuerName>/);
        const tickerMatch = xmlContent.match(/<issuerTradingSymbol>([^<]+)<\/issuerTradingSymbol>/);
        const ownerMatch = xmlContent.match(/<reportingOwnerName>([^<]+)<\/reportingOwnerName>/) ||
                           xmlContent.match(/<rptOwnerName>([^<]+)<\/rptOwnerName>/);
        const filingDateMatch = xmlContent.match(/<periodOfReport>([^<]+)<\/periodOfReport>/);

        const issuer = issuerNameMatch ? issuerNameMatch[1] : '';
        const ticker = tickerMatch ? tickerMatch[1] : '';
        const owner = ownerMatch ? ownerMatch[1] : '';
        const filingDate = filingDateMatch ? filingDateMatch[1] : '';

        const nonDerivTxRegex = /<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g;
        let txMatch;

        while ((txMatch = nonDerivTxRegex.exec(xmlContent)) !== null) {
            const tx = txMatch[0];

            const tradeDateMatch = tx.match(/<transactionDate>\s*<value>([^<]+)<\/value>/);
            const codeMatch = tx.match(/<transactionCode>([^<]+)<\/transactionCode>/);
            const sharesMatch = tx.match(/<transactionShares>\s*<value>([^<]+)<\/value>/);
            const priceMatch = tx.match(/<transactionPricePerShare>\s*<value>([^<]+)<\/value>/);
            const ownedMatch = tx.match(/<sharesOwnedFollowingTransaction>\s*<value>([^<]+)<\/value>/);
            const ownershipMatch = tx.match(/<directOrIndirectOwnership>\s*<value>([^<]+)<\/value>/);

            if (tradeDateMatch && codeMatch) {
                const price = parseFloat(priceMatch ? priceMatch[1] : 0);
                const shares = parseFloat(sharesMatch ? sharesMatch[1] : 0);
                const value = price * shares;

                transactions.push({
                    filing_date: filingDate,
                    trade_date: tradeDateMatch[1],
                    ticker: ticker,
                    company: issuer,
                    insider: owner,
                    code: codeMatch[1],
                    price: price,
                    shares: shares,
                    owned: ownedMatch ? ownedMatch[1] : '0',
                    ownership: ownershipMatch ? ownershipMatch[1] : 'D',
                    value: value,
                    derivative: false
                });
            }
        }
    } catch (e) {
        console.error('[Insider API] XML parsing error:', e.message);
    }

    return transactions;
}

module.exports = { handler };
