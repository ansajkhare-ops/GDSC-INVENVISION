# InvenVision 🚀
**AI-Powered Inventory Demand Predictor for Small Businesses**

> *"Predict what to stock, before you run out."*

---

## 🎯 Problem We Solve
Small shopkeepers lose money daily from:
- ❌ **Stockouts** — losing sales because shelves are empty
- ❌ **Overstock** — wasting money on dead inventory
- ❌ **Expiry losses** — products expiring before being sold

**InvenVision solves all three with AI.**

---

## ⚡ Why InvenVision Beats Excel & Traditional Tools

| Feature | Excel | Udaan | InvenVision ✅ |
|---|---|---|---|
| Demand Forecasting | Manual formulas | ❌ | ✅ AI-powered |
| Auto Reorder Alerts | ❌ | ❌ | ✅ Real-time |
| Expiry Tracking | Manual | ❌ | ✅ Auto alerts |
| Dead Stock Detection | ❌ | ❌ | ✅ Built-in |
| Needs technical knowledge | Yes | No | ✅ Zero setup |
| Works for small shops | Complex | ❌ | ✅ Designed for it |

> **Udaan** is a B2B marketplace (where to buy). **InvenVision** is inventory intelligence (what & when to buy). They are complementary, not competitors.

---

## 🧠 Key Features

### 📊 Smart Command Center
A real-time decision dashboard showing:
- Active stock alerts
- Expiring products
- Dead stock warnings
- AI-generated action plan for today

### 💬 Today's AI Suggestions
The system proactively tells you:
- *"Reorder Rice NOW — only 2 days of stock left"*
- *"Milk expires in 3 days — run a discount"*
- *"Chips are overstocked — 4 months of supply on hand"*

### 🔮 4 Forecasting Models
- Simple Moving Average (stable demand)
- Exponential Moving Average (trend-sensitive)
- Holt's Double Exponential (growing/falling trends)
- Linear Regression (strong directional trends)
- **Auto mode** — AI picks the best model for your data

### ⏰ Expiry + Loss Prevention
- Track expiry dates for perishable goods
- Auto-alert 7 days before expiry
- Identify dead stock before it becomes a loss

### 📦 Inventory Dashboard
- Per-item stock health (Healthy / Low / Critical)
- Days remaining until stockout
- 30-day demand forecast per item
- Multi-item comparison charts

### 📥 Data Import/Export
- Upload historical sales from CSV
- Export forecasts as CSV or PDF report
- Drag & drop file upload

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JS, Chart.js |
| Backend | Python 3.14, Flask 3.x |
| Database | MySQL 8.0 |
| Auth | Google OAuth 2.0 (Authlib) |
| ML Models | Custom Python (SMA, EMA, Holt's, Linear Reg) |

---

## 🚀 Run Locally

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/invenvision.git
cd invenvision

# 2. Install dependencies
py -m pip install -r requirements.txt

# 3. Set up environment
copy .env.example .env
# Fill in your Google OAuth credentials and MySQL password in .env

# 4. Set up MySQL database
mysql -u root -p < schema.sql

# 5. Start the server
py server.py

# 6. Open http://127.0.0.1:5000
```

---

## 🌐 Future Roadmap
- 📱 Mobile app (React Native)
- 🔌 Offline-first PWA mode
- 🤖 WhatsApp alert integration
- 🏪 Multi-store support
- 📊 Supplier integration API

> *"Currently a web platform — architected to scale to mobile and offline-first systems."*

---

## 💰 Business Model
| Tier | Price | Features |
|---|---|---|
| Free | ₹0 | 5 items, basic forecasting |
| Pro | ₹199/mo | Unlimited items, all models, PDF reports |
| Business | ₹499/mo | Multi-user, API access, priority support |

---

## 👥 Team
Built for hackathon — making AI affordable for India's 60 million small businesses.
