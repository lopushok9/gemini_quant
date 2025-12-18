# Polymarket Large Trades Monitor - Quick Start

Monitor large trades and orders on Polymarket prediction markets in 3 simple steps.

## Installation (One-Time Setup)

```bash
cd Poly
npm install
```

That's it! No API keys required.

## Usage

### Option 1: Quick Test (Recommended First Time)

```bash
npm test
```

This will:
- Fetch top markets from Polymarket
- Analyze one market for large orders
- Show you what the monitor can detect

**Takes ~5 seconds**

### Option 2: Start Monitoring

```bash
npm start
```

Or use the shell script:

```bash
./run.sh
```

This will:
- Monitor top 30 markets by volume
- Scan for orders >$3,000
- Update every 5 seconds
- Show detailed information about each large order found

Press `Ctrl+C` to stop.

### Option 3: Custom Threshold

Monitor only very large orders:

```bash
./run.sh 10000    # Only show orders >$10,000
```

Or smaller orders:

```bash
./run.sh 1000     # Show orders >$1,000
```

## What You'll See

### Large Order Alert
```
🎯 LARGE ORDERS FOUND ON MARKET
Market:   US recession in 2025?
Volume:   $10,918,352.82

Large Orders (3):
────────────────────────────────────────
1. 🔴 SELL No
   Size:  300005.05 shares
   Price: $0.9980
   Value: $299,405.04
```

**Interpretation:**
- 🟢 = BUY order (bid)
- 🔴 = SELL order (ask)
- Size = number of shares
- Price = price per share
- Value = total notional value (Size × Price)

### Volume Increase Alert
```
📊 LARGE VOLUME INCREASE | $45,250.00
Market:        Trump wins 2024 election?
Volume Added:  $45,250.00
Time Period:   87s
```

**Interpretation:**
- Market saw $45,250 in new trading volume in the last 87 seconds
- Indicates active trading/whale activity

## Configuration

Edit `.env` file to customize:

```bash
MIN_TRADE_SIZE=3000    # Minimum order size to alert
POLL_INTERVAL=5000     # Check every 5 seconds
```

Or set environment variables:

```bash
MIN_TRADE_SIZE=5000 npm start
```

## Tips

1. **First time?** Run `npm test` to verify everything works
2. **Want more alerts?** Lower the threshold: `./run.sh 1000`
3. **Want fewer alerts?** Raise the threshold: `./run.sh 10000`
4. **Background monitoring?** Use `screen` or `tmux`
5. **Stop monitoring?** Press `Ctrl+C`

## Troubleshooting

### "npm: command not found"
Install Node.js: https://nodejs.org/

### "Error fetching markets"
Check your internet connection. No API keys needed.

### "No large orders found"
Try lowering the threshold or wait - markets might be quiet.

## What's Next?

- Read [README.md](README.md) for full documentation
- See [EXAMPLES.md](EXAMPLES.md) for advanced usage
- Check the code in `src/` to customize behavior

## Support

- GitHub Issues: Report bugs or request features
- Polymarket Docs: https://docs.polymarket.com/

---

**Ready?** Run `npm test` to get started! 🚀
