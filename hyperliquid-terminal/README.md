# Hyperliquid Terminal

A high-performance terminal UI for real-time monitoring of Hyperliquid DEX activities. Built with Python and `Textual` for a fast, responsive trading experience.

## Features
- **Real-time Order Book**: Live L2 data from Hyperliquid.
- **Whale Trade Tracker (`large_trades.py`)**: Real-time websocket monitoring of trades ≥$100,000.
- **Liquidation Risk Monitor (`liquid.py`)**: Tracks critical positions (within 5% of liquidation) and market-wide risk metrics.
- **Technical Charts**: Integrated candle snapshots using `plotext`.
- **Position Tracking**: View open positions and risk levels (simulated/real).

## Specialized Tools

### 1. Large Trades Monitor
Tracks significant market movements by monitoring large trades in real-time.
```bash
# Monitor all supported assets
python3 large_trades.py

# Monitor a specific asset
python3 large_trades.py BTC
```

### 2. Liquidation Monitor
Analyzes market data to identify high-risk positions nearing liquidation (≤5% distance).
```bash
# Monitor all supported assets
python3 liquid.py

# Monitor a specific asset
python3 liquid.py ETH
```

## Installation

### 1. Set up Environment
```bash
cd hyperliquid-terminal
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Launch Terminal
```bash
python3 main.py
```

## Shortcuts
- `Ctrl+C`: Exit the terminal.
- `Q`: Quit application.
- `R`: Refresh data (if manual refresh is enabled).
