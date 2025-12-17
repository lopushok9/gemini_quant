# Configuration for Hyperliquid Positions at Risk Monitor

HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz"
HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws"

MONITORED_ASSETS = [
    "BTC",
    "ETH", 
    "SOL",
]

# Minimum open interest to consider (in USD)
MIN_OPEN_INTEREST_USD = 1000000

# Alert thresholds
OPEN_INTEREST_CHANGE_THRESHOLD = 0.15  # 15% change
LARGE_POSITION_THRESHOLD = 0.05  # 5% of total OI
MARGIN_RISK_THRESHOLD = 15  # 15x leverage threshold for warnings

# Risk calculation
LIQUIDATION_BUFFER_PERCENT = 5.0  # Alert when price is within 5% of liquidation

POLL_INTERVAL_SECONDS = 10

REQUEST_TIMEOUT_SECONDS = 15
RETRY_DELAY_SECONDS = 5

DISPLAY_WIDTH = 120

ENABLE_DETAILED_ANALYSIS = True
ENABLE_ALERTS = True

# Price impact threshold for detecting large positions
PRICE_IMPACT_THRESHOLD = 0.001  # 0.1%

# Minimum number of consecutive alerts before reporting
ALERT_CONSECUTIVE_COUNT = 2