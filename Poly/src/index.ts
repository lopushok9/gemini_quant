#!/usr/bin/env node

import TradeMonitor from './trade-monitor';
import config from './config';

const monitor = new TradeMonitor(config.minTradeSize);

process.on('SIGINT', () => {
  console.log('\n\nReceived SIGINT, stopping monitor...');
  monitor.stop();
  
  const stats = monitor.getStats();
  console.log(`\nFinal Statistics:`);
  console.log(`- Volume snapshots tracked: ${stats.volumeSnapshots}`);
  
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nReceived SIGTERM, stopping monitor...');
  monitor.stop();
  process.exit(0);
});

async function main() {
  try {
    await monitor.start();
  } catch (error) {
    console.error('Fatal error in monitor:', error);
    process.exit(1);
  }
}

main();
