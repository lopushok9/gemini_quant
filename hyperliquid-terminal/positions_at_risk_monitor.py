#!/usr/bin/env python3

import asyncio
import aiohttp
import json
import ssl
import certifi
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
from collections import defaultdict, deque
import math

try:
    from positions_at_risk_config import (
        HYPERLIQUID_API_URL,
        MONITORED_ASSETS,
        MIN_OPEN_INTEREST_USD,
        OPEN_INTEREST_CHANGE_THRESHOLD,
        LARGE_POSITION_THRESHOLD,
        MARGIN_RISK_THRESHOLD,
        LIQUIDATION_BUFFER_PERCENT,
        POLL_INTERVAL_SECONDS,
        REQUEST_TIMEOUT_SECONDS,
        RETRY_DELAY_SECONDS,
        DISPLAY_WIDTH,
        ENABLE_DETAILED_ANALYSIS,
        ENABLE_ALERTS,
        PRICE_IMPACT_THRESHOLD,
        ALERT_CONSECUTIVE_COUNT,
    )
except ImportError:
    HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz"
    MONITORED_ASSETS = ["BTC", "ETH", "SOL"]
    MIN_OPEN_INTEREST_USD = 1000000
    OPEN_INTEREST_CHANGE_THRESHOLD = 0.15
    LARGE_POSITION_THRESHOLD = 0.05
    MARGIN_RISK_THRESHOLD = 1.5
    LIQUIDATION_BUFFER_PERCENT = 5.0
    POLL_INTERVAL_SECONDS = 10
    REQUEST_TIMEOUT_SECONDS = 15
    RETRY_DELAY_SECONDS = 5
    DISPLAY_WIDTH = 120
    ENABLE_DETAILED_ANALYSIS = True
    ENABLE_ALERTS = True
    PRICE_IMPACT_THRESHOLD = 0.001
    ALERT_CONSECUTIVE_COUNT = 2


class PositionRiskCalculator:
    """Calculates liquidation levels and risk metrics for positions."""
    
    @staticmethod
    def calculate_liquidation_price(
        entry_price: float,
        leverage: float,
        position_size: float,
        side: str,  # "LONG" or "SHORT"
        maintenance_margin_rate: float = 0.004  # 0.4% default
    ) -> float:
        """
        Calculate liquidation price for a position.
        
        For perpetual swaps, liquidation occurs when:
        - LONG: (Entry Price / (1 - Maintenance Margin * Leverage)) * (1 - Maintenance Margin)
        - SHORT: (Entry Price / (1 + Maintenance Margin * Leverage)) * (1 + Maintenance Margin)
        """
        if leverage <= 0 or position_size <= 0 or entry_price <= 0:
            return 0.0
        
        if side.upper() == "LONG":
            # Liquidation price for long position
            liquidation_price = entry_price * (1 - maintenance_margin_rate * leverage) / (1 - maintenance_margin_rate)
        else:
            # Liquidation price for short position
            liquidation_price = entry_price * (1 + maintenance_margin_rate * leverage) / (1 + maintenance_margin_rate)
        
        return liquidation_price
    
    @staticmethod
    def calculate_distance_to_liquidation(
        current_price: float,
        liquidation_price: float,
        side: str
    ) -> float:
        """Calculate percentage distance to liquidation."""
        if current_price <= 0 or liquidation_price <= 0:
            return float('inf')
        
        if side.upper() == "LONG":
            return ((current_price - liquidation_price) / liquidation_price) * 100
        else:
            return ((liquidation_price - current_price) / current_price) * 100
    
    @staticmethod
    def estimate_max_leverage(margin_tiers: List[Dict], position_value_usd: float) -> float:
        """Estimate maximum leverage based on margin tiers and position size."""
        if not margin_tiers:
            return 10.0  # Default leverage
        
        # Find applicable tier
        applicable_tier = margin_tiers[0]  # Default to first tier
        for tier in margin_tiers:
            lower_bound = float(tier.get("lowerBound", "0"))
            if position_value_usd >= lower_bound:
                applicable_tier = tier
            else:
                break
        
        return float(applicable_tier.get("maxLeverage", 10.0))


