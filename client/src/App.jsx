import { useEffect, useMemo, useState } from 'react';
import { Timer, Trophy, Flame, Lock, Unlock, MoonStar, Download, Upload } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line, CartesianGrid } from 'recharts';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const subjectsDefault = ['Physics', 'Chemistry', 'Maths', 'Hindi', 'Geography', 'Computer Science'];

const Card = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-slate-950/50 transition-all duration-300 hover:border-slate-700 ${className}`}>{children}</div>
);

const mmss = (seconds) => new Date(seconds * 1000).toISOString().slice(14, 19);

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [mode, setMode] = useState('login');
  const [data, setData] = useState(JSON.parse(localStorage.getItem('finals-data') || 'null'));

  const [focusSeconds, setFocusSeconds] = useState(90 * 60);
  const [breakSeconds, setBreakSeconds] = useState(20 * 60);
  const [isFocusSession, setIsFocusSession] = useState(true);
  const [running, setRunning] = useState(false);
  const [whiteNoise, setWhiteNoise] = useState(false);

  const [weekIndex, setWeekIndex] = useState(1);
  const [confidenceDraft, setConfidenceDraft] = useState({});
  const [weakDraft, setWeakDraft] = useState({ subject: 'Physics', chapter: '', mistakes: 1 });

  const [mockMode, setMockMode] = useState({ subject: 'Physics', durationMinutes: 180, running: false, secondsLeft: 180 * 60, score: '' });

  const refreshData = async (activeToken = token) => {
    const res = await fetch(`${API}/app-data`, { headers: { Authorization: `Bearer ${activeToken}` } });
    if (res.ok) {
      const payload = await res.json();
      setData(payload);
      setConfidenceDraft(payload.analytics?.confidence || {});
      localStorage.setItem('finals-data', JSON.stringify(payload));
    }
  };

  useEffect(() => {
    if (token) refreshData();
  }, [token]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      if (isFocusSession) {
        setFocusSeconds((prev) => {
          if (prev <= 1) {
            setIsFocusSession(false);
            setRunning(false);
            return 90 * 60;
          }
          return prev - 1;
        });
      } else {
        setBreakSeconds((prev) => {
          if (prev <= 1) {
            setIsFocusSession(true);
            setRunning(false);
            return 20 * 60;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [running, isFocusSession]);

  useEffect(() => {
    if (!mockMode.running) return undefined;
    const t = setInterval(() => {
      setMockMode((prev) => {
        if (prev.secondsLeft <= 1) return { ...prev, running: false, secondsLeft: 0 };
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [mockMode.running]);

  const authUser = async () => {
    const endpoint = mode === 'login' ? 'login' : 'register';
    const res = await fetch(`${API}/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) return alert('Authentication failed');
    const payload = await res.json();
    localStorage.setItem('token', payload.token);
    setToken(payload.token);
  };

  const updatePlan = async (day, patch, sessionType = 'study') => {
    await fetch(`${API}/plans/${day}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...patch, sessionType }),
    });
    refreshData();
  };

  const toggleBlock = async (id, completed) => {
    await fetch(`${API}/blocks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ completed: !completed }),
    });
    refreshData();
  };

  const saveConfidence = async (subject) => {
    await fetch(`${API}/confidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subject, score: Number(confidenceDraft[subject] || 6), weekIndex }),
    });
    refreshData();
  };

  const addWeakTopic = async () => {
    await fetch(`${API}/weak-topics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(weakDraft),
    });
    setWeakDraft({ ...weakDraft, chapter: '', mistakes: 1 });
    refreshData();
  };

  const submitMock = async () => {
    await fetch(`${API}/mock-exams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        subject: mockMode.subject,
        durationMinutes: mockMode.durationMinutes,
        score: Number(mockMode.score || 0),
        totalMarks: 100,
      }),
    });
    setMockMode((prev) => ({ ...prev, running: false, score: '', secondsLeft: prev.durationMinutes * 60 }));
    refreshData();
  };

  const exportBackup = async () => {
    const res = await fetch(`${API}/export`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const payload = await res.json();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finals-lockin-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const restoreBackup = async (file) => {
    const text = await file.text();
    await fetch(`${API}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: text,
    });
    refreshData();
  };

  const daysRemaining = useMemo(() => {
    if (!data?.examDate) return 22;
    const diff = new Date(data.examDate).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [data?.examDate]);

  const today = 22 - daysRemaining + 1;
  const todayBlocks = (data?.blocks || []).filter((b) => b.day === today);
  const todayDone = todayBlocks.filter((b) => b.completed).length;
  const rewardUnlocked = todayBlocks.length > 0 && todayDone === todayBlocks.length;

  const hoursData = subjectsDefault.map((subject) => ({ subject: subject.slice(0, 4), hours: data?.analytics?.hoursPerSubject?.[subject] || 0 }));

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md space-y-4">
          <h1 className="text-3xl font-bold">PCM Lock-In</h1>
          <p className="text-slate-400">Sign in and start your 22-day finals sprint.</p>
          <input className="w-full rounded-lg bg-slate-800 p-2" placeholder="Name" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="w-full rounded-lg bg-slate-800 p-2" placeholder="Email" onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="w-full rounded-lg bg-slate-800 p-2" placeholder="Password" type="password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button className="w-full rounded-lg bg-indigo-500 p-2 font-semibold" onClick={authUser}>{mode === 'login' ? 'Login' : 'Register'}</button>
          <button className="text-sm text-indigo-300" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>Switch to {mode === 'login' ? 'Register' : 'Login'}</button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">PCM Lock-In</h1>
            <p className="text-slate-400">Adaptive finals preparation cockpit.</p>
          </div>
          <div className="flex gap-2">
            <button className="rounded-xl border border-slate-700 px-4 py-2" onClick={exportBackup}><Download size={16} className="inline" /> Export</button>
            <label className="rounded-xl border border-slate-700 px-4 py-2 cursor-pointer"><Upload size={16} className="inline" /> Restore
              <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && restoreBackup(e.target.files[0])} />
            </label>
            <button className="rounded-xl border border-slate-700 px-4 py-2" onClick={() => { localStorage.clear(); setToken(''); }}>Logout</button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-5">
          <Card><p className="text-slate-400">Days Remaining</p><p className="text-3xl font-bold">{daysRemaining}</p></Card>
          <Card><p className="text-slate-400">Completion</p><p className="text-3xl font-bold">{data?.analytics?.completion || 0}%</p></Card>
          <Card><p className="text-slate-400">Total Hours</p><p className="text-3xl font-bold">{data?.analytics?.totalHours || 0}h</p></Card>
          <Card><p className="text-slate-400">Streak</p><p className="text-3xl font-bold flex items-center gap-2"><Flame className="text-orange-400" /> {data?.analytics?.streak || 0}</p></Card>
          <Card><p className="text-slate-400">Weakest Subject</p><p className="text-2xl font-bold text-rose-300">{data?.analytics?.weakestSubject || '—'}</p></Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="text-xl font-semibold mb-3">Study Planner + Revision Boost</h2>
            <div className="max-h-[360px] overflow-auto space-y-2 pr-1">
              {(data?.plans || []).map((plan) => (
                <div key={`${plan.day}-${plan.sessionType}`} className={`rounded-lg p-3 grid gap-2 md:grid-cols-12 ${plan.sessionType === 'revision_boost' ? 'bg-rose-900/30 border border-rose-700/50' : 'bg-slate-900 border border-slate-800'}`}>
                  <span className="md:col-span-1 text-slate-400">D{plan.day}</span>
                  <select className="md:col-span-3 rounded bg-slate-800 p-2" value={plan.subject} onChange={(e) => updatePlan(plan.day, { ...plan, subject: e.target.value }, plan.sessionType)}>
                    {subjectsDefault.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <input className="md:col-span-4 rounded bg-slate-800 p-2" value={plan.topic} onChange={(e) => updatePlan(plan.day, { ...plan, topic: e.target.value }, plan.sessionType)} />
                  <input className="md:col-span-4 rounded bg-slate-800 p-2" placeholder="weak tags" value={plan.weakTag || ''} onChange={(e) => updatePlan(plan.day, { ...plan, weakTag: e.target.value }, plan.sessionType)} />
                </div>
              ))}
            </div>
          </Card>

          <Card className="space-y-3">
            <h2 className="text-xl font-semibold">Daily Task Lock</h2>
            {todayBlocks.map((block) => (
              <button key={block.id} onClick={() => toggleBlock(block.id, block.completed)} className={`w-full rounded-lg p-3 text-left transition ${block.completed ? 'bg-emerald-700/40 border border-emerald-600' : 'bg-slate-800 border border-slate-700'}`}>
                <p>{block.title}</p>
                <p className="text-xs text-slate-400">{block.durationMinutes} mins</p>
              </button>
            ))}
            <div className="rounded-lg p-3 border border-slate-700 bg-slate-800/50 flex justify-between">
              <span>Gaming Mode</span>
              {rewardUnlocked ? <Unlock className="text-emerald-400" /> : <Lock className="text-rose-400" />}
            </div>
            {rewardUnlocked && <div className="rounded-lg bg-emerald-600/20 border border-emerald-500 p-3"><Trophy className="inline mr-2" />Reward Mode unlocked</div>}
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <h2 className="text-xl font-semibold">Adaptive Study Engine (weekly confidence)</h2>
            <div className="flex items-center gap-3 mb-2">
              <label className="text-sm text-slate-300">Week</label>
              <input className="w-24 rounded bg-slate-800 p-2" type="number" min="1" max="10" value={weekIndex} onChange={(e) => setWeekIndex(Number(e.target.value) || 1)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {subjectsDefault.map((subject) => (
                <div key={subject} className="rounded-lg bg-slate-800 p-2 flex items-center justify-between gap-2">
                  <span>{subject}</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min="1" max="10" className="w-16 rounded bg-slate-700 p-1" value={confidenceDraft[subject] || 6} onChange={(e) => setConfidenceDraft({ ...confidenceDraft, [subject]: Number(e.target.value) })} />
                    <button className="rounded bg-indigo-500 px-2 py-1 text-xs" onClick={() => saveConfidence(subject)}>Save</button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-sm text-slate-400">Chemistry below 6 gets +20% study allocation. Maths above 7 gets slight reduction.</p>
          </Card>

          <Card className="space-y-3">
            <h2 className="text-xl font-semibold">Smart Weak Topic System</h2>
            <div className="grid gap-2 md:grid-cols-4">
              <select className="rounded bg-slate-800 p-2" value={weakDraft.subject} onChange={(e) => setWeakDraft({ ...weakDraft, subject: e.target.value })}>
                {subjectsDefault.map((s) => <option key={s}>{s}</option>)}
              </select>
              <input className="rounded bg-slate-800 p-2 md:col-span-2" placeholder="Chapter / topic" value={weakDraft.chapter} onChange={(e) => setWeakDraft({ ...weakDraft, chapter: e.target.value })} />
              <input className="rounded bg-slate-800 p-2" type="number" min="1" value={weakDraft.mistakes} onChange={(e) => setWeakDraft({ ...weakDraft, mistakes: Number(e.target.value) })} />
            </div>
            <button className="rounded bg-rose-500 px-3 py-2" onClick={addWeakTopic}>Add weak chapter</button>
            <div className="max-h-40 overflow-auto space-y-2">
              {(data?.analytics?.weakTopicsSorted || []).map((w) => (
                <div key={`${w.subject}-${w.chapter}`} className="rounded bg-slate-800 p-2 text-sm flex justify-between"><span>{w.subject}: {w.chapter}</span><span>{w.mistakes} mistakes</span></div>
              ))}
            </div>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-2">
            <h2 className="text-xl font-semibold">Analytics Dashboard</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hoursData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="subject" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" />
                  <Tooltip />
                  <Bar dataKey="hours" fill="#818cf8" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {(data?.analytics?.motivationalMessages || []).map((msg) => (
              <p key={msg} className="rounded bg-indigo-500/10 border border-indigo-500/40 p-2 text-sm"><MoonStar size={14} className="inline mr-2" />{msg}</p>
            ))}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-xl font-semibold">Mock Exam Mode</h2>
            <div className="grid md:grid-cols-3 gap-2">
              <select className="rounded bg-slate-800 p-2" value={mockMode.subject} onChange={(e) => setMockMode({ ...mockMode, subject: e.target.value })}>
                {subjectsDefault.map((s) => <option key={s}>{s}</option>)}
              </select>
              <input className="rounded bg-slate-800 p-2" type="number" value={mockMode.durationMinutes} onChange={(e) => setMockMode({ ...mockMode, durationMinutes: Number(e.target.value), secondsLeft: Number(e.target.value) * 60 })} />
              <button className="rounded bg-indigo-500 p-2" onClick={() => setMockMode({ ...mockMode, running: !mockMode.running })}>{mockMode.running ? 'Pause' : 'Start'} Mock</button>
            </div>
            <p className="text-4xl font-bold"><Timer size={20} className="inline mr-2" />{mmss(mockMode.secondsLeft)}</p>
            <div className="grid md:grid-cols-2 gap-2">
              <input className="rounded bg-slate-800 p-2" placeholder="Score / 100" type="number" value={mockMode.score} onChange={(e) => setMockMode({ ...mockMode, score: e.target.value })} />
              <button className="rounded bg-emerald-500 p-2" onClick={submitMock}>Save Score</button>
            </div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.analytics?.mockTrend || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="index" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" domain={[0, 100]} />
                  <Tooltip />
                  <Line dataKey="score" stroke="#34d399" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <h2 className="text-xl font-semibold flex items-center gap-2"><Timer size={18} /> Focus Mode Upgrade (90/20)</h2>
            <p className="text-5xl font-bold">{mmss(isFocusSession ? focusSeconds : breakSeconds)}</p>
            <p className="text-slate-400">{isFocusSession ? 'Focus Session' : 'Break Session (auto-triggered)'}</p>
            <div className="flex gap-2">
              <button className="rounded-lg bg-indigo-500 px-3 py-2" onClick={() => setRunning(!running)}>{running ? 'Pause' : 'Start'}</button>
              <button className="rounded-lg bg-slate-700 px-3 py-2" onClick={() => { setFocusSeconds(90 * 60); setBreakSeconds(20 * 60); setRunning(false); setIsFocusSession(true); }}>Reset</button>
              <button className="rounded-lg bg-slate-700 px-3 py-2" onClick={() => document.documentElement.requestFullscreen?.()}>Fullscreen</button>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={whiteNoise} onChange={(e) => setWhiteNoise(e.target.checked)} /> Ambient Sound</label>
            {whiteNoise && <audio autoPlay loop src="https://cdn.pixabay.com/audio/2022/03/15/audio_8f4f2bcd7e.mp3" />}
          </Card>

          <Card>
            <h2 className="text-xl font-semibold mb-3">Readiness Radar</h2>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.analytics?.daily || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="day" stroke="#cbd5e1" />
                  <YAxis stroke="#cbd5e1" domain={[0, 100]} />
                  <Tooltip />
                  <Line dataKey="percentage" stroke="#f59e0b" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-lg">You are <span className="font-bold text-indigo-300">{data?.analytics?.readiness || 0}%</span> exam-ready.</p>
          </Card>
        </section>
      </div>
    </div>
  );
}
