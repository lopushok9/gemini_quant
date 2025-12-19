import requests
import feedparser
import argparse
import time
import re
from lxml import etree, html
from tabulate import tabulate

HEADERS = {
    "User-Agent": "InsiderTradingTracker/1.0 your-email@example.com"  # ВАЖНО: Измените email!
}

def get_recent_form4_rss(count=100):
    """Получить последние Form 4 из RSS feed"""
    url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=only&count={count}&output=atom"
    
    print(f"Получение RSS feed с {count} последними Form 4...")
    time.sleep(0.11)  # SEC требует не более 10 запросов в секунду
    
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
        
        print(f"Найдено {len(entries)} форм")
        return entries
    
    except Exception as e:
        print(f"Ошибка получения RSS: {e}")
        return []


def get_xml_url_from_filing(filing_url, debug=False):
    """Получить URL основного XML файла Form 4 из страницы filing"""
    time.sleep(0.11)
    
    try:
        response = requests.get(filing_url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        
        # Парсим HTML страницу
        tree = html.fromstring(response.content)
        
        # Ищем таблицу с документами
        xml_candidates = []
        
        for row in tree.xpath('//table[@class="tableFile"]//tr'):
            cells = row.xpath('.//td')
            if len(cells) >= 3:
                # Ячейка с типом документа (обычно 4-я колонка)
                doc_type = cells[3].text_content().strip() if len(cells) > 3 else ''
                # Ячейка со ссылкой (обычно 3-я колонка)
                link_elem = cells[2].xpath('.//a/@href')
                
                if link_elem:
                    link = link_elem[0]
                    filename = link.split('/')[-1].lower()
                    
                    if debug:
                        print(f"    Found: {filename}, Type: {doc_type}")
                    
                    # Пропускаем XSLT файлы
                    if 'xslf34x' in filename or filename.endswith('.xsd'):
                        continue
                    
                    # Ищем XML файлы
                    if filename.endswith('.xml'):
                        # Приоритет 0: Основной Form 4 XML
                        if doc_type == '4':
                            priority = 0
                        # Приоритет 1: Файлы с form4 или doc4 в имени
                        elif 'form4' in filename or 'doc4' in filename or 'wf-form4' in filename:
                            priority = 1
                        # Приоритет 2: Любой другой XML
                        else:
                            priority = 2
                        
                        full_url = f"https://www.sec.gov{link}" if link.startswith('/') else link
                        xml_candidates.append((priority, full_url, filename))
        
        # Сортируем по приоритету и возвращаем первый
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
    """Скачать и распарсить XML"""
    time.sleep(0.11)
    
    try:
        response = requests.get(xml_url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        
        content = response.content
        
        # Проверяем, что это действительно XML, а не HTML
        try:
            # Пробуем декодировать первые 500 байт
            text_sample = content[:500].decode('utf-8', errors='ignore').strip().lower()
            
            if debug:
                print(f"    Content starts: {text_sample[:100]}")
            
            # Если явно HTML
            if text_sample.startswith(('<!doctype html', '<html')):
                if debug:
                    print("    -> HTML detected")
                return None
            
            # Если это XML (либо есть декларация, либо начинается с тега XML)
            if '<?xml' in text_sample or text_sample.startswith('<xml') or '<ownershipdocument>' in text_sample:
                if debug:
                    print("    -> Valid XML")
                return content
            
            # Пробуем парсить как XML для проверки
            try:
                etree.fromstring(content)
                if debug:
                    print("    -> Parseable XML")
                return content
            except:
                if debug:
                    print("    -> Not parseable as XML")
                return None
            
        except:
            if debug:
                print("    -> Decode error")
            return None
        
    except Exception as e:
        if debug:
            print(f"    Fetch error: {e}")
        return None


def safe_xpath_text(element, xpath, default=''):
    """Безопасное извлечение текста по XPath"""
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
    """Парсинг Form 4 XML в структурированные данные"""
    try:
        # Очистка XML от возможных проблемных символов
        xml_str = xml_data.decode('utf-8', errors='ignore')
        
        # Удаляем BOM если есть
        if xml_str.startswith('\ufeff'):
            xml_str = xml_str[1:]
        
        root = etree.fromstring(xml_str.encode('utf-8'))
        
        # Базовая информация - пробуем разные пути
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
        
        # Non-derivative транзакции
        for tx in root.xpath('.//nonDerivativeTransaction'):
            try:
                trade_date = safe_xpath_text(tx, './/transactionDate/value')
                code = safe_xpath_text(tx, './/transactionCoding/transactionCode')
                shares = safe_xpath_text(tx, './/transactionShares/value', '0')
                price = safe_xpath_text(tx, './/transactionPricePerShare/value', '0')
                owned = safe_xpath_text(tx, './/sharesOwnedFollowingTransaction/value', '0')
                
                # Ownership может быть в разных местах
                ownership = (
                    safe_xpath_text(tx, './/ownershipNature/directOrIndirectOwnership/value') or
                    safe_xpath_text(tx, './/directOrIndirectOwnership/value') or
                    'D'
                )
                
                # Вычисляем стоимость
                try:
                    value = float(price) * float(shares)
                except:
                    value = 0
                
                if trade_date and code:  # Минимальные требования
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
        
        # Derivative транзакции
        for tx in root.xpath('.//derivativeTransaction'):
            try:
                trade_date = safe_xpath_text(tx, './/transactionDate/value')
                code = safe_xpath_text(tx, './/transactionCoding/transactionCode')
                shares = safe_xpath_text(tx, './/transactionShares/value', '0')
                
                # Для derivative может быть другая цена
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
        print(f"Ошибка парсинга XML: {e}")
        return []


def format_transaction_code(code, is_derivative=False):
    """Расшифровка кода транзакции"""
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


def main(ticker_filter=None, limit=40, show_derivatives=True, debug=False):
    """Главная функция"""
    print("=" * 90)
    print("SEC Form 4 Insider Trading Tracker")
    print("=" * 90)
    
    if ticker_filter:
        print(f"Фильтр по тикеру: {ticker_filter.upper()}")
    if debug:
        print("⚙ Debug mode enabled")
    
    print()
    
    # Получаем RSS feed
    entries = get_recent_form4_rss(count=limit)
    
    if not entries:
        print("Не удалось получить данные из RSS feed")
        return
    
    all_transactions = []
    processed = 0
    errors = 0
    
    print(f"\nОбработка {len(entries)} форм...")
    print()
    
    for idx, entry in enumerate(entries, 1):
        title = entry['title'][:70]
        print(f"[{idx}/{len(entries)}] {title}...", end=' ')
        
        if debug:
            print(f"\n  Filing URL: {entry['link']}")
        
        # Получаем XML URL
        xml_url = get_xml_url_from_filing(entry['link'], debug=debug)
        
        if not xml_url:
            print("❌ XML не найден")
            errors += 1
            continue
        
        if debug:
            print(f"  XML URL: {xml_url}")
        
        # Скачиваем XML
        xml_data = fetch_and_parse_xml(xml_url, debug=debug)
        
        if not xml_data:
            print("⚠ Неверный формат")
            errors += 1
            continue
        
        # Парсим транзакции
        transactions = parse_form4_xml(xml_data)
        
        if transactions:
            # Фильтрация
            if ticker_filter:
                transactions = [t for t in transactions if t['ticker'].upper() == ticker_filter.upper()]
            
            if not show_derivatives:
                transactions = [t for t in transactions if not t['derivative']]
            
            if transactions:
                print(f"✓ {len(transactions)} сделок")
                all_transactions.extend(transactions)
                processed += 1
            else:
                print("⊘ Отфильтровано")
        else:
            print("⚠ Нет данных")
    
    print()
    print("=" * 90)
    print(f"Обработано: {processed} форм | Ошибок: {errors} | Найдено сделок: {len(all_transactions)}")
    print("=" * 90)
    
    if not all_transactions:
        print("\n❌ Инсайдерские сделки не найдены")
        if ticker_filter:
            print(f"Попробуйте другой тикер или запустите без фильтра")
        return
    
    print()
    
    # Форматируем для вывода
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
            t['filing_date'],
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
        "Filing",
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
    
    print(tabulate(table_data, headers=headers, tablefmt="grid", maxcolwidths=[10, 10, 8, 22, 18, 15, 10, 12, 12, 3, 12]))
    
    print("\n" + "=" * 90)
    print("Коды: P=Purchase (Покупка), S=Sale (Продажа), A=Award (Грант), M=Exercise (Исполнение опциона)")
    print("D/I: D=Direct (Прямое владение), I=Indirect (Косвенное) | (Deriv)=Derivative Security")
    print("=" * 90)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Отслеживание инсайдерских сделок SEC Form 4',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Примеры использования:
  python sec_form4_scraper.py                          # Последние 40 сделок
  python sec_form4_scraper.py --ticker AAPL            # Только AAPL
  python sec_form4_scraper.py --limit 100              # Обработать 100 форм
  python sec_form4_scraper.py --ticker NVDA --limit 200
  python sec_form4_scraper.py --no-derivatives         # Без деривативов
        '''
    )
    
    parser.add_argument(
        '--ticker', 
        help='Фильтр по тикеру (например: AAPL, TSLA, MSFT)',
        type=str
    )
    
    parser.add_argument(
        '--limit',
        help='Количество форм для обработки (по умолчанию: 40)',
        type=int,
        default=40
    )
    
    parser.add_argument(
        '--no-derivatives',
        help='Скрыть derivative транзакции (опционы и т.д.)',
        action='store_true'
    )
    
    parser.add_argument(
        '--debug',
        help='Включить режим отладки',
        action='store_true'
    )
    
    args = parser.parse_args()
    
    try:
        main(
            ticker_filter=args.ticker, 
            limit=args.limit,
            show_derivatives=not args.no_derivatives,
            debug=args.debug
        )
    except KeyboardInterrupt:
        print("\n\n⚠ Прервано пользователем")
    except Exception as e:
        print(f"\n❌ Критическая ошибка: {e}")
        import traceback
        traceback.print_exc()