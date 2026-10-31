# GharKhata – Personal Finance OS for Families

> **Tagline:** *"Your Family. Your Money. One Khata."*

GharKhata is a modern, responsive, minimal, and professional family financial operating system designed specifically for two family members—**Dad (Income Manager)** and **Mom (Expense Manager)**. They are securely paired under a single unique **Household ID** to manage family finances with instant real-time synchronization across all devices.

---

## 1. Technology Stack

- **Structure:** HTML5 Semantic Markup
- **Styling:** CSS3 Design System (Emerald Green `#065f46`, Cream `#fbf9f5`, White `#ffffff`, with persistent Dark Mode)
- **Application Logic:** Pure Vanilla JavaScript (Modular, clean, zero frontend frameworks)
- **Primary Persistent Database:** SQLite (`gharKhata.db` with WAL mode and foreign keys) via Node.js native `node:sqlite`
- **Real-Time Synchronization:** Firebase Firestore (`onSnapshot`) + fallback Server-Sent Events (SSE) stream
- **Progressive Web App (PWA):** `manifest.json`, `sw.js`, offline application shell, touch optimization
- **Minimal Backend API:** Built-in HTTP REST server with PBKDF2/scrypt password hashing and HMAC-signed session tokens

---

## 2. Core Architecture & Household Pairing

```
                               Household ID (e.g. GHK-82M9-XP41)
                                      /                 \
                                     /                   \
                   Dad (Income Manager)                 Mom (Expense Manager)
                   • Adds & manages Income              • Adds & manages Expenses
                   • Views all expenses                 • Views all income
                   • Inquires on expenses (Remarks)     • Uploads bill receipts
                   • WhatsApp click-to-chat             • Replies & resolves remarks
                                     \                   /
                                      \                 /
                                SQLite Persistent Ledger
                               (Real-Time Cloud Sync)
```

### Household Rules
1. **First Member Registration:** Automatically generates a unique 12-character Household ID (e.g. `GHK-82M9-XP41`).
2. **Second Member Pairing:** Enters the Household ID and selects the complementary role.
3. **Strict Limits:** Exactly **one Dad** and **one Mom** per household. Duplicate roles are rejected both on the backend and via database constraints (`UNIQUE(household_id, role)`).
4. **Single Ledger:** Both accounts share the exact same financial records, budget, and analytics.

---

## 3. Server-Enforced Permissions

| Feature / Action | Dad (Income Manager) | Mom (Expense Manager) |
|---|:---:|:---:|
| **Add / Edit / Delete Income** |  Full Access |  Read-Only |
| **Add / Edit / Delete Expenses** |  Read-Only |  Full Access |
| **Attach Receipt / Bill Photos** |  View & Download |  Upload & Remove |
| **Expense Remarks & Discussions** |  Ask Questions |  Reply & Resolve |
| **WhatsApp Partner Integration** |  Inquire with Details |  Reply with Details |
| **Budget & Analytics Reports** |  Full Visibility |  Full Visibility |
| **CSV & PDF Export** |  Yes |  Yes |

*All permissions are verified server-side on backend API endpoints—not just controlled via frontend UI visibility.*

---

## 4. Key Features

- **Daily Khata Timeline:** Combined, unified chronological feed of household incomes and expenses.
- **Receipt & Bill Attachments:** Camera or file upload for invoices, store receipts, and payment proofs.
- **Expense Remarks & Discussions:** Comment thread attached to each transaction with unresolved/resolved states.
- **WhatsApp Click-to-Chat:** Direct click-to-chat links pre-filled with transaction amount, category, date, and description.
- **Proactive Budget Alerts:** Spending thresholds at **70%**, **90%**, and **100%** of monthly household budget.
- **Visual Analytics (Chart.js):**
  - Donut chart of category-wise expenses.
  - Grouped bar chart comparing 6-month income vs expenses.
  - Distribution of payment modes (UPI, Cash, Bank).
- **Personal OS Experience:** Central Notification Center, Dark/Light mode toggle, offline queueing with auto-sync on reconnection.
- **Installable PWA:** Works on Android, iOS, Windows, macOS, and Linux as a standalone web app.

---

## 5. Folder Structure

