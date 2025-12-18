# Polymarket Large Trades Monitor - Examples

## Quick Start Examples

### 1. Run a Quick Test

Test that everything is working correctly:

```bash
npm test
```

**Expected Output:**
```
Testing Polymarket API Integration...

1. Fetching top volume markets...

Found 5 markets:

1. US recession in 2025?
   Volume: 10,918,352.816
   Active: true
   Outcomes: Yes, No

2. Analyzing large orders for: "US recession in 2025?"
   (This may take a moment...)

   Found 24 large orders (>$3,000):

   1. 🔴 SELL [
      Size: 3104937.07 @ $0.9990
      Notional: $3,101,832.13
   ...

✅ Test completed successfully!
```

### 2. Start Continuous Monitoring (Default: $3,000)

Monitor markets continuously with the default threshold:

```bash
npm start
```

Or using the shell script:

```bash
./run.sh
```

### 3. Custom Threshold - Monitor Only Large Orders ($10,000+)

To monitor only very large orders:

```bash
MIN_TRADE_SIZE=10000 npm start
```

Or using the shell script:

```bash
./run.sh 10000
```

### 4. Lower Threshold for More Alerts ($1,000+)

To catch more activity:

```bash
MIN_TRADE_SIZE=1000 npm start
```

### 5. Development Mode with Hot Reload

If you're making changes to the code:

```bash
npm run dev
```

## Output Examples

### Large Order Detection

When a large order is found in the order book:

```
================================================================================
🎯 LARGE ORDERS FOUND ON MARKET
================================================================================
Market:   Will Bitcoin reach $100,000 by end of 2024?
Volume:   $1,234,567.89
Ends:     12/31/2024

Large Orders (5):
────────────────────────────────────────────────────────────────────────────────
1. 🟢 BUY Yes
   Size:  50000.00 shares
   Price: $0.6500
   Value: $32,500.00

2. 🔴 SELL Yes
   Size:  25000.00 shares
   Price: $0.7500
   Value: $18,750.00

3. 🟢 BUY No
   Size:  100000.00 shares
   Price: $0.2800
   Value: $28,000.00

4. 🔴 SELL No
   Size:  75000.00 shares
   Price: $0.3200
   Value: $24,000.00

5. 🟢 BUY Yes
   Size:  10000.00 shares
   Price: $0.6800
   Value: $6,800.00
================================================================================
```

### Volume Change Detection

When significant volume is added to a market:

```
================================================================================
📊 LARGE VOLUME INCREASE | $45,250.00
================================================================================
Time:          12/18/2024, 3:45:23 PM
Market:        Trump wins 2024 election?
Volume Added:  $45,250.00
Time Period:   87s
Total Volume:  $8,234,567.12

Outcomes:
  Yes: 62.5%
  No: 37.5%
================================================================================
```

## Common Use Cases

### Whale Watching

Monitor for very large orders that might indicate institutional or whale activity:

```bash
MIN_TRADE_SIZE=50000 npm start
```

This will only show orders of $50,000 or more.

### Day Trading Signals

Get alerts for medium to large orders:

```bash
MIN_TRADE_SIZE=2000 npm start
```

More frequent alerts but captures significant market movements.

### Market Analysis

Run for extended periods and observe patterns:

```bash
# Run with logging to file
npm start > polymarket_activity.log 2>&1 &
```

Then analyze the log file later:

```bash
grep "LARGE ORDERS FOUND" polymarket_activity.log | wc -l
```

### Specific Market Monitoring

While the tool automatically scans top markets, you can modify the code to focus on specific markets by filtering in `trade-monitor.ts`.

## Understanding the Data

### Order Types

- **🟢 BUY**: Someone placing a bid to buy shares
- **🔴 SELL**: Someone placing an ask to sell shares

### Market Outcomes

Most markets have binary outcomes:
- **Yes/No**: Will X happen?
- **Win/Lose**: Who will win?
- **True/False**: Is X true?

### Notional Value Calculation

```
Notional Value = Size × Price

Example:
10,000 shares @ $0.75 = $7,500 notional value
```

### Volume Interpretation

High volume indicates:
- Popular markets with lots of trading
- High liquidity
- Active price discovery
- Market uncertainty or strong opinions

## Tips and Tricks

### 1. Run in Background

Use screen or tmux for persistent monitoring:

```bash
screen -S polymarket
cd Poly
npm start
# Press Ctrl+A then D to detach
```

To reattach:
```bash
screen -r polymarket
```

### 2. Multiple Thresholds

Run multiple instances with different thresholds:

```bash
# Terminal 1: High value alerts
MIN_TRADE_SIZE=20000 npm start

# Terminal 2: Medium value alerts
MIN_TRADE_SIZE=5000 npm start
```

### 3. Filtering Output

Use grep to filter specific markets:

```bash
npm start | grep -A 10 "Bitcoin"
```

### 4. Time-Based Analysis

Monitor during specific events:

```bash
# Start monitoring before a major announcement
npm start
# Stop with Ctrl+C after the event
```

## Environment Variables

Create a `.env` file for persistent configuration:

```bash
# .env
MIN_TRADE_SIZE=5000
POLL_INTERVAL=10000
```

Then just run:
```bash
npm start
```

## Troubleshooting

### No Orders Showing Up

1. **Threshold too high**: Lower `MIN_TRADE_SIZE`
2. **Low market activity**: Try during US market hours
3. **API issues**: Check network connectivity

### Too Many Alerts

1. **Threshold too low**: Increase `MIN_TRADE_SIZE`
2. **Increase poll interval**: Set `POLL_INTERVAL=10000` (10 seconds)

### Performance Issues

1. Increase poll interval to reduce API calls
2. Reduce number of markets scanned (modify `getTopVolumeMarkets` limit)

## Next Steps

After understanding the basics:

1. **Customize**: Edit `src/trade-monitor.ts` to add custom logic
2. **Integrate**: Build webhooks or notifications
3. **Analyze**: Export data for analysis
4. **Automate**: Create trading strategies based on large order detection

## Resources

- [Polymarket Official Docs](https://docs.polymarket.com/)
- [CLOB API Documentation](https://docs.polymarket.com/api/)
- [PolyWhales Repository](https://github.com/aghlichl/PolyWhales)
