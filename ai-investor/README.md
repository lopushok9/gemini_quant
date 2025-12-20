# AI Investor - Gemini Agent Extensions

A collection of professional-grade trading and investment analysis frameworks designed for Gemini Agents. These instructions enable institutional-grade research for equities, crypto, and prediction markets.

## Key Frameworks
- **Long-Term Analysis (`analyze`)**: Institutional-grade equity research with fundamental, catalyst, and risk assessment.
- **Short-Term Analysis (`analyze-st`)**: Focuses on technical analysis, momentum, and immediate catalysts.
- **Polymarket Specialist (`poly`)**: Identifies +EV opportunities and market inefficiencies in prediction markets.
- **Leverage/Risk Strategy (`poly-s`)**: Advanced position sizing and risk management for high-stakes trades.

## Usage
These files are used by the Gemini Agent to structure its research and output.

To invoke a specific analysis framework, use the corresponding command in the chat:
- `/analyze [Ticker]` - For comprehensive long-term stock/crypto research.
- `/analyze-st [Ticker]` - For short-term technical setups.
- `/poly [Market Question]` - for Polymarket trade analysis.

## Development
The directory includes an MCP (Model Context Protocol) server configuration in `gemini-extension.json` to integrate these capabilities directly into the agent's workflow.
