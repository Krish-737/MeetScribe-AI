import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Settings, Play, CheckCircle, AlertCircle, FileText,
  Loader2, Moon, Sun, Lock, Eye, EyeOff, Key,
  Globe, LayoutDashboard, History, ShieldCheck, Activity
} from 'lucide-react';

const API_BASE = 'http://localhost:8000';

function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [view, setView] = useState('dashboard');
  const [history, setHistory] = useState([]);

  const [meetingUrl, setMeetingUrl] = useState('');
  const [deepgramKey, setDeepgramKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [showDgKey, setShowDgKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const [transcript, setTranscript] = useState([]);
  const [summary, setSummary] = useState(null);

  // Load theme, keys and HISTORY from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setIsDarkMode(savedTheme === 'dark');
    if (savedTheme === 'dark') document.body.classList.add('dark-mode');

    setDeepgramKey(localStorage.getItem('dg_key') || '');
    setGroqKey(localStorage.getItem('gk_key') || '');

    const savedHistory = JSON.parse(localStorage.getItem('ms_history') || '[]');
    setHistory(savedHistory);
  }, []);

  // Polling for live updates while a session is active
  useEffect(() => {
    let interval;
    if (activeMeeting && !summary && view === 'dashboard') {
      interval = setInterval(async () => {
        try {
          const tResp = await axios.get(`${API_BASE}/meetings/${activeMeeting.meetingId}/transcript`);
          setTranscript(tResp.data);

          // Fetch meeting meta for status updates
          const mResp = await axios.get(`${API_BASE}/meetings/${activeMeeting.meetingId}`);
          if (mResp.data) {
            setActiveMeeting(prev => ({ ...prev, status: mResp.data.status }));
          }

          const sResp = await axios.get(`${API_BASE}/meetings/${activeMeeting.meetingId}/summary`);
          if (sResp.data) {
            const newSummary = sResp.data;
            setSummary(newSummary);

            // SAVE TO HISTORY - Prevent duplicates
            setHistory(prev => {
              if (prev.find(h => h.id === activeMeeting.meetingId)) return prev;
              const entry = {
                id: activeMeeting.meetingId,
                date: new Date().toLocaleString(),
                summary: newSummary
              };
              const updated = [entry, ...prev].slice(0, 15);
              localStorage.setItem('ms_history', JSON.stringify(updated));
              return updated;
            });

            clearInterval(interval);
          }
        } catch (e) {
          console.error("Polling failed", e);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [activeMeeting, summary, view]);

  const toggleTheme = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', newMode ? 'dark' : 'light');
  };

  useEffect(() => {
    localStorage.setItem('dg_key', deepgramKey);
    localStorage.setItem('gk_key', groqKey);
  }, [deepgramKey, groqKey]);

  const isFormValid = meetingUrl.trim() !== '' && deepgramKey.trim() !== '' && groqKey.trim() !== '';

  const startBot = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setTranscript([]);
    setSummary(null);
    try {
      const resp = await axios.post(`${API_BASE}/meetings/join`, {
        meeting_url: meetingUrl,
        deepgram_api_key: deepgramKey,
        groq_api_key: groqKey
      });
      setActiveMeeting(resp.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Connection failed. Check your API keys.");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const resp = await axios.get(`${API_BASE}/meetings`);
      // Merge backend history into local history
      const backendSessions = resp.data
        .filter(m => m.summary && m.status === 'completed')
        .map(m => ({
          id: m.meetingId,
          date: m.start_time || new Date().toLocaleString(),
          summary: m.summary
        }));

      setHistory(prev => {
        const merged = [...prev];
        backendSessions.forEach(bs => {
          if (!merged.find(m => m.id === bs.id)) {
            merged.unshift(bs);
          }
        });
        const updated = merged.slice(0, 20);
        localStorage.setItem('ms_history', JSON.stringify(updated));
        return updated;
      });
    } catch (err) {
      console.error("Failed to sync history", err);
    }
  };

  const deleteHistory = (id) => {
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    localStorage.setItem('ms_history', JSON.stringify(updated));
  };

  return (
    <div className="dashboard-container">
      {/* Sidebar - Professional Navigation */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo-box">M</div>
          <span className="brand-text">MeetScribe<span className="text-accent">AI</span></span>
        </div>

        <nav className="sidebar-nav">
          <div
            className={`nav-item ${view === 'dashboard' ? 'active' : ''}`}
            onClick={() => setView('dashboard')}
          >
            <LayoutDashboard size={18} /> Dashboard
          </div>
          <div
            className={`nav-item ${view === 'sessions' ? 'active' : ''}`}
            onClick={() => { setView('sessions'); fetchHistory(); }}
          >
            <History size={18} /> Sessions
          </div>
          {/* <div className="nav-item opacity-40 cursor-not-allowed"><ShieldCheck size={18} /> Security</div> */}
        </nav>

        <div className="sidebar-footer">
          <button onClick={toggleTheme} className="theme-toggle">
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            {isDarkMode ? 'Light Mode' : 'Dark Mode'}
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="content-header">
          <div>
            <h1>{view === 'dashboard' ? (activeMeeting ? "Live Session" : "New Meeting") : "Session History"}</h1>
            <p className="subtitle">System Status: <span className="status-indicator">Operational</span></p>
          </div>
          <div className="user-profile">
            <Settings size={20} className="text-secondary cursor-pointer hover:rotate-90 transition-transform" />
          </div>
        </header>

        <div className="scroll-area">
          {view === 'dashboard' ? (
            !activeMeeting ? (
              <div className="grid-layout">
                {/* Left Column: API Configuration */}
                <div className="card config-card">
                  <div className="card-header">
                    <Key size={18} className="text-accent" />
                    <h3>API Configuration</h3>
                  </div>

                  <div className="input-group">
                    <label>Deepgram Secret</label>
                    <div className="input-wrapper">
                      <input
                        type={showDgKey ? "text" : "password"}
                        value={deepgramKey}
                        onChange={(e) => setDeepgramKey(e.target.value)}
                        placeholder="dg_..."
                      />
                      <button onClick={() => setShowDgKey(!showDgKey)} className="eye-btn">
                        {showDgKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div className="input-group">
                    <label>Groq API Key</label>
                    <div className="input-wrapper">
                      <input
                        type={showGroqKey ? "text" : "password"}
                        value={groqKey}
                        onChange={(e) => setGroqKey(e.target.value)}
                        placeholder="gsk_..."
                      />
                      <button onClick={() => setShowGroqKey(!showGroqKey)} className="eye-btn">
                        {showGroqKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  {/* <p className="helper-text"><Lock size={12} /> Encryption: AES-256 Local Storage</p> */}
                </div>

                {/* Center Column: Primary Action */}
                <div className="card main-action-card">
                  <div className="card-header">
                    <Globe size={18} className="text-accent" />
                    <h3>Deployment Center</h3>
                  </div>

                  <form onSubmit={startBot} className="action-form">
                    <div className="input-group lg">
                      <label>Microsoft Teams Link</label>
                      <input
                        required
                        type="url"
                        className="url-input"
                        placeholder="https://teams.microsoft.com/..."
                        value={meetingUrl}
                        onChange={(e) => setMeetingUrl(e.target.value)}
                      />
                    </div>

                    {error && (
                      <div className="alert-box error">
                        <AlertCircle size={18} /> {error}
                      </div>
                    )}

                    <button
                      disabled={isLoading || !isFormValid}
                      className={`launch-btn ${isLoading ? 'loading' : ''}`}
                    >
                      {isLoading ? <Loader2 className="animate-spin" /> : <Play size={18} fill="white" />}
                      <span>{isLoading ? "Provisioning Worker..." : "Deploy AI Associate"}</span>
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="active-session-ui animate-in grid grid-cols-1 lg:grid-cols-3 gap-6">

                <div className="lg:col-span-2 space-y-6">
                  {/* Live Transcript Box */}
                  <div className="card transcript-card h-[500px] flex flex-col">
                    <div className="card-header flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <FileText size={18} className="text-accent" />
                        <h3>Live Transcript</h3>
                      </div>
                      {summary ? (
                        <div className="completed-badge">PROCESSED</div>
                      ) : (
                        <div className="live-badge"><span className="pulse"></span> LISTENING</div>
                      )}
                    </div>
                    <div className="transcript-body flex-1 overflow-y-auto p-4 space-y-4">
                      {transcript.length === 0 && <p className="opacity-30 text-center mt-10">Waiting for audio speech...</p>}
                      {transcript.map((chunk, i) => (
                        <div key={i} className="transcript-line animate-fade">
                          <span className="speaker-label">Speaker {chunk.speaker}:</span>
                          <span className="text-content">{chunk.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Summary Section (Appears when ready) */}
                  {summary && (
                    <div className="card summary-card animate-fade">
                      <div className="card-header">
                        <CheckCircle size={18} className="text-green-500" />
                        <h3>AI Meeting Result</h3>
                      </div>
                      <div className="summary-content space-y-6">
                        <div className="exec-summary">
                          <h4 className="text-accent text-xs font-bold uppercase mb-2">Executive Summary</h4>
                          <p className="text-sm leading-relaxed">{summary.summary}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <h4 className="text-accent text-xs font-bold uppercase mb-2">Key Decisions</h4>
                            <ul className="text-sm space-y-2 list-disc pl-4">
                              {summary.decisions.map((d, i) => <li key={i}>{d}</li>)}
                              {summary.decisions.length === 0 && <li>No decisions identified.</li>}
                            </ul>
                          </div>
                          <div>
                            <h4 className="text-accent text-xs font-bold uppercase mb-2">Action Items</h4>
                            <ul className="text-sm space-y-2 list-disc pl-4">
                              {summary.action_items.map((a, i) => (
                                <li key={i}><strong>{a.assignee || "Unassigned"}:</strong> {a.text}</li>
                              ))}
                              {summary.action_items.length === 0 && <li>No action items assigned.</li>}
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sidebar: Session Info */}
                <div className="card session-meta-card h-fit">
                  <div className="card-header">
                    <Activity size={18} className="text-accent" />
                    <h3>Session Info</h3>
                  </div>
                  <div className="space-y-4 py-2">
                    <div className="meta-item">
                      <p className="label">Meeting ID</p>
                      <p className="value font-mono text-xs">{activeMeeting.meetingId}</p>
                    </div>
                    <div className="meta-item">
                      <p className="label">Participants</p>
                      <p className="value">{summary?.participants?.join(', ') || "Analyzing..."}</p>
                    </div>
                    <button 
                      disabled={activeMeeting.status === 'terminating'}
                      onClick={async () => {
                        if (activeMeeting) {
                          try { 
                            await axios.post(`${API_BASE}/meetings/${activeMeeting.meetingId}/terminate`); 
                          } catch(e) { console.error("Terminate failed", e); }
                        }
                      }} 
                      className="btn-secondary w-full mt-4"
                    >
                      {summary ? "Done" : (activeMeeting.status === 'terminating' ? "Summarizing..." : "Terminate Bot")}
                    </button>
                    {summary && (
                      <button onClick={() => setActiveMeeting(null)} className="btn-primary w-full mt-2">
                        Close Session
                      </button>
                    )}
                  </div>
                </div>

              </div>
            )
          ) : (
            <div className="sessions-list-view space-y-4 animate-fade">
              {history.length === 0 && (
                <div className="card p-12 text-center opacity-40">
                  <History size={48} className="mx-auto mb-4" />
                  <p>No meeting history found in local storage.</p>
                </div>
              )}
              {history.map((h, i) => (
                <div key={h.id} className="card p-6 flex flex-col md:flex-row gap-6 hover:border-accent/40 transition-colors">
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-lg">Meeting Report</h3>
                        <p className="subtitle text-xs">{h.date} • ID: {h.id}</p>
                      </div>
                      <button onClick={() => deleteHistory(h.id)} className="text-red-500 hover:text-red-400 text-xs font-bold uppercase">Delete</button>
                    </div>
                    <p className="text-sm line-clamp-2 opacity-70 mb-4">{h.summary.summary}</p>
                    <div className="flex gap-2">
                      <span className="bg-accent/10 text-accent px-3 py-1 rounded-full text-[10px] font-bold">DECISIONS: {h.summary.decisions.length}</span>
                      <span className="bg-green-500/10 text-green-500 px-3 py-1 rounded-full text-[10px] font-bold">ACTIONS: {h.summary.action_items.length}</span>
                    </div>
                  </div>
                  <div className="md:w-48 flex items-end">
                    <button
                      onClick={() => {
                        setSummary(h.summary);
                        setActiveMeeting({ meetingId: h.id });
                        setView('dashboard');
                      }}
                      className="btn-primary w-full py-2 text-xs"
                    >
                      View Report
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;