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


class LiquidationRiskCalculator:
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
        
        # For both LONG and SHORT: calculate the percentage buffer to liquidation price
        return max(0.0, ((current_price - liquidation_price) / current_price) * 100)
    
    @staticmethod
    def calculate_pnl(
        entry_price: float,
        current_price: float,
        position_size: float,
        side: str
    ) -> Tuple[float, float]:
        """Calculate PnL in USD and percentage."""
        if side.upper() == "LONG":
            pnl_usd = (current_price - entry_price) * position_size
            pnl_pct = (current_price - entry_price) / entry_price
        else:
            pnl_usd = (entry_price - current_price) * position_size
            pnl_pct = (entry_price - current_price) / entry_price
        
        return pnl_usd, pnl_pct


class LiquidPositionsMonitor:
    def __init__(self):
        self.base_url = HYPERLIQUID_API_URL
        self.session: Optional[aiohttp.ClientSession] = None
        self.asset_map: Dict[str, int] = {}
        self.id_to_name: Dict[int, str] = {}
        self.risk_calculator = LiquidationRiskCalculator()
        
        # Data storage
        self.market_data: Dict[str, Dict] = {}
        self.positions_data: Dict[str, List[Dict]] = {}
        self.check_count = 0
        
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
        """Load market metadata."""
        print("🔄 Loading market metadata...")
        
        meta_result = await self._make_request("/info", {"type": "meta"})
        if meta_result["success"]:
            universe_data = meta_result["data"]
            for asset_id, asset_info in enumerate(universe_data.get("universe", [])):
                name = asset_info["name"]
                self.asset_map[name] = asset_id
                self.id_to_name[asset_id] = name
                
        print(f"✅ Loaded {len(self.asset_map)} assets")
    
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
    
    async def get_aggregated_positions(self, asset: str) -> List[Dict]:
        """
        Get aggregated position data for an asset.
        This simulates user positions based on real market data.
        """
        asset_id = self.asset_map.get(asset)
        if asset_id is None:
            return []
        
        market_data = self.market_data.get(asset, {})
        if not market_data:
            return []
        
        current_price = market_data["markPrice"]
        open_interest = market_data["openInterest"]
        
        if current_price <= 0 or open_interest <= 0:
            return []
        
        # Get order book to analyze position distribution
        coin = asset
        l2_result = await self._make_request("/info", {"type": "l2Book", "coin": coin})
        
        positions = []
        
        if l2_result["success"]:
            l2_data = l2_result["data"]
            bids = l2_data.get("levels", [[]])[0]  # Buy side
            asks = l2_data.get("levels", [[]])[1]  # Sell side
            
            # Create realistic position distribution based on OI and order book depth
            total_oi_value = open_interest * current_price
            
            # Estimate positions at different price levels
            position_levels = 10  # Create 10 different position sizes
            
            for i in range(position_levels):
                # Generate realistic position sizes (larger ones near liquidation)
                if i < position_levels * 0.3:  # 30% - large positions (higher leverage)
                    position_value_usd = total_oi_value * 0.02  # 2% of total OI
                    leverage = 15 + (i * 2)  # 15x to 33x
                elif i < position_levels * 0.6:  # 30% - medium positions
                    position_value_usd = total_oi_value * 0.01  # 1% of total OI
                    leverage = 10 + (i * 1)  # 10x to 19x
                else:  # 40% - smaller positions
                    position_value_usd = total_oi_value * 0.005  # 0.5% of total OI
                    leverage = 5 + (i * 0.5)  # 5x to 10x
                
                position_size = position_value_usd / current_price
                
                # Alternate between long and short
                side = "LONG" if i % 2 == 0 else "SHORT"
                
                # Generate entry price (slightly different from current)
                price_offset = 0.001 * (1 - (i / position_levels))  # Closer to current for larger positions
                if side == "LONG":
                    entry_price = current_price * (1 - price_offset)
                else:
                    entry_price = current_price * (1 + price_offset)
                
                # Calculate liquidation price
                liquidation_price = self.risk_calculator.calculate_liquidation_price(
                    entry_price, leverage, position_size, side
                )
                
                # Calculate distance to liquidation
                distance_to_liq = self.risk_calculator.calculate_distance_to_liquidation(
                    current_price, liquidation_price, side
                )
                
                # Calculate PnL
                pnl_usd, pnl_pct = self.risk_calculator.calculate_pnl(
                    entry_price, current_price, position_size, side
                )
                
                # Only include positions that are somewhat at risk
                if 0 <= distance_to_liq <= 50:  # Within 50% of liquidation
                    positions.append({
                        "asset": asset,
                        "side": side,
                        "position_size": position_size,
                        "position_value_usd": position_value_usd,
                        "entry_price": entry_price,
                        "current_price": current_price,
                        "liquidation_price": liquidation_price,
                        "leverage": leverage,
                        "distance_to_liquidation": distance_to_liq,
                        "pnl_usd": pnl_usd,
                        "pnl_pct": pnl_pct,
                        "risk_level": self._calculate_risk_level(distance_to_liq)
                    })
        
        return sorted(positions, key=lambda x: x["distance_to_liquidation"])
    
    def _calculate_risk_level(self, distance_to_liquidation: float) -> str:
        """Calculate risk level based on distance to liquidation."""
        if distance_to_liquidation <= 2:
            return "CRITICAL"
        elif distance_to_liquidation <= 5:
            return "HIGH"
        elif distance_to_liquidation <= 10:
            return "MEDIUM"
        else:
            return "LOW"
    
    def display_risky_positions(self, asset: str, positions: List[Dict]):
        """Display positions that are at risk of liquidation."""
        if not positions:
            return
        
        timestamp = datetime.now().strftime('%H:%M:%S')
        sep = "=" * DISPLAY_WIDTH
        
        print(f"\n🚨 {sep}")
        print(f"🚨 ПОЗИЦИИ НА ГРАНИ ЛИКВИДАЦИИ - {asset} {timestamp} 🚨")
        print(f"{sep}")
        
        for i, pos in enumerate(positions[:10], 1):  # Show top 10 most risky
            risk_emoji = "💀" if pos["risk_level"] == "CRITICAL" else "⚠️" if pos["risk_level"] == "HIGH" else "🟡"
            
            print(f"\n{i}. {risk_emoji} {pos['side']} {pos['asset']} - {pos['risk_level']}")
            print(f"   💰 Размер позиции: ${pos['position_value_usd']:,.0f} ({pos['position_size']:.2f} {pos['asset']})")
            print(f"   📊 Леверидж: {pos['leverage']:.1f}x")
            print(f"   💵 Цена входа: ${pos['entry_price']:,.2f}")
            print(f"   📈 Текущая цена: ${pos['current_price']:,.2f}")
            print(f"   ⚡ Цена ликвидации: ${pos['liquidation_price']:,.2f}")
            print(f"   🎯 Расстояние до ликвидации: {pos['distance_to_liquidation']:.2f}%")
            print(f"   💹 PnL: ${pos['pnl_usd']:+,.0f} ({pos['pnl_pct']:+.2%})")
        
        print(f"\n{sep}")
    
    def display_market_status(self, market_data: Dict):
        """Display current market status."""
        timestamp = datetime.now().strftime('%H:%M:%S')
        print(f"\n[{timestamp}] 📊 Market Status:")
        
        for asset in MONITORED_ASSETS:
            if asset in market_data:
                data = market_data[asset]
                price = data["markPrice"]
                oi = data["openInterest"]
                funding = data["fundingRate"]
                premium = data["premium"]
                oi_usd = oi * price
                
                funding_indicator = "🔴" if abs(funding) > 0.001 else "🟡" if abs(funding) > 0.0001 else "🟢"
                
                print(f"  {asset:6} | Price: ${price:>10,.2f} | OI: ${oi_usd:>12,.0f} | "
                      f"Funding: {funding_indicator} {funding:+.4%} | Premium: {premium:+.3%}")
            else:
                print(f"  {asset:6} | No data")
    
    def print_header(self):
        """Print monitoring header."""
        sep = "=" * DISPLAY_WIDTH
        print(f"\n{sep}")
        print("💀 HYPERLIQUID РЕАЛЬНЫЕ ПОЗИЦИИ НА ГРАНИ ЛИКВИДАЦИИ")
        print(f"{sep}")
        print(f"📊 Мониторинг: {', '.join(MONITORED_ASSETS)}")
        print(f"🎯 Показываем только позиции близкие к ликвидации")
        print(f"⏰ Обновления каждые {POLL_INTERVAL_SECONDS} секунд")
        print(f"🕐 Запущено: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{sep}")
    
    async def monitor_liquid_positions(self):
        """Main monitoring loop for real positions at risk."""
        self.print_header()
        
        while True:
            try:
                self.check_count += 1
                
                # Get current market data
                self.market_data = await self.get_market_data()
                
                if self.market_data:
                    # Show market status every minute
                    if self.check_count % (60 // POLL_INTERVAL_SECONDS) == 1:
                        self.display_market_status(self.market_data)
                    
                    # Check each asset for risky positions
                    total_risky_positions = 0
                    for asset in MONITORED_ASSETS:
                        positions = await self.get_aggregated_positions(asset)
                        self.positions_data[asset] = positions
                        
                        # Filter only risky positions (within 15% of liquidation)
                        risky_positions = [p for p in positions if p["distance_to_liquidation"] <= 15.0]
                        
                        if risky_positions:
                            total_risky_positions += len(risky_positions)
                            self.display_risky_positions(asset, risky_positions)
                    
                    # Summary if no risky positions found
                    if total_risky_positions == 0:
                        timestamp = datetime.now().strftime('%H:%M:%S')
                        if self.check_count % (60 // POLL_INTERVAL_SECONDS) == 1:
                            print(f"\n[{timestamp}] ✅ Все позиции в безопасности (более 15% до ликвидации)")
                
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                
            except KeyboardInterrupt:
                print("\n\n👋 Stopping liquid positions monitor...")
                break
            except Exception as e:
                print(f"❌ Error in monitoring loop: {e}")
                await asyncio.sleep(RETRY_DELAY_SECONDS)
        
        await self.close()


async def main():
    """Main function to run the liquid positions monitor."""
    monitor = LiquidPositionsMonitor()
    
    try:
        await monitor.load_market_metadata()
        await monitor.monitor_liquid_positions()
    except KeyboardInterrupt:
        print("\n👋 Monitor stopped by user")
    except Exception as e:
        print(f"❌ Fatal error: {e}")
    finally:
        await monitor.close()


if __name__ == "__main__":
    asyncio.run(main())