#!/bin/bash

# Polymarket Large Trades Monitor Runner
# Usage: ./run.sh [min_trade_size] [min_price] [max_price]
# Example: ./run.sh 5000 0.25 0.75

set -e

cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

if [ ! -f ".env" ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
fi

if [ -n "$1" ]; then
    export MIN_TRADE_SIZE=$1
    echo "Using minimum trade size: \$1"
fi

if [ -n "$2" ]; then
    export MIN_PRICE=$2
    echo "Using minimum price: $2 ($(echo "$2 * 100" | bc)%)"
fi

if [ -n "$3" ]; then
    export MAX_PRICE=$3
    echo "Using maximum price: $3 ($(echo "$3 * 100" | bc)%)"
fi

if [ ! -d "dist" ] || [ "src/index.ts" -nt "dist/index.js" ]; then
    echo "Building project..."
    npm run build
fi

echo "Starting Polymarket Large Trades Monitor..."
echo ""

npm start
