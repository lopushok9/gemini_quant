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
 * HelloWorld Action
 */
const helloWorldAction: Action = {
  name: 'HELLO_WORLD',
  similes: ['GREET', 'SAY_HELLO'],
  description: 'Responds with a simple hello world message',
  validate: async () => true,
  handler: async (runtime, message, state, options, callback) => {
    try {
      await callback({
        text: 'hello world!',
        actions: ['HELLO_WORLD'],
        source: message.content.source,
      });
      return { text: 'Sent hello world greeting', success: true };
    } catch (error) {
      return { text: 'Failed', success: false };
    }
  },
  examples: [
    [
      { name: '{{name1}}', content: { text: 'say hello' } },
      { name: '{{name2}}', content: { text: 'hello world!', actions: ['HELLO_WORLD'] } },
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
      const text = (message.content.text || '').toLowerCase();
      const words = text.split(/\s+/);
      let symbol = words.find(w => w.length >= 2 && w.length <= 10 && !['price', 'check', 'get', 'what', 'is'].includes(w));

      if (!symbol) {
        await callback({ text: "I couldn't identify the coin symbol. Could you specify which token you want to check? (e.g., 'price BTC')" });
        return { text: 'Missing symbol', success: false };
      }

      // Search for ID
      const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${symbol}`);
      const searchData = await searchRes.json();
      const coin = searchData.coins?.[0];

      if (!coin) {
        await callback({ text: `I couldn't find any coin matching '${symbol}' on CoinGecko.` });
        return { text: 'Coin not found', success: false };
      }

      // Fetch Price
      const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`);
      const priceData = await priceRes.json();
      const data = priceData[coin.id];

      if (!data) {
        await callback({ text: `I found ${coin.name}, but couldn't retrieve price data for it right now.` });
        return { text: 'Price data missing', success: false };
      }

      const change = data.usd_24h_change?.toFixed(2);
      const direction = data.usd_24h_change >= 0 ? '📈' : '📉';

      const responseText = `${coin.name} (${coin.symbol})\n` +
        `PRICE: $${data.usd.toLocaleString()}\n` +
        `24h CHANGE: ${direction} ${change}%\n` +
        `MARKET CAP: $${data.usd_market_cap?.toLocaleString()}\n` +
        `24h VOLUME: $${data.usd_24h_vol?.toLocaleString()}\n\n` +
        `IMPORTANT DISCLAIMER: Data provided by CoinGecko Public API. Not financial advice.`;

      await callback({ text: responseText, source: message.content.source });
      return { text: `Fetched price for ${coin.name}`, success: true };
    } catch (error) {
      await callback({ text: "Error fetching market data. Try again later." });
      return { text: 'Error', success: false };
    }
  },
  examples: [
    [
      { name: '{{name1}}', content: { text: "What's the price of BTC?" } },
      { name: 'Quanty', content: { text: "Bitcoin (BTC)\nPRICE: $96,000...", actions: ['GET_PRICE'] } }
    ],
  ],
};

const helloWorldProvider: Provider = {
  name: 'HELLO_WORLD_PROVIDER',
  get: async () => ({ text: 'Standard analytics provider active.', values: {}, data: {} }),
};

export class StarterService extends Service {
  static serviceType = 'starter';
  static async start(runtime: IAgentRuntime) { return new StarterService(runtime); }
  static async stop(runtime: IAgentRuntime) { }
}

const plugin: Plugin = {
  name: 'starter',
  description: 'Main Quanty plugin for market intelligence',
  priority: 0,
  config: { EXAMPLE_PLUGIN_VARIABLE: process.env.EXAMPLE_PLUGIN_VARIABLE },
  async init(config) { },
  models: {
    [ModelType.TEXT_SMALL]: async () => 'Quanty analyzing...',
    [ModelType.TEXT_LARGE]: async () => 'Quanty strategic analysis complete.',
  },
  routes: [
    {
      name: 'status',
      path: '/status',
      type: 'GET',
      handler: async (req, res) => { res.json({ status: 'active', agent: 'Quanty' }); },
    },
  ],
  services: [StarterService],
  actions: [helloWorldAction, getPriceAction],
  providers: [helloWorldProvider],
};

export default plugin;
