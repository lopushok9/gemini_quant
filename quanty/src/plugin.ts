import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type ActionResult,
  type Content,
  type GenerateTextParams,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type Provider,
  type ProviderResult,
  type RouteRequest,
  type RouteResponse,
  Service,
  type State,
  logger,
} from '@elizaos/core';
import { z } from 'zod';

const configSchema = z.object({
  EXAMPLE_PLUGIN_VARIABLE: z.string().optional(),
});

/**
 * GetStockPrice Action (Yahoo Finance Public API)
 */
const getStockPriceAction: Action = {
  name: 'GET_STOCK_PRICE',
  similes: ['STOCK_PRICE', 'EQUITY_PRICE', 'CHECK_STOCK', 'MARKET_QUOTE'],
  description: 'Fetch real-time stock price data for equities (NVDA, AAPL, etc.) via Yahoo Finance',
  validate: async () => true,
  handler: async (runtime, message, state, options, callback) => {
    try {
      let originalText = (message.content.text || '').trim();

      // Extract only the current message if history context is present
      const currentMsgMatch = originalText.match(/User's current message:\s*(.+?)$/is);
      if (currentMsgMatch) {
        originalText = currentMsgMatch[1].trim();
      }
      originalText = originalText.replace(/\[CONVERSATION HISTORY\][\s\S]*?\[END HISTORY\]/gi, '').trim();

      console.log('[GET_STOCK_PRICE] 📝 Cleaned text:', originalText);

      const words = originalText.split(/[\s,!?]+/);
      const blacklist = new Set([
        'stock', 'price', 'check', 'get', 'what', 'is', 'for', 'the', 'of', 'analyze', 'equity',
        'history', 'conversation', 'end', 'user', 'current', 'message'
      ]);

      let symbol = words.find(w => w.startsWith('$'))?.substring(1).toUpperCase();
      if (!symbol) {
        symbol = words.find(w => w.length >= 1 && w.length <= 5 && /^[A-Z]+$/.test(w) && !blacklist.has(w.toLowerCase()));
      }
      // Fallback to lowercase check if no uppercase match
      if (!symbol) {
        symbol = words.find(w => w.length >= 1 && w.length <= 5 && !blacklist.has(w.toLowerCase()))?.toUpperCase() || '';
      }

      if (!symbol) {
        if (callback) await callback({ text: "I couldn't identify the stock ticker. Please specify it (e.g. NVDA or $AAPL)." });
        return { text: 'Missing symbol', success: false };
      }

      // Yahoo Finance API (Public chart endpoint)
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
      const data = (await res.json()) as any;

      const result = data.chart?.result?.[0];
      if (!result) {
        if (callback) await callback({ text: `Could not find stock data for '${symbol}'. Make sure it's a valid ticker.` });
        return { text: 'Not found', success: false };
      }

      const meta = result.meta;
      const price = meta.regularMarketPrice;
      const prevClose = meta.previousClose;
      const change = price - prevClose;
      const changePercent = (change / prevClose) * 100;

      const responseText = `[STOCK DATA FETCHED]: ${symbol}\n` +
        `PRICE: $${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
        `CHANGE: ${change >= 0 ? '📈' : '📉'} ${change.toFixed(2)} (${changePercent.toFixed(2)}%)\n` +
        `MARKET: ${meta.exchangeName}\n\n` +
        `Processing equity research analysis...`;

      if (callback) await callback({ text: responseText, source: message.content.source });
      return { text: `Success: ${symbol}`, data: { symbol, price, change, changePercent, meta }, success: true };
    } catch (error) {
      if (callback) await callback({ text: "Error connecting to market data provider." });
      return { text: 'Error', success: false };
    }
  },
  examples: [
    [
      { name: '{{name1}}', content: { text: "Price of NVDA" } },
      { name: 'Quanty', content: { text: "[STOCK DATA FETCHED]: NVDA...", actions: ['GET_STOCK_PRICE'] } }
    ],
  ],
};

/**
 * GetPrice Action (CoinGecko Public API)
 */
const getPriceAction: Action = {
  name: 'GET_PRICE',
  similes: ['CHECK_PRICE', 'CRYPTO_PRICE', 'MARKET_DATA', 'TOKEN_PRICE'],
  description: 'Fetch real-time cryptocurrency price data from CoinGecko (Public API)',
  validate: async () => true,
  handler: async (runtime, message, state, options, callback) => {
    try {
      let originalText = (message.content.text || '').trim();

      // Extract only the current message if history context is present
      const currentMsgMatch = originalText.match(/User's current message:\s*(.+?)$/is);
      if (currentMsgMatch) {
        originalText = currentMsgMatch[1].trim();
      }
      // Also strip any [CONVERSATION HISTORY]...[END HISTORY] blocks
      originalText = originalText.replace(/\[CONVERSATION HISTORY\][\s\S]*?\[END HISTORY\]/gi, '').trim();

      const textLow = originalText.toLowerCase();

      console.log('[GET_PRICE] 📝 Cleaned text:', originalText);

      const blacklist = new Set([
        'price', 'check', 'get', 'what', 'is', 'for', 'the', 'analyze', 'of', 'tell',
        'about', 'now', 'please', 'allow', 'moment', 'data', 'how', 'much',
        'you', 'can', 'find', 'show', 'give', 'me', 'market', 'crypto', 'asset',
        'history', 'conversation', 'end', 'user', 'current', 'message'
      ]);

      const capsMatch = originalText.match(/\b[A-Z]{2,10}\b/g);
      const dollarMatch = originalText.match(/\$[a-zA-Z]{2,10}/g);

      console.log('[GET_PRICE] 🔍 capsMatch:', capsMatch, 'dollarMatch:', dollarMatch);

      let symbol = '';
      if (dollarMatch) {
        symbol = dollarMatch[0].substring(1).toLowerCase();
      } else if (capsMatch) {
        const validCaps = capsMatch.filter(w => !blacklist.has(w.toLowerCase()));
        if (validCaps.length > 0) symbol = validCaps[0].toLowerCase();
      }

      if (!symbol) {
        const words = textLow.split(/[\s,!?]+/);
        symbol = words.find(w => w.length >= 2 && w.length <= 10 && !blacklist.has(w)) || '';
      }

      console.log('[GET_PRICE] 🎯 Parsed symbol:', symbol);

      if (!symbol) {
        if (callback) await callback({ text: "I couldn't identify the ticker clearly. Please specify it (e.g. BTC)." });
        return { text: 'Missing symbol', success: false };
      }

      // Use CoinCap API (free, no rate limits issues)
      const coinCapUrl = `https://api.coincap.io/v2/assets?search=${symbol}&limit=5`;
      console.log('[GET_PRICE] 📡 Fetching from CoinCap:', coinCapUrl);

      const searchRes = await fetch(coinCapUrl);
      const searchData = (await searchRes.json()) as any;

      if (!searchData.data || searchData.data.length === 0) {
        if (callback) await callback({ text: `Asset '${symbol.toUpperCase()}' not found.` });
        return { text: 'Not found', success: false };
      }

      // Find exact match or use first result
      const coin = searchData.data.find((c: any) => c.symbol.toLowerCase() === symbol) || searchData.data[0];

      const price = parseFloat(coin.priceUsd);
      const change24h = parseFloat(coin.changePercent24Hr);
      const marketCap = parseFloat(coin.marketCapUsd);

      console.log('[GET_PRICE] 💰 Found:', coin.name, 'Price:', price);

      const responseText = `[DATA FETCHED]: ${coin.symbol} (${coin.name}) | PRICE: $${price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} | 24h: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}% | MCAP: $${(marketCap / 1e9).toFixed(2)}B`;
      console.log('[GET_PRICE] ✅ Response:', responseText);

      if (callback) await callback({ text: responseText, source: message.content.source });
      return { text: `Success: ${coin.symbol}`, data: { price, change24h, marketCap, symbol: coin.symbol, name: coin.name }, success: true };
    } catch (error) {
      console.error('[GET_PRICE] ❌ Error:', error);
      if (callback) await callback({ text: "Error fetching price data. Please try again." });
      return { text: 'Error', success: false };
    }
  },
  examples: [
    [
      { name: '{{name1}}', content: { text: "Price of BTC" } },
      { name: 'Quanty', content: { text: "[DATA FETCHED]: BITCOIN...", actions: ['GET_PRICE'] } }
    ],
  ],
};

/**
 * GetMemePrice Action (DexScreener API)
 */
const getMemePriceAction: Action = {
  name: 'GET_MEME_PRICE',
  similes: ['DEX_PRICE', 'CHECK_DEX', 'ONCHAIN_DATA', 'MEME_PRICE', 'DEXSCREENER'],
  description: 'Fetch real-time on-chain data for meme coins via DexScreener',
  validate: async () => true,
  handler: async (runtime, message, state, options, callback) => {
    try {
      let originalText = (message.content.text || '').trim();

      // Extract only the current message if history context is present
      const currentMsgMatch = originalText.match(/User's current message:\s*(.+?)$/is);
      if (currentMsgMatch) {
        originalText = currentMsgMatch[1].trim();
      }
      originalText = originalText.replace(/\[CONVERSATION HISTORY\][\s\S]*?\[END HISTORY\]/gi, '').trim();

      console.log('[GET_MEME_PRICE] 📝 Cleaned text:', originalText);

      const words = originalText.split(/[\s,!?]+/);
      const blacklist = new Set([
        'dex', 'price', 'check', 'get', 'what', 'is', 'for', 'the', 'of', 'analyze',
        'history', 'conversation', 'end', 'user', 'current', 'message'
      ]);

      let symbol = words.find(w => w.startsWith('$'))?.substring(1).toLowerCase();
      if (!symbol) {
        symbol = words.find(w => (w.length >= 2 && w.length <= 44) && !blacklist.has(w.toLowerCase()));
      }

      if (!symbol) return { text: 'Missing symbol', success: false };

      const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${symbol}`);
      const data = (await res.json()) as any;

      if (!data.pairs || data.pairs.length === 0) return { text: 'No pairs', success: false };

      const bestPair = data.pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
      const responseText = `[ON-CHAIN DATA]: ${bestPair.baseToken.symbol} | PRICE: $${bestPair.priceUsd} | LIQ: $${(bestPair.liquidity?.usd || 0).toLocaleString()} | 24h: ${bestPair.priceChange?.h24}%`;

      if (callback) await callback({ text: responseText, source: message.content.source });
      return { text: `Success: ${bestPair.baseToken.symbol}`, data: bestPair, success: true };
    } catch (error) {
      return { text: 'Error', success: false };
    }
  },
  examples: [
    [
      { name: '{{name1}}', content: { text: "check PEPE" } },
      { name: 'Quanty', content: { text: "[ON-CHAIN DATA]: PEPE...", actions: ['GET_MEME_PRICE'] } }
    ],
  ],
};

/**
 * HelloWorld Action
 */
const helloWorldAction: Action = {
  name: 'HELLO_WORLD',
  similes: ['GREET', 'SAY_HELLO'],
  description: 'Responds with simple hello',
  validate: async () => true,
  handler: async (runtime, message, state, options, callback) => {
    if (callback) await callback({ text: 'hello world!', actions: ['HELLO_WORLD'], source: message.content.source });
    return { text: 'Sent', success: true };
  },
  examples: [[{ name: '{{name1}}', content: { text: 'hello' } }, { name: '{{name2}}', content: { text: 'hello!', actions: ['HELLO_WORLD'] } }]],
};

const helloWorldProvider: Provider = {
  name: 'HELLO_WORLD_PROVIDER',
  get: async () => ({ text: 'Standard analytics provider active.', values: {}, data: {} }),
};

export class StarterService extends Service {
  static serviceType = 'starter';
  capabilityDescription = 'Quanty core market data service';
  static async start(runtime: IAgentRuntime) { return new StarterService(runtime); }
  static async stop(runtime: IAgentRuntime) { }
  async stop() { }
}

const plugin: Plugin = {
  name: 'starter',
  priority: 0,
  description: 'Main Quanty plugin for market intelligence',
  config: { EXAMPLE_PLUGIN_VARIABLE: process.env.EXAMPLE_PLUGIN_VARIABLE },
  async init(config) { },
  services: [StarterService],
  actions: [helloWorldAction, getPriceAction, getMemePriceAction, getStockPriceAction],
  providers: [helloWorldProvider],
};

export default plugin;
