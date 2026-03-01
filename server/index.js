import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const EXAM_DATE = process.env.EXAM_DATE || new Date(Date.now() + 22 * 24 * 60 * 60 * 1000).toISOString();
const TOTAL_DAYS = 22;

const db = new Database('finals_lockin.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT UNIQUE,
  password TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  day INTEGER,
  subject TEXT,
  topic TEXT,
  notes TEXT,
  weakTag TEXT DEFAULT '',
  sessionType TEXT DEFAULT 'study',
  UNIQUE(userId, day, sessionType)
);

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  day INTEGER,
  blockNumber INTEGER,
  title TEXT,
  subject TEXT,
  completed INTEGER DEFAULT 0,
  durationMinutes INTEGER DEFAULT 90,
  UNIQUE(userId, day, blockNumber)
);

CREATE TABLE IF NOT EXISTS confidence_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  subject TEXT,
  score INTEGER,
  weekIndex INTEGER,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(userId, subject, weekIndex)
);

CREATE TABLE IF NOT EXISTS weak_topic_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  subject TEXT,
  chapter TEXT,
  mistakeCount INTEGER DEFAULT 1,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(userId, subject, chapter)
);

CREATE TABLE IF NOT EXISTS mock_exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  subject TEXT,
  score INTEGER,
  totalMarks INTEGER,
  durationMinutes INTEGER,
  attemptedAt TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const defaultSubjects = ['Physics', 'Chemistry', 'Maths', 'Hindi', 'Geography', 'Computer Science'];

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Token missing' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};


const latestConfidenceMap = (userId) => {
  const rows = db.prepare(`
    SELECT c.subject, c.score
    FROM confidence_updates c
    INNER JOIN (
      SELECT subject, MAX(weekIndex) AS maxWeek
      FROM confidence_updates
      WHERE userId = ?
      GROUP BY subject
    ) latest ON latest.subject = c.subject AND latest.maxWeek = c.weekIndex
    WHERE c.userId = ?
  `).all(userId, userId);

  return defaultSubjects.reduce((acc, subject) => {
    const found = rows.find((r) => r.subject === subject);
    acc[subject] = found?.score ?? 6;
    return acc;
  }, {});
};

const adaptiveWeightsFromConfidence = (confidence) => {
  const baseline = Object.fromEntries(defaultSubjects.map((s) => [s, 1]));
  Object.entries(confidence).forEach(([subject, score]) => {
    baseline[subject] += Math.max(0, (7 - score) * 0.12);
  });

  if ((confidence.Chemistry ?? 6) < 6) baseline.Chemistry *= 1.2;
  if ((confidence.Maths ?? 6) > 7) baseline.Maths *= 0.9;

  const totalWeight = Object.values(baseline).reduce((a, b) => a + b, 0);
  return Object.fromEntries(
    Object.entries(baseline).map(([subject, weight]) => [subject, weight / totalWeight]),
  );
};

