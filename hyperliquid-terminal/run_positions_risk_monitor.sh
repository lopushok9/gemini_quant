#!/bin/bash

# Launcher script for Hyperliquid Positions at Risk Monitor
# This script provides multiple monitoring modes for tracking large positions near liquidation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR_SIMPLE="$SCRIPT_DIR/positions_at_risk_monitor_simple.py"
MONITOR_ADVANCED="$SCRIPT_DIR/positions_at_risk_monitor.py"

# Default values
MODE="simple"
BACKGROUND=false
LOG_FILE=""
PID_FILE=""

# Function to print colored output
print_color() {
    local color=$1
    shift
    echo -e "${color}$@${NC}"
}

# Function to show usage
show_usage() {
    print_color $WHITE "Usage: $0 [OPTIONS]"
    echo
    print_color $CYAN "Options:"
    echo "  -m, --mode MODE          Monitoring mode:"
    echo "                           simple    - Basic OI and funding monitoring (default)"
    echo "                           advanced  - Full liquidation risk analysis"
    echo "  -b, --background         Run in background"
    echo "  -l, --log-file FILE      Log file path (default: auto-generated)"
    echo "  -h, --help               Show this help message"
    echo
    print_color $CYAN "Examples:"
    echo "  $0                       # Run simple monitor"
    echo "  $0 -m advanced           # Run advanced monitor"
    echo "  $0 -b -l monitor.log     # Run simple monitor in background with logging"
    echo "  $0 -m advanced -b        # Run advanced monitor in background"
    echo
    print_color $CYAN "Features:"
    echo "  📈 Open Interest surge detection"
    echo "  💰 Funding rate stress monitoring"
    echo "  🚨 High leverage position warnings"
    echo "  ⚡ Real-time liquidation risk analysis"
    echo
}

# Function to check dependencies
check_dependencies() {
    if ! command -v python3 &> /dev/null; then
        print_color $RED "Error: Python 3 is required but not installed."
        exit 1
    fi
    
    if [ ! -f "$MONITOR_SIMPLE" ] && [ ! -f "$MONITOR_ADVANCED" ]; then
        print_color $RED "Error: Monitor scripts not found."
        print_color $YELLOW "Expected: $MONITOR_SIMPLE or $MONITOR_ADVANCED"
        exit 1
    fi
}

# Function to generate log file path
generate_log_path() {
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    if [ "$MODE" = "advanced" ]; then
        echo "$SCRIPT_DIR/logs/positions_risk_monitor_${MODE}_${timestamp}.log"
    else
        echo "$SCRIPT_DIR/logs/positions_risk_monitor_${MODE}_${timestamp}.log"
    fi
}

# Function to ensure logs directory exists
ensure_log_dir() {
    local log_dir="$SCRIPT_DIR/logs"
    if [ ! -d "$log_dir" ]; then
        mkdir -p "$log_dir"
        print_color $GREEN "Created logs directory: $log_dir"
    fi
}

# Function to run monitor in background
run_background() {
    local monitor_script="$1"
    local log_file="$2"
    local pid_file="$3"
    
    ensure_log_dir
    
    # Create logs directory if it doesn't exist
    mkdir -p "$(dirname "$log_file")"
    
    print_color $BLUE "Starting background monitor..."
    print_color $CYAN "Mode: $MODE"
    print_color $CYAN "Log file: $log_file"
    print_color $CYAN "PID file: $pid_file"
    
    # Start the monitor in background
    nohup python3 "$monitor_script" > "$log_file" 2>&1 &
    local pid=$!
    
    # Save PID
    echo $pid > "$pid_file"
    
    # Verify it started
    sleep 2
    if kill -0 $pid 2>/dev/null; then
        print_color $GREEN "✅ Monitor started successfully (PID: $pid)"
        print_color $YELLOW "💡 To view logs: tail -f $log_file"
        print_color $YELLOW "💡 To stop: kill $pid"
        print_color $YELLOW "💡 Or use: $0 --stop $pid_file"
    else
        print_color $RED "❌ Failed to start monitor"
        rm -f "$pid_file"
        exit 1
    fi
}

# Function to run monitor in foreground
run_foreground() {
    local monitor_script="$1"
    
    print_color $BLUE "Starting monitor in foreground..."
    print_color $CYAN "Mode: $MODE"
    print_color $YELLOW "💡 Press Ctrl+C to stop"
    echo
    
    # Run the monitor
    python3 "$monitor_script"
}

# Function to stop background monitor
stop_monitor() {
    local pid_file="$1"
    
    if [ ! -f "$pid_file" ]; then
        print_color $RED "Error: PID file not found: $pid_file"
        exit 1
    fi
    
    local pid=$(cat "$pid_file")
    
    if kill -0 $pid 2>/dev/null; then
        print_color $YELLOW "Stopping monitor (PID: $pid)..."
        kill $pid
        
        # Wait for graceful shutdown
        local count=0
        while kill -0 $pid 2>/dev/null && [ $count -lt 10 ]; do
            sleep 1
            count=$((count + 1))
        done
        
        # Force kill if still running
        if kill -0 $pid 2>/dev/null; then
            print_color $YELLOW "Force stopping monitor..."
            kill -9 $pid
        fi
        
        print_color $GREEN "✅ Monitor stopped"
    else
        print_color $RED "Monitor is not running (PID: $pid)"
    fi
    
    rm -f "$pid_file"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mode)
            MODE="$2"
            shift 2
            ;;
        -b|--background)
            BACKGROUND=true
            shift
            ;;
        -l|--log-file)
            LOG_FILE="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        --stop)
            STOP_MODE=true
            PID_FILE="$2"
            shift 2
            ;;
        *)
            print_color $RED "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Handle stop command
if [ "$STOP_MODE" = true ]; then
    stop_monitor "$PID_FILE"
    exit 0
fi

# Validate mode
if [ "$MODE" != "simple" ] && [ "$MODE" != "advanced" ]; then
    print_color $RED "Error: Invalid mode '$MODE'. Must be 'simple' or 'advanced'"
    show_usage
    exit 1
fi

# Check dependencies
check_dependencies

# Select monitor script
if [ "$MODE" = "advanced" ]; then
    MONITOR_SCRIPT="$MONITOR_ADVANCED"
else
    MONITOR_SCRIPT="$MONITOR_SIMPLE"
fi

# Generate log file path if not provided
if [ -z "$LOG_FILE" ]; then
    LOG_FILE=$(generate_log_path)
fi

# Generate PID file path
PID_FILE="$SCRIPT_DIR/positions_risk_monitor_${MODE}.pid"

print_color $PURPLE "🎯 HYPERLIQUID POSITIONS AT RISK MONITOR"
print_color $CYAN "Mode: $MODE"
print_color $CYAN "Background: $BACKGROUND"

# Run monitor
if [ "$BACKGROUND" = true ]; then
    run_background "$MONITOR_SCRIPT" "$LOG_FILE" "$PID_FILE"
else
    run_foreground "$MONITOR_SCRIPT"
fi