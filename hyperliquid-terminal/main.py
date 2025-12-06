# Main entry point for the Hyperliquid Terminal application
from ui import HyperliquidApp

def main():
    """Run the terminal application."""
    app = HyperliquidApp()
    app.run()

if __name__ == "__main__":
    main()