const ensureDefaultData = (userId) => {
  const planCount = db.prepare('SELECT COUNT(*) as count FROM plans WHERE userId = ?').get(userId).count;
  if (planCount > 0) return;

  const insertPlan = db.prepare('INSERT INTO plans (userId, day, subject, topic, notes, weakTag, sessionType) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertBlock = db.prepare('INSERT INTO blocks (userId, day, blockNumber, title, subject, completed, durationMinutes) VALUES (?, ?, ?, ?, ?, 0, ?)');

  for (let day = 1; day <= TOTAL_DAYS; day += 1) {
    const subject = defaultSubjects[(day - 1) % defaultSubjects.length];
    insertPlan.run(userId, day, subject, `${subject} Core Chapter ${((day - 1) % 6) + 1}`, 'Auto-generated lock-in schedule', '', 'study');
    for (let block = 1; block <= 4; block += 1) {
      insertBlock.run(userId, day, block, `${subject} Block ${block}`, subject, 90);
    }
  }

  const insertConfidence = db.prepare('INSERT INTO confidence_updates (userId, subject, score, weekIndex) VALUES (?, ?, ?, ?)');
  defaultSubjects.forEach((subject) => insertConfidence.run(userId, subject, 6, 1));
};

const recalculateAdaptivePlan = (userId) => {
  const confidence = latestConfidenceMap(userId);
  const weights = adaptiveWeightsFromConfidence(confidence);
  const blockPool = TOTAL_DAYS * 4;

  const subjectBlockTargets = Object.fromEntries(defaultSubjects.map((subject) => [subject, Math.round(weights[subject] * blockPool)]));
  const totalAllocated = Object.values(subjectBlockTargets).reduce((a, b) => a + b, 0);
  if (totalAllocated !== blockPool) {
    subjectBlockTargets.Chemistry += blockPool - totalAllocated;
  }

  const flattened = [];
  defaultSubjects.forEach((subject) => {
    for (let i = 0; i < Math.max(0, subjectBlockTargets[subject]); i += 1) flattened.push(subject);
  });

  const updatePlan = db.prepare('UPDATE plans SET subject = ?, topic = ?, notes = ? WHERE userId = ? AND day = ? AND sessionType = ?');
  const updateBlock = db.prepare('UPDATE blocks SET subject = ?, title = ? WHERE userId = ? AND day = ? AND blockNumber = ?');

  for (let day = 1; day <= TOTAL_DAYS; day += 1) {
    const daySlice = flattened.slice((day - 1) * 4, day * 4);
    const dominant = daySlice[0] || defaultSubjects[(day - 1) % defaultSubjects.length];
    updatePlan.run(dominant, `${dominant} Adaptive Revision Day ${day}`, 'Confidence-adaptive plan', userId, day, 'study');

    for (let block = 1; block <= 4; block += 1) {
      const blockSubject = daySlice[block - 1] || dominant;
      updateBlock.run(blockSubject, `${blockSubject} Adaptive Block ${block}`, userId, day, block);
    }
  }
};

const applyRevisionBoosts = (userId) => {
  const weakRows = db.prepare('SELECT subject, chapter, mistakeCount FROM weak_topic_logs WHERE userId = ? ORDER BY mistakeCount DESC').all(userId);
  if (!weakRows.length) return;

  db.prepare('DELETE FROM plans WHERE userId = ? AND sessionType = ?').run(userId, 'revision_boost');
  const insertBoost = db.prepare('INSERT INTO plans (userId, day, subject, topic, notes, weakTag, sessionType) VALUES (?, ?, ?, ?, ?, ?, ?)');

  weakRows.slice(0, 10).forEach((row, idx) => {
    const day = ((idx * 2) % TOTAL_DAYS) + 1;
    insertBoost.run(userId, day, row.subject, `Revision Boost: ${row.chapter}`, 'Auto-generated from weak-topic mistakes', row.chapter, 'revision_boost');
  });
};

const getAnalytics = (userId) => {
  const blocks = db.prepare('SELECT * FROM blocks WHERE userId = ? ORDER BY day, blockNumber').all(userId);
  const plans = db.prepare('SELECT * FROM plans WHERE userId = ? ORDER BY day').all(userId);
  const weakRows = db.prepare('SELECT * FROM weak_topic_logs WHERE userId = ? ORDER BY mistakeCount DESC').all(userId);
  const mocks = db.prepare('SELECT * FROM mock_exams WHERE userId = ? ORDER BY attemptedAt').all(userId);
  const confidence = latestConfidenceMap(userId);

  const done = blocks.filter((b) => b.completed === 1).length;
  const total = blocks.length || 1;

  const hoursPerSubject = defaultSubjects.reduce((acc, subject) => {
    const subjectDone = blocks.filter((b) => b.completed === 1 && b.subject === subject);
    const mins = subjectDone.reduce((sum, row) => sum + (row.durationMinutes || 90), 0);
    acc[subject] = Number((mins / 60).toFixed(1));
    return acc;
  }, {});

  const daily = Array.from({ length: TOTAL_DAYS }, (_, i) => {
    const day = i + 1;
    const forDay = blocks.filter((b) => b.day === day);
    const completed = forDay.filter((b) => b.completed === 1).length;
    return { day, percentage: Math.round((completed / (forDay.length || 1)) * 100) };
  });

  let streak = 0;
  for (let day = TOTAL_DAYS; day >= 1; day -= 1) {
    if (daily[day - 1].percentage >= 75) streak += 1;
    else break;
  }

  const weakestSubject = Object.entries(confidence).sort((a, b) => a[1] - b[1])[0]?.[0] || 'Physics';
  const readiness = Math.min(100, Math.round((done / total) * 70 + ((TOTAL_DAYS - Math.max(0, Math.ceil((new Date(EXAM_DATE).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))) / TOTAL_DAYS) * 30));

  const motivationalMessages = [
    confidence.Chemistry < 6 ? 'Chemistry focus boosted by 20% this week.' : 'Chemistry confidence is stabilizing nicely.',
    `You are ${readiness}% exam-ready. Keep compounding daily wins.`,
  ];

  const weakTopicsSorted = weakRows.map((row) => ({
    subject: row.subject,
    chapter: row.chapter,
    mistakes: row.mistakeCount,
  }));

  const mockTrend = mocks.map((m, idx) => ({
    index: idx + 1,
    subject: m.subject,
    score: m.score,
    totalMarks: m.totalMarks,
    attemptedAt: m.attemptedAt,
  }));

  const revisions = weakRows.slice(0, 3).map((row) => `Revision Boost: ${row.subject} - ${row.chapter}`);

  return {
    completion: Math.round((done / total) * 100),
    totalHours: Number((Object.values(hoursPerSubject).reduce((a, b) => a + b, 0)).toFixed(1)),
    hoursPerSubject,
    streak,
    weakestSubject,
    readiness,
    daily,
    recommendations: revisions.length ? revisions : ['Tag weak chapters to generate Revision Boost sessions'],
    weakTopicsSorted,
    confidence,
    motivationalMessages,
    mockTrend,
    totalSubjects: defaultSubjects.length,
    totalPlans: plans.length,
  };
};

app.get('/api/health', (_, res) => res.json({ status: 'ok', examDate: EXAM_DATE }));

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'email and password required' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(400).json({ message: 'User exists' });

  const hashed = await bcrypt.hash(password, 10);
  const info = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)').run(name || 'Student', email, hashed);
  ensureDefaultData(info.lastInsertRowid);
  const token = jwt.sign({ userId: info.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: info.lastInsertRowid, name: name || 'Student', email } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

  ensureDefaultData(user.id);
  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/app-data', auth, (req, res) => {
  ensureDefaultData(req.user.userId);
  applyRevisionBoosts(req.user.userId);

  const plans = db.prepare('SELECT * FROM plans WHERE userId = ? ORDER BY day, sessionType').all(req.user.userId);
  const blocks = db.prepare('SELECT * FROM blocks WHERE userId = ? ORDER BY day, blockNumber').all(req.user.userId);
  const confidenceHistory = db.prepare('SELECT * FROM confidence_updates WHERE userId = ? ORDER BY weekIndex').all(req.user.userId);
  const mocks = db.prepare('SELECT * FROM mock_exams WHERE userId = ? ORDER BY attemptedAt DESC').all(req.user.userId);
  const analytics = getAnalytics(req.user.userId);

  res.json({ plans, blocks, analytics, confidenceHistory, mocks, examDate: EXAM_DATE, subjects: defaultSubjects });
});

