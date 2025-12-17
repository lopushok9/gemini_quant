#!/usr/bin/env python3

import asyncio
import json
import ssl
import sys
import time
from collections import deque
from datetime import datetime
from typing import Any, Deque, Dict, Iterable, List, Optional

import aiohttp
import certifi

try:
    from positions_at_risk_config import HYPERLIQUID_WS_URL, MONITORED_ASSETS, RETRY_DELAY_SECONDS
except ImportError:
    HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws"
    MONITORED_ASSETS = ["BTC", "ETH", "SOL"]
    RETRY_DELAY_SECONDS = 5


MIN_TRADE_NOTIONAL_USD = 100_000


def _fmt_usd(value: float) -> str:
    if value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.2f}B"
    if value >= 1_000_000:
        return f"${value / 1_000_000:.2f}M"
    if value >= 1_000:
        return f"${value / 1_000:.2f}K"
    return f"${value:.2f}"


def _safe_float(v: Any) -> Optional[float]:
    try:
        return float(v)
    except Exception:
        return None


def _iter_trades_from_msg(obj: Any) -> Iterable[Dict[str, Any]]:
    if not isinstance(obj, dict):
        return []

    data = obj.get("data")
    if isinstance(data, list):
        return [t for t in data if isinstance(t, dict)]
    if isinstance(data, dict):
        if all(k in data for k in ("px", "sz", "time")):
            return [data]
        nested = data.get("data")
        if isinstance(nested, list):
            return [t for t in nested if isinstance(t, dict)]

    return []


class LargeTradesMonitor:
    def __init__(self, assets: List[str], min_notional_usd: float = MIN_TRADE_NOTIONAL_USD):
        self.ws_url = HYPERLIQUID_WS_URL
        self.assets = assets
        self.min_notional_usd = float(min_notional_usd)

        self.session: Optional[aiohttp.ClientSession] = None
        self.seen: Deque[str] = deque(maxlen=5000)
        self.last_print_ts = 0.0

    async def _ensure_session(self):
        if self.session is None or self.session.closed:
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            connector = aiohttp.TCPConnector(ssl=ssl_context, ttl_dns_cache=300, keepalive_timeout=30)
            timeout = aiohttp.ClientTimeout(total=None, connect=10)
            self.session = aiohttp.ClientSession(connector=connector, timeout=timeout)

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()
            await asyncio.sleep(0.25)

    async def _subscribe(self, ws: aiohttp.ClientWebSocketResponse):
        for coin in self.assets:
            await ws.send_json({"method": "subscribe", "subscription": {"type": "trades", "coin": coin}})

    def _trade_key(self, trade: Dict[str, Any]) -> str:
        coin = str(trade.get("coin", ""))
        side = str(trade.get("side", ""))
        px = str(trade.get("px", ""))
        sz = str(trade.get("sz", ""))
        t = str(trade.get("time", ""))
        tid = trade.get("tid") or trade.get("hash")
        return f"{coin}:{tid or ''}:{t}:{side}:{px}:{sz}"

    def _side_label(self, raw_side: Any) -> str:
        s = str(raw_side).upper()
        if s in {"B", "BUY", "LONG"}:
            return "LONG"
        return "SHORT"

    def _handle_trade(self, trade: Dict[str, Any]):
        key = self._trade_key(trade)
        if key in self.seen:
            return
        self.seen.append(key)

        px = _safe_float(trade.get("px"))
        sz = _safe_float(trade.get("sz"))
        ts_ms = trade.get("time")

        if px is None or sz is None:
            return

        notional = px * sz
        if notional < self.min_notional_usd:
            return

        coin = str(trade.get("coin", ""))
        side = self._side_label(trade.get("side"))

        try:
            ts = datetime.fromtimestamp(float(ts_ms) / 1000.0).strftime("%H:%M:%S.%f")[:-3]
        except Exception:
            ts = datetime.now().strftime("%H:%M:%S")

        print(
            f"{ts} | {coin:>6} | {side:5} | px={px:,.2f} | sz={sz:,.6f} | notional={_fmt_usd(notional)}"
        )

    async def run(self):
        print("HYPERLIQUID LARGE TRADES MONITOR")
        print(f"Tracking trades >= {_fmt_usd(self.min_notional_usd)} | Assets: {', '.join(self.assets)}")
        print("Press Ctrl+C to stop")
        print("=" * 80)

        while True:
            try:
                await self._ensure_session()

                async with self.session.ws_connect(self.ws_url, heartbeat=20) as ws:
                    await self._subscribe(ws)

                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            try:
                                obj = json.loads(msg.data)
                            except Exception:
                                continue

                            for trade in _iter_trades_from_msg(obj):
                                self._handle_trade(trade)

                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break

            except KeyboardInterrupt:
                break
            except Exception as e:
                now = time.time()
                if now - self.last_print_ts > 2:
                    self.last_print_ts = now
                    print(f"Connection error: {e}")
                await asyncio.sleep(RETRY_DELAY_SECONDS)

        await self.close()


async def main():
    selected_asset: Optional[str] = None

    if len(sys.argv) > 1:
        selected_asset = sys.argv[1].upper().strip()

    if selected_asset:
        assets = [selected_asset]
    else:
        assets = list(MONITORED_ASSETS)

    monitor = LargeTradesMonitor(assets=assets)
    await monitor.run()


if __name__ == "__main__":
    asyncio.run(main())
