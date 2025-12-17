# Liquidations Monitor - Files Overview

This document provides a quick reference for all files related to the Hyperliquid Liquidations Monitor.

## Core Scripts

### `liquidations_monitor.py`
**Size:** ~10 KB | **Type:** Python Script (Executable)

Simple version of the liquidations monitor. Good for basic usage and understanding the core logic.

**Usage:**
```bash
python3 liquidations_monitor.py [threshold]
```

**Features:**
- Basic liquidation detection
- Clean, readable code
- Minimal dependencies
- Good starting point for customization

---

### `liquidations_monitor_advanced.py`
**Size:** ~14 KB | **Type:** Python Script (Executable)

Advanced version with statistics, better error handling, and configuration support.

**Usage:**
```bash
python3 liquidations_monitor_advanced.py [threshold]
```

**Features:**
- Session statistics tracking
- Configurable via config file
- Better error handling and retry logic
- Price comparison display
- Asset and side breakdown
- Final statistics report

**Recommended for:** Production use, monitoring, data collection

---

## Configuration

### `liquidations_config.py`
**Size:** ~430 bytes | **Type:** Python Module

Central configuration file for the advanced monitor.

**Key Settings:**
- `MONITORED_ASSETS` - List of assets to track (default: BTC, ETH, SOL)
- `LIQUIDATION_THRESHOLD_USD` - Minimum liquidation size (default: $50,000)
- `POLL_INTERVAL_SECONDS` - How often to check (default: 2s)
- `ENABLE_STATS` - Show statistics (default: True)
- `DISPLAY_WIDTH` - Console width (default: 100)

**Customization:**
```python
# Edit to add more assets
MONITORED_ASSETS = ["BTC", "ETH", "SOL", "ARB", "MATIC"]

# Lower threshold for more alerts
LIQUIDATION_THRESHOLD_USD = 10000
```

---

## Documentation

### `LIQUIDATIONS_README.md`
**Size:** ~5.6 KB | **Type:** Documentation

Main user documentation for the liquidations monitor.

**Contains:**
- Quick start guide
- Feature overview
- Usage examples
- Configuration instructions
- Troubleshooting tips

**Target Audience:** End users, traders

---

### `API_REFERENCE.md`
**Size:** ~8.7 KB | **Type:** Technical Documentation

Comprehensive API reference for developers.

**Contains:**
- Class and method documentation
- API endpoints used
- Integration examples
- Data structure definitions
- Performance considerations

**Target Audience:** Developers, integrators

---

### `SYSTEMD_SETUP.md`
**Size:** ~7.3 KB | **Type:** Setup Guide

Step-by-step guide for running the monitor as a Linux system service.

**Contains:**
- systemd service setup
- Alternative methods (screen, tmux, nohup)
- Multiple instance configuration
- Troubleshooting
- Notification integration examples

**Target Audience:** System administrators, DevOps

---

### `LIQUIDATIONS_FILES_OVERVIEW.md` (this file)
**Size:** ~3 KB | **Type:** Quick Reference

Overview of all files in the liquidations monitor suite.

---

## Helper Scripts

### `run_liquidations_monitor.sh`
**Size:** ~1.5 KB | **Type:** Bash Script (Executable)

Convenient launcher script for the monitor.

**Usage:**
```bash
./run_liquidations_monitor.sh [threshold] [mode]
```

**Modes:**
- `simple` - Runs basic version
- `advanced` - Runs advanced version (default)
- `background` - Runs in background with logging

**Examples:**
```bash
# Default: advanced mode, $50k threshold
./run_liquidations_monitor.sh

# Custom threshold
./run_liquidations_monitor.sh 25000 advanced

# Background mode
./run_liquidations_monitor.sh 100000 background
```

---

### `example_usage.py`
**Size:** ~5 KB | **Type:** Python Script

Collection of usage examples and integration patterns.

**Examples Included:**
1. Basic usage
2. Custom threshold
3. With callback
4. Monitoring loop
5. Multiple monitors

**Usage:**
```bash
python3 example_usage.py [1-5]
```

**Purpose:** Learning, testing, integration patterns

---

## System Files

### `hyperliquid-liquidations.service`
**Size:** ~600 bytes | **Type:** systemd Unit File

Template systemd service file for running the monitor as a daemon.

**Setup:**
1. Edit paths and user
2. Copy to `/etc/systemd/system/`
3. Enable and start service

**See:** SYSTEMD_SETUP.md for detailed instructions

---

### `.gitignore`
**Size:** ~150 bytes | **Type:** Git Configuration

Prevents committing unnecessary files.

**Excludes:**
- Python cache files (`__pycache__/`, `*.pyc`)
- Log files (`*.log`)
- Virtual environments (`venv/`, `env/`)
- OS files (`.DS_Store`, `.swp`)

---

## Dependencies

### Additional Requirements
The liquidations monitor adds these dependencies to `requirements.txt`:
- `aiohttp` - Async HTTP client
- `websockets` - WebSocket support (future use)
- `certifi` - SSL certificate bundle

**Install:**
```bash
pip install -r requirements.txt
```

---

## File Relationships

```
liquidations_monitor.py (simple)
    ↓
liquidations_config.py (optional config)
    ↓
liquidations_monitor_advanced.py (advanced)
    ↓
run_liquidations_monitor.sh (launcher)
    ↓
hyperliquid-liquidations.service (systemd)
```

---

## Quick Start Matrix

| Use Case | File to Use | Command |
|----------|-------------|---------|
| Quick test | `liquidations_monitor.py` | `python3 liquidations_monitor.py 10000` |
| Production monitoring | `liquidations_monitor_advanced.py` | `python3 liquidations_monitor_advanced.py 50000` |
| Custom integration | `example_usage.py` | Adapt examples |
| System service | `hyperliquid-liquidations.service` | See SYSTEMD_SETUP.md |
| Quick launch | `run_liquidations_monitor.sh` | `./run_liquidations_monitor.sh 50000 advanced` |

---

## Storage Requirements

Total size of liquidations monitor suite: **~50 KB**
- Scripts: ~30 KB
- Documentation: ~20 KB
- Config: <1 KB

Runtime memory: **~10-20 MB** (Python + aiohttp)

---

## Maintenance

### Updating
```bash
# Update dependencies
pip install -r requirements.txt --upgrade

# Pull latest changes
git pull origin main

# Restart service (if using systemd)
sudo systemctl restart hyperliquid-liquidations
```

### Backup
Important files to backup:
- `liquidations_config.py` (your custom settings)
- `hyperliquid-liquidations.service` (if modified)
- Any custom modifications to scripts

---

## Support

- **User Issues:** See LIQUIDATIONS_README.md
- **Developer Questions:** See API_REFERENCE.md
- **System Setup:** See SYSTEMD_SETUP.md
- **General:** See main project README.md

---

## Version History

- **v1.0** (2024-12) - Initial release
  - Simple and advanced monitors
  - Configuration support
  - Full documentation
  - systemd integration
  - Example scripts

---

## License

All liquidations monitor files are part of the Gemini Quant project and share the same license as the main repository.