app.put('/api/plans/:day', auth, (req, res) => {
  const day = Number(req.params.day);
  const { subject, topic, notes, weakTag, sessionType = 'study' } = req.body;

  db.prepare(`
    UPDATE plans
    SET subject = ?, topic = ?, notes = ?, weakTag = ?
    WHERE userId = ? AND day = ? AND sessionType = ?
  `).run(subject, topic, notes, weakTag || '', req.user.userId, day, sessionType);

  const plan = db.prepare('SELECT * FROM plans WHERE userId = ? AND day = ? AND sessionType = ?').get(req.user.userId, day, sessionType);
  res.json(plan);
});

app.put('/api/blocks/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const { completed } = req.body;
  db.prepare('UPDATE blocks SET completed = ? WHERE id = ? AND userId = ?').run(completed ? 1 : 0, id, req.user.userId);
  const block = db.prepare('SELECT * FROM blocks WHERE id = ? AND userId = ?').get(id, req.user.userId);
  res.json(block);
});

app.post('/api/confidence', auth, (req, res) => {
  const { subject, score, weekIndex } = req.body;
  if (!subject || Number(score) < 1 || Number(score) > 10) return res.status(400).json({ message: 'Invalid confidence input' });

  db.prepare(`
    INSERT INTO confidence_updates (userId, subject, score, weekIndex)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(userId, subject, weekIndex) DO UPDATE SET score = excluded.score, updatedAt = CURRENT_TIMESTAMP
  `).run(req.user.userId, subject, Number(score), Number(weekIndex) || 1);

  recalculateAdaptivePlan(req.user.userId);
  const analytics = getAnalytics(req.user.userId);
  res.json({ message: 'Confidence updated', confidence: analytics.confidence });
});

