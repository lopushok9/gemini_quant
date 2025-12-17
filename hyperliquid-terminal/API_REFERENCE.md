# Hyperliquid Liquidations Monitor - API Reference

## Overview

This document provides a technical reference for developers who want to integrate or extend the Hyperliquid Liquidations Monitor.

## Core Classes

### `LiquidationsMonitor`

Main class for monitoring liquidations on Hyperliquid.

#### Constructor

```python
LiquidationsMonitor(threshold_usd: float = LIQUIDATION_THRESHOLD_USD)
```

**Parameters:**
- `threshold_usd` (float): Minimum USD value for liquidations to be reported. Default: 50000

**Attributes:**
- `base_url` (str): Hyperliquid API base URL
- `session` (aiohttp.ClientSession): HTTP session for API requests
- `threshold_usd` (float): Current threshold value
- `asset_map` (Dict[str, int]): Mapping of asset names to IDs
- `id_to_name` (Dict[int, str]): Mapping of asset IDs to names
- `prices` (Dict[str, float]): Current prices for monitored assets
- `last_processed_time` (Dict[str, int]): Last processed timestamp per asset
- `stats` (dict): Statistics about detected liquidations

#### Methods

##### `async load_market_meta()`

Loads market metadata including asset IDs and names from Hyperliquid API.

**Returns:** None

**Example:**
```python
monitor = LiquidationsMonitor()
await monitor.load_market_meta()
```

##### `async get_current_prices()`

Fetches current prices for all monitored assets.

**Returns:** `Dict[str, float]` - Dictionary of asset prices

**Example:**
```python
prices = await monitor.get_current_prices()
print(f"BTC: ${prices['BTC']:,.2f}")
```

##### `async check_recent_liquidations(asset: str)`

Checks for recent liquidations of a specific asset.

**Parameters:**
- `asset` (str): Asset symbol (e.g., "BTC", "ETH", "SOL")

**Returns:** None (displays liquidations via `display_liquidation`)

**Example:**
```python
await monitor.check_recent_liquidations("BTC")
```

##### `async subscribe_to_trades()`

Main monitoring loop that continuously checks for liquidations.

**Returns:** None (runs indefinitely until interrupted)

**Example:**
```python
await monitor.subscribe_to_trades()
```

##### `async run()`

High-level method that initializes and starts the monitor.

**Returns:** None

**Example:**
```python
monitor = LiquidationsMonitor(threshold_usd=25000)
await monitor.run()
```

##### `async close()`

Properly closes the HTTP session and cleans up resources.

**Returns:** None

**Example:**
```python
await monitor.close()
```

##### `display_liquidation(trade: Dict[str, Any], asset: str, usd_value: float)`

Displays information about a detected liquidation. Override this method for custom behavior.

**Parameters:**
- `trade` (dict): Trade data from Hyperliquid API
- `asset` (str): Asset symbol
- `usd_value` (float): USD value of the liquidation

**Example override:**
```python
class CustomMonitor(LiquidationsMonitor):
    def display_liquidation(self, trade, asset, usd_value):
        # Custom display logic
        print(f"ALERT: {asset} liquidation of ${usd_value:,.0f}")
        # Send to webhook, database, etc.
```

##### `update_stats(asset: str, usd_value: float, side: str)`

Updates internal statistics when a liquidation is detected.

**Parameters:**
- `asset` (str): Asset symbol
- `usd_value` (float): USD value
- `side` (str): Trade side ("SELL" or "BUY")

##### `print_session_stats()`

Prints current session statistics.

##### `print_final_stats()`

Prints final statistics when monitor is stopped.

## Configuration

### Configuration File (`liquidations_config.py`)

```python
# API URLs
HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz"
HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws"

# Monitored assets (can add more)
MONITORED_ASSETS = ["BTC", "ETH", "SOL"]

# Default threshold
LIQUIDATION_THRESHOLD_USD = 50000

# Polling interval in seconds
POLL_INTERVAL_SECONDS = 2

# Request timeout
REQUEST_TIMEOUT_SECONDS = 15

# Retry delay after errors
RETRY_DELAY_SECONDS = 5

# Enable statistics display
ENABLE_STATS = True

# Enable price comparison in output
ENABLE_PRICE_COMPARISON = True

# Display width for separators
DISPLAY_WIDTH = 100

# Enable emoji in output
EMOJI_MODE = True
```

## API Endpoints Used

### Hyperliquid Info API (`/info`)

Base URL: `https://api.hyperliquid.xyz/info`

#### Get Market Metadata

```python
payload = {"type": "meta"}
```

