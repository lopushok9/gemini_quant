# SEC Insider Trading Tracker

A tool to track real-time insider trading activities as reported to the SEC via Form 4 filings.

## Features

- **Real-time Tracking**: Fetches the latest filings from the SEC EDGAR RSS feed.
- **Automated Parsing**: Extracts transaction details (date, shares, price, value) from raw XML documents.
- **Robust Filtering**: Filter by ticker, transaction type, or exclude complex derivative securities.
- **Detailed Output**: Provides a clean, tabular view of insider activity including ownership nature (Direct/Indirect).

## Installation

Ensure you have the required dependencies installed:

```bash
pip install requests feedparser lxml tabulate
```

## Usage

Run the script from the terminal:

```bash
python insider.py [options]
```

### Command Options

| Option | Description |
| :--- | :--- |
| `--ticker TICKER` | Filter results by a specific stock ticker (e.g., `AAPL`, `NVDA`). |
| `--limit LIMIT` | Number of recent filings to process (default: 40). |
| `--no-derivatives` | Hide derivative transactions (like options exercise/grants). |
| `--only-buysell` | Only show open market Purchases (P) and Sales (S). |
| `--debug` | Show detailed logs of the fetching and parsing process. |

### Examples

**Track the latest 100 insider transactions:**
```bash
python insider.py --limit 100
```

**Track only NVIDIA ($NVDA) purchases and sales:**
```bash
python insider.py --ticker NVDA --only-buysell
```

**Quick scan without derivative noise:**
```bash
python insider.py --no-derivatives
```

## Transaction Codes

- **P**: Purchase (Open Market)
- **S**: Sale (Open Market)
- **A**: Grant/Award
- **M**: Exercise of derivative security
- **D**: Disposition
- **F**: Payment of exercise price or tax liability

## Disclaimer

This tool is for educational and research purposes only. Data is retrieved from the SEC EDGAR system and should be verified independently. Not financial advice.