class PositionsAtRiskMonitor:
    def __init__(self):
        self.base_url = HYPERLIQUID_API_URL
        self.session: Optional[aiohttp.ClientSession] = None
        self.asset_map: Dict[str, int] = {}
        self.id_to_name: Dict[int, str] = {}
        self.margin_data: Dict[int, Dict] = {}
        self.risk_calculator = PositionRiskCalculator()
        
        # Data storage
        self.market_data: Dict[str, Dict] = {}
        self.open_interest_history: Dict[str, deque] = defaultdict(lambda: deque(maxlen=10))
        self.consecutive_alerts: Dict[str, int] = defaultdict(int)
        
        # Risk alerts
        self.risk_alerts: List[Dict] = []
        
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
    
    async def load_market_metadata(self):
        """Load market metadata including margin requirements."""
        print("🔄 Loading market metadata and margin data...")
        
        # Load basic meta
        meta_result = await self._make_request("/info", {"type": "meta"})
        if meta_result["success"]:
            universe_data = meta_result["data"]
            for asset_id, asset_info in enumerate(universe_data.get("universe", [])):
                name = asset_info["name"]
                self.asset_map[name] = asset_id
                self.id_to_name[asset_id] = name
                
                # Store margin data
                margin_table_id = asset_info.get("marginTableId")
                max_leverage = asset_info.get("maxLeverage", 10)
                self.margin_data[asset_id] = {
                    "marginTableId": margin_table_id,
                    "maxLeverage": max_leverage
                }
        
        print(f"✅ Loaded {len(self.asset_map)} assets")
        
        # Load detailed margin information
        await self._load_margin_details()
    
    async def _load_margin_details(self):
        """Load detailed margin requirements for each asset."""
        for asset_id in self.asset_map.values():
            asset_name = self.id_to_name[asset_id]
            try:
                # Get margin details from meta response (already loaded)
                # In a real implementation, we might need additional API calls
                margin_info = self.margin_data[asset_id]
                
                # Estimate margin tiers based on max leverage
                if margin_info["maxLeverage"] >= 40:
                    margin_info["marginTiers"] = [
                        {"lowerBound": "0.0", "maxLeverage": 40},
                        {"lowerBound": "50000000.0", "maxLeverage": 20}
                    ]
                elif margin_info["maxLeverage"] >= 25:
                    margin_info["marginTiers"] = [
                        {"lowerBound": "0.0", "maxLeverage": 25},
                        {"lowerBound": "100000000.0", "maxLeverage": 15}
                    ]
                elif margin_info["maxLeverage"] >= 20:
                    margin_info["marginTiers"] = [
                        {"lowerBound": "0.0", "maxLeverage": 20},
                        {"lowerBound": "40000000.0", "maxLeverage": 10}
                    ]
                else:
                    margin_info["marginTiers"] = [
                        {"lowerBound": "0.0", "maxLeverage": margin_info["maxLeverage"]}
                    ]
                
            except Exception as e:
                print(f"⚠️ Error loading margin details for {asset_name}: {e}")
    
    async def get_market_data(self):
        """Fetch current market data for all monitored assets."""
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
                            "midPrice": float(context.get("midPx", 0)),
                            "openInterest": float(context.get("openInterest", 0)),
                            "fundingRate": float(context.get("funding", 0)),
                            "volume24h": float(context.get("dayNtlVlm", 0)),
                            "premium": float(context.get("premium", 0))
                        }
            
            return market_data
        except Exception as e:
            print(f"Error parsing market data: {e}")
            return {}
    
    async def analyze_risk_factors(self, asset: str, market_data: Dict) -> List[Dict]:
        """Analyze risk factors for a specific asset."""
        risk_factors = []
        
        if asset not in market_data:
            return risk_factors
        
        asset_id = self.asset_map.get(asset)
        if asset_id is None:
            return risk_factors
        
        data = market_data[asset]
        current_price = data["markPrice"]
        open_interest = data["openInterest"]
        
        # Skip if data is invalid
        if current_price <= 0 or open_interest <= 0:
            return risk_factors
        
        # Convert OI to USD value
        oi_usd = open_interest * current_price
        
        # Skip if OI is too small
        if oi_usd < MIN_OPEN_INTEREST_USD:
            return risk_factors
        
        # Check for large OI changes
        self.open_interest_history[asset].append(oi_usd)
        if len(self.open_interest_history[asset]) >= 3:
            current_oi = self.open_interest_history[asset][-1]
            previous_oi = self.open_interest_history[asset][-2]
            
            if previous_oi > 0:
                oi_change_pct = abs(current_oi - previous_oi) / previous_oi
                if oi_change_pct >= OPEN_INTEREST_CHANGE_THRESHOLD:
                    risk_factors.append({
                        "type": "OI_CHANGE",
                        "asset": asset,
                        "severity": "HIGH" if oi_change_pct > 0.25 else "MEDIUM",
                        "description": f"Open Interest changed by {oi_change_pct:.1%}",
                        "currentValue": current_oi,
                        "previousValue": previous_oi,
                        "changePercent": oi_change_pct
                    })
        
        # Analyze potential liquidation scenarios
        if asset in self.margin_data:
            margin_info = self.margin_data[asset]
            max_leverage = margin_info.get("maxLeverage", 10)
            
            # Check high leverage risk
            if max_leverage >= MARGIN_RISK_THRESHOLD * 10:  # Convert to multiplier
                # Estimate liquidation levels for large positions
                large_position_value = oi_usd * LARGE_POSITION_THRESHOLD
                
                if large_position_value >= 100000:  # $100k minimum
                    # Long liquidation price
                    long_liq_price = self.risk_calculator.calculate_liquidation_price(
                        current_price, max_leverage, large_position_value / current_price, "LONG"
                    )
                    
                    # Short liquidation price
                    short_liq_price = self.risk_calculator.calculate_liquidation_price(
                        current_price, max_leverage, large_position_value / current_price, "SHORT"
                    )
                    
                    # Calculate distances to liquidation
                    long_distance = self.risk_calculator.calculate_distance_to_liquidation(
                        current_price, long_liq_price, "LONG"
                    )
                    short_distance = self.risk_calculator.calculate_distance_to_liquidation(
                        current_price, short_liq_price, "SHORT"
                    )
                    
                    # Alert if positions are close to liquidation
                    if long_distance <= LIQUIDATION_BUFFER_PERCENT:
                        risk_factors.append({
                            "type": "LIQUIDATION_RISK",
                            "asset": asset,
                            "side": "LONG",
                            "severity": "CRITICAL" if long_distance <= 2.0 else "HIGH",
                            "description": f"Large LONG positions at risk (within {long_distance:.1f}% of liquidation)",
                            "liquidationPrice": long_liq_price,
                            "currentPrice": current_price,
                            "distancePercent": long_distance,
                            "estimatedSize": large_position_value,
                            "maxLeverage": max_leverage
                        })
                    
                    if short_distance <= LIQUIDATION_BUFFER_PERCENT:
                        risk_factors.append({
                            "type": "LIQUIDATION_RISK",
                            "asset": asset,
                            "side": "SHORT",
                            "severity": "CRITICAL" if short_distance <= 2.0 else "HIGH",
                            "description": f"Large SHORT positions at risk (within {short_distance:.1f}% of liquidation)",
                            "liquidationPrice": short_liq_price,
                            "currentPrice": current_price,
                            "distancePercent": short_distance,
                            "estimatedSize": large_position_value,
                            "maxLeverage": max_leverage
                        })
        
        # Analyze funding rate pressure
        if abs(data["fundingRate"]) > 0.0001:  # 0.01%
            funding_severity = "HIGH" if abs(data["fundingRate"]) > 0.001 else "MEDIUM"
            risk_factors.append({
                "type": "FUNDING_PRESSURE",
                "asset": asset,
                "severity": funding_severity,
                "description": f"High funding rate: {data['fundingRate']:.4%}",
                "fundingRate": data["fundingRate"],
                "direction": "POSITIVE" if data["fundingRate"] > 0 else "NEGATIVE"
            })
        
        return risk_factors
    
    def display_risk_alert(self, risk_factor: Dict):
        """Display a risk alert."""
        severity_emoji = {
            "CRITICAL": "🚨",
            "HIGH": "⚠️", 
            "MEDIUM": "⚡",
            "LOW": "📊"
        }
        
        emoji = severity_emoji.get(risk_factor["severity"], "📊")
        sep = "=" * DISPLAY_WIDTH
        
        print(f"\n{sep}")
        print(f"{emoji} RISK ALERT - {risk_factor['asset']} {emoji}")
        print(f"{sep}")
        print(f"Type: {risk_factor['type']}")
        print(f"Severity: {risk_factor['severity']}")
        print(f"Description: {risk_factor['description']}")
        
        if risk_factor["type"] == "LIQUIDATION_RISK":
            print(f"\n📈 Market Data:")
            print(f"   Current Price: ${risk_factor['currentPrice']:,.2f}")
            print(f"   Liquidation Price: ${risk_factor['liquidationPrice']:,.2f}")
            print(f"   Distance: {risk_factor['distancePercent']:.2f}%")
            print(f"   Estimated Size: ${risk_factor['estimatedSize']:,.0f}")
            print(f"   Side: {risk_factor['side']}")
            print(f"   Max Leverage: {risk_factor['maxLeverage']}x")
        
        elif risk_factor["type"] == "OI_CHANGE":
            print(f"\n📊 Open Interest Data:")
            print(f"   Current: ${risk_factor['currentValue']:,.0f}")
            print(f"   Previous: ${risk_factor['previousValue']:,.0f}")
            print(f"   Change: {risk_factor['changePercent']:.1%}")
        
        elif risk_factor["type"] == "FUNDING_PRESSURE":
            print(f"\n💰 Funding Data:")
            print(f"   Rate: {risk_factor['fundingRate']:.4%}")
            print(f"   Direction: {risk_factor['direction']}")
        
        print(f"{sep}")
    
    def print_header(self):
        """Print monitoring header."""
        sep = "=" * DISPLAY_WIDTH
        print(f"\n{sep}")
        print("🎯 HYPERLIQUID POSITIONS AT RISK MONITOR")
        print(f"{sep}")
        print(f"📊 Monitoring: {', '.join(MONITORED_ASSETS)}")
        print(f"💰 Min OI Threshold: ${MIN_OPEN_INTEREST_USD:,.0f}")
        print(f"⚡ OI Change Alert: {OPEN_INTEREST_CHANGE_THRESHOLD:.1%}")
        print(f"🚨 Liquidation Buffer: {LIQUIDATION_BUFFER_PERCENT:.1f}%")
        print(f"🕐 Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{sep}")
        print("👁️  Watching for risk factors...\n")
    
    async def monitor_risk_factors(self):
        """Main monitoring loop."""
        self.print_header()
        
        while True:
            try:
                # Get current market data
                market_data = await self.get_market_data()
                
                if market_data:
                    print(f"🔍 Scanning {len(MONITORED_ASSETS)} assets...")
                    
                    # Analyze each asset
                    for asset in MONITORED_ASSETS:
                        risk_factors = await self.analyze_risk_factors(asset, market_data)
                        
                        for risk_factor in risk_factors:
                            alert_key = f"{asset}_{risk_factor['type']}"
                            
                            if risk_factor["severity"] in ["CRITICAL", "HIGH"]:
                                self.consecutive_alerts[alert_key] += 1
                                
                                # Only alert if we have consecutive triggers
                                if self.consecutive_alerts[alert_key] >= ALERT_CONSECUTIVE_COUNT:
                                    if ENABLE_ALERTS:
                                        self.display_risk_alert(risk_factor)
                                    
                                    # Reset counter after alerting
                                    self.consecutive_alerts[alert_key] = 0
                            else:
                                # Reset counter for lower severity alerts
                                self.consecutive_alerts[alert_key] = 0
                
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                
            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"⚠️ Error in monitoring loop: {e}")
                await asyncio.sleep(RETRY_DELAY_SECONDS)
    
    async def run(self):
        """Start the risk monitoring system."""
        try:
            await self.load_market_metadata()
            print()
            await self.monitor_risk_factors()
        except KeyboardInterrupt:
            sep = "=" * DISPLAY_WIDTH
            print(f"\n\n{sep}")
            print("🛑 Shutting down risk monitor...")
            print(f"{sep}")
            self.print_summary()
        finally:
            await self.close()
    
    def print_summary(self):
        """Print monitoring summary."""
        print(f"\n📊 Risk monitoring session complete")
        print(f"Total risk factors detected: {len(self.risk_alerts)}")
        print("Thank you for using Hyperliquid Positions at Risk Monitor!")


async def main():
    """Main entry point."""
    monitor = PositionsAtRiskMonitor()
    await monitor.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass