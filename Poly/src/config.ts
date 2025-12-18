import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  apiUrl: process.env.POLYMARKET_API_URL || 'https://clob.polymarket.com',
  wsUrl: process.env.POLYMARKET_WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws',
  wsRTDSUrl: process.env.POLYMARKET_WS_RTDS_URL || 'wss://ws-live-data.polymarket.com',
  minTradeSize: parseFloat(process.env.MIN_TRADE_SIZE || '1000'),
  pollInterval: parseInt(process.env.POLL_INTERVAL || '5000', 10),
  minPrice: parseFloat(process.env.MIN_PRICE || '0.10'),
  maxPrice: parseFloat(process.env.MAX_PRICE || '0.90'),
};

export default config;
