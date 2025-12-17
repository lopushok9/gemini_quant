#!/usr/bin/env python3

import asyncio
import aiohttp
import json
import ssl
import certifi
from datetime import datetime
from typing import Dict, List, Any, Optional
import websockets

HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz"
HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws"

MONITORED_ASSETS = ["BTC", "ETH", "SOL"]

LIQUIDATION_THRESHOLD_USD = 50000


class LiquidationsMonitor:
    def __init__(self, threshold_usd: float = LIQUIDATION_THRESHOLD_USD):
        self.base_url = HYPERLIQUID_API_URL
        self.ws_url = HYPERLIQUID_WS_URL
        self.session: Optional[aiohttp.ClientSession] = None
        self.threshold_usd = threshold_usd
        self.asset_map: Dict[str, int] = {}
        self.id_to_name: Dict[int, str] = {}
        self.prices: Dict[str, float] = {}
        self.last_processed_time: Dict[str, int] = {}
        
    async def _ensure_session(self):
        if self.session is None or self.session.closed:
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            connector = aiohttp.TCPConnector(
                ssl=ssl_context,
                ttl_dns_cache=300,
                keepalive_timeout=30,
                force_close=False
            )
            timeout = aiohttp.ClientTimeout(total=30, connect=10)
            self.session = aiohttp.ClientSession(
                connector=connector,
                timeout=timeout
            )
    
    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()
            await asyncio.sleep(0.25)
    
    async def _make_request(self, endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        await self._ensure_session()
        
        try:
            headers = {"Content-Type": "application/json"}
            timeout = aiohttp.ClientTimeout(total=15)
            async with self.session.post(
                self.base_url + endpoint,
                headers=headers,
                json=payload,
                timeout=timeout
            ) as response:
                response.raise_for_status()
                data = await response.json()
                return {"success": True, "data": data}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def load_market_meta(self):
        print("Loading market metadata...")
        result = await self._make_request("/info", {"type": "meta"})
        if result["success"]:
            universe_data = result["data"]
            for asset_id, asset_info in enumerate(universe_data.get("universe", [])):
                name = asset_info["name"]
                self.asset_map[name] = asset_id
                self.id_to_name[asset_id] = name
            print(f"✓ Loaded {len(self.asset_map)} assets")
        else:
            print(f"✗ Error loading market meta: {result.get('error')}")
            self.asset_map = {"BTC": 0, "ETH": 1, "SOL": 2}
            self.id_to_name = {0: "BTC", 1: "ETH", 2: "SOL"}
    
    async def get_current_prices(self):
        payload = {"type": "allMids"}
        result = await self._make_request("/info", payload)
        if result["success"]:
            data = result["data"]
            if isinstance(data, dict):
                mids = data
            else:
                mids = {}
            
            for asset in MONITORED_ASSETS:
                asset_id = self.asset_map.get(asset)
                if asset_id is not None:
                    price_str = mids.get(str(asset_id))
                    if price_str:
                        try:
                            self.prices[asset] = float(price_str)
                        except (ValueError, TypeError):
                            pass
        return self.prices
    
    async def get_user_fills(self, user_address: str) -> List[Dict[str, Any]]:
        payload = {"type": "userFills", "user": user_address}
        result = await self._make_request("/info", payload)
        if result["success"]:
            return result["data"]
        return []
    
    async def poll_recent_liquidations(self):
        for asset in MONITORED_ASSETS:
            asset_id = self.asset_map.get(asset)
            if asset_id is None:
                continue
            
            payload = {"type": "userFills", "user": "0x0000000000000000000000000000000000000000"}
            result = await self._make_request("/info", payload)
            
            if result["success"]:
                fills = result["data"]
                self.process_fills_for_liquidations(fills, asset)
    
    def process_fills_for_liquidations(self, fills: List[Dict[str, Any]], asset: str):
        if not fills:
            return
        
        for fill in fills:
            if fill.get("liquidation", False) or "liquidation" in fill.get("closedPnl", "").lower():
                time_ms = fill.get("time", 0)
                if asset not in self.last_processed_time:
                    self.last_processed_time[asset] = 0
                
                if time_ms <= self.last_processed_time[asset]:
                    continue
                
                self.last_processed_time[asset] = time_ms
                
                price = float(fill.get("px", 0))
                size = float(fill.get("sz", 0))
                usd_value = price * size
                
                if usd_value >= self.threshold_usd:
                    self.display_liquidation(fill, asset, usd_value)
    
    async def subscribe_to_trades(self):
        print(f"\n{'='*80}")
        print("🔴 HYPERLIQUID LIQUIDATIONS MONITOR")
        print(f"{'='*80}")
        print(f"Monitoring: {', '.join(MONITORED_ASSETS)}")
        print(f"Threshold: ${self.threshold_usd:,.0f}")
        print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*80}\n")
        
        while True:
            try:
                await self.get_current_prices()
                
                for asset in MONITORED_ASSETS:
                    await self.check_recent_liquidations(asset)
                
                await asyncio.sleep(2)
                
            except Exception as e:
                print(f"Error in monitoring loop: {e}")
                await asyncio.sleep(5)
    
    async def check_recent_liquidations(self, asset: str):
        payload = {"type": "recentTrades", "coin": asset}
        result = await self._make_request("/info", payload)
        
        if not result["success"]:
            return
        
        trades = result["data"]
        for trade in trades:
            if trade.get("liquidation"):
                time_ms = trade.get("time", 0)
                
                if asset not in self.last_processed_time:
                    self.last_processed_time[asset] = 0
                
                if time_ms <= self.last_processed_time[asset]:
                    continue
                
                self.last_processed_time[asset] = time_ms
                
                price = float(trade.get("px", 0))
                size = float(trade.get("sz", 0))
                usd_value = price * size
                
                if usd_value >= self.threshold_usd:
                    self.display_liquidation_from_trade(trade, asset, usd_value)
    
    def display_liquidation_from_trade(self, trade: Dict[str, Any], asset: str, usd_value: float):
        timestamp = datetime.fromtimestamp(trade.get("time", 0) / 1000).strftime('%Y-%m-%d %H:%M:%S')
        side = trade.get("side", "UNKNOWN").upper()
        price = float(trade.get("px", 0))
        size = float(trade.get("sz", 0))
        
        liquidation_type = "LONG" if side == "SELL" else "SHORT"
        
        print(f"\n{'='*80}")
        print(f"🚨 LIQUIDATION DETECTED - {asset}")
        print(f"{'='*80}")
        print(f"Time:       {timestamp}")
        print(f"Type:       {liquidation_type} liquidation")
        print(f"Price:      ${price:,.2f}")
        print(f"Size:       {size:,.4f} {asset}")
        print(f"USD Value:  ${usd_value:,.2f}")
        print(f"Side:       {side}")
        print(f"{'='*80}\n")
    
    def display_liquidation(self, fill: Dict[str, Any], asset: str, usd_value: float):
        timestamp = datetime.fromtimestamp(fill.get("time", 0) / 1000).strftime('%Y-%m-%d %H:%M:%S')
        side = fill.get("side", "UNKNOWN").upper()
        price = float(fill.get("px", 0))
        size = float(fill.get("sz", 0))
        
        print(f"\n{'='*80}")
        print(f"🚨 LIQUIDATION DETECTED - {asset}")
        print(f"{'='*80}")
        print(f"Time:       {timestamp}")
        print(f"Price:      ${price:,.2f}")
        print(f"Size:       {size:,.4f} {asset}")
        print(f"USD Value:  ${usd_value:,.2f}")
        print(f"Side:       {side}")
        print(f"{'='*80}\n")
    
    async def run(self):
        try:
            await self.load_market_meta()
            await self.get_current_prices()
            
            print("\nCurrent prices:")
            for asset in MONITORED_ASSETS:
                price = self.prices.get(asset, 0)
                print(f"  {asset}: ${price:,.2f}")
            
            await self.subscribe_to_trades()
        except KeyboardInterrupt:
            print("\n\nShutting down monitor...")
        finally:
            await self.close()


async def main():
    import sys
    
    threshold = LIQUIDATION_THRESHOLD_USD
    if len(sys.argv) > 1:
        try:
            threshold = float(sys.argv[1])
            print(f"Using custom threshold: ${threshold:,.0f}")
        except ValueError:
            print(f"Invalid threshold value, using default: ${threshold:,.0f}")
    
    monitor = LiquidationsMonitor(threshold_usd=threshold)
    await monitor.run()


if __name__ == "__main__":
    asyncio.run(main())
