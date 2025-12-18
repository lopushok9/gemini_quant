# Changelog

## [2.0.0] - 2025-12-18

### 🎯 Major Changes - Smart Price Filtering

#### Added
- **Price Range Filtering**: New `MIN_PRICE` and `MAX_PRICE` configuration options
  - Default: 0.25-0.75 (25%-75%)
  - Filters out near-certain outcomes (>75% or <25%)
  - Focuses on genuine market uncertainty
- **Improved Output**: Shows price range in startup banner
- **Better Logging**: Indicates when no orders found in configured range

#### Changed
- **Default MIN_TRADE_SIZE**: Increased from $3,000 to $5,000
- **Filter Logic**: Now uses configurable price range instead of hardcoded 0.10-0.90
- **Monitoring Focus**: Changed from "all large trades" to "middle probability range trades"
- **run.sh Script**: Now accepts 3 parameters: min_trade_size, min_price, max_price

#### Documentation
- **PRICE_FILTERING.md**: Complete guide to price filtering
- **USAGE_EXAMPLES.md**: Real-world usage examples
- **README.md**: Updated with new features and configuration options
- **.env.example**: Added MIN_PRICE and MAX_PRICE configuration

### Why This Change?

Previous versions showed all trades, including:
- 0.99 (99%) - Near certain outcomes
- 0.94 (94%) - Very likely outcomes  
- 0.10 (10%) - Very unlikely outcomes
- 0.05 (5%) - Near impossible outcomes

These provide little value as they represent markets with minimal uncertainty.

**New approach**: Focus on 25%-75% range where:
- Markets have genuine uncertainty
- Price movements are meaningful
- Trading activity indicates real conviction

### Migration Guide

If you were using default settings, no action needed - new defaults are better.

If you want the old behavior (show all trades):
```bash
MIN_PRICE=0.01
MAX_PRICE=0.99
```

But we recommend trying the new defaults first!

### Examples

**Old output (noisy):**
```
🔴 SELL Price: $0.9990 (99.9%) - not interesting
🔴 SELL Price: $0.9900 (99.0%) - not interesting  
🟢 BUY  Price: $0.9400 (94.0%) - not interesting
```

**New output (focused):**
```
🔴 SELL Price: $0.6500 (65.0%) - interesting!
🔴 SELL Price: $0.6000 (60.0%) - interesting!
🟢 BUY  Price: $0.4500 (45.0%) - interesting!
```

---

## [1.0.0] - Previous Version

### Features
- Real-time order book monitoring
- Configurable minimum trade size
- Top 30 markets scanning
- YES/NO outcome display
- Market information display
- Order book analysis (not historical trades)
