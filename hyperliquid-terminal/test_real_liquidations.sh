#!/bin/bash

# Test script for real_liquidations_monitor.py

echo "=========================================="
echo "Testing real_liquidations_monitor.py"
echo "=========================================="
echo ""

# Check if the file exists
if [ ! -f "real_liquidations_monitor.py" ]; then
    echo "❌ Error: real_liquidations_monitor.py not found!"
    exit 1
fi
echo "✅ File exists: real_liquidations_monitor.py"

# Check Python syntax
echo ""
echo "Checking Python syntax..."
python3 -m py_compile real_liquidations_monitor.py
if [ $? -eq 0 ]; then
    echo "✅ Syntax check passed"
else
    echo "❌ Syntax check failed"
    exit 1
fi

# Test with no arguments
echo ""
echo "=========================================="
echo "Test 1: Running without arguments"
echo "=========================================="
echo "Expected: Monitor all assets (BTC, ETH, SOL)"
echo ""
echo "Command: timeout 5 python3 real_liquidations_monitor.py 2>&1 | head -20"
echo ""
timeout 5 python3 real_liquidations_monitor.py 2>&1 | head -20 || true
echo ""

# Test with BTC argument
echo "=========================================="
echo "Test 2: Running with BTC argument"
echo "=========================================="
echo "Expected: Monitor only BTC"
echo ""
echo "Command: timeout 5 python3 real_liquidations_monitor.py BTC 2>&1 | head -20"
echo ""
timeout 5 python3 real_liquidations_monitor.py BTC 2>&1 | head -20 || true
echo ""

# Test with invalid argument
echo "=========================================="
echo "Test 3: Running with invalid argument"
echo "=========================================="
echo "Expected: Error message with usage instructions"
echo ""
echo "Command: python3 real_liquidations_monitor.py INVALID 2>&1"
echo ""
python3 real_liquidations_monitor.py INVALID 2>&1
echo ""

# Test with lowercase argument
echo "=========================================="
echo "Test 4: Running with lowercase eth argument"
echo "=========================================="
echo "Expected: Convert to uppercase and monitor ETH"
echo ""
echo "Command: timeout 5 python3 real_liquidations_monitor.py eth 2>&1 | head -20"
echo ""
timeout 5 python3 real_liquidations_monitor.py eth 2>&1 | head -20 || true
echo ""

echo "=========================================="
echo "All tests completed!"
echo "=========================================="
