import requests
from config import API_KEY

BASE_URL = "https://www.alphavantage.co/query"

def get_quote(symbol):
    """
    Fetches the latest price and other information for a given symbol.
    """
    params = {
        "function": "GLOBAL_QUOTE",
        "symbol": symbol,
        "apikey": API_KEY
    }
    try:
        response = requests.get(BASE_URL, params=params)
        response.raise_for_status()  # Raise an exception for bad status codes
        data = response.json()
        if "Global Quote" in data and data["Global Quote"]:
            return data["Global Quote"]
        elif "Note" in data:
            return {"Error": data["Note"]}
        elif "Information" in data:
            return {"Error": data["Information"]}
        else:
            # It's possible for the response to be empty, or have other errors
            if data:
                return {"Error": str(data)}
            return {"Error": "No data found for the symbol."}
    except requests.exceptions.RequestException as e:
        return {"Error": f"Request failed: {e}"}
    except ValueError:
        return {"Error": "Failed to parse response."}
