import { useState } from 'react'
import { Menu } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import NotificationBell from '../components/NotificationBell'
import PageDashboard from './PageDashboard'
import PageUsers from './PageUsers'
import PageDomains from './PageDomains'
import PageLogs from './PageLogs'
import PageServices from './PageServices'
import PageStats from './PageStats'
import PageSettings from './PageSettings'
import PageAliases from './PageAliases'
import PageSecurity from './PageSecurity'
import PageWebmailLogins from './PageWebmailLogins'
import PageAdmins from './PageAdmins'
import PageIpLists from './PageIpLists'
import PageAdminLogins from './PageAdminLogins'
import PageSystemUpdates from './PageSystemUpdates'
import PageMonitor from './PageMonitor'

const pages = {
  dashboard: PageDashboard,
  users: PageUsers,
  domains: PageDomains,
  aliases: PageAliases,
  security: PageSecurity,
  'webmail-logins': PageWebmailLogins,
  'ip-lists': PageIpLists,
  'admin-logins': PageAdminLogins,
  'system-updates': PageSystemUpdates,
  logs: PageLogs,
  services: PageServices,
  monitor: PageMonitor,
  stats: PageStats,
  settings: PageSettings,
  admins: PageAdmins,
}

export default function Dashboard({ onLogout, theme, setTheme, currentAdmin }) {
  const [page, setPage] = useState('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const Page = pages[page]

  return (
    <div className="app-shell" style={{display:'flex',minHeight:'100vh',width:'100%',fontSize:'14px',background:'var(--bg-secondary)'}}>
      <NotificationBell />
      <Sidebar current={page} onChange={setPage} onLogout={onLogout} theme={theme} setTheme={setTheme}
        open={mobileOpen} onNavigate={() => setMobileOpen(false)} currentAdmin={currentAdmin} />
      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
      <div className="main-content" style={{flex:1,overflow:'auto',minWidth:0}}>
        <div className="mobile-topbar">
          <button onClick={() => setMobileOpen(true)} aria-label="開啟選單"><Menu size={18} /></button>
          <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>🐱 NannanCat Mail</div>
        </div>
        <Page key={page} onNavigate={setPage} currentAdmin={currentAdmin} />
      </div>
    </div>
  )
}
