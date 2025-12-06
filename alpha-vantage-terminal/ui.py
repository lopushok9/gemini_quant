from textual.app import App, ComposeResult
from textual.widgets import Header, Footer, Input, Static
from textual.containers import Container
import logging

logging.basicConfig(filename="app.log", filemode="w", level=logging.INFO)


class QuoteDisplay(Static):
    """A widget to display the quote data."""

    def update_quote(self, data):
        logging.info(f"Updating display with: {data}")
        if "Error" in data:
            self.update(f"Error: {data['Error']}")
            return

        if not data:
            self.update("No data received.")
            return

        quote_str = ""
        for key, value in data.items():
            # key is like "01. symbol", we want to display "symbol"
            parts = key.split(". ")
            if len(parts) > 1:
                display_key = parts[1]
            else:
                display_key = key
            quote_str += f"{display_key}: {value}\n"
        self.update(quote_str)


class StockApp(App):
    """A Textual app to display stock quotes."""

    CSS_PATH = "styles.css"

    BINDINGS = [("d", "toggle_dark", "Toggle dark mode")]

    def compose(self) -> ComposeResult:
        """Create child widgets for the app."""
        yield Header()
        yield Input(placeholder="Enter a stock symbol (e.g., AAPL)")
        yield Container(QuoteDisplay("Enter a symbol to see the quote."), id="quote_display")
        yield Footer()

    def on_input_submitted(self, message: Input.Submitted) -> None:
        """Handle the submission of the input."""
        from api_client import get_quote

        symbol = message.value
        logging.info(f"Fetching data for symbol: {symbol}")
        quote_data = get_quote(symbol)
        logging.info(f"Received data: {quote_data}")
        quote_display = self.query_one(QuoteDisplay)
        quote_display.update_quote(quote_data)
        logging.info("Display updated.")


    def action_toggle_dark(self) -> None:
        """An action to toggle dark mode."""
        self.dark = not self.dark

if __name__ == "__main__":
    app = StockApp()
    app.run()
