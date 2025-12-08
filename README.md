# Gemini Quant: Deep Market Analysis

**Gemini Quant** is a financial analysis tool designed to transform Gemini CLI into an institutional equity research analyst.

You can use it **100% free** with Gemini CLI! No API keys, no token payments, no subscriptions.

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

Once installed, you can use these commands directly in your terminal:

| Command | Description | Example |
|---------|-------------|---------|
| `/analyze [TICKER]` | **Long-term investment analysis**. Generates a full research report with BUY/SELL/HOLD rating, price targets, risk assessment. | `/analyze AAPL` |
| `/analyze-st [TICKER]` | **Short-term trading analysis**. Focuses on technical indicators, momentum, and near-term catalysts for swing trading. | `/analyze-st TSLA` |
| `/analyze-lev [TICKER]` | **Leveraged trading analysis**. Evaluates assets for short-term leveraged positions with specific entry/exit points. | `/analyze-lev BTC` |


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

---

## Hyperliquid Terminal (Bonus Feature)

Included in this suite is a high-performance **Terminal User Interface (TUI)** for direct trading on Hyperliquid. It provides a distraction-free, keyboard-driven environment for execution.

### Key Features

*   **Live Market Data**: Real-time candlestick charts (custom rendering), convergent order books, and colored trade feeds.
*   **Performance**: Optimized for speed (0.3s updates).
*   **Multi-Asset**: Instant switching between assets (`s` key).

### Installation & Run

```bash
cd hyperliquid-terminal
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

### Controls

*   `s` - Switch Asset
*   `t` - Change Timeframe
*   `q` - Quit

---
