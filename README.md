![Gemini Assistant Screenshot](assets/screenshot.png)
# Gemini Quant: Deep Market Analysis

**Gemini Quant** is a financial analysis tool designed to transform Gemini CLI into a research analyst.

You can use it free with Gemini CLI! No API keys, no token payments, no subscriptions.

---

## AI Investor: Deep Market Analysis

The core of this repository is the **AI Investor** engine—a research framework that directs Gemini to perform multi-layered market analysis. Unlike simple summarizers, this system executes a rigorous due diligence process.

### Installation

#### Step 1: Install Gemini CLI

First, you need to install the official Gemini CLI. Follow the instructions in the [official Gemini CLI repository](https://github.com/google-gemini/gemini-cli).



#### Step 2: Clone this Repository

```bash
git clone https://github.com/lopushok9/gemini_quant.git
cd gemini_quant
```

#### Step 3: Install the Extension in Gemini CLI

Navigate to the `ai-investor` folder and install it as a Gemini extension:

```bash
cd ai-investor
gemini extension install .
```

Verify the installation:
```bash
gemini extension list
```

You should see `ai-investor` in the list of installed extensions.

---

### Available Commands

Once installed, you can use these commands directly in your terminal, it may take a while to load up to 3 minutes (run commands from the ai-investor folder):

| Command | Description | Example |
|---------|-------------|---------|
| `gemini analyze [TICKER]` | **Long-term investment analysis**. Generates a full research report with BUY/SELL/HOLD rating, price targets, risk assessment. | `gemini analyze AAPL` |
| `gemini analyze-st [TICKER]` | **Short-term trading analysis**. Focuses on technical indicators, momentum, and near-term catalysts for swing trading. | `gemini analyze-st TSLA` |
| `gemini analyze-lev [TICKER]` | **Leveraged trading analysis**. Evaluates assets for short-term leveraged positions with specific entry/exit points. | `gemini analyze-lev BTC` |
| `gemini poly-s` | **Polymarket Scanner**. Scans the top Finance & Economy markets for high-potential trading opportunities. | `gemini poly-s` |
| `gemini poly [TOPIC]` | **Polymarket Analysis**. Deep dive into a specific prediction market to find +EV opportunities. | `gemini poly "Bitcoin price"` |



---

### Research Methodology

The agent follows a strict 3-pillar investigative strategy:

1.  **Financial Performance**
    *   Deep dive into revenue growth, margins, and key business KPIs.
    *   Analysis of earnings reports and analyst coverage.

2.  **Market Positioning**
    *   Peer comparison with valuation multiples (P/E, P/S).
    *   Sector performance and competitive analysis.

3.  **Advanced Intelligence**
    *   **Technical Context**: Support/resistance levels, volume patterns.
    *   **Options Flow**: Put/call ratios, implied volatility trends.
    *   **Insider Signals**: Tracking executive buying/selling and institutional ownership.

### Output Capabilities

*   **Institutional-Grade Reports**: Generates reports with specific "BUY/SELL/HOLD" ratings, price targets (with upside/downside %), and conviction levels.
*   **Risk Assessment**: Detailed breakdown of company, macro, and ESG risks, including specific position sizing recommendations.
*   **Catalyst Tracking**: Identifies near-term (earnings), medium-term (strategic), and event-driven (M&A) catalysts.

### Polymarket Intelligence
The agent now includes specialized tools for analyzing prediction markets:
*   **Market Scanner (`poly-s`)**: Identifies high-value opportunities by analyzing market discrepancies and "overextended" odds in Finance & Economy sectors.
*   **Deep Analysis (`poly`)**: Conducts a rigorous EV (Expected Value) analysis on specific markets, comparing implied probabilities with real-world data and sentiment.

---

## Hyperliquid Tools

Included in this suite are tools for monitoring and analyzing Hyperliquid markets.

### Hyperliquid Terminal (TUI)

A **Terminal User Interface (TUI)** for monitoring assets on Hyperliquid. It provides a distraction-free, keyboard-driven environment for execution.

#### Installation & Run

```bash
cd hyperliquid-terminal
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

#### Controls

*   `s` - Switch Asset
*   `t` - Change Timeframe
*   `q` - Quit

### Hyperliquid Laverege Health Positions Monitor (`liquid.py`)

This script provides a of Hyperliquid positions, focusing on large positions (≥ $100k) that are approaching liquidation.
#### Features

*   **Position**:Large and medium-sized positions with varying leverage and proximity to liquidation based on current market conditions.
*   **Market Summary**: Provides an overview of market risk, including total critical positions and value at risk.
*   **Configurable Assets**: Monitor key assets like BTC, ETH, SOL. 

#### Installation & Run

```bash
cd hyperliquid-terminal
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 liquid.py [ASSET]
```

**Example:**
To monitor simulated positions for BTC:
```bash
python3 liquid.py BTC
```
To monitor all configured assets:
```bash
python3 liquid.py
```

### Hyperliquid Large Trades Monitor (`large_trades.py`)

This script monitors Hyperliquid in real-time for executed large trades on specified assets. Using a WebSocket connection, it provides immediate alerts for trades exceeding a configurable notional value (default: $100,000 USD).

#### Features

*   **Real-time Monitoring**: Connects via WebSocket to receive live trade data.
*   **Configurable Threshold**: Easily set the minimum notional value for trades to be alerted.
*   **Asset Filtering**: Monitor all configured assets or focus on a specific one via command-line.
*   **Concise Output**: Displays essential trade details (time, asset, side, price, size, notional value).

#### Installation & Run

```bash
cd hyperliquid-terminal
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 large_trades.py [ASSET]
```

**Example:**
To monitor large trades for ETH:
```bash
python3 large_trades.py ETH
```
To monitor all configured assets:
```bash
python3 large_trades.py
```

---

## Polymarket Tools

Monitor large trades and orders on Polymarket prediction markets.

### Polymarket Large Trades Monitor

A TypeScript-based monitoring system that tracks large trades and orders (>$3,000) on Polymarket. It scans top volume markets and analyzes order books to identify significant trading activity.

#### Features

*   **Real-time Order Book Analysis**: Scans order books for large orders
*   **Volume Change Detection**: Monitors volume increases across markets
*   **Top Markets Tracking**: Focuses on highest volume prediction markets
*   **Configurable Threshold**: Set minimum order size (default: $3,000)
*   **Rich Console Output**: Detailed market and order information

#### Installation & Run

```bash
cd Poly
npm install
npm test        # Run a quick test
npm start       # Start continuous monitoring
# or
./run.sh        # Alternative runner script
./run.sh 5000   # Custom threshold: $5,000
```

**Example Output:**
```
🎯 LARGE ORDERS FOUND ON MARKET
Market:   US recession in 2025?
Volume:   $10,918,352.82

Large Orders (3):
🔴 SELL No
   Size:  300005.05 shares
   Price: $0.9980
   Value: $299,405.04
```

See [Poly/README.md](Poly/README.md) for detailed documentation.

