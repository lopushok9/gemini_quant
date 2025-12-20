import os
import requests
import feedparser
import argparse
import time
import re
from urllib.parse import urljoin
from lxml import etree, html
from tabulate import tabulate

SEC_USER_AGENT = os.getenv("SEC_USER_AGENT") or os.getenv("USER_AGENT")

HEADERS = {
    "User-Agent": SEC_USER_AGENT or "InsiderTradingTracker/1.0 (contact: your-email@example.com)",
    "Accept-Encoding": "gzip, deflate",
    "Accept": "application/atom+xml,application/xml,text/xml,text/html;q=0.9,*/*;q=0.8",
}

_XSL_DIR_RE = re.compile(r"/xslF345X\d{2}/", re.IGNORECASE)


def normalize_sec_xml_url(url: str) -> str:
    """SEC sometimes returns HTML-rendered XML via xslF345X**/.

    To parse properly, we need to download the raw XML without the xsl directory.
    """

    return _XSL_DIR_RE.sub("/", url)

def get_recent_form4_rss(count=100):
    """Fetch the latest Form 4 filings from the SEC RSS feed"""
    url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=only&count={count}&output=atom"
    
    print(f"Fetching RSS feed with the {count} latest Form 4 filings...")
    time.sleep(0.11)  # SEC allows no more than 10 requests per second
    
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        feed = feedparser.parse(response.content)
        
        entries = []
        for entry in feed.entries:
            entries.append({
                'title': entry.title,
                'link': entry.link,
                'updated': entry.updated if hasattr(entry, 'updated') else ''
            })
        
        print(f"Found {len(entries)} filings")
        return entries
    
    except Exception as e:
        print(f"Error fetching RSS: {e}")
        return []


