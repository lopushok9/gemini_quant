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
}

export default PolymarketAPI;
