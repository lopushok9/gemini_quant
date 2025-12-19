import WebSocket from 'ws';
import PolymarketAPI from './polymarket-api';
import { Market } from './types';
import config from './config';

interface RTDSTradePayload {
  asset: string;
  conditionId: string;
  outcome: string;
  price: number;
  side: 'BUY' | 'SELL';
  size: number;
  timestamp: number;
  proxyWallet: string;
}

interface RTDSMessage {
  topic: string;
  type: string;
  payload: RTDSTradePayload;
}

interface VolumeSnapshot {
  marketId: string;
  volume: number;
  timestamp: number;
}

export class TradeMonitor {
  private api: PolymarketAPI;
  private minTradeSize: number;
  private isRunning: boolean;
  private volumeSnapshots: Map<string, VolumeSnapshot>;
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;

  constructor(minTradeSize: number = config.minTradeSize) {
    this.api = new PolymarketAPI();
    this.minTradeSize = minTradeSize;
    this.isRunning = false;
    this.volumeSnapshots = new Map();
  }

  private connectToWebSocket(): void {
    if (!this.isRunning) return;

    console.log(`[Monitor] Connecting to Polymarket RTDS WebSocket...`);
    this.ws = new WebSocket(config.wsRTDSUrl);

    this.ws.on('open', () => {
      console.log(`[Monitor] Connected to Polymarket Real-Time Feed.`);
      this.reconnectAttempts = 0;

      const subscribeMsg = {
        action: "subscribe",
        subscriptions: [
          {
            topic: "activity",
            type: "trades",
            filters: ""
          }
        ]
      };
      this.ws?.send(JSON.stringify(subscribeMsg));
    });

    this.ws.on('message', (data: any) => {
      try {
        const parsed: RTDSMessage = JSON.parse(data.toString());

        if (parsed.topic !== 'activity' || parsed.type !== 'trades' || !parsed.payload) {
          return;
        }

        this.handleTrade(parsed.payload);
      } catch (error) {
        // Silently handle non-JSON or other message errors
      }
    });

    this.ws.on('error', (error) => {
      console.error(`[Monitor] WebSocket Error:`, error.message);
    });

    this.ws.on('close', () => {
      if (this.isRunning) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        console.log(`[Monitor] Connection closed. Reconnecting in ${delay / 1000}s...`);
        this.reconnectAttempts++;
        setTimeout(() => this.connectToWebSocket(), delay);
      }
    });
  }

  private handleTrade(payload: RTDSTradePayload): void {
    const notional = payload.size * payload.price;
    const price = payload.price;

    // Filter by side (BUY only), price range, and minimum size
    if (payload.side === 'BUY' &&
      price >= config.minPrice &&
      price <= config.maxPrice &&
      notional >= this.minTradeSize) {

      const market = this.api.getMarketByConditionId(payload.conditionId);

      if (market) {
        if (market.active && !market.closed && !market.archived) {
          this.displayTrade(market, payload, notional);
        }
      } else {
        // If market not in cache, try to fetch it and then display
        this.api.getMarket(payload.conditionId).then(m => {
          if (m && m.active && !m.closed && !m.archived) {
            this.displayTrade(m, payload, notional);
          }
        });
      }
    }
  }

  private displayTrade(market: Market, trade: RTDSTradePayload, notional: number): void {
    const isYes = trade.outcome.toLowerCase() === 'yes';
    const isNo = trade.outcome.toLowerCase() === 'no';
    const outcomeDisplay = isYes ? '✅ YES' : (isNo ? '❌ NO' : trade.outcome);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚨 LARGE TRADE EXECUTED (Live)`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Market:      ${market.question}`);
    console.log(`Outcome:     ${outcomeDisplay}`);
    console.log(`Side:        🟢 BUY (Entry)`);
    console.log(`Price:       $${trade.price.toFixed(4)} (${(trade.price * 100).toFixed(1)}%)`);
    console.log(`Size:        ${trade.size.toLocaleString()} shares`);
    console.log(`Value:       $${notional.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    console.log(`Wallet:      ${trade.proxyWallet || 'Unknown'}`);
    console.log(`Timestamp:   ${new Date().toLocaleTimeString()}`);
    console.log(`${'='.repeat(80)}\n`);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;

    console.log(`\n${'='.repeat(80)}`);
    console.log('POLYMARKET LARGE TRADES MONITOR (POLYWHALES MODE)');
    console.log(`${'='.repeat(80)}`);
    console.log(`Minimum Order Size: $${this.minTradeSize.toLocaleString()}`);
    console.log(`Price Range:        ${(config.minPrice * 100).toFixed(0)}% - ${(config.maxPrice * 100).toFixed(0)}%`);
    console.log(`Mode:               WebSocket (Real-Time)`);
    console.log(`Started at:         ${new Date().toLocaleString()}`);
    console.log(`${'='.repeat(80)}\n`);

    // 1. Initial market metadata fetch
    await this.api.fetchAllActiveMarkets();

    // 2. Start WebSocket connection
    this.connectToWebSocket();

    // 3. Periodic volume scanning (disabled as per user request to focus on individual trades)
    // this.startVolumeMonitoring();
  }


  private startVolumeMonitoring(): void {
    const volumeInterval = setInterval(async () => {
      if (!this.isRunning) {
        clearInterval(volumeInterval);
        return;
      }
      await this.monitorVolumeChanges();
    }, 30000); // Check volume spikes every 30 seconds instead of 5s to avoid API timeouts
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
      // Ignore errors in background volume task
    }
  }

  private displayVolumeChange(market: Market, volumeIncrease: number, timeDiff: number): void {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 LARGE VOLUME INCREASE | $${volumeIncrease.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Time:          ${new Date().toLocaleString()}`);
    console.log(`Market:        ${market.question}`);
    console.log(`Volume Added:  $${volumeIncrease.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    console.log(`Time Period:   ${timeDiff.toFixed(0)}s`);

    if (market.outcomes && market.outcomePrices) {
      console.log(`\nOutcomes:`);
      market.outcomes.forEach((outcome, i) => {
        const p = market.outcomePrices && market.outcomePrices[i]
          ? parseFloat(market.outcomePrices[i])
          : 0;
        console.log(`  ${outcome}: ${(p * 100).toFixed(1)}%`);
      });
    }

    console.log(`${'='.repeat(80)}\n`);
  }

  getStats(): { volumeSnapshots: number } {
    return {
      volumeSnapshots: this.volumeSnapshots.size
    };
  }

  stop(): void {
    this.isRunning = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log('\nMonitor stopped.');
  }
}

export default TradeMonitor;