**Response:**
```json
{
  "universe": [
    {"name": "BTC", ...},
    {"name": "ETH", ...}
  ]
}
```

#### Get Current Prices

```python
payload = {"type": "allMids"}
```

**Response:**
```json
{
  "0": "43250.50",  # BTC price
  "1": "2580.25",   # ETH price
  ...
}
```

#### Get Recent Trades

```python
payload = {"type": "recentTrades", "coin": "BTC"}
```

**Response:**
```json
[
  {
    "time": 1703001234567,
    "px": "43180.00",
    "sz": "2.5",
    "side": "SELL",
    "liquidation": true
  },
  ...
]
```

## Integration Examples

### Basic Integration

```python
import asyncio
from liquidations_monitor_advanced import LiquidationsMonitor

async def main():
    monitor = LiquidationsMonitor(threshold_usd=25000)
    await monitor.run()

asyncio.run(main())
```

### With Custom Callback

```python
class NotifyMonitor(LiquidationsMonitor):
    def display_liquidation(self, trade, asset, usd_value):
        super().display_liquidation(trade, asset, usd_value)
        
        # Send notification
        send_telegram_alert(f"Liquidation: {asset} ${usd_value:,.0f}")
        
        # Log to database
        save_to_db({
            "asset": asset,
            "value": usd_value,
            "timestamp": trade.get("time"),
            "price": float(trade.get("px", 0))
        })

monitor = NotifyMonitor(threshold_usd=50000)
await monitor.run()
```

### Programmatic Access

```python
# Get prices without starting monitor
monitor = LiquidationsMonitor()
await monitor.load_market_meta()
prices = await monitor.get_current_prices()

# Check liquidations once
await monitor.check_recent_liquidations("BTC")

# Clean up
await monitor.close()
```

### Running in Background

```python
import asyncio

async def run_monitor_background():
    monitor = LiquidationsMonitor(threshold_usd=100000)
    await monitor.load_market_meta()
    
    # Start monitoring in background
    task = asyncio.create_task(monitor.subscribe_to_trades())
    
    # Do other work...
    await asyncio.sleep(3600)  # Run for 1 hour
    
    # Stop monitor
    task.cancel()
    await monitor.close()

asyncio.run(run_monitor_background())
```

## Data Structures

### Trade Object

```python
{
    "time": 1703001234567,      # Timestamp in milliseconds
    "px": "43180.00",            # Price as string
    "sz": "2.5",                 # Size as string
    "side": "SELL",              # "SELL" or "BUY"
    "liquidation": True          # True if liquidation
}
```

### Statistics Object

```python
{
    "total_liquidations": 15,
    "total_volume_usd": 2500000.00,
    "by_asset": {
        "BTC": {"count": 8, "volume": 1500000.00},
        "ETH": {"count": 5, "volume": 800000.00},
        "SOL": {"count": 2, "volume": 200000.00}
    },
    "by_side": {
        "LONG": {"count": 10, "volume": 1800000.00},
        "SHORT": {"count": 5, "volume": 700000.00}
    }
}
```

## Error Handling

The monitor includes automatic retry logic for API failures:

```python
async def _make_request(self, endpoint: str, payload: Dict[str, Any]):
    try:
        # Make request
        pass
    except Exception as e:
        # Log error
        print(f"Error: {e}")
        # Retry after delay
        await asyncio.sleep(RETRY_DELAY_SECONDS)
```

Common errors:
- **TimeoutError**: API request timed out - will retry automatically
- **ClientError**: Network or API error - will retry automatically  
- **KeyboardInterrupt**: User stopped monitor - exits gracefully

## Performance Considerations

- **Polling Interval**: Default 2 seconds balances responsiveness and API load
- **Connection Pooling**: Reuses HTTP session for efficiency
- **Memory**: Minimal - only stores recent timestamps to avoid duplicates
- **CPU**: Low - async I/O bound, not compute intensive

## Testing

```bash
# Test with short timeout
timeout 10 python3 liquidations_monitor_advanced.py 5000

# Test simple version
python3 liquidations_monitor.py 10000

# Test with example scripts
python3 example_usage.py 1
```

## Troubleshooting

### No liquidations detected

- Lower threshold: `python3 liquidations_monitor_advanced.py 1000`
- Check API connectivity: `curl https://api.hyperliquid.xyz/info -d '{"type":"meta"}'`
- Market may be stable (normal in low volatility periods)

### API errors

- Check internet connection
- Verify Hyperliquid API is up: https://status.hyperliquid.xyz
- Monitor will auto-retry after 5 seconds

### High CPU usage

- Increase `POLL_INTERVAL_SECONDS` in config
- Check for infinite loops in custom code

## License

Same as main repository.
