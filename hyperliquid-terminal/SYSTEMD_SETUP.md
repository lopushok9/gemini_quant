# Setting Up Liquidations Monitor as a System Service

This guide shows how to run the Hyperliquid Liquidations Monitor as a background service on Linux using systemd.

## Prerequisites

- Linux system with systemd (Ubuntu, Debian, CentOS, etc.)
- Python 3.8 or higher
- Required Python packages installed
- Root or sudo access

## Quick Setup

### 1. Install Dependencies

```bash
cd /path/to/hyperliquid-terminal
pip3 install -r requirements.txt
```

### 2. Test the Script

Make sure the monitor works correctly:

```bash
python3 liquidations_monitor_advanced.py 50000
# Press Ctrl+C to stop after confirming it works
```

### 3. Edit the Service File

Open `hyperliquid-liquidations.service` and update these fields:

```ini
User=your_username                    # Replace with your Linux username
WorkingDirectory=/path/to/hyperliquid-terminal
ExecStart=/usr/bin/python3 /path/to/hyperliquid-terminal/liquidations_monitor_advanced.py 50000
```

**Find your Python path:**
```bash
which python3
# Use this path in ExecStart
```

### 4. Install the Service

```bash
# Copy service file to systemd directory
sudo cp hyperliquid-liquidations.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable hyperliquid-liquidations

# Start the service
sudo systemctl start hyperliquid-liquidations
```

## Managing the Service

### Check Status

```bash
sudo systemctl status hyperliquid-liquidations
```

### View Logs

```bash
# Live logs
sudo journalctl -u hyperliquid-liquidations -f

# Last 100 lines
sudo journalctl -u hyperliquid-liquidations -n 100

# Custom log file (if configured)
tail -f /var/log/hyperliquid-liquidations.log
```

### Stop Service

```bash
sudo systemctl stop hyperliquid-liquidations
```

### Restart Service

```bash
sudo systemctl restart hyperliquid-liquidations
```

### Disable Auto-Start

```bash
sudo systemctl disable hyperliquid-liquidations
```

## Configuration Options

### Change Threshold

Edit the service file:

```bash
sudo nano /etc/systemd/system/hyperliquid-liquidations.service
```

Change the ExecStart line:

```ini
# For $25k threshold
ExecStart=/usr/bin/python3 /path/to/hyperliquid-terminal/liquidations_monitor_advanced.py 25000

# For $10k threshold
ExecStart=/usr/bin/python3 /path/to/hyperliquid-terminal/liquidations_monitor_advanced.py 10000
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart hyperliquid-liquidations
```

### Custom Log Location

Edit the service file:

```ini
[Service]
StandardOutput=append:/home/youruser/liquidations/output.log
StandardError=append:/home/youruser/liquidations/error.log
```

Make sure the directory exists:

```bash
mkdir -p /home/youruser/liquidations
```

### Environment Variables

Add custom environment variables:

```ini
[Service]
Environment="THRESHOLD=50000"
Environment="POLL_INTERVAL=3"
```

## Alternative: Using Screen or Tmux

If you don't have root access or prefer not to use systemd:

### Using Screen

```bash
# Install screen
sudo apt-get install screen

# Start a named screen session
screen -S liquidations

# Run the monitor
cd /path/to/hyperliquid-terminal
python3 liquidations_monitor_advanced.py 50000

# Detach from screen: Press Ctrl+A, then D

# Reattach to screen
screen -r liquidations

# List sessions
screen -ls
```

### Using Tmux

```bash
# Install tmux
sudo apt-get install tmux

# Start a named tmux session
tmux new -s liquidations

# Run the monitor
cd /path/to/hyperliquid-terminal
python3 liquidations_monitor_advanced.py 50000

# Detach from tmux: Press Ctrl+B, then D

# Reattach to tmux
tmux attach -t liquidations

# List sessions
tmux ls
```

### Using nohup (Simplest)

