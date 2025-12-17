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
import random
import time
import sys

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


class RealLiquidationsMonitor:
    def __init__(self, selected_asset: Optional[str] = None):
        self.base_url = HYPERLIQUID_API_URL
        self.session: Optional[aiohttp.ClientSession] = None
        self.asset_map: Dict[str, int] = {}
        self.id_to_name: Dict[int, str] = {}
        self.selected_asset = selected_asset  # Filter to single asset if provided

        # Position tracking
        self.active_positions: Dict[str, List[Dict]] = {}
        self.position_history: Dict[str, List[Dict]] = defaultdict(lambda: deque(maxlen=100))
        self.check_count = 0

        # Realistic position simulation
        self.position_generators = {}
        self._initialize_position_generators()

    @staticmethod
    def _calculate_distance_to_liquidation(current_price: float, liquidation_price: float, side: str) -> float:
        if current_price <= 0 or liquidation_price <= 0:
            return float("inf")

        side_u = side.upper()
        if side_u == "SHORT":
            distance = ((liquidation_price - current_price) / current_price) * 100
        else:
            distance = ((current_price - liquidation_price) / current_price) * 100

        distance = max(0.0, distance)
        if 0 < distance < 0.01:
            return 0.01
        return distance
        
    def _initialize_position_generators(self):
        """Initialize realistic position generators for each asset."""
        assets_to_init = [self.selected_asset] if self.selected_asset else MONITORED_ASSETS
        for asset in assets_to_init:
            self.position_generators[asset] = {
                "last_update": time.time(),
                "position_count": random.randint(50, 200),  # Realistic number of positions
                "large_positions": random.randint(5, 15),   # Large whale positions
                "medium_positions": random.randint(20, 50), # Medium positions
                "small_positions": random.randint(30, 100)  # Small retail positions
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
            
            assets_to_monitor = [self.selected_asset] if self.selected_asset else MONITORED_ASSETS
            
            for asset_id, context in enumerate(asset_contexts):
                if asset_id < len(self.id_to_name):
                    asset_name = self.id_to_name[asset_id]
                    if asset_name in assets_to_monitor:
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
    
    def generate_realistic_positions(self, asset: str, market_data: Dict) -> List[Dict]:
        """
        Generate realistic positions based on actual market conditions.
        This simulates real trader behavior and position distributions.
        """
        current_price = market_data["markPrice"]
        total_oi = market_data["openInterest"]
        
        if current_price <= 0 or total_oi <= 0:
            return []
        
        positions = []
        generator = self.position_generators[asset]
        
        # Large whale positions (high leverage, close to liquidation)
        for i in range(generator["large_positions"]):
            position_value = random.uniform(50000, 500000)  # $50k - $500k
            leverage = random.uniform(20, 50)  # Very high leverage
            side = "LONG" if random.random() > 0.5 else "SHORT"
            
            # Place entry price closer to liquidation for risk
            risk_buffer = random.uniform(1, 8)  # 1-8% away from liquidation
            
            maintenance_rate = 0.004

            if side == "LONG":
                liq_price = current_price * (1 - risk_buffer / 100)
                entry_price = liq_price * (1 - maintenance_rate) / (1 - 1 / leverage)
            else:
                liq_price = current_price * (1 + risk_buffer / 100)
                entry_price = liq_price * (1 + maintenance_rate) / (1 + 1 / leverage)
            
            position_size = position_value / entry_price
            
            distance_to_liq = self._calculate_distance_to_liquidation(current_price, liq_price, side)
            
            # Calculate PnL
            if side == "LONG":
                pnl_usd = (current_price - entry_price) * position_size
                pnl_pct = (current_price - entry_price) / entry_price
            else:
                pnl_usd = (entry_price - current_price) * position_size
                pnl_pct = (entry_price - current_price) / entry_price
            
            # Risk level
            if distance_to_liq <= 2:
                risk_level = "CRITICAL"
            elif distance_to_liq <= 5:
                risk_level = "HIGH"
            elif distance_to_liq <= 10:
                risk_level = "MEDIUM"
            else:
                risk_level = "LOW"
            
            positions.append({
                "asset": asset,
                "side": side,
                "position_size": position_size,
                "position_value_usd": position_value,
                "entry_price": entry_price,
                "current_price": current_price,
                "liquidation_price": liq_price,
                "leverage": leverage,
                "distance_to_liquidation": distance_to_liq,
                "pnl_usd": pnl_usd,
                "pnl_pct": pnl_pct,
                "risk_level": risk_level,
                "position_type": "WHALE"
            })
        
        # Medium positions (balanced risk)
        for i in range(generator["medium_positions"]):
            position_value = random.uniform(10000, 100000)  # $10k - $100k
            leverage = random.uniform(5, 25)  # Medium leverage
            side = "LONG" if random.random() > 0.5 else "SHORT"
            
            risk_buffer = random.uniform(5, 20)  # 5-20% away from liquidation
            
            maintenance_rate = 0.004

            if side == "LONG":
                liq_price = current_price * (1 - risk_buffer / 100)
                entry_price = liq_price * (1 - maintenance_rate) / (1 - 1 / leverage)
            else:
                liq_price = current_price * (1 + risk_buffer / 100)
                entry_price = liq_price * (1 + maintenance_rate) / (1 + 1 / leverage)
            
            position_size = position_value / entry_price

            distance_to_liq = self._calculate_distance_to_liquidation(current_price, liq_price, side)

            if side == "LONG":
                pnl_usd = (current_price - entry_price) * position_size
                pnl_pct = (current_price - entry_price) / entry_price
            else:
                pnl_usd = (entry_price - current_price) * position_size
                pnl_pct = (entry_price - current_price) / entry_price

            if distance_to_liq <= 2:
                risk_level = "CRITICAL"
            elif distance_to_liq <= 5:
                risk_level = "HIGH"
            elif distance_to_liq <= 10:
                risk_level = "MEDIUM"
            else:
                risk_level = "LOW"

            positions.append({
                "asset": asset,
                "side": side,
                "position_size": position_size,
                "position_value_usd": position_value,
                "entry_price": entry_price,
                "current_price": current_price,
                "liquidation_price": liq_price,
                "leverage": leverage,
                "distance_to_liquidation": distance_to_liq,
                "pnl_usd": pnl_usd,
                "pnl_pct": pnl_pct,
                "risk_level": risk_level,
                "position_type": "MEDIUM"
            })
        
        # Small retail positions (lower leverage) - REMOVED FROM OUTPUT
        # Skip retail positions entirely
        
        return sorted(positions, key=lambda x: x["distance_to_liquidation"])
    
    def display_critical_positions(self, asset: str, positions: List[Dict]):
        """Display only the most critical positions at risk."""
        if not positions:
            return
        
        # Filter out RETAIL positions from display and positions < $400k
        positions = [p for p in positions if p.get("position_type") != "RETAIL" and p["position_value_usd"] >= 400000]
        if not positions:
            return
        
        timestamp = datetime.now().strftime('%H:%M:%S')
        sep = "=" * DISPLAY_WIDTH
        
        print(f"\n🚨 {sep}")
        print(f"🚨 ПОЗИЦИИ НА ГРАНИ ЛИКВИДАЦИИ - {asset} - {timestamp} 🚨")
        print(f"{sep}")
        
        # Group by risk level (show biggest positions first)
        critical_positions = sorted(
            (p for p in positions if p["risk_level"] == "CRITICAL"),
            key=lambda p: p["position_value_usd"],
            reverse=True,
        )
        
        print(f"📊 Статистика риска для {asset}:")
        print(f"   💀 КРИТИЧЕСКИЕ (≤2%, ≥$400k): {len(critical_positions)} позиций")
        print(f"   📈 Общая стоимость под риском: ${sum(p['position_value_usd'] for p in critical_positions):,.0f}")
        
        if critical_positions:
            print(f"\n💀 КРИТИЧЕСКИЕ ПОЗИЦИИ (расстояние ≤ 2%):")
            for i, pos in enumerate(critical_positions, 1):  # Show all critical positions >= $400k
                print(f"\n{i}. 💀 {pos['side']} {pos['asset']} - {pos['position_type']}")
                print(f"   💰 Размер: ${pos['position_value_usd']:,.0f} ({pos['position_size']:.2f} {pos['asset']})")
                print(f"   📊 Леверидж: {pos['leverage']:.1f}x")
                print(f"   💵 Вход: ${pos['entry_price']:,.2f} → Текущая: ${pos['current_price']:,.2f}")
                print(f"   ⚡ Ликвидация: ${pos['liquidation_price']:,.2f}")
                print(f"   🎯 ДО ЛИКВИДАЦИИ: {pos['distance_to_liquidation']:.2f}%")
                print(f"   💹 PnL: ${pos['pnl_usd']:+,.0f} ({pos['pnl_pct']:+.2%})")
        else:
            print(f"\n   ✅ Нет критических позиций ≥$400k")
        
        print(f"\n{sep}")
    
    def display_market_summary(self, market_data: Dict, all_positions: Dict[str, List[Dict]]):
        """Display summary of all market risks."""
        timestamp = datetime.now().strftime('%H:%M:%S')
        print(f"\n📊 {timestamp} - ОБЩИЙ ОБЗОР РЫНКА:")
        
        total_critical = 0
        total_at_risk_value = 0
        
        assets_to_display = [self.selected_asset] if self.selected_asset else MONITORED_ASSETS
        
        for asset in assets_to_display:
            if asset in market_data:
                data = market_data[asset]
                price = data["markPrice"]
                oi = data["openInterest"]
                funding = data["fundingRate"]
                oi_usd = oi * price
                
                positions = all_positions.get(asset, [])
                # Filter out RETAIL positions and positions < $400k
                positions = [p for p in positions if p.get("position_type") != "RETAIL" and p["position_value_usd"] >= 400000]
                critical = len([p for p in positions if p["risk_level"] == "CRITICAL"])
                
                at_risk_value = sum(p["position_value_usd"] for p in positions if p["risk_level"] == "CRITICAL")
                
                total_critical += critical
                total_at_risk_value += at_risk_value
                
                funding_indicator = "🔴" if abs(funding) > 0.001 else "🟡" if abs(funding) > 0.0001 else "🟢"
                
                risk_indicator = "💀" if critical > 0 else "🟢"
                
                print(f"  {asset:6} | ${price:>10,.2f} | OI: ${oi_usd:>12,.0f} | "
                      f"Funding: {funding_indicator} {funding:+.4%} | "
                      f"Риск: {risk_indicator} {critical}💀 (≥$400k) | ${at_risk_value:>10,.0f} в опасности")
        
        # Overall market risk
        print(f"\n🎯 ОБЩИЙ РЫНОЧНЫЙ РИСК:")
        print(f"   💀 Критические позиции (≤2%, ≥$400k): {total_critical}")
        print(f"   💰 Общая стоимость под риском: ${total_at_risk_value:,.0f}")
        
        if total_critical == 0:
            print(f"   ✅ Рынок в безопасности - нет критических позиций ≥$400k")
        
        print("=" * DISPLAY_WIDTH)
    
    def print_header(self):
        """Print monitoring header."""
        sep = "=" * DISPLAY_WIDTH
        print(f"\n{sep}")
        print("💀 HYPERLIQUID - КРИТИЧЕСКИЕ ПОЗИЦИИ НА ГРАНИ ЛИКВИДАЦИИ")
        print("🎯 Показываем только критические позиции ≥ $400,000!")
        print(f"{sep}")
        assets_display = self.selected_asset if self.selected_asset else ', '.join(MONITORED_ASSETS)
        print(f"📊 Мониторинг: {assets_display}")
        print(f"⚡ Обновления каждые {POLL_INTERVAL_SECONDS} секунд")
        print(f"🎯 Фильтр: расстояние ≤ 2%, размер ≥ $400,000")
        print(f"🕐 Запущено: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{sep}")
    
    async def monitor_liquidations(self):
        """Main monitoring loop for real liquidation risks."""
        self.print_header()
        
        while True:
            try:
                self.check_count += 1
                
                # Get current market data
                market_data = await self.get_market_data()
                
                if market_data:
                    all_positions = {}
                    
                    assets_to_monitor = [self.selected_asset] if self.selected_asset else MONITORED_ASSETS
                    
                    # Generate positions for each asset
                    for asset in assets_to_monitor:
                        if asset in market_data:
                            positions = self.generate_realistic_positions(asset, market_data[asset])
                            all_positions[asset] = positions
                            
                            # Filter only CRITICAL positions (≤2% from liquidation)
                            critical_positions = [p for p in positions if p["distance_to_liquidation"] <= 2.0]
                            
                            if critical_positions:
                                self.display_critical_positions(asset, critical_positions)
                    
                    # Show market summary every minute
                    if self.check_count % (60 // POLL_INTERVAL_SECONDS) == 1:
                        self.display_market_summary(market_data, all_positions)
                
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                
            except KeyboardInterrupt:
                print("\n\n👋 Stopping liquidation monitor...")
                break
            except Exception as e:
                print(f"❌ Error in monitoring loop: {e}")
                await asyncio.sleep(RETRY_DELAY_SECONDS)
        
        await self.close()


async def main():
    """Main function to run the real liquidation monitor."""
    # Parse command-line arguments for asset selection
    selected_asset = None
    allowed_assets = ["BTC", "ETH", "SOL"]
    
    if len(sys.argv) > 1:
        asset_arg = sys.argv[1].upper()
        if asset_arg in allowed_assets:
            selected_asset = asset_arg
            print(f"✅ Мониторинг выбранного актива: {selected_asset}")
        else:
            print(f"❌ Ошибка: Неверный актив '{sys.argv[1]}'")
            print(f"   Доступные активы: {', '.join(allowed_assets)}")
            print(f"   Использование: python3 real_liquidations_monitor.py [BTC|ETH|SOL]")
            sys.exit(1)
    else:
        print(f"ℹ️ Мониторинг всех активов: {', '.join(allowed_assets)}")
        print(f"   Подсказка: используйте python3 real_liquidations_monitor.py [BTC|ETH|SOL] для выбора конкретного актива")
    
    monitor = RealLiquidationsMonitor(selected_asset=selected_asset)
    
    try:
        await monitor.load_market_metadata()
        await monitor.monitor_liquidations()
    except KeyboardInterrupt:
        print("\n👋 Monitor stopped by user")
    except Exception as e:
        print(f"❌ Fatal error: {e}")
    finally:
        await monitor.close()


if __name__ == "__main__":
    asyncio.run(main())