```
GharKhata/
│
├── index.html                    # Welcome landing page & overview
├── login.html                    # Account authentication
├── register.html                 # Registration & Household pairing
├── dashboard.html                # Main financial overview & KPI cards
├── income.html                   # Income management (Dad)
├── expenses.html                 # Expense management & receipts (Mom)
├── transactions.html             # Daily Khata transaction timeline
├── analytics.html                # Visual charts & financial insights
├── discussions.html              # Remarks & conversation history
├── reports.html                  # Monthly statements & audit trail
├── profile.html                  # User account & partner info
├── settings.html                 # Monthly budget & custom categories
│
├── css/
│   ├── style.css                 # Design tokens, variables & typography
│   ├── auth.css                  # Login, registration & pairing styles
│   ├── dashboard.css             # Stats grid, budget meter & widgets
│   ├── components.css            # Cards, modals, toasts & discussions
│   └── responsive.css            # Desktop sidebar & mobile navigation
│
├── js/
│   ├── app.js                    # Shell manager, navigation & PWA init
│   ├── auth.js                   # Client auth & session persistence
│   ├── firebase.js               # Firestore real-time synchronization
│   ├── database.js               # REST client & offline queue manager
│   ├── sync.js                   # Unified sync controller (Firestore + SSE)
│   ├── income.js                 # Income CRUD & Dad permissions
│   ├── expenses.js               # Expense CRUD & receipt uploads
│   ├── analytics.js              # Chart.js visualization logic
│   ├── discussions.js            # Transaction remarks thread
│   ├── notifications.js          # Central toast & alert drawer
│   ├── whatsapp.js               # WhatsApp pre-filled chat generator
│   └── theme.js                  # Light / Dark mode toggle
│
├── backend/
│   ├── server.js                 # Main server & static file host
│   ├── miniExpress.js            # Zero-dependency HTTP router
│   ├── database.js               # Native SQLite database schema
│   ├── auth.js                   # scrypt password hashing & tokens
│   ├── syncBroadcaster.js        # Server-Sent Events broadcaster
│   ├── routes/
│   │   ├── authRoutes.js         # Register, login, me, change password
│   │   ├── incomeRoutes.js       # Income CRUD (Dad enforced)
│   │   ├── expenseRoutes.js      # Expense CRUD & receipts (Mom enforced)
│   │   ├── discussionRoutes.js   # Remarks & status toggle
│   │   ├── categoryRoutes.js     # Default & custom categories
│   │   ├── reportRoutes.js       # Aggregations, analytics & CSV export
│   │   ├── householdRoutes.js    # Budget limits, partner & backup
│   │   └── notificationRoutes.js # Central alert center
│   └── middleware/
│       ├── authMiddleware.js     # Role verification & token checking
│       └── uploadMiddleware.js   # Receipt storage & size validation
│
├── database/
│   └── gharKhata.db              # SQLite persistent database file
│
├── uploads/
│   └── receipts/                 # Saved receipt images & PDFs
│
├── assets/
│   └── icons/                    # PWA icons (192px, 512px, SVG)
│
├── manifest.json                 # PWA manifest
├── sw.js                         # PWA Service Worker (offline cache)
├── firebase-config.example.js    # Firebase Firestore template
├── .env.example                  # Environment variables template
├── .gitignore                    # Git ignore file
└── README.md                     # Documentation & setup guide
```

---

## 6. Getting Started & Installation

### Prerequisites
- Node.js 18+ (tested on Node.js 22 & 24).
- Zero external package installation required out-of-the-box! The backend utilizes Node.js built-ins (`node:sqlite`, `node:crypto`, `node:http`, `node:fs`).

### 1. Launch GharKhata
From the `GharKhata` directory, start the server:

```bash
node backend/server.js
```

Or run via npm:
```bash
npm start
```

Open your browser and navigate to:
```
http://localhost:3000
```

---

## 7. Firebase Firestore Real-Time Sync Configuration (Optional)

GharKhata works out of the box with built-in real-time synchronization. To additionally enable multi-network cloud sync across remote devices using Firebase Firestore:

1. Open the [Firebase Console](https://console.firebase.google.com/) and create a project.
2. In the Firebase console, create a **Cloud Firestore** database in test or production mode.
3. Copy your Web App configuration keys into `firebase-config.js` (or edit `firebase-config.example.js`):

```javascript
window.GHAR_KHATA_FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef..."
};
```

*Note: GharKhata uses Firebase **solely for real-time synchronization**; SQLite remains the secure primary persistent database on your backend.*

---

## 8. Progressive Web App (PWA) Installation

- **On Android (Chrome / Edge / Brave):** Open `http://localhost:3000` (or your deployed URL), tap the browser menu (⋮), and tap **"Install App"** or **"Add to Home screen"**.
- **On iOS (Safari):** Open the site, tap the Share icon (↑), and select **"Add to Home Screen"**.
- **On Desktop (Chrome / Edge):** Click the install badge in the browser address bar.

---

## 9. Security & Production Checklist

1. **Environment Variables:** Copy `.env.example` to `.env` and set a strong `JWT_SECRET`.
2. **Reverse Proxy:** Deploy behind Nginx or Caddy with HTTPS enabled.
3. **Receipt Storage:** Ensure `uploads/receipts/` directory has appropriate write permissions.
4. **Database Backups:** Use the built-in backup endpoint at `/api/household/backup` or standard SQLite `.backup` commands.

