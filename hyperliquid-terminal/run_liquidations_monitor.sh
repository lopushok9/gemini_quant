#!/bin/bash

# Скрипт для запуска мониторинга ликвидаций Hyperliquid
# Использование: ./run_liquidations_monitor.sh [threshold] [mode]
# Параметры:
#   threshold - минимальная сумма ликвидации в USD (по умолчанию 50000)
#   mode - режим работы: simple, advanced, background (по умолчанию advanced)

THRESHOLD=${1:-50000}
MODE=${2:-advanced}

echo "================================================"
echo "🚀 Hyperliquid Liquidations Monitor"
echo "================================================"
echo "Threshold: \$$THRESHOLD"
echo "Mode: $MODE"
echo "================================================"
echo ""

case $MODE in
    simple)
        echo "Starting simple monitor..."
        python3 liquidations_monitor.py $THRESHOLD
        ;;
    advanced)
        echo "Starting advanced monitor..."
        python3 liquidations_monitor_advanced.py $THRESHOLD
        ;;
    background)
        echo "Starting in background mode..."
        LOG_FILE="liquidations_$(date +%Y%m%d_%H%M%S).log"
        nohup python3 liquidations_monitor_advanced.py $THRESHOLD > $LOG_FILE 2>&1 &
        PID=$!
        echo "Monitor started with PID: $PID"
        echo "Log file: $LOG_FILE"
        echo "To stop: kill $PID"
        echo "To view logs: tail -f $LOG_FILE"
        ;;
    *)
        echo "Unknown mode: $MODE"
        echo "Available modes: simple, advanced, background"
        exit 1
        ;;
esac
