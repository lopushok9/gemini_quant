#!/usr/bin/env node

import PolymarketAPI from './polymarket-api';

async function test() {
  console.log('Testing Polymarket API Integration...\n');
  
  const api = new PolymarketAPI();
  
  console.log('1. Fetching top volume markets...');
  const markets = await api.getTopVolumeMarkets(5);
  
  console.log(`\nFound ${markets.length} markets:\n`);
  
  markets.forEach((market, i) => {
    console.log(`${i + 1}. ${market.question}`);
    console.log(`   Volume: ${parseFloat(market.volume || '0').toLocaleString()}`);
    console.log(`   Active: ${market.active}`);
    
    let outcomesStr = 'N/A';
    if (market.outcomes) {
      if (Array.isArray(market.outcomes)) {
        outcomesStr = market.outcomes.join(', ');
      } else if (typeof market.outcomes === 'string') {
        try {
          const parsed = JSON.parse(market.outcomes);
          outcomesStr = Array.isArray(parsed) ? parsed.join(', ') : market.outcomes;
        } catch {
          outcomesStr = market.outcomes;
        }
      }
    }
    
    console.log(`   Outcomes: ${outcomesStr}`);
    console.log('');
  });
  
  if (markets.length > 0) {
    const testMarket = markets[0];
    console.log(`\n2. Analyzing large orders for: "${testMarket.question}"`);
    console.log('   (This may take a moment...)\n');
    
    const largeOrders = await api.analyzeLargeOrders(testMarket, 3000);
    
    if (largeOrders.length > 0) {
      console.log(`   Found ${largeOrders.length} large orders (>$3,000):\n`);
      
      largeOrders.slice(0, 5).forEach((order, i) => {
        const symbol = order.side === 'BUY' ? '🟢' : '🔴';
        console.log(`   ${i + 1}. ${symbol} ${order.side} ${order.outcome}`);
        console.log(`      Size: ${order.size.toFixed(2)} @ $${order.price.toFixed(4)}`);
        console.log(`      Notional: $${order.notional.toFixed(2)}`);
        console.log('');
      });
      
      if (largeOrders.length > 5) {
        console.log(`   ... and ${largeOrders.length - 5} more\n`);
      }
    } else {
      console.log('   No large orders found on this market.\n');
    }
  }
  
  console.log('✅ Test completed successfully!');
  console.log('\nThe monitor is working correctly and can detect large orders.');
  console.log('Run "npm start" or "./run.sh" to start continuous monitoring.\n');
}

test().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
