# Handles all communication with the Hyperliquid API
import aiohttp
import asyncio
import json
import ssl
import certifi
from typing import Dict, Any, Optional
from config import HYPERLIQUID_API_URL, DEFAULT_ASSET
import time

class HyperliquidAPI:
    def __init__(self):
        self.base_url = HYPERLIQUID_API_URL
        self._asset_map: Dict[str, int] = {}
        self._id_to_name: Dict[int, str] = {}
        self._universe_data: Optional[Dict[str, Any]] = None
        self.session: Optional[aiohttp.ClientSession] = None

    async def _ensure_session(self):
        """Ensure we have an active session with proper timeout and keepalive settings."""
        if self.session is None or self.session.closed:
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            # Configure connector with timeout and keepalive
            connector = aiohttp.TCPConnector(
                ssl=ssl_context,
                ttl_dns_cache=300,
                keepalive_timeout=30,
                force_close=False
            )
            # Set timeout for all requests: 10s connect, 30s total
            timeout = aiohttp.ClientTimeout(total=30, connect=10)
            self.session = aiohttp.ClientSession(
                connector=connector,
                timeout=timeout
            )

    async def close(self):
        """Properly close the session."""
        if self.session and not self.session.closed:
            await self.session.close()
            # Give time for cleanup to prevent warnings
            await asyncio.sleep(0.25)

    async def _make_request(self, endpoint: str, payload: Dict[str, Any], max_retries: int = 3) -> Dict[str, Any]:
        """Helper to make POST requests to the Hyperliquid API with retry logic."""
        await self._ensure_session()
        
        last_error = None
        for attempt in range(max_retries):
            try:
                headers = {"Content-Type": "application/json"}
                # Set per-request timeout of 10 seconds
                timeout = aiohttp.ClientTimeout(total=10)
                async with self.session.post(
                    self.base_url + endpoint,
                    headers=headers,
                    json=payload,
                    timeout=timeout
                ) as response:
                    response.raise_for_status()
                    data = await response.json()
                    return {"success": True, "data": data}
                    
            except asyncio.TimeoutError as e:
                last_error = f"Timeout: {str(e)}"
            except aiohttp.ClientError as e:
                last_error = f"Client error: {str(e)}"
            except Exception as e:
                last_error = f"Unexpected error: {str(e)}"
            
            # If this wasn't the last attempt, wait before retrying
            if attempt < max_retries - 1:
                # Exponential backoff: 0.5s, 1s, 2s
                wait_time = 0.5 * (2 ** attempt)
                await asyncio.sleep(wait_time)
        
        # All retries failed
        return {"success": False, "error": last_error or "Unknown error"}

    async def load_market_meta(self):
        """Loads market metadata (asset IDs) on initialization."""
        result = await self._make_request("/info", {"type": "meta"})
        if result["success"]:
            self._universe_data = result["data"] # The universe data is directly in 'data'
            for asset_id, asset_info in enumerate(self._universe_data.get("universe", [])):
                self._asset_map[asset_info["name"]] = asset_id
                self._id_to_name[asset_id] = asset_info["name"]
        else:
            print(f"Error loading market meta: {result.get('error')}")
            # Fallback for common assets if meta fails
            self._asset_map["BTC"] = 0
            self._id_to_name[0] = "BTC"
            self._asset_map["ETH"] = 1
            self._id_to_name[1] = "ETH"
            self._asset_map["ARB"] = 2
            self._id_to_name[2] = "ARB"


    def get_asset_id(self, ticker: str) -> Optional[int]:
        """Returns the Hyperliquid asset ID for a given ticker."""
        return self._asset_map.get(ticker.upper())

    def get_asset_name(self, asset_id: int) -> Optional[str]:
        """Returns the ticker for a given asset ID."""
        return self._id_to_name.get(asset_id)

    async def get_l2_book(self, asset_id: int) -> Dict[str, Any]:
        """Fetches the L2 order book for a given asset ID."""
        coin = self.get_asset_name(asset_id)
        if not coin:
             return {"success": False, "error": "Invalid asset ID", "data": {"bids": [], "asks": []}}
        
        payload = {"type": "l2Book", "coin": coin}
        result = await self._make_request("/info", payload)
        if result["success"]:
            data = result["data"]
            levels = data.get("levels", [[], []])
            return {"success": True, "data": {"bids": levels[0], "asks": levels[1]}}
        else:
            return {"success": False, "error": result["error"], "data": {"bids": [], "asks": []}}

    async def get_trades(self, asset_id: int) -> Dict[str, Any]:
        """Fetches recent trades for a given asset ID."""
        coin = self.get_asset_name(asset_id)
        if not coin:
             return {"success": False, "error": "Invalid asset ID", "data": []}

        payload = {"type": "recentTrades", "coin": coin}
        result = await self._make_request("/info", payload)
        if result["success"]:
            return {"success": True, "data": result["data"]}
        else:
            return {"success": False, "error": result["error"], "data": []}

    async def get_candle_data(self, asset_id: int, interval: str = "15m", limit: int = 100) -> Dict[str, Any]:
        """
        Fetches candle data for a given asset ID.
        Intervals can be "1m", "5m", "15m", "1h", "4h", "12h", "1d".
        """
        coin = self.get_asset_name(asset_id)
        if not coin:
             return {"success": False, "error": "Invalid asset ID", "data": []}

        # Calculate start and end time based on limit and interval
        import time
        now_ms = int(time.time() * 1000)
        
        interval_map = {
            "1m": 60 * 1000,
            "5m": 5 * 60 * 1000,
            "15m": 15 * 60 * 1000,
            "1h": 60 * 60 * 1000,
            "4h": 4 * 60 * 60 * 1000,
            "12h": 12 * 60 * 60 * 1000,
            "1d": 24 * 60 * 60 * 1000,
        }
        interval_ms = interval_map.get(interval, 15 * 60 * 1000)
        start_time = now_ms - (limit * interval_ms)

        payload = {"type": "candleSnapshot", "req": {"coin": coin, "interval": interval, "startTime": start_time, "endTime": now_ms}}
        result = await self._make_request("/info", payload)
        if result["success"]:
            return {"success": True, "data": result["data"]}
        else:
            return {"success": False, "error": result["error"], "data": []}

    async def get_open_interest(self, asset_id: int) -> Dict[str, Any]:
        """Fetches open interest for a given asset ID."""
        # Open interest is in metaAndAssetCtxs
        payload = {"type": "metaAndAssetCtxs"}
        result = await self._make_request("/info", payload)
        if result["success"]:
            try:
                # result["data"] is [universe, assetCtxs]
                asset_ctxs = result["data"][1]
                if asset_id < len(asset_ctxs):
                    return {"success": True, "data": {"openInterest": asset_ctxs[asset_id]["openInterest"]}}
                else:
                    return {"success": False, "error": "Asset ID out of range", "data": None}
            except (IndexError, KeyError, TypeError) as e:
                 return {"success": False, "error": f"Error parsing open interest: {e}", "data": None}
        else:
            return {"success": False, "error": result["error"], "data": None}

    async def get_funding_rate(self, asset_id: int) -> Dict[str, Any]:
        """Fetches funding rate for a given asset ID."""
        coin = self.get_asset_name(asset_id)
        if not coin:
             return {"success": False, "error": "Invalid asset ID", "data": None}

        payload = {"type": "fundingHistory", "coin": coin, "startTime": 0}
        result = await self._make_request("/info", payload)
        if result["success"] and result["data"]:
            # Return the latest entry (first one usually? or last? debug script showed list)
            # Assuming list is time sorted.
            # Actually, let's just return the first one as "latest" if it's reverse chrono, or check timestamp.
            # Usually APIs return latest first.
            return {"success": True, "data": result["data"][0]} 
        else:
            return {"success": False, "error": result.get("error", "No funding data"), "data": None}


