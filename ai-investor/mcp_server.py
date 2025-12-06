import os
import sys
import json
import re
import requests
from typing import Dict, Any, List

from mcp.server import Server
from mcp.types import Tool, TextContent
import mcp.server.stdio

# Get the absolute path of the directory where the script is located
SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))

ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query"

# Создаем MCP сервер
app = Server("alpha-vantage-mcp")


def get_template_content(filename: str) -> str:
    """Reads the content of a template file."""
    try:
        with open(os.path.join(SCRIPT_DIR, filename), 'r') as f:
            return f.read()
    except FileNotFoundError:
        return f"Error: Template file {filename} not found."

def clean_template(template: str) -> str:
    """Cleans any unfilled placeholders from the template."""
    return re.sub(r'\[.*?\]', 'N/A', template)


@app.list_tools()
async def list_tools() -> list[Tool]:
    """Список доступных инструментов"""
    return [
        Tool(
            name="get_stock_data",
            description="Fetches Alpha Vantage stock data and formats it for long-term analysis.",
            inputSchema={"type": "object", "properties": {"ticker": {"type": "string"}}, "required": ["ticker"]}
        ),
        Tool(
            name="get_short_term_data",
            description="Fetches technical indicators (RSI, SMA) and formats them for short-term analysis.",
            inputSchema={"type": "object", "properties": {"ticker": {"type": "string"}}, "required": ["ticker"]}
        ),
        Tool(
            name="get_leverage_data",
            description="Fetches and formats data for short-term, high-risk leveraged trade analysis.",
            inputSchema={"type": "object", "properties": {"ticker": {"type": "string"}}, "required": ["ticker"]}
        ),
        Tool(
            name="interactive_analysis",
            description="Runs a step-by-step interactive analysis chat.",
            inputSchema={
                "type": "object",
                "properties": {
                    "ticker": {"type": "string"},
                    "step": {"type": "string", "description": "The starting step, e.g., 'start'"},
                    "user_response": {"type": "string", "description": "The user's reply from the previous step"}
                },
                "required": ["ticker"]
            }
        )
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Обработка вызовов инструментов"""
    api_key = os.environ.get("ALPHA_VANTAGE_API_KEY")
    if not api_key:
        return [TextContent(text=json.dumps({"text": "Error: ALPHA_VANTAGE_API_KEY environment variable is not set."}))]

    ticker = arguments.get("ticker")
    if not ticker:
        return [TextContent(text=json.dumps({"text": "Error: Ticker symbol was not provided."}))]

    report = f"Error generating report for tool: {name}"

    if name == "get_stock_data":
        result = await get_stock_data(ticker, api_key)
        report = result.get("formatted_report", "Error generating long-term analysis report.")
    elif name == "get_short_term_data":
        result = await get_short_term_data(ticker, api_key)
        report = result.get("formatted_report", "Error generating short-term analysis report.")
    elif name == "get_leverage_data":
        result = await get_leverage_data(ticker, api_key)
        report = result.get("formatted_report", "Error generating leveraged trade analysis report.")
    elif name == "interactive_analysis":
        report = await handle_interactive_analysis(ticker, api_key, arguments)
    else:
        raise ValueError(f"Unknown tool: {name}")
        
    return [TextContent(type="text", text=json.dumps({"text": report}))]


async def handle_interactive_analysis(ticker: str, api_key: str, args: dict) -> str:
    """Manages the state of the interactive chat."""
    # This function remains unchanged
    step = args.get("step")
    user_response = args.get("user_response", "").lower()

    if step == "start":
        return f"Interactive analysis for {ticker}. What would you like to see first? Options: 'overview', 'technicals', 'news'."

    next_prompt = "What's next? Options: 'overview', 'technicals', 'news', or 'exit'."

    if user_response == "overview":
        data = await get_stock_data_raw(ticker, api_key)
        if data.get("overview") and data['overview'].get('Description'):
            overview = data["overview"]
            name = overview.get('Name', 'N/A')
            desc = overview.get('Description')
            return f"**Overview for {name}**:\n{desc}\n\n{next_prompt}"
        return f"Could not retrieve overview or it was empty. {next_prompt}"

    elif user_response == "technicals":
        data = await get_short_term_data_raw(ticker, api_key)
        if data.get("status") == "success":
            rsi = data.get('RSI', {}).get('RSI', 'N/A')
            sma = data.get('SMA', {}).get('SMA', 'N/A')
            return f"**Technicals for {ticker}**:\n- RSI (14 day): {rsi}\n- SMA (50 day): {sma}\n\n{next_prompt}"
        return f"Could not retrieve technicals. {next_prompt}"

    elif user_response == "news":
        data = await get_stock_data_raw(ticker, api_key)
        if data.get("news", {}).get("feed"):
            articles = [f"- {item['title']}" for item in data["news"]["feed"][:3]]
            news_str = "\n".join(articles)
            return f"**Recent News for {ticker}**:\n{news_str}\n\n{next_prompt}"
        return f"Could not retrieve news. {next_prompt}"

    elif user_response == "exit":
        return "Analysis session ended. Goodbye!"

    else:
        return f"Invalid option. Please choose from: 'overview', 'technicals', 'news', or 'exit'."


async def get_stock_data(ticker: str, api_key: str) -> Dict[str, Any]:
    """Fetches and formats long-term analysis data."""
    raw_data = await get_stock_data_raw(ticker, api_key)
    if raw_data["status"] == "error":
        return {"formatted_report": f"Error fetching data for {ticker}: {raw_data['errors']}"}

    template = get_template_content('GEMINI.md')
    overview = raw_data.get("overview", {})
    news_feed = raw_data.get("news", {}).get("feed", [])

    template = template.replace('$ARGUMENTS', ticker.upper())
    template = template.replace('[BUY/SELL/HOLD]', 'HOLD').replace('[X]', 'N/A')
    template = template.replace('[Key catalyst and investment thesis in 1-2 sentences]', overview.get('Description', 'N/A'))
    
    financial_metrics = f"Market Cap: {overview.get('MarketCapitalization', 'N/A')}\nP/E Ratio: {overview.get('PERatio', 'N/A')}\nEPS: {overview.get('EPS', 'N/A')}"
    template = template.replace('[Specific revenue growth %, margins, key business KPIs with exact numbers and timeframes]', financial_metrics)
    
    news_str = "\n".join([f"- {item['title']}" for item in news_feed[:5]]) if news_feed else "No recent news."
    template = template.replace('[Specific upcoming events with dates - earnings, product launches, regulatory decisions]', news_str)
    
    return {"status": "success", "formatted_report": clean_template(template)}


async def get_short_term_data(ticker: str, api_key: str) -> Dict[str, Any]:
    """Fetches and formats short-term analysis data."""
    raw_data = await get_short_term_data_raw(ticker, api_key)
    if raw_data["status"] == "error":
        return {"formatted_report": f"Error fetching data for {ticker}: {raw_data['errors']}"}

    template = get_template_content('GEMINI-ST.md')
    
    template = template.replace('$ARGUMENTS', ticker.upper())
    template = template.replace('[RSI]', str(raw_data.get("RSI", {}).get("RSI", "N/A")))
    template = template.replace('[SMA]', str(raw_data.get("SMA", {}).get("SMA", "N/A")))
    
    return {"status": "success", "formatted_report": clean_template(template)}

async def get_leverage_data(ticker: str, api_key: str) -> Dict[str, Any]:
    """Fetches and formats leveraged trade analysis data."""
    raw_data = await get_leverage_data_raw(ticker, api_key)
    if raw_data["status"] == "error":
        return {"formatted_report": f"Error fetching data for {ticker}: {raw_data['errors']}"}

    template = get_template_content('GEMINI-LEV.md')
    
    intraday_data = raw_data.get("intraday", {})
    latest_price = intraday_data.get("close", "N/A")
    rsi_data = raw_data.get("RSI", {}).get("RSI", "N/A")
    news_feed = raw_data.get("news", {}).get("feed", [])

    template = template.replace('$ARGUMENTS', ticker.upper())
    template = template.replace('[Current Price]', str(latest_price))

    news_str = "\n".join([f"- {item['title']}" for item in news_feed[:3]]) if news_feed else "No breaking news."
    template = template.replace('[Any breaking news or significant changes in social media sentiment in the last hour.]', news_str)

    template = template.replace('[Current RSI value and whether it\'s overbought/oversold]', str(rsi_data))

    return {"status": "success", "formatted_report": clean_template(template)}


async def get_stock_data_raw(ticker: str, api_key: str) -> Dict[str, Any]:
    """Fetches raw Alpha Vantage stock data for long-term analysis."""
    results = {}
    errors = []
    try:
        r = requests.get(ALPHA_VANTAGE_BASE_URL, params={"function": "OVERVIEW", "symbol": ticker, "apikey": api_key})
        r.raise_for_status()
        data = r.json()
        if not data or "Error Message" in data: errors.append("Failed to load OVERVIEW")
        else: results["overview"] = data
    except Exception as e: errors.append(f"Overview error: {e}")
    try:
        r = requests.get(ALPHA_VANTAGE_BASE_URL, params={"function": "NEWS_SENTIMENT", "tickers": ticker, "limit": 5, "sort": "LATEST", "apikey": api_key})
        r.raise_for_status()
        data = r.json()
        if not data.get("feed"): errors.append("No news found")
        else: results["news"] = data
    except Exception as e: errors.append(f"News error: {e}")
    if errors: return {"status": "error", "errors": errors, "ticker": ticker}
    results["status"] = "success"; results["ticker"] = ticker
    return results


async def get_short_term_data_raw(ticker: str, api_key: str) -> Dict[str, Any]:
    """Fetches raw technical indicators for short-term analysis."""
    results = {}; errors = []
    try:
        r = requests.get(ALPHA_VANTAGE_BASE_URL, params={"function": "RSI", "symbol": ticker, "interval": "daily", "time_period": "14", "series_type": "close", "apikey": api_key})
        r.raise_for_status()
        data = r.json()
        if "Technical Analysis: RSI" in data and len(data["Technical Analysis: RSI"]) > 0:
            results["RSI"] = next(iter(data["Technical Analysis: RSI"].values()))
        else: errors.append("Failed to load RSI")
    except Exception as e: errors.append(f"RSI error: {e}")
    try:
        r = requests.get(ALPHA_VANTAGE_BASE_URL, params={"function": "SMA", "symbol": ticker, "interval": "daily", "time_period": "50", "series_type": "close", "apikey": api_key})
        r.raise_for_status()
        data = r.json()
        if "Technical Analysis: SMA" in data and len(data["Technical Analysis: SMA"]) > 0:
            results["SMA"] = next(iter(data["Technical Analysis: SMA"].values()))
        else: errors.append("Failed to load SMA")
    except Exception as e: errors.append(f"SMA error: {e}")
    if errors: return {"status": "error", "errors": errors, "ticker": ticker}
    results["status"] = "success"; results["ticker"] = ticker
    return results

async def get_leverage_data_raw(ticker: str, api_key: str) -> Dict[str, Any]:
    """Fetches raw data for leveraged trade analysis."""
    results = {}; errors = []
    try: # Intraday data for latest price
        r = requests.get(ALPHA_VANTAGE_BASE_URL, params={"function": "TIME_SERIES_INTRADAY", "symbol": ticker, "interval": "5min", "apikey": api_key})
        r.raise_for_status()
        data = r.json()
        if "Time Series (5min)" in data and len(data["Time Series (5min)"]) > 0:
            latest_timestamp = next(iter(data["Time Series (5min)"]))
            results["intraday"] = data["Time Series (5min)"][latest_timestamp]
        else: errors.append("Failed to load intraday data")
    except Exception as e: errors.append(f"Intraday error: {e}")
    try: # RSI with short interval
        r = requests.get(ALPHA_VANTAGE_BASE_URL, params={"function": "RSI", "symbol": ticker, "interval": "5min", "time_period": "14", "series_type": "close", "apikey": api_key})
        r.raise_for_status()
        data = r.json()
        if "Technical Analysis: RSI" in data and len(data["Technical Analysis: RSI"]) > 0:
            results["RSI"] = next(iter(data["Technical Analysis: RSI"].values()))
        else: errors.append("Failed to load 5min RSI")
    except Exception as e: errors.append(f"5min RSI error: {e}")
    try: # News
        r = requests.get(ALPHA_VANTAGE_BASE_URL, params={"function": "NEWS_SENTIMENT", "tickers": ticker, "limit": 5, "sort": "LATEST", "apikey": api_key})
        r.raise_for_status()
        data = r.json()
        if data.get("feed"): results["news"] = data
    except Exception as e: errors.append(f"News error: {e}")

    if errors: return {"status": "error", "errors": errors, "ticker": ticker}
    results["status"] = "success"; results["ticker"] = ticker
    return results


async def main():
    """Запуск MCP сервера"""
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            app.create_initialization_options()
        )


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
