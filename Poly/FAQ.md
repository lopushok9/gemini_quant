# Frequently Asked Questions

## General Questions

### Q: What does this monitor do?
**A:** It scans Polymarket prediction markets and alerts you when large orders (>$5,000) are placed in the middle probability range (25%-75%), where market uncertainty is highest.

### Q: Why only 25%-75%?
**A:** Trades at extreme probabilities (e.g., 0.99 or 99%) represent near-certain outcomes with little market uncertainty. The middle range shows where traders are making meaningful bets on uncertain outcomes.

### Q: Is this free to use?
**A:** Yes! It uses public Polymarket APIs and doesn't require any API keys or authentication.

---

## Price Filtering

### Q: I'm seeing trades at 0.99 (99%), why?
**A:** Check your `.env` file. Make sure you have:
```
MIN_PRICE=0.25
MAX_PRICE=0.75
```

### Q: What's the best price range?
**A:** It depends on your goals:
- **0.25-0.75** (default): Good balance, recommended for most users
- **0.30-0.70**: Stricter filtering, less noise
- **0.40-0.60**: Maximum focus, only near-50/50 trades
- **0.20-0.80**: More inclusive, see more activity

### Q: Can I disable price filtering?
**A:** Yes, but not recommended:
```
MIN_PRICE=0.01
MAX_PRICE=0.99
```

### Q: What does "Price: $0.4500 (45.0%)" mean?
**A:** 
- `$0.4500` is the Polymarket price (0.0 to 1.0 scale)
- `45.0%` is the probability representation
- A price of 0.45 means the market thinks this outcome has a 45% chance

---

## Trade Size

### Q: Not seeing any trades?
**A:** Try lowering the minimum trade size:
```
MIN_TRADE_SIZE=1000
```

### Q: Too many alerts?
**A:** Increase the minimum trade size or narrow the price range:
```
MIN_TRADE_SIZE=10000
MIN_PRICE=0.35
MAX_PRICE=0.65
```

### Q: What's considered a "large" trade?
**A:** Default is $5,000. This is substantial for Polymarket but not whale-level. Adjust based on what you consider significant.

---

## Technical

### Q: Does this require API keys?
**A:** No, it uses public endpoints only.

### Q: What's the difference between order book and trade history?
**A:** This monitor analyzes the **order book** (pending orders), not executed trades. This shows current market sentiment and large positions waiting to be filled.

### Q: How often does it check for new orders?
**A:** Every 5 seconds by default. Configurable with `POLL_INTERVAL`.

### Q: Does this work with all markets?
**A:** It scans the top 30 markets by volume. This covers the most active and liquid markets.

### Q: Can I use this for automated trading?
**A:** This is a monitoring tool only. For trading, you'd need to integrate with Polymarket's trading APIs (which require authentication).

---

## Output

### Q: What does "✅ YES" and "❌ NO" mean?
**A:** These are the market outcomes. For binary markets:
- YES = the outcome will happen
- NO = the outcome will not happen

### Q: What's the difference between BUY and SELL?
**A:**
- 🟢 BUY = someone wants to buy this outcome (bullish)
- 🔴 SELL = someone wants to sell this outcome (bearish)

### Q: Why do I see multiple orders for the same market?
**A:** The order book has multiple price levels. Each order at a different price is shown separately.

---

## Configuration

### Q: Where do I configure settings?
**A:** In the `.env` file in the Poly directory:
```bash
MIN_TRADE_SIZE=5000
MIN_PRICE=0.25
MAX_PRICE=0.75
POLL_INTERVAL=5000
```

### Q: Can I set these via command line?
**A:** Yes:
```bash
MIN_TRADE_SIZE=10000 MIN_PRICE=0.30 MAX_PRICE=0.70 npm run dev
```

### Q: Do I need to rebuild after changing .env?
**A:** No, just restart the monitor.

---

## Troubleshooting

### Q: Getting "npm: command not found"?
**A:** Install Node.js 18+ from [nodejs.org](https://nodejs.org/)

### Q: Getting TypeScript errors?
**A:** Run `npm install` to install all dependencies.

### Q: Monitor stops after a while?
**A:** This might be an API rate limit. Increase `POLL_INTERVAL`:
```
POLL_INTERVAL=10000  # 10 seconds
```

### Q: "No large orders found" message?
**A:** Either:
1. No orders meet your criteria (lower thresholds)
2. Markets are inactive (check different time of day)
3. Price range is too narrow (widen MIN_PRICE/MAX_PRICE)

---

## Use Cases

### Q: What can I use this for?
**A:**
- **Market Research**: Understand where big money is moving
- **Risk Assessment**: See large positions that could move markets
- **Trading Signals**: Detect when whales are taking positions
- **Market Sentiment**: Track changes in large order flow
- **Portfolio Monitoring**: Watch for activity in your markets

### Q: Is this legal/allowed?
**A:** Yes, this uses public data only. No terms of service are violated.

### Q: Can I run this 24/7?
**A:** Yes, it's designed for continuous monitoring. Consider using a VPS or always-on machine.

---

## Advanced

### Q: Can I add notifications (Discord, Telegram)?
**A:** Not built-in, but you can modify the code in `src/trade-monitor.ts` to add webhook notifications.

### Q: Can I export data to a database?
**A:** Not built-in, but you can modify the code to log to a database instead of console.

### Q: How do I contribute?
**A:** This is a working tool. Fork and submit pull requests with improvements!

### Q: Can I modify the markets it scans?
**A:** Yes, edit `src/trade-monitor.ts` line 41 to change from top 30 to your preferred number or specific markets.
