# PCM Lock-In (Finals Lock-In Upgraded)

An upgraded full-stack study system for a Class 11 Science student preparing for finals in 22 days.

## Updated Features
- **Adaptive Study Engine**
  - Weekly confidence score (1–10) per subject.
  - Dynamic study-block reallocation based on confidence.
  - Chemistry confidence `< 6` boosts Chemistry allocation by 20%.
  - Maths confidence `> 7` reduces Maths allocation slightly.
- **Smart Weak Topic System**
  - Tag weak chapters with mistake frequency.
  - Auto-generated **Revision Boost** sessions added to the planner.
  - Weak topics sorted by mistake count.
- **Mock Exam Mode**
  - Subject selection + timed countdown.
  - Save mock score history.
  - Trend graph for score progression.
- **Analytics Dashboard**
  - Total hours studied.
  - Hours per subject chart.
  - Completion rate + streak.
  - Weakest-subject indicator.
- **Focus Mode Upgrade**
  - 90-minute focus timer + auto 20-minute break.
  - Fullscreen mode.
  - Ambient sound toggle.
- **Reward System**
  - Gaming mode badge stays locked until daily blocks are complete.
  - Dynamic motivational messages including readiness estimate.
- **Persistence + Recovery**
  - Data persisted in SQLite.
  - Auto-save through API updates and local cache.
  - Export/restore progress JSON backup.

## Tech Stack
- Frontend: React + Tailwind + Vite + Recharts
- Backend: Node.js + Express
- Database: SQLite (`better-sqlite3`)
- Authentication: JWT local auth

## Folder Structure
```
.
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── package.json
│   └── vite/tailwind configs
├── server/
│   ├── index.js
│   └── package.json
├── .env.example
├── package.json
└── README.md
```

## New/Updated Dependencies
- `recharts` (frontend charts)
- Existing: `express`, `better-sqlite3`, `jsonwebtoken`, `bcryptjs`, `cors`, `dotenv`, `lucide-react`, `tailwindcss`, `vite`

## Setup Instructions
1. Install root + workspace dependencies:
   ```bash
   npm install
   npm install --prefix server
   npm install --prefix client
   ```
2. Create env file:
   ```bash
   cp .env.example .env
   ```
3. Start both apps:
   ```bash
   npm run dev
   ```
4. Access:
   - Frontend: `http://localhost:5173`
   - Backend: `http://localhost:4000`

## API Endpoints
- Auth
  - `POST /api/auth/register`
  - `POST /api/auth/login`
- Core data
  - `GET /api/app-data`
  - `PUT /api/plans/:day`
  - `PUT /api/blocks/:id`
- Adaptive + weak topics
  - `POST /api/confidence`
  - `POST /api/weak-topics`
- Mock exams
  - `POST /api/mock-exams`
- Backup
  - `GET /api/export`
  - `POST /api/restore`
