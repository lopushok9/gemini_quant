from textual.app import App, ComposeResult
from textual.containers import Container
from textual.widgets import Header, Footer, Static, DataTable, Input, Label
from textual.screen import ModalScreen
from textual.reactive import reactive

from rich.text import Text
from datetime import datetime

from api_client import HyperliquidAPI
from config import DEFAULT_ASSET

class AssetSelectionScreen(ModalScreen[str]):
    """A modal screen to select an asset."""

    def compose(self) -> ComposeResult:
        yield Container(
            Label("Enter Asset Ticker (e.g. BTC, ETH):"),
            Input(placeholder="Ticker", id="asset_input"),
            id="asset_input_container"
        )

    def on_input_submitted(self, message: Input.Submitted) -> None:
        self.dismiss(message.value)


class TimeframeSelectionScreen(ModalScreen[str]):
    """A modal screen to select a timeframe."""

    def compose(self) -> ComposeResult:
        yield Container(
            Label("Enter Timeframe (15m, 1h, 4h, 1d):"),
            Input(placeholder="15m", id="timeframe_input"),
            id="timeframe_input_container"
        )

    def on_input_submitted(self, message: Input.Submitted) -> None:
        self.dismiss(message.value)


class OrderBookWidget(Container):
    """A widget to display the order book."""
    
    def compose(self) -> ComposeResult:
        yield Static("Order Book", classes="widget-header")
        yield DataTable(id="order_book_table")

    def on_mount(self) -> None:
        table = self.query_one(DataTable)
        table.add_columns("Price", "Size", "Total")
        table.cursor_type = "row"
        table.zebra_stripes = True


class RecentTradesWidget(Container):
    """A widget to display recent trades."""

    def compose(self) -> ComposeResult:
        yield Static("Recent Trades", classes="widget-header")
        yield DataTable(id="trades_table")

    def on_mount(self) -> None:
        table = self.query_one(DataTable)
        table.add_columns("Price", "Size", "Time")
        table.cursor_type = "row"
        table.zebra_stripes = True





class CandlestickChart(Static):
    """A widget to display a candlestick chart using plotext."""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.candle_data = []
        self.symbol = "BTC"
        self.interval = "15m"

    def update_plot(self, candle_data):
        import plotext as plt
        
        self.candle_data = candle_data
        
        if not self.candle_data or not isinstance(self.candle_data, list):
            self.update(Text("No data to display"))
            return

        try:
            # Sort data by timestamp
            self.candle_data.sort(key=lambda x: x['t'])
            
            # Extract OHLC data
            timestamps = [c['t'] / 1000 for c in self.candle_data]
            opens = [float(c['o']) for c in self.candle_data]
            highs = [float(c['h']) for c in self.candle_data]
            lows = [float(c['l']) for c in self.candle_data]
            closes = [float(c['c']) for c in self.candle_data]
            
            # Get widget dimensions - INCREASED for better resolution
            if self.content_size and self.content_size.width > 0:
                width = self.content_size.width
                # Increase height significantly for better vertical resolution
                height = max(self.content_size.height, 25)
            else:
                width = max(self.size.width - 4, 80)
                # Minimum height increased to 25 for better candle detail
                height = max(self.size.height - 2, 25)
            
            # Clear and configure plotext
            plt.clf()
            plt.theme('dark')
            
            # Set plot size with enhanced resolution
            plt.plotsize(width, height)
            
            # Prepare candlestick data
            data = {
                'Open': opens,
                'High': highs,
                'Low': lows,
                'Close': closes
            }
            
            # Calculate price range for better y-axis scaling
            all_prices = opens + highs + lows + closes
            min_price = min(all_prices)
            max_price = max(all_prices)
            price_range = max_price - min_price
            
            # Add padding to y-axis (5% on each side for better visibility)
            padding = price_range * 0.05
            y_min = min_price - padding
            y_max = max_price + padding
            
            # Draw candlestick chart
            plt.candlestick(timestamps, data)
            
            # Configure y-axis with ROUND number price levels
            # Determine appropriate step size to show ~5 price levels
            if price_range > 5000:
                step = 1000  # For BTC: 91000, 92000, 93000, 94000, 95000
                decimals = 0
            elif price_range > 1000:
                step = 250   # 90000, 90250, 90500...
                decimals = 0
            elif price_range > 500:
                step = 100   # 1000, 1100, 1200...
                decimals = 0
            elif price_range > 100:
                step = 25    # 1000, 1025, 1050...
                decimals = 0
            elif price_range > 50:
                step = 10    # 100, 110, 120...
                decimals = 0
            elif price_range > 10:
                step = 2     # 10, 12, 14...
                decimals = 1
            elif price_range > 1:
                step = 0.5   # 5.0, 5.5, 6.0...
                decimals = 1
            elif price_range > 0.1:
                step = 0.1   # 1.0, 1.1, 1.2...
                decimals = 2
            else:
                step = 0.02  # 0.10, 0.12, 0.14...
                decimals = 3
            
            # Round min/max to step boundaries for perfect calibration
            import math
            rounded_min = math.floor(y_min / step) * step
            rounded_max = math.ceil(y_max / step) * step
            
            # Set ylim to ROUNDED values for perfect tick alignment
            plt.ylim(rounded_min, rounded_max)
            
            # Generate round number ticks
            y_values = []
            current = rounded_min
            while current <= rounded_max:
                y_values.append(current)
                current += step
            
            # Format labels with appropriate decimals
            if y_values:
                y_labels = [f"{y:.{decimals}f}" for y in y_values]
                plt.yticks(y_values, y_labels)
            
            # Add horizontal line at current price (last close)
            current_price = closes[-1]
            plt.hline(current_price, color="cyan")
            
            # Configure appearance - show current price in title
            plt.title(f"{self.symbol}/USD ({self.interval}) | Price: {current_price:,.2f}")
            
            # Set x-axis labels (time) - increased number for better granularity
            num_labels = min(7, len(timestamps))
            if len(timestamps) >= num_labels:
                step = len(timestamps) // (num_labels - 1) if num_labels > 1 else 1
                label_indices = [i * step for i in range(num_labels - 1)] + [len(timestamps) - 1]
                label_times = [timestamps[i] for i in label_indices]
                label_strings = [datetime.fromtimestamp(t).strftime('%H:%M') for t in label_times]
                plt.xticks(label_times, label_strings)
            
            # Build and render
            chart_str = plt.build()
            self.update(Text.from_ansi(chart_str))
            
        except Exception as e:
            self.update(Text(f"Chart error: {e}", style="red"))