```bash
cd /path/to/hyperliquid-terminal
nohup python3 liquidations_monitor_advanced.py 50000 > liquidations.log 2>&1 &

# Get process ID
echo $!

# View logs
tail -f liquidations.log

# Kill process
kill <PID>
```

## Monitoring Multiple Instances

To run multiple monitors with different thresholds:

### 1. Create Multiple Service Files

```bash
# Copy and rename
sudo cp /etc/systemd/system/hyperliquid-liquidations.service \
        /etc/systemd/system/hyperliquid-liquidations-high.service

sudo cp /etc/systemd/system/hyperliquid-liquidations.service \
        /etc/systemd/system/hyperliquid-liquidations-low.service
```

### 2. Edit Each Service

**hyperliquid-liquidations-high.service:**
```ini
Description=Hyperliquid Liquidations Monitor (High Threshold)
ExecStart=/usr/bin/python3 /path/to/.../liquidations_monitor_advanced.py 100000
StandardOutput=append:/var/log/hyperliquid-liquidations-high.log
```

**hyperliquid-liquidations-low.service:**
```ini
Description=Hyperliquid Liquidations Monitor (Low Threshold)
ExecStart=/usr/bin/python3 /path/to/.../liquidations_monitor_advanced.py 10000
StandardOutput=append:/var/log/hyperliquid-liquidations-low.log
```

### 3. Enable All Services

```bash
sudo systemctl daemon-reload
sudo systemctl enable hyperliquid-liquidations-high
sudo systemctl enable hyperliquid-liquidations-low
sudo systemctl start hyperliquid-liquidations-high
sudo systemctl start hyperliquid-liquidations-low
```

## Troubleshooting

### Service Won't Start

```bash
# Check service status
sudo systemctl status hyperliquid-liquidations

# Check logs
sudo journalctl -u hyperliquid-liquidations -n 50

# Common issues:
# - Wrong Python path
# - Missing dependencies
# - Incorrect file paths
# - Permission issues
```

### Fix Python Dependencies

```bash
# Run as the service user
sudo -u your_username pip3 install -r requirements.txt
```

### Permission Denied

```bash
# Make script executable
chmod +x /path/to/hyperliquid-terminal/liquidations_monitor_advanced.py

# Check file ownership
ls -la /path/to/hyperliquid-terminal/
```

### Service Crashes on Start

```bash
# Test script manually as service user
sudo -u your_username python3 liquidations_monitor_advanced.py 50000

# Check for errors in output
```

## Notifications Integration

To add notifications, edit `liquidations_monitor_advanced.py` or create a wrapper script:

### Example Wrapper with Telegram

```bash
#!/bin/bash
# wrapper.sh

export TELEGRAM_BOT_TOKEN="your_token"
export TELEGRAM_CHAT_ID="your_chat_id"

cd /path/to/hyperliquid-terminal
python3 liquidations_monitor_advanced.py 50000 | while read line; do
    echo "$line"
    if [[ "$line" == *"LIQUIDATION DETECTED"* ]]; then
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
             -d chat_id="${TELEGRAM_CHAT_ID}" \
             -d text="$line"
    fi
done
```

Then use wrapper in service:

```ini
ExecStart=/path/to/wrapper.sh
```

## Best Practices

1. **Use separate user**: Create a dedicated user for running the service
2. **Set resource limits**: Add limits to prevent excessive resource usage
3. **Rotate logs**: Use logrotate to manage log file sizes
4. **Monitor the monitor**: Set up alerts if service stops
5. **Test thoroughly**: Always test changes before deploying to production

## Security Considerations

- Run as non-root user
- Restrict file permissions
- Use firewall to block unwanted connections
- Keep dependencies updated
- Monitor system resources

## Support

For issues specific to:
- **systemd**: Check systemd documentation
- **Monitor script**: See main README and API_REFERENCE.md
- **Hyperliquid API**: Check Hyperliquid documentation

## License

Same as main repository.
