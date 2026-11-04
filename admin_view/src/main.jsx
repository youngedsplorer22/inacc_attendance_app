import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'
import {
  Activity, CalendarDays, CheckCircle2, ChevronDown, ChevronRight,
  Download, FileSpreadsheet, LogOut, RefreshCw, Search, ShieldCheck,
  Users, UserCheck, UserX, Building2, Clock3, X
} from 'lucide-react'
import './styles.css'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://inaccattendanceapp-production.up.railway.app').replace(/\/$/, '')
const TOKEN_KEY = 'inaac_admin_token'

function localToday() {
  // Use India local date regardless of the computer's timezone.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
}

function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
  }).format(d)
}

async function apiRequest(path, { token, method = 'GET', body } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${API_BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.detail || `Request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return data
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [checkingSession, setCheckingSession] = useState(Boolean(localStorage.getItem(TOKEN_KEY)))
  const [username, setUsername] = useState('')
  const [date, setDate] = useState(localToday())
  const [summary, setSummary] = useState(null)
  const [employees, setEmployees] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error, setError] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const logout = useCallback(async (notify = false) => {
    const oldToken = token
    setToken('')
    localStorage.removeItem(TOKEN_KEY)
    setSummary(null)
    setEmployees([])
    setUsername('')
    setExpanded(null)
    if (oldToken) {
      try { await apiRequest('/api/admin/logout', { token: oldToken, method: 'POST' }) } catch {}
    }
    if (notify) setLoginError('Your session has ended. Please sign in again.')
  }, [token])

  const loadDashboard = useCallback(async (showSpinner = false) => {
    if (!token) return
    if (showSpinner) setRefreshing(true)
    try {
      const query = `?date=${encodeURIComponent(date)}`
      const [dashboardData, employeeData] = await Promise.all([
        apiRequest(`/api/admin/dashboard${query}`, { token }),
        apiRequest(`/api/admin/employees${query}`, { token })
      ])
      setSummary(dashboardData.summary || {})
      setEmployees(employeeData.employees || [])
      setLastUpdated(new Date())
      setError('')
    } catch (err) {
      if (err.status === 401) {
        await logout(true)
      } else {
        setError(err.message || 'Unable to load dashboard data.')
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [token, date, logout])

  useEffect(() => {
    if (!token) { setCheckingSession(false); return }
    let cancelled = false
    apiRequest('/api/admin/me', { token })
      .then(data => { if (!cancelled) setUsername(data.username || '') })
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem(TOKEN_KEY)
          setToken('')
        }
      })
      .finally(() => { if (!cancelled) setCheckingSession(false) })
    return () => { cancelled = true }
  }, [token])

  useEffect(() => {
    if (!token || checkingSession) return
    setLoading(true)
    loadDashboard()
    const interval = window.setInterval(() => loadDashboard(), 10000)
    return () => window.clearInterval(interval)
  }, [token, checkingSession, loadDashboard])

  async function handleLogin(event) {
    event.preventDefault()
    setLoginError('')
    setLoginBusy(true)
    const form = new FormData(event.currentTarget)
    try {
      const result = await apiRequest('/api/admin/login', {
        method: 'POST',
        body: {
          username: String(form.get('username') || '').trim(),
          password: String(form.get('password') || '')
        }
      })
      localStorage.setItem(TOKEN_KEY, result.access_token)
      setToken(result.access_token)
      setUsername(String(form.get('username') || '').trim())
    } catch (err) {
      setLoginError(err.message || 'Unable to sign in.')
    } finally {
      setLoginBusy(false)
    }
  }

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees.filter(person => {
      const matchesSearch = !q || [
        person.roll_no, person.child_name, person.phone_no, person.email,
        person.school_name, person.city, person.state, person.team_no, person.group_no
      ].some(value => String(value ?? '').toLowerCase().includes(q))
      const matchesStatus = statusFilter === 'all' || person.attendance_status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [employees, search, statusFilter])

  function exportExcel() {
    const rows = employees.map((p, index) => ({
      'S. No.': index + 1,
      'Roll No.': p.roll_no ?? '',
      'Participant Name': p.child_name ?? '',
      'Phone Number': p.phone_no ?? '',
      'Email': p.email ?? '',
      'School / Organisation': p.school_name ?? '',
      'City': p.city ?? '',
      'State': p.state ?? '',
      'Region': p.region ?? '',
      'Grade': p.grade ?? '',
      'Team No.': p.team_no ?? '',
      'Group No.': p.group_no ?? '',
      'In Premises': p.in_premise ? 'Yes' : 'No',
      'Attendance Status': p.attendance_status ?? 'absent',
      'In Time (IST)': p.in_time ? formatDateTime(p.in_time) : '',
      'Out Time (IST)': p.out_time ? formatDateTime(p.out_time) : ''
    }))
    const sheet = XLSX.utils.json_to_sheet(rows)
    sheet['!cols'] = [
      { wch: 8 }, { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 28 },
      { wch: 28 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 24 }
    ]
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 15 } }) }
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 }
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Attendance')
    const meta = XLSX.utils.aoa_to_sheet([
      ['INAAC Attendance Report'],
      ['Selected date (IST)', date],
      ['Generated at (IST)', formatDateTime(new Date().toISOString())],
      ['Total participants', employees.length],
      ['Present today', summary?.present_today ?? 0],
      ['Currently inside', summary?.currently_inside ?? 0],
      ['Absent today', summary?.absent_today ?? 0]
    ])
    XLSX.utils.book_append_sheet(workbook, meta, 'Report Summary')
    XLSX.writeFile(workbook, `INAAC_Attendance_${date}.xlsx`)
  }

  if (checkingSession) {
    return <div className="screen-center"><div className="loader large" /><span>Verifying admin session…</span></div>
  }

  if (!token) {
    return <LoginScreen onSubmit={handleLogin} error={loginError} busy={loginBusy} />
  }

  const cards = [
    { label: 'Total participants', value: summary?.total_employees ?? '—', icon: Users, tone: 'blue', note: 'Registered in database' },
    { label: 'Present today', value: summary?.present_today ?? '—', icon: UserCheck, tone: 'green', note: 'Attendance recorded' },
    { label: 'Currently inside', value: summary?.currently_inside ?? '—', icon: Building2, tone: 'violet', note: 'Live premises status' },
    { label: 'Absent today', value: summary?.absent_today ?? '—', icon: UserX, tone: 'amber', note: 'No check-in on selected date' }
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">I</div>
          <div><strong>INAAC</strong><span>ATTENDANCE SYSTEM</span></div>
        </div>
        <div className="side-label">WORKSPACE</div>
        <div className="nav-item active"><Activity size={18} /> Overview</div>
        <div className="sidebar-bottom">
          <div className="secure-note"><ShieldCheck size={17} /><span>Secure admin access</span></div>
          <div className="user-block">
            <div className="avatar">{(username || 'A').charAt(0).toUpperCase()}</div>
            <div className="user-meta"><strong>Administrator</strong><span>{username || 'Admin account'}</span></div>
            <button className="icon-button logout-button" title="Log out" onClick={() => logout()}><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">INAAC / ADMINISTRATION</div>
            <h1>Attendance overview</h1>
            <p>Monitor participant attendance and premises activity.</p>
          </div>
          <div className="top-actions">
            <div className="live-indicator"><span /> LIVE · 10 SEC</div>
            <button className="refresh-button" onClick={() => loadDashboard(true)} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? 'spin' : ''} /> Refresh
            </button>
            <button className="mobile-logout" onClick={() => logout()}><LogOut size={17} /></button>
          </div>
        </header>

        {error && <div className="error-banner"><X size={17} />{error}<button onClick={() => loadDashboard(true)}>Retry</button></div>}

        <section className="toolbar">
          <div className="date-control">
            <CalendarDays size={18} />
            <label htmlFor="attendance-date">Attendance date</label>
            <input id="attendance-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="updated-label">
            <span className="status-dot" /> {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-IN')}` : 'Loading data…'}
          </div>
        </section>

        <section className="stats-grid">
          {cards.map(card => {
            const Icon = card.icon
            return <article className="stat-card" key={card.label}>
              <div className={`stat-icon ${card.tone}`}><Icon size={20} /></div>
              <div className="stat-label">{card.label}</div>
              <div className="stat-value">{card.value}</div>
              <div className="stat-note">{card.note}</div>
            </article>
          })}
        </section>

        <section className="table-panel">
          <div className="table-heading">
            <div>
              <div className="section-kicker">PARTICIPANT DIRECTORY</div>
              <h2>Attendance register</h2>
              <p>Spreadsheet view · Select any row to see complete details.</p>
            </div>
            <button className="export-button" onClick={exportExcel} disabled={!employees.length}>
              <FileSpreadsheet size={17} /> Export Excel <Download size={15} />
            </button>
          </div>

          <div className="table-controls">
            <div className="search-box">
              <Search size={17} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, roll no., phone, school…" />
              {search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter attendance status">
              <option value="all">All statuses</option>
              <option value="present">Present</option>
              <option value="dispersed">Dispersed</option>
              <option value="absent">Absent</option>
            </select>
            <span className="record-count">{filteredEmployees.length} of {employees.length} records</span>
          </div>

          <div className="spreadsheet-wrap">
            <table className="spreadsheet">
              <thead>
                <tr>
                  <th className="expand-col"></th>
                  <th>S. No.</th>
                  <th>Roll no.</th>
                  <th>Participant name</th>
                  <th>Phone number</th>
                  <th>School / organisation</th>
                  <th>Grade</th>
                  <th>Team</th>
                  <th>In time (IST)</th>
                  <th>Out time (IST)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((person, index) => {
                  const isOpen = expanded === person.id
                  return <React.Fragment key={person.id}>
                    <tr className={`data-row ${isOpen ? 'selected-row' : ''}`} onClick={() => setExpanded(isOpen ? null : person.id)}>
                      <td className="expand-cell">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                      <td className="muted-cell">{index + 1}</td>
                      <td className="mono-cell">{person.roll_no || '—'}</td>
                      <td className="name-cell">{person.child_name || '—'}</td>
                      <td>{person.phone_no || '—'}</td>
                      <td>{person.school_name || '—'}</td>
                      <td>{person.grade || '—'}</td>
                      <td>{person.team_no || '—'}</td>
                      <td className="time-cell">{formatDateTime(person.in_time)}</td>
                      <td className="time-cell">{formatDateTime(person.out_time)}</td>
                      <td><StatusPill status={person.attendance_status} /></td>
                    </tr>
                    {isOpen && <tr className="detail-row"><td colSpan="11">
                      <div className="detail-grid">
                        <Detail label="Participant" value={person.child_name} />
                        <Detail label="Roll number" value={person.roll_no} />
                        <Detail label="Email" value={person.email} />
                        <Detail label="Phone" value={person.phone_no} />
                        <Detail label="School / organisation" value={person.school_name} />
                        <Detail label="City / state" value={[person.city, person.state].filter(Boolean).join(', ')} />
                        <Detail label="Region" value={person.region} />
                        <Detail label="Grade" value={person.grade} />
                        <Detail label="Team / group" value={[person.team_no, person.group_no].filter(Boolean).join(' / ')} />
                        <Detail label="In time" value={formatDateTime(person.in_time)} />
                        <Detail label="Out time" value={formatDateTime(person.out_time)} />
                        <Detail label="Currently inside" value={person.in_premise ? 'Yes' : 'No'} />
                      </div>
                      {person.image_url && <a className="photo-link" href={person.image_url} target="_blank" rel="noreferrer">View participant photo ↗</a>}
                    </td></tr>}
                  </React.Fragment>
                })}
                {!filteredEmployees.length && <tr><td colSpan="11" className="empty-state">{loading ? 'Loading participant records…' : 'No participants match this search or filter.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>Showing {filteredEmployees.length} participant records for {date}</span>
            <span><Clock3 size={14} /> Automatically refreshes every 10 seconds</span>
          </div>
        </section>
        <footer className="page-footer">INAAC Attendance Management <span>•</span> Admin Portal</footer>
      </main>
    </div>
  )
}

function LoginScreen({ onSubmit, error, busy }) {
  const [showPassword, setShowPassword] = useState(false)
  return <div className="login-screen">
    <div className="login-decoration decoration-one" /><div className="login-decoration decoration-two" />
    <div className="login-card">
      <div className="login-brand"><div className="brand-mark large-mark">I</div><div><strong>INAAC</strong><span>ATTENDANCE SYSTEM</span></div></div>
      <div className="login-icon"><ShieldCheck size={25} /></div>
      <div className="section-kicker">RESTRICTED ACCESS</div>
      <h1>Admin sign in</h1>
      <p className="login-subtitle">Sign in to manage attendance and monitor participant activity.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="username">Admin ID</label>
        <input id="username" name="username" type="text" autoComplete="username" placeholder="Enter admin ID" required />
        <label htmlFor="password">Password</label>
        <div className="password-wrap">
          <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter password" required />
          <button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button>
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="login-submit" type="submit" disabled={busy}>{busy ? <><span className="loader" /> Signing in…</> : <>Sign in securely <ChevronRight size={17} /></>}</button>
      </form>
      <div className="login-foot"><ShieldCheck size={15} /> Protected administrator access</div>
    </div>
    <div className="login-caption">INAAC · ATTENDANCE ADMINISTRATION</div>
  </div>
}

function StatusPill({ status }) {
  const value = status || 'absent'
  const label = value === 'present' ? 'Present' : value === 'dispersed' ? 'Dispersed' : 'Absent'
  return <span className={`status-pill ${value}`}><span />{label}</span>
}

function Detail({ label, value }) {
  return <div className="detail-item"><span>{label}</span><strong>{value || '—'}</strong></div>
}

createRoot(document.getElementById('root')).render(<App />)
