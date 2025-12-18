#!/bin/bash

# Polymarket Large Trades Monitor Runner
# Usage: ./run.sh [min_trade_size]

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
    echo "Using minimum trade size: \$$1"
fi

if [ ! -d "dist" ] || [ "src/index.ts" -nt "dist/index.js" ]; then
    echo "Building project..."
    npm run build
fi

echo "Starting Polymarket Large Trades Monitor..."
echo ""

npm start
