# Quick Start Guide

## TL;DR

```bash
cd Poly
npm install
npm run dev
```

You'll now see only **interesting trades** in the 25%-75% probability range, filtering out near-certain outcomes.

---

## What's New?

### ✅ Smart Filtering
- **Before**: Saw trades at 0.99 (99%), 0.94 (94%), 0.10 (10%) - not useful
- **After**: Only see trades at 0.45-0.75 range - genuine uncertainty!

### ✅ Better Output
```
================================================================================
🚨 INTERESTING POSITION DETECTED
================================================================================
Market:      Russia x Ukraine ceasefire in 2025?
Outcome:     ✅ YES
Side:        🔴 SELL
Price:       $0.6500 (65.0%)
Size:        29,012 shares
Value:       $18,857.80
================================================================================
```

---

## Configuration

Edit `.env` file:

```bash
# Trade Size
MIN_TRADE_SIZE=5000    # Only show trades > $5,000

# Price Range (25%-75% = default, recommended)
MIN_PRICE=0.25         # Minimum 25% probability
MAX_PRICE=0.75         # Maximum 75% probability

# Polling
POLL_INTERVAL=5000     # Check every 5 seconds
```

---

## Common Adjustments

### See More Trades (Wider Range)
```bash
MIN_PRICE=0.20
MAX_PRICE=0.80
```

### Maximum Focus (Narrow Range)
```bash
MIN_PRICE=0.40
MAX_PRICE=0.60
```

### Larger Trades Only
```bash
MIN_TRADE_SIZE=10000
```

---

## Run Options

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

### With Custom Settings
```bash
MIN_PRICE=0.30 MAX_PRICE=0.70 npm run dev
```

### Using Shell Script
```bash
./run.sh 5000 0.25 0.75
#        ^     ^     ^
#        |     |     └─ max price
#        |     └─ min price
#        └─ min trade size
```

---

## Understanding Output

### Price Format
```
Price: $0.4500 (45.0%)
       ^       ^
       |       └─ Probability (45% chance)
       └─ Polymarket price
```

### Outcomes
- ✅ **YES** = outcome will happen
- ❌ **NO** = outcome will not happen

### Sides
- 🟢 **BUY** = bullish on this outcome
- 🔴 **SELL** = bearish on this outcome

---

## Need Help?

- **Full docs**: See `README.md`
- **Price filtering**: See `PRICE_FILTERING.md`
- **Examples**: See `USAGE_EXAMPLES.md`
- **FAQ**: See `FAQ.md`
- **Changes**: See `CHANGELOG.md`

---

## Test It

### Quick 15-second test
```bash
timeout 15 npm run dev
```

### Test different ranges
```bash
./test-price-filter.sh
```

---

## Pro Tips

1. **Start with defaults** - they work great for most cases
2. **Run for 10 minutes** - see what activity you get
3. **Adjust from there** - too many alerts? Narrow the range
4. **Combine filters** - use both price range AND trade size

---

## What Was Fixed

Your issue: Seeing low-value trades at 0.99, 0.94, etc.

**Solution**: New price range filter (25%-75%) removes noise and focuses on genuine market uncertainty.

**Result**: Only see trades where both outcomes are plausible!
