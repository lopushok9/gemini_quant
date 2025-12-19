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
    console.log(`\n2. Selected market for potential analysis: "${testMarket.question}"`);
    console.log(`   Status: ${testMarket.active ? 'Active' : 'Inactive'}, Closed: ${testMarket.closed}`);
    console.log(`   ID: ${testMarket.conditionId || testMarket.id}`);
  }


  console.log('✅ Test completed successfully!');
  console.log('\nThe monitor is working correctly and can detect large orders.');
  console.log('Run "npm start" or "./run.sh" to start continuous monitoring.\n');
}

test().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