def get_xml_url_from_filing(filing_url, debug=False):
    """Extract the main Form 4 XML file URL from the filing landing page"""
    time.sleep(0.11)
    
    try:
        response = requests.get(filing_url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        
        # Parse the HTML page
        tree = html.fromstring(response.content)
        
        # Look for the document table
        xml_candidates = []
        
        for row in tree.xpath('//table[@class="tableFile"]//tr'):
            cells = row.xpath('.//td')
            if len(cells) >= 3:
                # Document type cell (usually 4th column)
                doc_type = cells[3].text_content().strip() if len(cells) > 3 else ''
                doc_type_clean = doc_type.strip().upper()

                # Document link cell (usually 3rd column)
                link_elem = cells[2].xpath('.//a/@href')

                if link_elem:
                    link = link_elem[0]
                    filename = link.split('/')[-1].lower()

                    if debug:
                        print(f"    Found: {filename}, Type: {doc_type}")

                    # Skip XSLT and schema files
                    if 'xslf34x' in filename or filename.endswith('.xsd'):
                        continue

                    # Look for XML files
                    if filename.endswith('.xml'):
                        # Priority 0: Main Form 4 XML
                        if doc_type_clean.startswith('4'):
                            priority = 0
                        # Priority 1: Files with form4 or doc4 in the name
                        elif 'form4' in filename or 'doc4' in filename or 'wf-form4' in filename:
                            priority = 1
                        # Priority 2: Any other XML
                        else:
                            priority = 2

                        full_url = urljoin('https://www.sec.gov', link)
                        xml_candidates.append((priority, full_url, filename))
        
        # Sort by priority and return the best match
        if xml_candidates:
            xml_candidates.sort(key=lambda x: x[0])
            if debug:
                print(f"    Selected: {xml_candidates[0][2]}")
            return xml_candidates[0][1]
        
        return None
    
    except Exception as e:
        if debug:
            print(f"    Error: {e}")
        return None


def fetch_and_parse_xml(xml_url, debug=False):
    """Download and validate XML content.

    SEC often returns an HTML view of the XML if the URL contains xslF345X**/.
    In such cases, we fetch the "raw" XML by removing that directory.
    """

    time.sleep(0.11)

    candidate_urls = []
    raw_url = normalize_sec_xml_url(xml_url)
    if raw_url != xml_url:
        candidate_urls.append(raw_url)
    candidate_urls.append(xml_url)

    last_error = None

    for url in candidate_urls:
        try:
            response = requests.get(url, headers=HEADERS, timeout=15)
            response.raise_for_status()

            content = response.content
            content_type = (response.headers.get('content-type') or '').lower()

            text_sample = content[:500].decode('utf-8', errors='ignore').strip().lower()

            if debug:
                if url != xml_url:
                    print(f"    Trying raw XML URL: {url}")
                print(f"    Content-Type: {content_type or '(unknown)'}")
                print(f"    Content starts: {text_sample[:100]}")

            is_html = (
                'text/html' in content_type
                or text_sample.startswith(('<!doctype html', '<html'))
            )

            if is_html:
                if debug:
                    print("    -> HTML detected")
                continue

            if '<?xml' in text_sample or '<ownershipdocument>' in text_sample:
                if debug:
                    print("    -> Valid XML")
                return content

            try:
                etree.fromstring(content)
                if debug:
                    print("    -> Parseable XML")
                return content
            except Exception:
                if debug:
                    print("    -> Not parseable as XML")
                continue

        except Exception as e:
            last_error = e
            if debug:
                print(f"    Fetch error ({url}): {e}")
            continue

    if debug and last_error:
        print(f"    -> Failed to fetch XML: {last_error}")

    return None


def safe_xpath_text(element, xpath, default=''):
    """Safely extract text using XPath"""
    try:
        result = element.xpath(xpath)
        if result and len(result) > 0:
            if hasattr(result[0], 'text'):
                return result[0].text if result[0].text else default
            else:
                return str(result[0]) if result[0] else default
        return default
    except:
        return default


def parse_form4_xml(xml_data):
    """Parse Form 4 XML into structured data"""
    try:
        # Clean XML from potential problematic characters
        xml_str = xml_data.decode('utf-8', errors='ignore')
        
        # Remove BOM if present
        if xml_str.startswith('\ufeff'):
            xml_str = xml_str[1:]
        
        root = etree.fromstring(xml_str.encode('utf-8'))
        
        # Base information - trying multiple paths for robustness
        issuer_name = (
            safe_xpath_text(root, './/issuerName') or 
            safe_xpath_text(root, './/issuer/issuerName') or
            safe_xpath_text(root, './/ns:issuerName', '') or
            ''
        )
        
        ticker = (
            safe_xpath_text(root, './/issuerTradingSymbol') or
            safe_xpath_text(root, './/issuer/issuerTradingSymbol') or
            safe_xpath_text(root, './/ns:issuerTradingSymbol', '') or
            ''
        )
        
        owner_name = (
            safe_xpath_text(root, './/reportingOwnerName') or
            safe_xpath_text(root, './/rptOwnerName') or
            safe_xpath_text(root, './/reportingOwner/reportingOwnerId/rptOwnerName') or
            ''
        )
        
        filing_date = safe_xpath_text(root, './/periodOfReport') or ''
        
        transactions = []
        
        # Non-derivative transactions
        for tx in root.xpath('.//nonDerivativeTransaction'):
            try:
                trade_date = safe_xpath_text(tx, './/transactionDate/value')
                code = safe_xpath_text(tx, './/transactionCoding/transactionCode')
                shares = safe_xpath_text(tx, './/transactionShares/value', '0')
                price = safe_xpath_text(tx, './/transactionPricePerShare/value', '0')
                owned = safe_xpath_text(tx, './/sharesOwnedFollowingTransaction/value', '0')
                
                # Ownership structure can vary
                ownership = (
                    safe_xpath_text(tx, './/ownershipNature/directOrIndirectOwnership/value') or
                    safe_xpath_text(tx, './/directOrIndirectOwnership/value') or
                    'D'
                )
                
                # Calculate value
                try:
                    value = float(price) * float(shares)
                except:
                    value = 0
                
                if trade_date and code:  # Minimum requirements
                    transactions.append({
                        'filing_date': filing_date,
                        'trade_date': trade_date,
                        'ticker': ticker,
                        'company': issuer_name,
                        'insider': owner_name,
                        'code': code,
                        'price': price,
                        'shares': shares,
                        'owned': owned,
                        'ownership': ownership,
                        'value': value,
                        'derivative': False
                    })
            
            except Exception as e:
                continue
        
        # Derivative transactions
        for tx in root.xpath('.//derivativeTransaction'):
            try:
                trade_date = safe_xpath_text(tx, './/transactionDate/value')
                code = safe_xpath_text(tx, './/transactionCoding/transactionCode')
                shares = safe_xpath_text(tx, './/transactionShares/value', '0')
                
                # Derivative might have a different price field
                price = (
                    safe_xpath_text(tx, './/conversionOrExercisePrice/value', '0') or
                    safe_xpath_text(tx, './/transactionPricePerShare/value', '0')
                )
                
                owned = safe_xpath_text(tx, './/sharesOwnedFollowingTransaction/value', '0')
                
                ownership = (
                    safe_xpath_text(tx, './/ownershipNature/directOrIndirectOwnership/value') or
                    safe_xpath_text(tx, './/directOrIndirectOwnership/value') or
                    'D'
                )
                
                try:
                    value = float(price) * float(shares)
                except:
                    value = 0
                
                if trade_date and code:
                    transactions.append({
                        'filing_date': filing_date,
                        'trade_date': trade_date,
                        'ticker': ticker,
                        'company': issuer_name,
                        'insider': owner_name,
                        'code': code,
                        'price': price,
                        'shares': shares,
                        'owned': owned,
                        'ownership': ownership,
                        'value': value,
                        'derivative': True
                    })
            
            except Exception as e:
                continue
        
        return transactions
    
    except Exception as e:
        print(f"Error parsing XML: {e}")
        return []


def format_transaction_code(code, is_derivative=False):
    """Decode transaction codes into human-readable strings"""
    codes = {
        'P': 'Purchase',
        'S': 'Sale',
        'A': 'Grant/Award',
        'D': 'Disposition',
        'F': 'Tax Payment',
        'I': 'Discretionary',
        'M': 'Exercise',
        'C': 'Conversion',
        'E': 'Expiration',
        'H': 'Expiration Short',
        'O': 'Exercise OTM',
        'X': 'Exercise ITM',
        'G': 'Gift',
        'L': 'Small Acq',
        'W': 'Will Transfer',
        'Z': 'Deposit/Withdrawal',
        'J': 'Other'
    }
    
    result = codes.get(code, code)
    if is_derivative:
        result += ' (Deriv)'
    return result


def main(ticker_filter=None, limit=40, show_derivatives=True, debug=False, only_buysell=False):
    """Main execution function"""
    print("=" * 90)
    print("SEC Form 4 Insider Trading Tracker")
    print("=" * 90)
    
    if ticker_filter:
        print(f"Ticker filter: {ticker_filter.upper()}")
    if debug:
        print("⚙ Debug mode enabled")
    
    print()
    
    # Fetch RSS feed
    entries = get_recent_form4_rss(count=limit)
    
    if not entries:
        print("Failed to retrieve data from the RSS feed")
        return
    
    all_transactions = []
    processed = 0
    errors = 0
    
    print(f"\nProcessing {len(entries)} filings...")
    print()
    
    for idx, entry in enumerate(entries, 1):
        title = entry['title'][:70]
        print(f"[{idx}/{len(entries)}] {title}...", end=' ')
        
        if debug:
            print(f"\n  Filing URL: {entry['link']}")
        
        # Get XML URL
        xml_url = get_xml_url_from_filing(entry['link'], debug=debug)
        
        if not xml_url:
            print("❌ XML not found")
            errors += 1
            continue
        
        if debug:
            print(f"  XML URL: {xml_url}")
        
        # Download XML
        xml_data = fetch_and_parse_xml(xml_url, debug=debug)
        
        if not xml_data:
            print("⚠ Invalid format")
            errors += 1
            continue
        
        # Parse transactions
        transactions = parse_form4_xml(xml_data)
        
        if transactions:
            # Filtering
            if ticker_filter:
                transactions = [t for t in transactions if t['ticker'].upper() == ticker_filter.upper()]
            
            if not show_derivatives:
                transactions = [t for t in transactions if not t['derivative']]
            
            if only_buysell:
                transactions = [t for t in transactions if t['code'] in ('P', 'S')]
            
            if transactions:
                print(f"✓ {len(transactions)} trades")
                all_transactions.extend(transactions)
                processed += 1
            else:
                print("⊘ Filtered out")
        else:
            print("⚠ No data")
    
    print()
    print("=" * 90)
    print(f"Processed: {processed} filings | Errors: {errors} | Trades found: {len(all_transactions)}")
    print("=" * 90)
    
    if not all_transactions:
        print("\n❌ No insider trades found matching your criteria")
        if ticker_filter:
            print(f"Try another ticker or run without filters")
        return
    
    print()
    
    # Format for output
    table_data = []
    for t in all_transactions:
        try:
            value = float(t['value'])
            value_str = f"${value:,.0f}" if value > 0 else ""
        except:
            value_str = ""
        
        try:
            price_float = float(t['price'])
            price_str = f"${price_float:,.2f}" if price_float > 0 else ""
        except:
            price_str = ""
        
        try:
            shares_float = float(t['shares'])
            shares_str = f"{shares_float:,.0f}" if shares_float > 0 else ""
        except:
            shares_str = t['shares']
        
        try:
            owned_float = float(t['owned'])
            owned_str = f"{owned_float:,.0f}" if owned_float > 0 else ""
        except:
            owned_str = t['owned']
        
        table_data.append([
            t['trade_date'],
            t['ticker'][:8],
            t['company'][:22],
            t['insider'][:18],
            format_transaction_code(t['code'], t['derivative']),
            price_str,
            shares_str,
            owned_str,
            t['ownership'],
            value_str
        ])
    
    headers = [
        "Trade",
        "Ticker",
        "Company",
        "Insider",
        "Type",
        "Price",
        "Shares",
        "Owned",
        "D/I",
        "Value"
    ]
    
    print(tabulate(table_data, headers=headers, tablefmt="grid", maxcolwidths=[10, 8, 22, 18, 15, 10, 12, 12, 3, 12]))
    
    print("\n" + "=" * 90)
    print("Codes: P=Purchase, S=Sale, A=Award, M=Exercise")
    print("D/I: D=Direct, I=Indirect | (Deriv)=Derivative Security")
    print("=" * 90)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='SEC Form 4 Insider Trading Tracker',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python insider.py                          # Latest 40 filings
  python insider.py --ticker AAPL            # Filter by AAPL
  python insider.py --limit 100              # Process 100 filings
  python insider.py --ticker NVDA --limit 200
  python insider.py --no-derivatives         # Hide derivatives
  python insider.py --only-buysell           # Only Purchases and Sales (P/S)
        '''
    )
    
    parser.add_argument(
        '--ticker', 
        help='Ticker filter (e.g., AAPL, TSLA, MSFT)',
        type=str
    )
    
    parser.add_argument(
        '--limit',
        help='Number of filings to process (default: 40)',
        type=int,
        default=40
    )
    
    parser.add_argument(
        '--no-derivatives',
        help='Hide derivative transactions (options, etc.)',
        action='store_true'
    )
    
    parser.add_argument(
        '--debug',
        help='Enable debug mode',
        action='store_true'
    )
    
    parser.add_argument(
        '--only-buysell',
        help='Display only Purchases (P) and Sales (S)',
        action='store_true'
    )
    
    args = parser.parse_args()
    
    try:
        main(
            ticker_filter=args.ticker, 
            limit=args.limit,
            show_derivatives=not args.no_derivatives,
            debug=args.debug,
            only_buysell=args.only_buysell
        )
    except KeyboardInterrupt:
        print("\n\n⚠ Interrupted by user")
    except Exception as e:
        print(f"\n❌ Critical error: {e}")
        import traceback
        traceback.print_exc()