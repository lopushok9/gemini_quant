# Gemini Quant: Deep Market Analysis & Trading

**Gemini Quant** is a professional-grade financial analysis framework designed to transform AI agents into institutional equity research analysts. It combines deep market research capabilities with a high-performance terminal for execution.

![Analysis Preview](https://github.com/lopushok9/gemini_quant/raw/main/preview_analysis.png)

## 🧠 AI Investor: Deep Market Analysis

The core of this repository is the **AI Investor** engine—a sophisticated research framework (`GEMINI.md`) that directs AI agents to perform comprehensive, multi-layered market analysis. Unlike simple summarizers, this system executes a rigorous due diligence process.

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

### Capabilities
*   **Institutional-Grade Output**: Generates reports with specific "BUY/SELL/HOLD" ratings, price targets (with upside/downside %), and conviction levels.
*   **Risk Assessment**: Detailed breakdown of company, macro, and ESG risks, including specific position sizing recommendations.
*   **Catalyst Tracking**: Identifies near-term (earnings), medium-term (strategic), and event-driven (M&A) catalysts.

### How to Use
1.  Load the `ai-investor/GEMINI.md` system prompt into your AI assistant (e.g., Gemini Advanced, Claude).
2.  Use the command/prompt: `analyze [TICKER]` (e.g., `analyze AAPL`).
3.  The agent will execute parallel web searches to gather live data and synthesize a professional report.

---

## 🖥️ Hyperliquid Terminal (Bonus Feature)

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

## 📄 License
MIT
