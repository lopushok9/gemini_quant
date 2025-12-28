import axios, { AxiosInstance } from 'axios';
import { Market, Trade, OrderBook } from './types';
import config from './config';

export class PolymarketAPI {
  private gammaClient: AxiosInstance;
  private clobClient: AxiosInstance;
  private marketCache: Map<string, Market> = new Map();

  constructor() {
    this.gammaClient = axios.create({
      baseURL: 'https://gamma-api.polymarket.com',
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.clobClient = axios.create({
      baseURL: config.apiUrl,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async getActiveMarkets(limit: number = 100, offset: number = 0): Promise<Market[]> {
    try {
      const response = await this.gammaClient.get('/markets', {
        params: {
          limit,
          offset,
          active: true,
          closed: false,
        },
      });
      return response.data || [];
    } catch (error) {
      console.error('Error fetching active markets:', error);
      return [];
    }
  }

  async fetchAllActiveMarkets(): Promise<void> {
    try {
      // Fetch top 500 active markets to populate cache
      const response = await this.gammaClient.get('/markets', {
        params: {
          limit: 500,
          active: true,
          closed: false,
          order: 'volume24hr',
          ascending: false
        },
      });

      const markets = response.data || [];
      markets.forEach((market: Market) => {
        if (market.conditionId) {
          this.marketCache.set(market.conditionId, market);
        }
      });
      console.log(`[API] Market cache updated with ${this.marketCache.size} markets.`);
    } catch (error) {
      console.error('Error fetching markets for cache:', error);
    }
  }

  getMarketByConditionId(conditionId: string): Market | undefined {
    return this.marketCache.get(conditionId);
  }

  async getMarket(conditionId: string): Promise<Market | null> {
    try {
      if (this.marketCache.has(conditionId)) {
        return this.marketCache.get(conditionId)!;
      }
      const response = await this.gammaClient.get(`/markets`, {
        params: { conditionId }
      });
      const market = response.data && response.data.length > 0 ? response.data[0] : null;
      if (market) {
        this.marketCache.set(conditionId, market);
      }
      return market;
    } catch (error) {
      console.error(`Error fetching market ${conditionId}:`, error);
      return null;
    }
  }

  async getTopVolumeMarkets(limit: number = 50): Promise<Market[]> {
    try {
      const response = await this.gammaClient.get('/markets', {
        params: {
          limit,
          active: true,
          closed: false,
        },
      });

      const markets = response.data || [];

      return markets.sort((a: Market, b: Market) => {
        const volumeA = parseFloat(a.volume || '0');
        const volumeB = parseFloat(b.volume || '0');
        return volumeB - volumeA;
      });
    } catch (error: any) {
      // Quietly log typical timeout/rate-limit issues for background tasks
      if (error.code !== 'ECONNABORTED') {
        console.warn(`[API] Could not fetch top markets: ${error.message}`);
      }
      return [];
    }
  }

  parseTokenIds(market: Market): string[] {
    try {
      if (!market.clobTokenIds) {
        return [];
      }

      const tokenIds = JSON.parse(market.clobTokenIds);
      return Array.isArray(tokenIds) ? tokenIds : [];
    } catch (error) {
      return [];
    }
  }

  calculateNotionalValue(size: number, price: number): number {
    return size * price;
  }

  /**
   * Fetches recent large trades from Polymarket Data API.
   * This is used to display historical trades when the monitor starts.
   * 
   * @param minTradeSize - Minimum trade value in USD
   * @param minPrice - Minimum price (0-1)
   * @param maxPrice - Maximum price (0-1)
   * @param limit - Maximum number of trades to return
   * @returns Array of recent large trades with market info
   */
  async fetchRecentLargeTrades(
    minTradeSize: number,
    minPrice: number,
    maxPrice: number,
    limit: number = 10
  ): Promise<Array<{
    market: Market;
    trade: {
      asset: string;
      conditionId: string;
      outcome: string;
      price: number;
      side: 'BUY' | 'SELL';
      size: number;
      timestamp: number;
      proxyWallet: string;
      notional: number;
    };
  }>> {
    try {
      // Fetch trades in multiple batches to cover more history
      // This helps find large trades even when they are infrequent
      const nowSec = Math.floor(Date.now() / 1000);

      const batchUrls = [
        'https://data-api.polymarket.com/trades?limit=1000',
        `https://data-api.polymarket.com/trades?limit=1000&before=${nowSec - 3600}`, // 1h ago
        `https://data-api.polymarket.com/trades?limit=1000&before=${nowSec - 7200}`, // 2h ago
      ];

      // Fetch all batches in parallel
      const responses = await Promise.allSettled(
        batchUrls.map(url => axios.get(url, { timeout: 15000 }))
      );

      // Collect all trades from successful responses
      const allTrades: any[] = [];
      for (const result of responses) {
        if (result.status === 'fulfilled' && Array.isArray(result.value.data)) {
          allTrades.push(...result.value.data);
        }
      }

      console.log(`[API] Fetched ${allTrades.length} total trades from Data API`);

      // Remove duplicates by trade ID/hash
      const seen = new Set<string>();
      const uniqueTrades = allTrades.filter(t => {
        const key = t.id || t.transaction_hash || `${t.asset_id}-${t.match_time}-${t.size}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Sort by timestamp descending (newest first)
      uniqueTrades.sort((a, b) => {
        const tsA = new Date(a.match_time || a.timestamp || 0).getTime();
        const tsB = new Date(b.match_time || b.timestamp || 0).getTime();
        return tsB - tsA;
      });

      console.log(`[API] ${uniqueTrades.length} unique trades after deduplication`);

      const results: Array<{
        market: Market;
        trade: {
          asset: string;
          conditionId: string;
          outcome: string;
          price: number;
          side: 'BUY' | 'SELL';
          size: number;
          timestamp: number;
          proxyWallet: string;
          notional: number;
        };
      }> = [];

      for (const trade of uniqueTrades) {
        // Calculate notional value
        const price = parseFloat(trade.price || '0');
        const size = parseFloat(trade.size || '0');
        const notional = size * price;

        // Filter: BUY side only, price in range, minimum size
        if (
          trade.side === 'BUY' &&
          price >= minPrice &&
          price <= maxPrice &&
          notional >= minTradeSize
        ) {
          // Get market info
          const assetId = trade.asset_id || trade.asset;
          let market: Market | null = null;

          // Try to find market by condition ID or asset ID
          if (trade.conditionId) {
            market = this.getMarketByConditionId(trade.conditionId) || null;
            if (!market) {
              market = await this.getMarket(trade.conditionId);
            }
          }

          // If we found the market, add it to results
          if (market && market.active && !market.closed && !market.archived) {
            // Determine outcome from asset_id position
            let outcome = 'Unknown';
            if (market.clobTokenIds && market.outcomes) {
              try {
                const tokenIds = typeof market.clobTokenIds === 'string'
                  ? JSON.parse(market.clobTokenIds)
                  : market.clobTokenIds;
                const outcomes = typeof market.outcomes === 'string'
                  ? JSON.parse(market.outcomes)
                  : market.outcomes;

                const assetIndex = tokenIds.findIndex((id: string) => id === assetId);
                if (assetIndex >= 0 && outcomes[assetIndex]) {
                  outcome = outcomes[assetIndex];
                }
              } catch {
                // Keep default outcome
              }
            }

            results.push({
              market,
              trade: {
                asset: assetId,
                conditionId: trade.conditionId || market.conditionId || '',
                outcome,
                price,
                side: 'BUY',
                size,
                // Data API returns timestamp in seconds, multiply by 1000 for milliseconds
                // If it's already a string date, parse it; otherwise multiply
                timestamp: (() => {
                  const ts = trade.match_time || trade.created_at || trade.timestamp;
                  if (!ts) return Date.now();
                  // If it's a string date format like "2025-12-28T12:00:00Z"
                  if (typeof ts === 'string' && ts.includes('-')) {
                    return new Date(ts).getTime();
                  }
                  // If it's a numeric timestamp
                  const numTs = typeof ts === 'string' ? parseInt(ts, 10) : ts;
                  // If less than 10 billion, it's in seconds (need to multiply)
                  return numTs < 10000000000 ? numTs * 1000 : numTs;
                })(),
                proxyWallet: trade.owner || trade.maker_address || trade.taker_address || trade.address || trade.user || trade.wallet || 'Unknown',
                notional,
              },
            });

            // Stop if we have enough trades
            if (results.length >= limit) {
              break;
            }
          }
        }
      }

      // Sort by timestamp (newest first)
      results.sort((a, b) => b.trade.timestamp - a.trade.timestamp);

      return results;
    } catch (error) {
      console.error('[API] Error fetching recent large trades:', error);
      return [];
    }
  }
}

export default PolymarketAPI;
