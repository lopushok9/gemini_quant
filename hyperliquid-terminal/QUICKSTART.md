# Liquidations Monitor - Quick Start Guide

Get started with the Hyperliquid Liquidations Monitor in under 2 minutes.

## ⚡ One-Line Setup

```bash
cd hyperliquid-terminal && pip install -r requirements.txt && python3 liquidations_monitor_advanced.py
```

That's it! The monitor will start tracking liquidations above $50,000.

## 📋 Step-by-Step

### 1. Install Dependencies

```bash
cd hyperliquid-terminal
pip install -r requirements.txt
```

### 2. Run the Monitor

```bash
# Default: $50k threshold
python3 liquidations_monitor_advanced.py

# Or with custom threshold
python3 liquidations_monitor_advanced.py 25000
```

### 3. Watch Liquidations

The monitor will display:
- 🔴 Real-time liquidation alerts
- 💰 USD value of each liquidation
- 📊 Position type (LONG/SHORT)
- 📈 Price and size information
- 📉 Current price comparison

### 4. Stop the Monitor

Press `Ctrl+C` to stop and see final statistics.

## 🎯 Common Use Cases

### High-Value Alerts Only ($100k+)
```bash
python3 liquidations_monitor_advanced.py 100000
```

### Catch More Events ($10k+)
```bash
python3 liquidations_monitor_advanced.py 10000
```

### Run in Background
```bash
./run_liquidations_monitor.sh 50000 background
```

### Check Logs
```bash
tail -f liquidations_*.log
```

## 🛠️ Customization

Edit `liquidations_config.py` to change:
- Monitored assets (add ARB, MATIC, etc.)
- Polling interval
- Display preferences

```python
MONITORED_ASSETS = ["BTC", "ETH", "SOL", "ARB"]
POLL_INTERVAL_SECONDS = 3
LIQUIDATION_THRESHOLD_USD = 25000
```

## 📖 Need More Help?

- **User Guide:** `LIQUIDATIONS_README.md`
- **Developer Docs:** `API_REFERENCE.md`
- **System Service:** `SYSTEMD_SETUP.md`
- **Examples:** `python3 example_usage.py`

## ✅ Verify Installation

```bash
# Check Python version (need 3.8+)
python3 --version

# Test import
python3 -c "import aiohttp, certifi; print('OK')"

# Quick test (10 seconds)
timeout 10 python3 liquidations_monitor_advanced.py 5000
```

## 🚀 Advanced

### Run as Service (Linux)
```bash
# Edit paths in service file
nano hyperliquid-liquidations.service

# Install
sudo cp hyperliquid-liquidations.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start hyperliquid-liquidations
sudo systemctl status hyperliquid-liquidations
```

### Integration Example
```python
from liquidations_monitor_advanced import LiquidationsMonitor

class MyMonitor(LiquidationsMonitor):
    def display_liquidation(self, trade, asset, usd_value):
        super().display_liquidation(trade, asset, usd_value)
        # Your custom code here
        send_notification(f"Liquidation: {asset} ${usd_value}")

monitor = MyMonitor(threshold_usd=50000)
await monitor.run()
```

## 💡 Tips

1. **Start with high threshold** ($50k+) to avoid spam
2. **Lower threshold** during volatile markets
3. **Run in background** for continuous monitoring
4. **Check logs regularly** when running as service
5. **Customize display width** if using narrow terminal

## ⚠️ Troubleshooting

### "Module not found"
```bash
pip install -r requirements.txt --upgrade
```

### "Connection error"
- Check internet connection
- Verify Hyperliquid API is up
- Monitor will auto-retry

### "No liquidations detected"
- This is normal during stable markets
- Try lower threshold to test
- Be patient during low volatility

## 🎓 Learn More

```bash
# See all examples
python3 example_usage.py

# Read full docs
cat LIQUIDATIONS_README.md

# Check API reference
cat API_REFERENCE.md
```

## 📊 Sample Output

```
================================================================================
🔴 HYPERLIQUID LIQUIDATIONS MONITOR - ADVANCED
================================================================================
📊 Monitoring: BTC, ETH, SOL
💰 Threshold: $50,000
🕐 Started at: 2024-12-17 15:30:00
================================================================================
🔍 Listening for liquidations...

================================================================================
🚨 LIQUIDATION DETECTED - BTC 🔴
================================================================================
🕐 Time:       2024-12-17 15:32:45
📊 Type:       LONG 📉
💵 Price:      $43,180.00
📦 Size:       2.500000 BTC
💰 USD Value:  $107,950.00
⚡ Direction:  SELL
📌 Current:    $43,250.00 (+0.16%)
================================================================================
```

---

**Ready to monitor?** Run: `python3 liquidations_monitor_advanced.py`

Questions? See full documentation in `LIQUIDATIONS_README.md`
