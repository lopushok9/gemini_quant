import axios, { AxiosInstance } from 'axios';
import { Market, Trade, OrderBook } from './types';
import config from './config';

export class PolymarketAPI {
  private gammaClient: AxiosInstance;
  private clobClient: AxiosInstance;

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

  async getMarket(conditionId: string): Promise<Market | null> {
    try {
      const response = await this.gammaClient.get(`/markets/${conditionId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching market ${conditionId}:`, error);
      return null;
    }
  }

  async getMarketBySlug(slug: string): Promise<Market | null> {
    try {
      const response = await this.gammaClient.get(`/markets`, {
        params: {
          slug,
          limit: 1,
        },
      });
      const markets = response.data || [];
      return markets.length > 0 ? markets[0] : null;
    } catch (error) {
      console.error(`Error fetching market by slug ${slug}:`, error);
      return null;
    }
  }

  async getOrderBook(tokenId: string): Promise<OrderBook | null> {
    try {
      const response = await this.clobClient.get(`/book`, {
        params: {
          token_id: tokenId,
        },
      });
      return response.data;
    } catch (error) {
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
    } catch (error) {
      console.error('Error fetching top volume markets:', error);
      return [];
    }
  }

  async searchMarkets(query: string, limit: number = 10): Promise<Market[]> {
    try {
      const response = await this.gammaClient.get('/markets', {
        params: {
          limit: 100,
          active: true,
          closed: false,
        },
      });
      
      const markets = response.data || [];
      
      if (!query) {
        return markets.slice(0, limit);
      }

      const lowerQuery = query.toLowerCase();
      return markets.filter((market: Market) => 
        market.question?.toLowerCase().includes(lowerQuery) ||
        market.description?.toLowerCase().includes(lowerQuery) ||
        market.slug?.toLowerCase().includes(lowerQuery)
      ).slice(0, limit);
    } catch (error) {
      console.error('Error searching markets:', error);
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

  async analyzeLargeOrders(market: Market, minSize: number): Promise<any[]> {
    const tokenIds = this.parseTokenIds(market);
    const largeOrders: any[] = [];

    let outcomes: string[] = [];
    if (Array.isArray(market.outcomes)) {
      outcomes = market.outcomes;
    } else if (typeof market.outcomes === 'string') {
      try {
        outcomes = JSON.parse(market.outcomes);
      } catch {
        outcomes = [];
      }
    }

    for (let i = 0; i < tokenIds.length; i++) {
      const tokenId = tokenIds[i];
      const orderBook = await this.getOrderBook(tokenId);
      
      if (!orderBook) continue;

      const outcome = outcomes && outcomes[i] ? outcomes[i] : `Outcome ${i}`;

      const largeBids = orderBook.bids
        .filter(bid => {
          const size = parseFloat(bid.size);
          const price = parseFloat(bid.price);
          const notional = this.calculateNotionalValue(size, price);
          return notional >= minSize && price >= 0.10 && price <= 0.90;
        })
        .map(bid => ({
          market: market.question,
          outcome,
          side: 'BUY' as const,
          size: parseFloat(bid.size),
          price: parseFloat(bid.price),
          notional: this.calculateNotionalValue(parseFloat(bid.size), parseFloat(bid.price)),
        }));

      const largeAsks = orderBook.asks
        .filter(ask => {
          const size = parseFloat(ask.size);
          const price = parseFloat(ask.price);
          const notional = this.calculateNotionalValue(size, price);
          return notional >= minSize && price >= 0.10 && price <= 0.90;
        })
        .map(ask => ({
          market: market.question,
          outcome,
          side: 'SELL' as const,
          size: parseFloat(ask.size),
          price: parseFloat(ask.price),
          notional: this.calculateNotionalValue(parseFloat(ask.size), parseFloat(ask.price)),
        }));

      largeOrders.push(...largeBids, ...largeAsks);
    }

    return largeOrders;
  }
}

export default PolymarketAPI;
