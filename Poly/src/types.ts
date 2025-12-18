/**
 * Polymarket API Types
 */

export interface Market {
  id: string;
  question: string;
  description?: string;
  end_date_iso?: string;
  endDateIso?: string;
  outcomes?: string[];
  outcome_prices?: string[];
  outcomePrices?: string[];
  volume?: string;
  liquidity?: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  tags?: string[];
  slug?: string;
  clobTokenIds?: string;
  conditionId?: string;
  volumeNum?: number;
  volume24hr?: number;
}

export interface Trade {
  id: string;
  market: string;
  asset_id: string;
  maker_address: string;
  taker_address: string;
  side: 'BUY' | 'SELL';
  size: string;
  price: string;
  timestamp: number;
  outcome: string;
  market_question?: string;
  fee_rate_bps?: string;
  status?: string;
  match_time?: number;
}

export interface OrderBookEntry {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  timestamp: number;
}

export interface TradeAlert {
  trade: Trade;
  notionalValue: number;
  marketInfo?: Market;
  formattedTime: string;
  outcome: string;
  side: 'BUY' | 'SELL';
}

export interface MonitorConfig {
  minTradeSize: number;
  pollInterval: number;
  apiUrl: string;
  wsUrl?: string;
}
