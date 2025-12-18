import PolymarketAPI from './polymarket-api';
import { Market } from './types';
import config from './config';

interface LargeOrder {
  market: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  notional: number;
}

interface VolumeSnapshot {
  marketId: string;
  volume: number;
  timestamp: number;
}

export class TradeMonitor {
  private api: PolymarketAPI;
  private minTradeSize: number;
  private pollInterval: number;
  private isRunning: boolean;
  private volumeSnapshots: Map<string, VolumeSnapshot>;
  private lastScanTime: number;

  constructor(minTradeSize: number = config.minTradeSize) {
    this.api = new PolymarketAPI();
    this.minTradeSize = minTradeSize;
    this.pollInterval = config.pollInterval;
    this.isRunning = false;
    this.volumeSnapshots = new Map();
    this.lastScanTime = Date.now();
  }

  async scanMarketsForLargeOrders(): Promise<void> {
    try {
      console.log(`[${new Date().toLocaleTimeString()}] Scanning markets for large orders...`);
      
      const markets = await this.api.getTopVolumeMarkets(30);
      
      let totalLargeOrders = 0;
      
      for (const market of markets) {
        if (!this.isRunning) break;
        
        const largeOrders = await this.api.analyzeLargeOrders(market, this.minTradeSize);
        
        if (largeOrders.length > 0) {
          this.displayMarketOrders(market, largeOrders);
          totalLargeOrders += largeOrders.length;
        }

        await this.sleep(100);
      }

      if (totalLargeOrders === 0) {
        console.log(`[${new Date().toLocaleTimeString()}] No large orders found above $${this.minTradeSize.toLocaleString()}`);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] Found ${totalLargeOrders} large orders`);
      }
      
      console.log(`${'='.repeat(80)}\n`);

    } catch (error) {
      console.error('Error scanning markets:', error);
    }
  }

  async monitorVolumeChanges(): Promise<void> {
    try {
      const markets = await this.api.getTopVolumeMarkets(50);
      const now = Date.now();
      
      for (const market of markets) {
        const currentVolume = parseFloat(market.volume || '0');
        const marketId = market.conditionId || market.id;
        
        const snapshot = this.volumeSnapshots.get(marketId);
        
        if (snapshot) {
          const volumeIncrease = currentVolume - snapshot.volume;
          const timeDiff = (now - snapshot.timestamp) / 1000;
          
          if (volumeIncrease >= this.minTradeSize && timeDiff < 120) {
            this.displayVolumeChange(market, volumeIncrease, timeDiff);
          }
        }
        
        this.volumeSnapshots.set(marketId, {
          marketId,
          volume: currentVolume,
          timestamp: now,
        });
      }

      if (this.volumeSnapshots.size > 200) {
        const entries = Array.from(this.volumeSnapshots.entries());
        const toDelete = entries.slice(0, 100);
        toDelete.forEach(([key]) => this.volumeSnapshots.delete(key));
      }

    } catch (error) {
      console.error('Error monitoring volume changes:', error);
    }
  }

  private displayVolumeChange(market: Market, volumeIncrease: number, timeDiff: number): void {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 LARGE VOLUME INCREASE | $${volumeIncrease.toFixed(2)}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Time:          ${new Date().toLocaleString()}`);
    console.log(`Market:        ${market.question}`);
    console.log(`Volume Added:  $${volumeIncrease.toFixed(2)}`);
    console.log(`Time Period:   ${timeDiff.toFixed(0)}s`);
    console.log(`Total Volume:  $${parseFloat(market.volume || '0').toFixed(2)}`);
    
    if (market.outcomes && market.outcomePrices) {
      console.log(`\nOutcomes:`);
      market.outcomes.forEach((outcome, i) => {
        const price = market.outcomePrices && market.outcomePrices[i] 
          ? parseFloat(market.outcomePrices[i]) 
          : 0;
        console.log(`  ${outcome}: ${(price * 100).toFixed(1)}%`);
      });
    }
    
    console.log(`${'='.repeat(80)}\n`);
  }

  private displayMarketOrders(market: Market, orders: LargeOrder[]): void {
    orders.forEach((order) => {
      const isYes = order.outcome.toLowerCase() === 'yes';
      const isNo = order.outcome.toLowerCase() === 'no';
      const outcomeDisplay = isYes ? '✅ YES' : (isNo ? '❌ NO' : order.outcome);
      
      const sideDisplay = order.side === 'BUY' ? '🟢 BUY' : '🔴 SELL';
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🚨 INTERESTING POSITION DETECTED`);
      console.log(`${'='.repeat(80)}`);
      console.log(`Market:      ${market.question}`);
      console.log(`Outcome:     ${outcomeDisplay}`);
      console.log(`Side:        ${sideDisplay}`);
      console.log(`Price:       $${order.price.toFixed(4)} (${(order.price * 100).toFixed(1)}%)`);
      console.log(`Size:        ${order.size.toLocaleString()} shares`);
      console.log(`Value:       $${order.notional.toLocaleString()}`);
      console.log(`${'='.repeat(80)}\n`);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Monitor is already running');
      return;
    }

    this.isRunning = true;
    console.log(`\n${'='.repeat(80)}`);
    console.log('POLYMARKET LARGE TRADES MONITOR');
    console.log(`${'='.repeat(80)}`);
    console.log(`Minimum Order Size: $${this.minTradeSize.toLocaleString()}`);
    console.log(`Poll Interval:      ${this.pollInterval / 1000}s`);
    console.log(`Started at:         ${new Date().toLocaleString()}`);
    console.log(`${'='.repeat(80)}\n`);
    console.log('Monitoring for large orders and volume changes...\n');

    let scanCount = 0;

    while (this.isRunning) {
      if (scanCount % 2 === 0) {
        await this.scanMarketsForLargeOrders();
      }
      
      await this.monitorVolumeChanges();
      
      scanCount++;
      await this.sleep(this.pollInterval);
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log('\nMonitor stopped.');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats(): { volumeSnapshots: number } {
    return {
      volumeSnapshots: this.volumeSnapshots.size,
    };
  }
}

export default TradeMonitor;
