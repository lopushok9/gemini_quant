# Usage Examples

## Quick Start

### Default Settings (25%-75% range, $5,000 minimum)
```bash
cd Poly
npm install
npm run dev
```

## Common Use Cases

### 1. Monitor Large Trades in Middle Range
**Default configuration - recommended for most users**

```bash
npm run dev
```

**Settings:**
- Minimum trade: $5,000
- Price range: 25%-75%
- Shows: Only trades with genuine uncertainty

**What you'll see:**
- ✅ Trades at 0.45, 0.55, 0.65, etc.
- ❌ No trades at 0.99, 0.94, 0.10, etc.

---

### 2. Focus on Maximum Uncertainty (40%-60%)
**For high signal-to-noise ratio**

```bash
MIN_PRICE=0.40 MAX_PRICE=0.60 npm run dev
```

**Settings:**
- Minimum trade: $5,000
- Price range: 40%-60%
- Shows: Only near-50/50 trades

**Best for:**
- Finding truly uncertain markets
- Reducing alert fatigue
- Focusing on coin-flip scenarios

---

### 3. Wider Range for More Activity (20%-80%)
**For more inclusive monitoring**

```bash
MIN_PRICE=0.20 MAX_PRICE=0.80 npm run dev
```

**Settings:**
- Minimum trade: $5,000
- Price range: 20%-80%
- Shows: More trades, slightly less focused

**Best for:**
- Less active markets
- Broader market overview
- Development/testing

---

### 4. High-Value Trades Only
**For whale watching**

```bash
MIN_TRADE_SIZE=20000 npm run dev
```

**Settings:**
- Minimum trade: $20,000
- Price range: 25%-75%
- Shows: Only very large trades

**Best for:**
- Tracking institutional activity
- Reducing alert volume
- High-stakes markets

---

### 5. Maximum Coverage
**See everything above $1,000**

```bash
MIN_TRADE_SIZE=1000 MIN_PRICE=0.20 MAX_PRICE=0.80 npm run dev
```

**Settings:**
- Minimum trade: $1,000
- Price range: 20%-80%
- Shows: High volume of alerts

**Best for:**
- Active monitoring
- Market research
- Data collection

---

### 6. Using run.sh Script

**Basic usage:**
```bash
./run.sh 5000
```

**With price range:**
```bash
./run.sh 10000 0.30 0.70
```

**Arguments:**
1. Minimum trade size (USD)
2. Minimum price (0.0-1.0)
3. Maximum price (0.0-1.0)

---

## Example Output

```
================================================================================
POLYMARKET LARGE TRADES MONITOR
================================================================================
Minimum Order Size: $5,000
Price Range:        25% - 75% (middle range only)
Poll Interval:      5s
Started at:         12/18/2025, 11:55:34 AM
================================================================================

[11:55:34 AM] Scanning markets for large orders...

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

[11:55:45 AM] Found 12 large orders in middle probability range
```

---

## Configuration File (.env)

For persistent settings, edit `.env`:

```bash
# Core Settings
MIN_TRADE_SIZE=5000
MIN_PRICE=0.25
MAX_PRICE=0.75
POLL_INTERVAL=5000

# API Settings (usually don't need to change)
POLYMARKET_API_URL=https://clob.polymarket.com
```

---

## Tips

1. **Start with defaults** - they work well for most use cases
2. **Adjust based on volume** - if too many alerts, narrow the range or increase min size
3. **Combine filters** - use both price range AND trade size for optimal results
4. **Monitor output** - watch for a few minutes to see if settings are right
5. **Test changes** - use `timeout 30 npm run dev` to test for 30 seconds

---

## Performance Tuning

### Reduce API load
```bash
POLL_INTERVAL=10000 npm run dev  # Poll every 10 seconds
```

### Focus on top markets only
The monitor already scans only top 30 markets by volume. This is optimal for most cases.

---

## Troubleshooting

### Not seeing any trades?
```bash
# Try wider range and lower threshold
MIN_TRADE_SIZE=1000 MIN_PRICE=0.15 MAX_PRICE=0.85 npm run dev
```

### Too many alerts?
```bash
# Narrow range and increase threshold
MIN_TRADE_SIZE=10000 MIN_PRICE=0.35 MAX_PRICE=0.65 npm run dev
```

### Want to test without waiting?
```bash
# Quick 15-second test
timeout 15 npm run dev
```