class MarketInfoWidget(Static):
    """A widget to display market info (OI, Funding)."""
    
    open_interest = reactive("Loading...")
    funding_rate = reactive("Loading...")

    def render(self) -> str:
        return f"Open Interest: {self.open_interest}  |  Funding Rate: {self.funding_rate}"

class HyperliquidApp(App):
    """A Textual app to display Hyperliquid market data."""

    CSS_PATH = "styles.css"
    BINDINGS = [
        ("s", "switch_asset", "Switch Asset"),
        ("t", "switch_timeframe", "Timeframe"),
        ("q", "quit", "Quit"),
    ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.api_client = HyperliquidAPI()
        self.current_asset_ticker = DEFAULT_ASSET
        self.current_asset_id = None
        self.current_timeframe = "15m"

    def compose(self) -> ComposeResult:
        """Create child widgets for the app."""
        yield Header(show_clock=True)
        yield MarketInfoWidget(id="market_info")
        
        yield Container(
            OrderBookWidget(id="order_book_container"),
            RecentTradesWidget(id="recent_trades_container"),
            CandlestickChart(id="main_chart"),
            id="app-grid"
        )

        yield Footer()

    async def on_mount(self) -> None:
        """Called when the app is first mounted."""
        self.update_title()
        
        await self.api_client.load_market_meta()
        self.current_asset_id = self.api_client.get_asset_id(self.current_asset_ticker)
        if self.current_asset_id is None:
            self.notify(f"Error: Asset '{self.current_asset_ticker}' not found!", severity="error")
            return

        # Initial fetch
        await self.update_market_data()
        # Set interval for dynamic updates (0.5s for stability)
        self.set_interval(0.4, self.update_market_data)

    def update_title(self):
        self.title = f"Hyperliquid Terminal | Asset: {self.current_asset_ticker}"


    
    async def update_market_data(self) -> None:
        """Fetches data and updates the non-BTC widgets."""
        if self.current_asset_id is None:
            return

        # Fetch L2 Book - only clear and update if successful
        l2_book_data = await self.api_client.get_l2_book(self.current_asset_id)
        if l2_book_data["success"]:
            ob_table = self.query_one("#order_book_table", DataTable)
            ob_table.clear()  # Clear only on success
            asks = l2_book_data["data"]["asks"][:10]  # Best 10 asks
            bids = l2_book_data["data"]["bids"][:10]  # Best 10 bids
            
            # Calculate cumulative totals
            ask_cumulative = 0
            bid_cumulative = 0
            
            # Show asks in reverse order (highest to lowest, converging to spread)
            for ask in reversed(asks):
                price = float(ask['px'])
                size = float(ask['sz'])
                ask_cumulative += size
                ob_table.add_row(
                    f"[#ef5350]{price:,.2f}[/#ef5350]",
                    f"{size:.5f}",
                    f"{ask_cumulative:.5f}"
                )
            
            # Spread row
            if asks and bids:
                best_ask = float(asks[0]['px'])
                best_bid = float(bids[0]['px'])
                spread = best_ask - best_bid
                spread_pct = (spread / best_bid) * 100 if best_bid > 0 else 0
                ob_table.add_row(
                    f"[bold]Spread[/bold]",
                    f"[bold]{spread:.2f}[/bold]",
                    f"[bold]{spread_pct:.3f}%[/bold]"
                )
            
            # Show bids (highest to lowest)
            for bid in bids:
                price = float(bid['px'])
                size = float(bid['sz'])
                bid_cumulative += size
                ob_table.add_row(
                    f"[#26a69a]{price:,.2f}[/#26a69a]",
                    f"{size:.5f}",
                    f"{bid_cumulative:.5f}"
                )

        # Fetch Recent Trades - only clear and update if successful
        trades_data = await self.api_client.get_trades(self.current_asset_id)
        if trades_data["success"]:
            trades_table = self.query_one("#trades_table", DataTable)
            trades_table.clear()  # Clear only on success
            for trade in trades_data["data"][:25]:
                time_str = datetime.fromtimestamp(trade['time'] / 1000).strftime("%H:%M:%S")
                side_color = "#26a69a" if trade['side'] == 'B' else "#ef5350"
                price = float(trade['px'])
                size = float(trade['sz'])
                trades_table.add_row(
                    f"[{side_color}]{price:,.2f}[/{side_color}]",
                    f"{size:.5f}",
                    time_str
                )

        # Fetch Candle Data for selected asset - only update if successful
        candle_data = await self.api_client.get_candle_data(
            self.current_asset_id, 
            interval=self.current_timeframe, 
            limit=40
        )
        
        # Update Main Chart only if data was successfully fetched
        if candle_data["success"] and candle_data["data"]:
            chart = self.query_one("#main_chart", CandlestickChart)
            chart.symbol = self.current_asset_ticker
            chart.interval = self.current_timeframe
            chart.update_plot(candle_data["data"])
        
        # Fetch Market Info - only update on success
        market_info_widget = self.query_one(MarketInfoWidget)
        oi_data = await self.api_client.get_open_interest(self.current_asset_id)
        if oi_data.get("success"):
            market_info_widget.open_interest = f"{float(oi_data['data']['openInterest']):.2f}"
        
        funding_data = await self.api_client.get_funding_rate(self.current_asset_id)
        if funding_data.get("success") and funding_data.get("data"):
            fr = float(funding_data['data'].get('fundingRate', 0))
            market_info_widget.funding_rate = f"{fr:.6%}"

    def action_switch_asset(self) -> None:
        """Show the asset selection screen."""
        self.push_screen(AssetSelectionScreen(), self.on_asset_selected)

    def on_asset_selected(self, ticker: str) -> None:
        """Callback when an asset is selected."""
        if not ticker:
            return
            
        ticker = ticker.upper()
        asset_id = self.api_client.get_asset_id(ticker)
        
        if asset_id is not None:
            self.current_asset_ticker = ticker
            self.current_asset_id = asset_id
            self.update_title()
            self.run_worker(self.update_market_data, exclusive=True)
            self.notify(f"Switched to {ticker}")
        else:
            self.notify(f"Asset '{ticker}' not found!", severity="error")

    def action_switch_timeframe(self) -> None:
        """Show the timeframe selection screen."""
        self.push_screen(TimeframeSelectionScreen(), self.on_timeframe_selected)

    def on_timeframe_selected(self, timeframe: str) -> None:
        """Callback when a timeframe is selected."""
        if not timeframe:
            return
            
        valid_timeframes = ["1m", "5m", "15m", "1h", "4h", "12h", "1d"]
        if timeframe not in valid_timeframes:
             self.notify(f"Invalid timeframe: {timeframe}. Valid: {', '.join(valid_timeframes)}", severity="error")
             return

        self.current_timeframe = timeframe
        self.update_title()
        self.run_worker(self.update_market_data, exclusive=True)
        self.notify(f"Switched to {timeframe}")  

    async def action_quit(self) -> None:
        """An action to quit the app."""
        await self.api_client.close()
        self.exit()