import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  apiUrl: process.env.POLYMARKET_API_URL || 'https://clob.polymarket.com',
  wsUrl: process.env.POLYMARKET_WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws',
  minTradeSize: parseFloat(process.env.MIN_TRADE_SIZE || '3000'),
  pollInterval: parseInt(process.env.POLL_INTERVAL || '5000', 10),
};

export default config;
