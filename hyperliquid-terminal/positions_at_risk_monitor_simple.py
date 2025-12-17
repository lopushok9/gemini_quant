#!/usr/bin/env python3

import asyncio
import aiohttp
import ssl
import certifi
from datetime import datetime
from typing import Dict, Any, Optional
from collections import defaultdict

try:
    from positions_at_risk_config import (
        HYPERLIQUID_API_URL,
        MONITORED_ASSETS,
        MIN_OPEN_INTEREST_USD,
        OPEN_INTEREST_CHANGE_THRESHOLD,
        LIQUIDATION_BUFFER_PERCENT,
        POLL_INTERVAL_SECONDS,
        REQUEST_TIMEOUT_SECONDS,
        RETRY_DELAY_SECONDS,
        DISPLAY_WIDTH,
    )
except ImportError:
    HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz"
    MONITORED_ASSETS = ["BTC", "ETH", "SOL"]
    MIN_OPEN_INTEREST_USD = 500000
    OPEN_INTEREST_CHANGE_THRESHOLD = 0.20
    LIQUIDATION_BUFFER_PERCENT = 8.0
    POLL_INTERVAL_SECONDS = 15
    REQUEST_TIMEOUT_SECONDS = 15
    RETRY_DELAY_SECONDS = 5
    DISPLAY_WIDTH = 100


class SimpleRiskMonitor:
    def __init__(self):
        self.base_url = HYPERLIQUID_API_URL
        self.session: Optional[aiohttp.ClientSession] = None
        self.asset_map: Dict[str, int] = {}
        self.id_to_name: Dict[int, str] = {}
        self.last_oi_data: Dict[str, float] = {}
        
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
        else:
            print(f"❌ Error loading market meta: {result.get('error')}")
            self.asset_map = {"BTC": 0, "ETH": 1, "SOL": 2}
            self.id_to_name = {0: "BTC", 1: "ETH", 2: "SOL"}
    
    async def get_market_data(self):
        """Get simplified market data."""
        payload = {"type": "metaAndAssetCtxs"}
        result = await self._make_request("/info", payload)
        
        if not result["success"]:
            return {}
        
        try:
            _, asset_contexts = result["data"]
            market_data = {}
            
            for asset_id, context in enumerate(asset_contexts):
                if asset_id < len(self.id_to_name):
                    asset_name = self.id_to_name[asset_id]
                    if asset_name in MONITORED_ASSETS:
                        market_data[asset_name] = {
                            "markPrice": float(context.get("markPx", 0)),
                            "openInterest": float(context.get("openInterest", 0)),
                            "fundingRate": float(context.get("funding", 0)),
                            "premium": float(context.get("premium", 0))
                        }
            
            return market_data
        except Exception as e:
            print(f"Error parsing market data: {e}")
            return {}
    
    def print_header(self):
        sep = "=" * DISPLAY_WIDTH
        print(f"\n{sep}")
        print("⚡ SIMPLE POSITIONS AT RISK MONITOR")
        print(f"{sep}")
        print(f"📊 Monitoring: {', '.join(MONITORED_ASSETS)}")
        print(f"💰 Min OI: ${MIN_OPEN_INTEREST_USD:,.0f}")
        print(f"🕐 Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{sep}")
    
    def display_risk_alert(self, asset: str, alert_type: str, details: Dict):
        sep = "=" * DISPLAY_WIDTH
        
        if alert_type == "OI_SURGE":
            print(f"\n{sep}")
            print(f"📈 OI SURGE DETECTED - {asset}")
            print(f"{sep}")
            print(f"Previous OI: ${details['previous_oi']:,.0f}")
            print(f"Current OI:  ${details['current_oi']:,.0f}")
            print(f"Change:      {details['change_pct']:+.1%}")
            print(f"Current Px:  ${details['price']:,.2f}")
            print(f"{sep}")
        
        elif alert_type == "FUNDING_STRESS":
            print(f"\n{sep}")
            print(f"💰 FUNDING STRESS - {asset}")
            print(f"{sep}")
            print(f"Funding Rate: {details['funding_rate']:+.4%}")
            print(f"Premium:      {details['premium']:+.3%}")
            print(f"Price:        ${details['price']:,.2f}")
            print(f"{sep}")
        
        elif alert_type == "HIGH_LEVERAGE_RISK":
            print(f"\n{sep}")
            print(f"🚨 HIGH LEVERAGE RISK - {asset}")
            print(f"{sep}")
            print(f"Max Leverage: {details['max_leverage']}x")
            print(f"Price:        ${details['price']:,.2f}")
            print(f"Open Interest: ${details['oi_usd']:,.0f}")
            print(f"Risk Level:   {'CRITICAL' if details['max_leverage'] >= 25 else 'HIGH'}")
            print(f"{sep}")
    
    async def check_simple_risks(self, asset: str, market_data: Dict):
        """Simple risk checking."""
        if asset not in market_data:
            return
        
        data = market_data[asset]
        price = data["markPrice"]
        oi = data["openInterest"]
        funding = data["fundingRate"]
        premium = data["premium"]
        
        if price <= 0 or oi <= 0:
            return
        
        oi_usd = oi * price
        
        # Skip small positions
        if oi_usd < MIN_OPEN_INTEREST_USD:
            return
        
        # Check for OI surges
        if asset in self.last_oi_data:
            previous_oi = self.last_oi_data[asset]
            if previous_oi > 0:
                change_pct = (oi_usd - previous_oi) / previous_oi
                if abs(change_pct) >= OPEN_INTEREST_CHANGE_THRESHOLD:
                    self.display_risk_alert(asset, "OI_SURGE", {
                        "previous_oi": previous_oi,
                        "current_oi": oi_usd,
                        "change_pct": change_pct,
                        "price": price
                    })
        
        self.last_oi_data[asset] = oi_usd
        
        # Check funding stress
        if abs(funding) > 0.0005:  # 0.05%
            self.display_risk_alert(asset, "FUNDING_STRESS", {
                "funding_rate": funding,
                "premium": premium,
                "price": price
            })
        
        # Check leverage risk (simplified)
        # This would need proper margin data in a full implementation
        if oi_usd > MIN_OPEN_INTEREST_USD * 10:  # Very large positions
            # Estimate high leverage based on funding pressure and premium
            leverage_risk = abs(funding) > 0.001 or abs(premium) > 0.005
            
            if leverage_risk:
                estimated_leverage = 20 if abs(funding) > 0.0005 else 15
                self.display_risk_alert(asset, "HIGH_LEVERAGE_RISK", {
                    "max_leverage": estimated_leverage,
                    "price": price,
                    "oi_usd": oi_usd
                })
    
    async def run(self):
        """Run simple risk monitor."""
        try:
            await self.load_market_meta()
            self.print_header()
            
            print("🔍 Starting simple risk monitoring...")
            print(f"📊 Checking every {POLL_INTERVAL_SECONDS} seconds\n")
            
            while True:
                try:
                    market_data = await self.get_market_data()
                    
                    if market_data:
                        for asset in MONITORED_ASSETS:
                            await self.check_simple_risks(asset, market_data)
                    
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)
                    
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    print(f"⚠️ Error: {e}")
                    await asyncio.sleep(RETRY_DELAY_SECONDS)
                    
        except KeyboardInterrupt:
            sep = "=" * DISPLAY_WIDTH
            print(f"\n\n{sep}")
            print("🛑 Stopping risk monitor...")
            print(f"{sep}")
        finally:
            await self.close()


async def main():
    monitor = SimpleRiskMonitor()
    await monitor.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass