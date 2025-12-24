from flask import Flask, jsonify
import requests
import feedparser
import time
import re
from urllib.parse import urljoin
from lxml import etree, html

app = Flask(__name__)

# --- Copied and Adapted Logic from insider.py ---

SEC_USER_AGENT = "QuantyInsiderApp/1.0 (contact: support@quanty.app)"

HEADERS = {
    "User-Agent": SEC_USER_AGENT,
    "Accept-Encoding": "gzip, deflate",
    "Accept": "application/atom+xml,application/xml,text/xml,text/html;q=0.9,*/*;q=0.8",
}

_XSL_DIR_RE = re.compile(r"/xslF345X\d{2}/", re.IGNORECASE)

def normalize_sec_xml_url(url: str) -> str:
    return _XSL_DIR_RE.sub("/", url)

def get_recent_form4_rss(count=60):
    url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=only&count={count}&output=atom"
    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        feed = feedparser.parse(response.content)
        entries = []
        for entry in feed.entries:
            entries.append({
                'title': entry.title,
                'link': entry.link,
                'updated': entry.updated if hasattr(entry, 'updated') else ''
            })
        return entries
    except Exception as e:
        print(f"Error fetching RSS: {e}")
        return []

def get_xml_url_from_filing(filing_url):
    try:
        response = requests.get(filing_url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        tree = html.fromstring(response.content)
        xml_candidates = []
        for row in tree.xpath('//table[@class="tableFile"]//tr'):
            cells = row.xpath('.//td')
            if len(cells) >= 3:
                doc_type = cells[3].text_content().strip() if len(cells) > 3 else ''
                doc_type_clean = doc_type.strip().upper()
                link_elem = cells[2].xpath('.//a/@href')
                if link_elem:
                    link = link_elem[0]
                    filename = link.split('/')[-1].lower()
                    if 'xslf34x' in filename or filename.endswith('.xsd'):
                        continue
                    if filename.endswith('.xml'):
                        if doc_type_clean.startswith('4'): priority = 0
                        elif 'form4' in filename or 'doc4' in filename: priority = 1
                        else: priority = 2
                        full_url = urljoin('https://www.sec.gov', link)
                        xml_candidates.append((priority, full_url))
        if xml_candidates:
            xml_candidates.sort(key=lambda x: x[0])
            return xml_candidates[0][1]
        return None
    except Exception:
        return None

def fetch_and_parse_xml(xml_url):
    candidate_urls = []
    raw_url = normalize_sec_xml_url(xml_url)
    if raw_url != xml_url: candidate_urls.append(raw_url)
    candidate_urls.append(xml_url)

    for url in candidate_urls:
        try:
            response = requests.get(url, headers=HEADERS, timeout=10)
            response.raise_for_status()
            content = response.content
            if b'<?xml' in content[:500] or b'<ownershipdocument>' in content[:500].lower():
                return content
            try:
                etree.fromstring(content)
                return content
            except: continue
        except: continue
    return None

def safe_xpath_text(element, xpath, default=''):
    try:
        result = element.xpath(xpath)
        if result and len(result) > 0:
            return result[0].text if hasattr(result[0], 'text') and result[0].text else str(result[0])
        return default
    except:
        return default

def parse_form4_xml(xml_data):
    try:
        xml_str = xml_data.decode('utf-8', errors='ignore')
        if xml_str.startswith('\ufeff'): xml_str = xml_str[1:]
        root = etree.fromstring(xml_str.encode('utf-8'))
        
        issuer_name = safe_xpath_text(root, './/issuerName') or safe_xpath_text(root, './/issuer/issuerName')
        ticker = safe_xpath_text(root, './/issuerTradingSymbol') or safe_xpath_text(root, './/issuer/issuerTradingSymbol')
        owner_name = safe_xpath_text(root, './/reportingOwnerName') or safe_xpath_text(root, './/rptOwnerName')
        filing_date = safe_xpath_text(root, './/periodOfReport')

        transactions = []
        
        # Non-Derivative
        for tx in root.xpath('.//nonDerivativeTransaction'):
            try:
                trade_date = safe_xpath_text(tx, './/transactionDate/value')
                code = safe_xpath_text(tx, './/transactionCoding/transactionCode')
                shares = safe_xpath_text(tx, './/transactionShares/value', '0')
                price = safe_xpath_text(tx, './/transactionPricePerShare/value', '0')
                owned = safe_xpath_text(tx, './/sharesOwnedFollowingTransaction/value', '0')
                ownership = safe_xpath_text(tx, './/directOrIndirectOwnership/value') or 'D'
                
                try: value = float(price) * float(shares)
                except: value = 0
                
                if trade_date and code:
                    transactions.append({
                        'filing_date': filing_date, 'trade_date': trade_date, 'ticker': ticker,
                        'company': issuer_name, 'insider': owner_name, 'code': code,
                        'price': price, 'shares': shares, 'owned': owned, 'ownership': ownership,
                        'value': value, 'derivative': False
                    })
            except: continue

        # Derivative
        for tx in root.xpath('.//derivativeTransaction'):
            try:
                trade_date = safe_xpath_text(tx, './/transactionDate/value')
                code = safe_xpath_text(tx, './/transactionCoding/transactionCode')
                shares = safe_xpath_text(tx, './/transactionShares/value', '0')
                price = safe_xpath_text(tx, './/conversionOrExercisePrice/value', '0')
                owned = safe_xpath_text(tx, './/sharesOwnedFollowingTransaction/value', '0')
                ownership = safe_xpath_text(tx, './/directOrIndirectOwnership/value') or 'D'
                
                try: value = float(price) * float(shares)
                except: value = 0
                
                if trade_date and code:
                    transactions.append({
                        'filing_date': filing_date, 'trade_date': trade_date, 'ticker': ticker,
                        'company': issuer_name, 'insider': owner_name, 'code': code,
                        'price': price, 'shares': shares, 'owned': owned, 'ownership': ownership,
                        'value': value, 'derivative': True
                    })
            except: continue
            
        return transactions
    except:
        return []

# --- Vercel Handler ---

@app.route('/api/insider', methods=['GET'])
@app.route('/', methods=['GET'])
def get_insider_data():
    try:
        # Process only a small batch to avoid timeout, 
        # Vercel functions have 10s default limit (can be 60s on Pro)
        # We'll reduce limit to 5 for speed in serverless env
        entries = get_recent_form4_rss(count=5) 
        
        all_transactions = []
        seen = set()
        
        for entry in entries:
            xml_url = get_xml_url_from_filing(entry['link'])
            if not xml_url: continue
            
            xml_data = fetch_and_parse_xml(xml_url)
            if not xml_data: continue
            
            txs = parse_form4_xml(xml_data)
            for t in txs:
                sig = (t['filing_date'], t['trade_date'], t['ticker'], t['insider'], t['code'], 
                       str(t['price']), str(t['shares']), t['ownership'])
                if sig not in seen:
                    seen.add(sig)
                    all_transactions.append(t)
        
        return jsonify(all_transactions)
    except Exception as e:
        return jsonify({"error": str(e), "type": type(e).__name__}), 500

@app.route('/api/debug', methods=['GET'])
def debug():
    return jsonify({
        "status": "ok", 
        "message": "Insider feed API is running",
        "libraries": {
            "lxml": "available"
        }
    })

# Vercel expects a named handler for non-Flask, but for Flask/WSGI:
# We just need to expose 'app'. Vercel detects WSGI apps automatically in api/ folder 
# if using 'vercel.json' properly or just standard builds.
# But for safety with "rewrites" pointing to a file, standard handler is:

from werkzeug.middleware.proxy_fix import ProxyFix
app.wsgi_app = ProxyFix(app.wsgi_app)

if __name__ == '__main__':
    app.run()