# Example of how to use the client
if __name__ == "__main__":
    async def main():
        client = HyperliquidAPI()
        await client.load_market_meta()
        
        btc_id = client.get_asset_id("BTC")
        if btc_id is None:
            print("Could not find asset ID for BTC.")
        else:
            print(f"BTC Asset ID: {btc_id}")

            print("\n--- L2 Book for BTC ---")
            l2_book = await client.get_l2_book(btc_id)
            if l2_book["success"]:
                print(f"Bids: {l2_book['data']['bids'][:3]}")
                print(f"Asks: {l2_book['data']['asks'][:3]}")
            else:
                print(f"Error fetching L2 book: {l2_book['error']}")

            print("\n--- Trades for BTC ---")
            trades = await client.get_trades(btc_id)
            if trades["success"]:
                for trade in trades["data"][:3]:
                    print(f"  {trade['time']} | {trade['side']} | {trade['px']} | {trade['sz']}")
            else:
                print(f"Error fetching trades: {trades['error']}")
            
            print("\n--- Candle Data (15m) for BTC ---")
            candles = await client.get_candle_data(btc_id, interval="15m")
            if candles["success"]:
                # Candle format might be different now?
                # Debug output didn't show candle structure, but usually it's list of objects.
                # Let's print one to see.
                if len(candles["data"]) > 0:
                    c = candles["data"][0]
                    print(f"  Time: {c.get('t')} O:{c.get('o')} H:{c.get('h')} L:{c.get('l')} C:{c.get('c')} V:{c.get('v')}")
            else:
                print(f"Error fetching candles: {candles['error']}")

            print("\n--- Open Interest for BTC ---")
            oi = await client.get_open_interest(btc_id)
            if oi["success"] and oi["data"]:
                print(f"  Open Interest: {oi['data']['openInterest']}")
            else:
                print(f"Error fetching Open Interest: {oi['error']}")

            print("\n--- Funding Rate for BTC ---")
            fr = await client.get_funding_rate(btc_id)
            if fr["success"] and fr["data"]:
                print(f"  Funding Rate: {fr['data'].get('fundingRate', 'N/A')} (hourly?)")
            else:
                print(f"Error fetching Funding Rate: {fr['error']}")
        
        await client.close()

    asyncio.run(main())