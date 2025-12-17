#!/usr/bin/env python3
"""
Example usage of the Hyperliquid Liquidations Monitor

This file demonstrates different ways to use and customize the monitor.
"""

import asyncio
from liquidations_monitor_advanced import LiquidationsMonitor

async def example_basic():
    """Basic usage with default settings"""
    print("Example 1: Basic usage with default threshold ($50k)")
    monitor = LiquidationsMonitor()
    await monitor.run()


async def example_custom_threshold():
    """Custom threshold example"""
    print("Example 2: Custom threshold ($10k)")
    monitor = LiquidationsMonitor(threshold_usd=10000)
    await monitor.run()


async def example_with_callback():
    """Example with custom callback for liquidations"""
    print("Example 3: With custom callback")
    
    liquidations_log = []
    
    class MonitorWithCallback(LiquidationsMonitor):
        def display_liquidation(self, trade, asset, usd_value):
            # Call parent display
            super().display_liquidation(trade, asset, usd_value)
            
            # Custom action: save to log
            liquidations_log.append({
                "asset": asset,
                "value": usd_value,
                "time": trade.get("time"),
                "price": float(trade.get("px", 0)),
                "size": float(trade.get("sz", 0)),
            })
            
            # Could also send notifications, save to DB, etc.
            if usd_value > 100000:
                print(f"   🔥 LARGE LIQUIDATION ALERT: ${usd_value:,.0f} 🔥")
    
    monitor = MonitorWithCallback(threshold_usd=5000)
    try:
        await monitor.run()
    except KeyboardInterrupt:
        print(f"\n\nCaptured {len(liquidations_log)} liquidations")
        if liquidations_log:
            print("\nTop 5 largest:")
            for liq in sorted(liquidations_log, key=lambda x: x["value"], reverse=True)[:5]:
                print(f"  {liq['asset']}: ${liq['value']:,.2f}")


async def example_monitoring_loop():
    """Example of running monitor as part of larger application"""
    print("Example 4: Integrated monitoring loop")
    
    monitor = LiquidationsMonitor(threshold_usd=25000)
    
    # Load metadata
    await monitor.load_market_meta()
    await monitor.get_current_prices()
    
    print("\nMonitoring prices:")
    for asset, price in monitor.prices.items():
        print(f"  {asset}: ${price:,.2f}")
    
    # Run for limited time (10 minutes)
    print("\nStarting 10-minute monitoring session...")
    task = asyncio.create_task(monitor.subscribe_to_trades())
    
    try:
        await asyncio.wait_for(task, timeout=600)
    except asyncio.TimeoutError:
        print("\n10 minutes elapsed, stopping monitor...")
    finally:
        await monitor.close()


async def example_multiple_monitors():
    """Example of running multiple monitors simultaneously"""
    print("Example 5: Multiple monitors with different thresholds")
    
    # Create monitors with different thresholds
    monitor_high = LiquidationsMonitor(threshold_usd=100000)
    monitor_medium = LiquidationsMonitor(threshold_usd=50000)
    monitor_low = LiquidationsMonitor(threshold_usd=10000)
    
    # Custom display to differentiate them
    class LabeledMonitor(LiquidationsMonitor):
        def __init__(self, threshold_usd, label):
            super().__init__(threshold_usd)
            self.label = label
        
        def display_liquidation(self, trade, asset, usd_value):
            print(f"\n[{self.label}] ", end="")
            super().display_liquidation(trade, asset, usd_value)
    
    # Run all concurrently
    monitors = [
        LabeledMonitor(100000, "HIGH"),
        LabeledMonitor(50000, "MED"),
        LabeledMonitor(10000, "LOW"),
    ]
    
    tasks = [asyncio.create_task(m.run()) for m in monitors]
    
    try:
        await asyncio.gather(*tasks)
    except KeyboardInterrupt:
        print("\nStopping all monitors...")
        for m in monitors:
            await m.close()


def main():
    """Main function to run examples"""
    import sys
    
    examples = {
        "1": ("Basic usage", example_basic),
        "2": ("Custom threshold", example_custom_threshold),
        "3": ("With callback", example_with_callback),
        "4": ("Monitoring loop", example_monitoring_loop),
        "5": ("Multiple monitors", example_multiple_monitors),
    }
    
    if len(sys.argv) > 1:
        choice = sys.argv[1]
    else:
        print("Available examples:")
        for key, (desc, _) in examples.items():
            print(f"  {key}. {desc}")
        print("\nUsage: python3 example_usage.py [1-5]")
        print("Or just run: python3 example_usage.py 1")
        return
    
    if choice in examples:
        desc, func = examples[choice]
        print(f"Running: {desc}\n")
        try:
            asyncio.run(func())
        except KeyboardInterrupt:
            print("\n\nExample stopped by user")
    else:
        print(f"Invalid choice: {choice}")
        print("Choose 1-5")


if __name__ == "__main__":
    main()