app.post('/api/weak-topics', auth, (req, res) => {
  const { subject, chapter, mistakes = 1 } = req.body;
  if (!subject || !chapter) return res.status(400).json({ message: 'subject and chapter required' });

  db.prepare(`
    INSERT INTO weak_topic_logs (userId, subject, chapter, mistakeCount)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(userId, subject, chapter)
    DO UPDATE SET mistakeCount = weak_topic_logs.mistakeCount + excluded.mistakeCount, updatedAt = CURRENT_TIMESTAMP
  `).run(req.user.userId, subject, chapter, Number(mistakes) || 1);

  applyRevisionBoosts(req.user.userId);
  const weak = db.prepare('SELECT * FROM weak_topic_logs WHERE userId = ? ORDER BY mistakeCount DESC').all(req.user.userId);
  res.json(weak);
});

app.post('/api/mock-exams', auth, (req, res) => {
  const { subject, score, totalMarks = 100, durationMinutes = 180 } = req.body;
  if (!subject || Number(score) < 0) return res.status(400).json({ message: 'Invalid mock data' });

  db.prepare('INSERT INTO mock_exams (userId, subject, score, totalMarks, durationMinutes) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.userId, subject, Number(score), Number(totalMarks), Number(durationMinutes));

  const rows = db.prepare('SELECT * FROM mock_exams WHERE userId = ? ORDER BY attemptedAt DESC').all(req.user.userId);
  res.json(rows);
});

app.get('/api/export', auth, (req, res) => {
  const payload = {
    exportedAt: new Date().toISOString(),
    plans: db.prepare('SELECT * FROM plans WHERE userId = ?').all(req.user.userId),
    blocks: db.prepare('SELECT * FROM blocks WHERE userId = ?').all(req.user.userId),
    confidence_updates: db.prepare('SELECT * FROM confidence_updates WHERE userId = ?').all(req.user.userId),
    weak_topic_logs: db.prepare('SELECT * FROM weak_topic_logs WHERE userId = ?').all(req.user.userId),
    mock_exams: db.prepare('SELECT * FROM mock_exams WHERE userId = ?').all(req.user.userId),
  };

  res.json(payload);
});

app.post('/api/restore', auth, (req, res) => {
  const backup = req.body;
  if (!backup?.plans || !backup?.blocks) return res.status(400).json({ message: 'Invalid backup payload' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM plans WHERE userId = ?').run(req.user.userId);
    db.prepare('DELETE FROM blocks WHERE userId = ?').run(req.user.userId);
    db.prepare('DELETE FROM confidence_updates WHERE userId = ?').run(req.user.userId);
    db.prepare('DELETE FROM weak_topic_logs WHERE userId = ?').run(req.user.userId);
    db.prepare('DELETE FROM mock_exams WHERE userId = ?').run(req.user.userId);

    const pStmt = db.prepare('INSERT INTO plans (userId, day, subject, topic, notes, weakTag, sessionType) VALUES (?, ?, ?, ?, ?, ?, ?)');
    backup.plans.forEach((p) => pStmt.run(req.user.userId, p.day, p.subject, p.topic, p.notes || '', p.weakTag || '', p.sessionType || 'study'));

    const bStmt = db.prepare('INSERT INTO blocks (userId, day, blockNumber, title, subject, completed, durationMinutes) VALUES (?, ?, ?, ?, ?, ?, ?)');
    backup.blocks.forEach((b) => bStmt.run(req.user.userId, b.day, b.blockNumber, b.title, b.subject || 'Physics', b.completed ? 1 : 0, b.durationMinutes || 90));

    const cStmt = db.prepare('INSERT INTO confidence_updates (userId, subject, score, weekIndex) VALUES (?, ?, ?, ?)');
    (backup.confidence_updates || []).forEach((c) => cStmt.run(req.user.userId, c.subject, c.score, c.weekIndex));

    const wStmt = db.prepare('INSERT INTO weak_topic_logs (userId, subject, chapter, mistakeCount) VALUES (?, ?, ?, ?)');
    (backup.weak_topic_logs || []).forEach((w) => wStmt.run(req.user.userId, w.subject, w.chapter, w.mistakeCount || 1));

    const mStmt = db.prepare('INSERT INTO mock_exams (userId, subject, score, totalMarks, durationMinutes) VALUES (?, ?, ?, ?, ?)');
    (backup.mock_exams || []).forEach((m) => mStmt.run(req.user.userId, m.subject, m.score, m.totalMarks || 100, m.durationMinutes || 180));
  });

  tx();
  res.json({ message: 'Backup restored successfully' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Finals Lock-In server running on port ${PORT}`);
});
