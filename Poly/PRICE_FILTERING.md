# Price Filtering Guide

## Overview

The Polymarket Large Trades Monitor now includes **smart price filtering** to focus only on trades in the middle probability range where market uncertainty is highest.

## Why Filter by Price?

Trades at extreme probabilities (e.g., 0.99, 0.95, 0.05, 0.10) represent near-certain outcomes and provide little value:
- **0.99 (99%)**: Almost guaranteed outcome - not interesting
- **0.95 (95%)**: Very likely outcome - low uncertainty
- **0.05 (5%)**: Very unlikely outcome - low uncertainty
- **0.10 (10%)**: Almost impossible outcome - not interesting

## Default Configuration

By default, the monitor filters to show only trades in the **25%-75% range**:

```bash
MIN_PRICE=0.25  # 25% minimum probability
MAX_PRICE=0.75  # 75% maximum probability
```

This ensures you only see trades where there's genuine market uncertainty and meaningful price action.

## Examples

### Default (25%-75%) - Recommended
```bash
MIN_PRICE=0.25
MAX_PRICE=0.75
```
**Use case**: General monitoring - filters out most noise while showing interesting trades

### Wider Range (20%-80%)
```bash
MIN_PRICE=0.20
MAX_PRICE=0.80
```
**Use case**: More inclusive - see more trades but with some less interesting ones

### Narrower Range (30%-70%)
```bash
MIN_PRICE=0.30
MAX_PRICE=0.70
```
**Use case**: High signal-to-noise - only the most uncertain markets

### Maximum Uncertainty (40%-60%)
```bash
MIN_PRICE=0.40
MAX_PRICE=0.60
```
**Use case**: Extreme focus - only trades near 50/50 probability

### No Filtering (not recommended)
```bash
MIN_PRICE=0.01
MAX_PRICE=0.99
```
**Use case**: See everything, including near-certain outcomes

## What Gets Filtered Out

With default settings (0.25-0.75), these trades are filtered:

❌ **Filtered:**
- Price: 0.99 (99%) - too certain
- Price: 0.94 (94%) - too certain
- Price: 0.85 (85%) - too certain
- Price: 0.15 (15%) - too certain
- Price: 0.05 (5%) - too certain

✅ **Shown:**
- Price: 0.45 (45%) - uncertain
- Price: 0.55 (55%) - uncertain
- Price: 0.65 (65%) - moderately uncertain
- Price: 0.35 (35%) - moderately uncertain

## Changing Settings

### Via .env file
```bash
# Edit .env file
MIN_PRICE=0.30
MAX_PRICE=0.70
```

### Via command line
```bash
MIN_PRICE=0.30 MAX_PRICE=0.70 npm run dev
```

### Via run.sh script
```bash
# Modify MIN_PRICE and MAX_PRICE in run.sh
./run.sh 5000
```

## Monitoring Output

When the monitor starts, you'll see the configured range:

```
================================================================================
POLYMARKET LARGE TRADES MONITOR
================================================================================
Minimum Order Size: $5,000
Price Range:        25% - 75% (middle range only)
Poll Interval:      5s
Started at:         12/18/2025, 11:55:34 AM
================================================================================
```

## Best Practices

1. **Start with defaults** (0.25-0.75) - works well for most use cases
2. **Narrow the range** if you're getting too many alerts
3. **Widen the range** if you're not seeing enough activity
4. **Combine with MIN_TRADE_SIZE** for optimal filtering:
   ```bash
   MIN_TRADE_SIZE=10000  # Only large trades
   MIN_PRICE=0.35        # 35%-65% range
   MAX_PRICE=0.65
   ```

## Understanding the Output

Each detected position shows the price in two formats:

```
Price:       $0.4500 (45.0%)
```

- **$0.4500**: Polymarket price (0.0-1.0 range)
- **45.0%**: Probability representation

This makes it easy to understand that:
- 0.50 = 50% probability = coin flip uncertainty
- 0.25 = 25% probability = lower bound of default filter
- 0.75 = 75% probability = upper bound of default filter
