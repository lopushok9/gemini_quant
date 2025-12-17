#!/usr/bin/env python3

import asyncio
import aiohttp
import json
import ssl
import certifi
from datetime import datetime
from typing import Dict, List, Any, Optional
from collections import defaultdict

try:
    from liquidations_config import (
        HYPERLIQUID_API_URL,
        MONITORED_ASSETS,
        LIQUIDATION_THRESHOLD_USD,
        POLL_INTERVAL_SECONDS,
        REQUEST_TIMEOUT_SECONDS,
        RETRY_DELAY_SECONDS,
        DISPLAY_WIDTH,
        ENABLE_STATS,
        ENABLE_PRICE_COMPARISON,
    )
except ImportError:
    HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz"
    MONITORED_ASSETS = ["BTC", "ETH", "SOL"]
    LIQUIDATION_THRESHOLD_USD = 50000
    POLL_INTERVAL_SECONDS = 2
    REQUEST_TIMEOUT_SECONDS = 15
    RETRY_DELAY_SECONDS = 5
    DISPLAY_WIDTH = 100
    ENABLE_STATS = True
    ENABLE_PRICE_COMPARISON = True


class LiquidationsMonitor:
    def __init__(self, threshold_usd: float = LIQUIDATION_THRESHOLD_USD):
        self.base_url = HYPERLIQUID_API_URL
        self.session: Optional[aiohttp.ClientSession] = None
        self.threshold_usd = threshold_usd
        self.asset_map: Dict[str, int] = {}
        self.id_to_name: Dict[int, str] = {}
        self.prices: Dict[str, float] = {}
        self.last_processed_time: Dict[str, int] = {}
        
        self.stats = {
            "total_liquidations": 0,
            "total_volume_usd": 0.0,
            "by_asset": defaultdict(lambda: {"count": 0, "volume": 0.0}),
            "by_side": defaultdict(lambda: {"count": 0, "volume": 0.0}),
        }
        
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
        print("🔄 Loading market metadata...")
        result = await self._make_request("/info", {"type": "meta"})
        if result["success"]:
            universe_data = result["data"]
            for asset_id, asset_info in enumerate(universe_data.get("universe", [])):
                name = asset_info["name"]
                self.asset_map[name] = asset_id
                self.id_to_name[asset_id] = name
            print(f"✅ Loaded {len(self.asset_map)} assets")
            
            for asset in MONITORED_ASSETS:
                if asset in self.asset_map:
                    print(f"   • {asset} (ID: {self.asset_map[asset]})")
        else:
            print(f"❌ Error loading market meta: {result.get('error')}")
            self.asset_map = {"BTC": 0, "ETH": 1, "SOL": 2}
            self.id_to_name = {0: "BTC", 1: "ETH", 2: "SOL"}
    
    async def get_current_prices(self):
        payload = {"type": "allMids"}
        result = await self._make_request("/info", payload)
        if result["success"]:
            data = result["data"]
            
            for asset in MONITORED_ASSETS:
                asset_id = self.asset_map.get(asset)
                if asset_id is not None:
                    price_str = data.get(str(asset_id))
                    if price_str:
                        try:
                            self.prices[asset] = float(price_str)
                        except (ValueError, TypeError):
                            try:
                                payload_spot = {"type": "recentTrades", "coin": asset}
                                result_spot = await self._make_request("/info", payload_spot)
                                if result_spot["success"] and result_spot["data"]:
                                    recent_trade = result_spot["data"][0]
                                    self.prices[asset] = float(recent_trade.get("px", 0))
                            except:
                                pass
        return self.prices
    
    async def subscribe_to_trades(self):
        self.print_header()
        
        while True:
            try:
                await self.get_current_prices()
                
                for asset in MONITORED_ASSETS:
                    await self.check_recent_liquidations(asset)
                
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                
            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"⚠️  Error in monitoring loop: {e}")
                await asyncio.sleep(RETRY_DELAY_SECONDS)
    
    async def check_recent_liquidations(self, asset: str):
        payload = {"type": "recentTrades", "coin": asset}
        result = await self._make_request("/info", payload)
        
        if not result["success"]:
            return
        
        trades = result["data"]
        if not isinstance(trades, list):
            return
            
        for trade in trades:
            is_liquidation = trade.get("liquidation", False)
            
            if not is_liquidation:
                continue
            
            time_ms = trade.get("time", 0)
            
            if asset not in self.last_processed_time:
                self.last_processed_time[asset] = time_ms
                continue
            
            if time_ms <= self.last_processed_time[asset]:
                continue
            
            self.last_processed_time[asset] = max(time_ms, self.last_processed_time[asset])
            
            price = float(trade.get("px", 0))
            size = float(trade.get("sz", 0))
            
            current_price = self.prices.get(asset, price)
            if current_price == 0:
                current_price = price
            
            usd_value = price * size
            
            if usd_value >= self.threshold_usd:
                self.display_liquidation(trade, asset, usd_value)
                self.update_stats(asset, usd_value, trade.get("side", ""))
    
    def update_stats(self, asset: str, usd_value: float, side: str):
        self.stats["total_liquidations"] += 1
        self.stats["total_volume_usd"] += usd_value
        self.stats["by_asset"][asset]["count"] += 1
        self.stats["by_asset"][asset]["volume"] += usd_value
        
        liquidation_type = "LONG" if side.upper() == "SELL" else "SHORT"
        self.stats["by_side"][liquidation_type]["count"] += 1
        self.stats["by_side"][liquidation_type]["volume"] += usd_value
    
    def print_header(self):
        sep = "=" * DISPLAY_WIDTH
        print(f"\n{sep}")
        print("🔴 HYPERLIQUID LIQUIDATIONS MONITOR - ADVANCED")
        print(f"{sep}")
        print(f"📊 Monitoring: {', '.join(MONITORED_ASSETS)}")
        print(f"💰 Threshold: ${self.threshold_usd:,.0f}")
        print(f"🕐 Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        if self.prices:
            print(f"\n📈 Current Prices:")
            for asset in MONITORED_ASSETS:
                price = self.prices.get(asset, 0)
                if price > 0:
                    print(f"   • {asset}: ${price:,.2f}")
                else:
                    print(f"   • {asset}: Loading...")
        
        print(f"{sep}")
        print("🔍 Listening for liquidations...\n")
    
    def display_liquidation(self, trade: Dict[str, Any], asset: str, usd_value: float):
        timestamp = datetime.fromtimestamp(trade.get("time", 0) / 1000).strftime('%Y-%m-%d %H:%M:%S')
        side = trade.get("side", "UNKNOWN").upper()
        price = float(trade.get("px", 0))
        size = float(trade.get("sz", 0))
        
        liquidation_type = "LONG 📉" if side == "SELL" else "SHORT 📈"
        emoji = "🔴" if side == "SELL" else "🟢"
        
        sep = "=" * DISPLAY_WIDTH
        print(f"\n{sep}")
        print(f"🚨 LIQUIDATION DETECTED - {asset} {emoji}")
        print(f"{sep}")
        print(f"🕐 Time:       {timestamp}")
        print(f"📊 Type:       {liquidation_type}")
        print(f"💵 Price:      ${price:,.2f}")
        print(f"📦 Size:       {size:,.6f} {asset}")
        print(f"💰 USD Value:  ${usd_value:,.2f}")
        print(f"⚡ Direction:  {side}")
        
        if ENABLE_PRICE_COMPARISON:
            current_price = self.prices.get(asset)
            if current_price and current_price > 0:
                price_diff = ((current_price - price) / price) * 100
                print(f"📌 Current:    ${current_price:,.2f} ({price_diff:+.2f}%)")
        
        print(f"{sep}")
        
        if ENABLE_STATS:
            self.print_session_stats()
    
    def print_session_stats(self):
        if self.stats["total_liquidations"] > 0:
            print(f"\n📊 Session Statistics:")
            print(f"   Total Liquidations: {self.stats['total_liquidations']}")
            print(f"   Total Volume: ${self.stats['total_volume_usd']:,.2f}")
            
            if self.stats["by_asset"]:
                print(f"\n   By Asset:")
                for asset, data in self.stats["by_asset"].items():
                    print(f"      • {asset}: {data['count']} liquidations, ${data['volume']:,.2f}")
            
            if self.stats["by_side"]:
                print(f"\n   By Type:")
                for side_type, data in self.stats["by_side"].items():
                    print(f"      • {side_type}: {data['count']} liquidations, ${data['volume']:,.2f}")
            
            print()
    
    async def run(self):
        try:
            await self.load_market_meta()
            print()
            print("🔄 Fetching current prices...")
            await self.get_current_prices()
            print("✅ Ready to monitor\n")
            
            await self.subscribe_to_trades()
        except KeyboardInterrupt:
            sep = "=" * DISPLAY_WIDTH
            print(f"\n\n{sep}")
            print("🛑 Shutting down monitor...")
            print(f"{sep}")
            self.print_final_stats()
        finally:
            await self.close()
    
    def print_final_stats(self):
        sep = "=" * DISPLAY_WIDTH
        print("\n📊 FINAL SESSION STATISTICS")
        print(sep)
        
        if self.stats["total_liquidations"] == 0:
            print("No liquidations detected during this session.")
        else:
            print(f"Total Liquidations: {self.stats['total_liquidations']}")
            print(f"Total Volume: ${self.stats['total_volume_usd']:,.2f}")
            print(f"Average Size: ${self.stats['total_volume_usd'] / self.stats['total_liquidations']:,.2f}")
            
            if self.stats["by_asset"]:
                print(f"\nBreakdown by Asset:")
                for asset, data in sorted(self.stats["by_asset"].items(), 
                                         key=lambda x: x[1]["volume"], reverse=True):
                    avg = data["volume"] / data["count"] if data["count"] > 0 else 0
                    print(f"  {asset}:")
                    print(f"    Count: {data['count']}")
                    print(f"    Volume: ${data['volume']:,.2f}")
                    print(f"    Average: ${avg:,.2f}")
            
            if self.stats["by_side"]:
                print(f"\nBreakdown by Type:")
                for side_type, data in sorted(self.stats["by_side"].items(),
                                             key=lambda x: x[1]["volume"], reverse=True):
                    avg = data["volume"] / data["count"] if data["count"] > 0 else 0
                    print(f"  {side_type} Liquidations:")
                    print(f"    Count: {data['count']}")
                    print(f"    Volume: ${data['volume']:,.2f}")
                    print(f"    Average: ${avg:,.2f}")
        
        print(sep)
        print("👋 Thank you for using Hyperliquid Liquidations Monitor!")
        print(f"{sep}\n")


async def main():
    import sys
    
    threshold = LIQUIDATION_THRESHOLD_USD
    if len(sys.argv) > 1:
        try:
            threshold = float(sys.argv[1])
        except ValueError:
            print(f"⚠️  Invalid threshold value, using default: ${threshold:,.0f}")
    
    monitor = LiquidationsMonitor(threshold_usd=threshold)
    await monitor.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
