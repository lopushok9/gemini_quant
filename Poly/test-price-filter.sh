#!/bin/bash

# Test script to demonstrate price filtering
# Shows the difference between wide and narrow price ranges

set -e

cd "$(dirname "$0")"

echo "=========================================="
echo "Price Filtering Test"
echo "=========================================="
echo ""
echo "This script will test different price ranges to show"
echo "how the filter works. Each test runs for 15 seconds."
echo ""

echo "=========================================="
echo "Test 1: Wide Range (10%-90%)"
echo "Shows many trades including near-certain outcomes"
echo "=========================================="
echo ""
MIN_PRICE=0.10 MAX_PRICE=0.90 timeout 15 npm run dev || true
echo ""
echo "Press Enter to continue to Test 2..."
read

echo ""
echo "=========================================="
echo "Test 2: Default Range (25%-75%)"
echo "Recommended - filters near-certain outcomes"
echo "=========================================="
echo ""
MIN_PRICE=0.25 MAX_PRICE=0.75 timeout 15 npm run dev || true
echo ""
echo "Press Enter to continue to Test 3..."
read

echo ""
echo "=========================================="
echo "Test 3: Narrow Range (40%-60%)"
echo "Maximum focus - only near 50/50 trades"
echo "=========================================="
echo ""
MIN_PRICE=0.40 MAX_PRICE=0.60 timeout 15 npm run dev || true
echo ""

echo ""
echo "=========================================="
echo "Test Complete!"
echo "=========================================="
echo ""
echo "Summary:"
echo "- Test 1 (10%-90%): Shows many trades, including noise"
echo "- Test 2 (25%-75%): Balanced - recommended for most users"
echo "- Test 3 (40%-60%): Highly focused - only maximum uncertainty"
echo ""
echo "Choose the range that fits your needs and configure in .env"
