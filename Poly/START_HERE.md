# 🚀 START HERE - Polymarket Large Trades Monitor

Welcome! This is a monitoring system that tracks large trades and orders (>$3,000) on Polymarket prediction markets.

## ⚡ Quick Start (3 Steps)

### Step 1: Install Dependencies
```bash
cd Poly
npm install
```
*This takes about 10-15 seconds*

### Step 2: Test It
```bash
npm test
```
*This verifies everything works and shows you example output*

### Step 3: Start Monitoring
```bash
npm start
```
*Press Ctrl+C to stop*

**That's it!** 🎉

---

## 📖 What You'll See

### Large Order Alert
```
🎯 LARGE ORDERS FOUND ON MARKET
Market:   US recession in 2025?
Volume:   $10,918,352.82

Large Orders (3):
────────────────────────────────────────
1. 🔴 SELL No
   Size:  300005.05 shares
   Price: $0.9980
   Value: $299,405.04
```

**Meaning:**
- 🟢 = Someone wants to BUY
- 🔴 = Someone wants to SELL
- Value = Total amount of the order

### Volume Spike Alert
```
📊 LARGE VOLUME INCREASE | $45,250.00
Market:        Trump wins 2024 election?
Volume Added:  $45,250.00
Time Period:   87s
```

**Meaning:** The market saw $45k in new trading volume in 87 seconds

---

## ⚙️ Customization

### Want BIGGER orders only? ($10,000+)
```bash
./run.sh 10000
```

### Want MORE alerts? ($1,000+)
```bash
./run.sh 1000
```

### Want to change the check interval?
Edit `.env` file:
```
POLL_INTERVAL=10000    # Check every 10 seconds
```

---

## 📚 Documentation

| File | Description | When to Read |
|------|-------------|--------------|
| **START_HERE.md** | This file | Read first! |
| **QUICKSTART.md** | Quick start guide | Getting started |
| **README.md** | Full documentation | Want all details |
| **README_RU.md** | Russian version | Для русскоязычных |
| **EXAMPLES.md** | Usage examples | Want ideas |
| **PROJECT_SUMMARY.md** | Technical details | For developers |

---

## 🆘 Troubleshooting

### "npm: command not found"
→ Install Node.js from https://nodejs.org/

### "No large orders found"
→ Try lower threshold: `./run.sh 1000`  
→ Markets might be quiet right now

### "Error fetching markets"
→ Check your internet connection  
→ No API keys needed!

---

## 💡 Pro Tips

1. **First time?** Run `npm test` to see what it does
2. **Want less spam?** Use higher threshold: `./run.sh 10000`
3. **Want more action?** Use lower threshold: `./run.sh 1000`
4. **Run in background?** Use `screen` or `nohup`
5. **Stop it?** Press `Ctrl+C`

---

## 🎯 Common Use Cases

### Whale Watching
Monitor only massive orders:
```bash
MIN_TRADE_SIZE=50000 npm start
```

### Active Trading
Catch medium-large orders:
```bash
./run.sh 2000
```

### Research
Log everything for later analysis:
```bash
npm start > trades.log 2>&1 &
```

---

## 🤔 FAQ

**Q: Do I need API keys?**  
A: No! Works out of the box.

**Q: Is this real-time?**  
A: Nearly. Updates every 5 seconds.

**Q: What markets are monitored?**  
A: Top 30 by trading volume, automatically.

**Q: Can I monitor specific markets?**  
A: Not in this version, but you can modify the code.

**Q: Is my data private?**  
A: Yes. No tracking, no data collection.

**Q: Can I run this 24/7?**  
A: Yes! It's designed for continuous operation.

---

## 📊 System Requirements

- **Node.js**: 18 or higher
- **RAM**: 100 MB
- **Network**: Internet connection
- **Storage**: 50 MB

---

## 🚦 Next Steps

1. ✅ You're here (START_HERE.md)
2. ⏭️ Run `npm install`
3. ⏭️ Run `npm test`
4. ⏭️ Run `npm start`
5. 🎉 You're monitoring!

For more details, see [QUICKSTART.md](QUICKSTART.md)

---

## 🎊 Ready?

```bash
cd Poly
npm install
npm test
npm start
```

**Happy monitoring!** 🎯📊

---

**Questions?** Read [README.md](README.md) or [EXAMPLES.md](EXAMPLES.md)  
**Russian?** See [README_RU.md](README_RU.md)  
**Technical?** Check [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
