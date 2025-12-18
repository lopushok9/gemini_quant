#!/bin/bash

# Polymarket Monitor Demo Script
# This script runs a quick demonstration of the monitor

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║        Polymarket Large Trades Monitor - Demo                   ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "This demo will:"
echo "  1. Test the API connection"
echo "  2. Show top markets"
echo "  3. Find large orders on the highest volume market"
echo "  4. Run the monitor for 30 seconds"
echo ""
read -p "Press ENTER to start the demo..."

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Running API Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

npm test

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Test failed. Please check your installation."
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Starting Live Monitor (30 seconds)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Watch for large orders in real-time..."
echo "Press Ctrl+C to stop early, or wait 30 seconds"
echo ""

timeout 30 npm start

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Demo Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "What's next?"
echo ""
echo "  • Start monitoring:    npm start"
echo "  • Custom threshold:    ./run.sh 5000"
echo "  • Read the docs:       cat README.md"
echo "  • See examples:        cat EXAMPLES.md"
echo ""
echo "Happy monitoring! 🎯"
echo ""
