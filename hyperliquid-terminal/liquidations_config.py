# Configuration for Hyperliquid Liquidations Monitor

HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz"
HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws"

MONITORED_ASSETS = [
    "BTC",
    "ETH", 
    "SOL",
]

LIQUIDATION_THRESHOLD_USD = 50000

POLL_INTERVAL_SECONDS = 2

REQUEST_TIMEOUT_SECONDS = 15

RETRY_DELAY_SECONDS = 5

ENABLE_STATS = True

ENABLE_PRICE_COMPARISON = True

DISPLAY_WIDTH = 100

EMOJI_MODE = True
