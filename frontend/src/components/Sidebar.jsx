import {
  LayoutDashboard, Users, Globe, AtSign, ScrollText,
  ServerCog, BarChart3, Settings, LogOut, Sun, Moon, Monitor, ShieldAlert, LogIn, UserCog, Languages, ShieldBan, Lock, Package, Activity,
} from 'lucide-react'
import { useLanguage, LANGUAGES } from '../i18n/LanguageContext'

// module: null 代表一律顯示（不受權限矩陣控制，例如儀表板本身是彙總頁）；
// 'admins' 這個 module 名稱是特殊 key，不是後端 permissions 裡的模組，另外用 manage_admins/super_admin 判斷
const items = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, module: null, color: 'var(--primary)' },
  { id: 'users', labelKey: 'nav.users', icon: Users, module: 'users', color: 'var(--info)' },
  { id: 'domains', labelKey: 'nav.domains', icon: Globe, module: 'domains', color: 'var(--accent-teal)' },
  { id: 'aliases', labelKey: 'nav.aliases', icon: AtSign, module: 'aliases', color: 'var(--accent-cyan)' },
  { id: 'security', labelKey: 'nav.security', icon: ShieldAlert, module: 'security', color: 'var(--danger)' },
  { id: 'webmail-logins', labelKey: 'nav.webmailLogins', icon: LogIn, module: 'webmail_logins', color: 'var(--accent-indigo)' },
  { id: 'ip-lists', labelKey: 'nav.ipLists', icon: ShieldBan, module: 'ip_lists', color: 'var(--accent-rose)' },
  { id: 'admin-logins', labelKey: 'nav.adminLogins', icon: Lock, module: 'admin_logins', color: 'var(--warning)' },
  { id: 'logs', labelKey: 'nav.logs', icon: ScrollText, module: 'logs', color: 'var(--text-muted)' },
  { id: 'services', labelKey: 'nav.services', icon: ServerCog, module: 'services', color: 'var(--accent-violet)' },
  { id: 'monitor', labelKey: 'nav.monitor', icon: Activity, module: 'services', color: 'var(--accent-lime)' },
  { id: 'system-updates', labelKey: 'nav.systemUpdates', icon: Package, module: 'services', color: 'var(--accent-amber)' },
  { id: 'stats', labelKey: 'nav.stats', icon: BarChart3, module: 'stats', color: 'var(--success)' },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings, module: 'settings', color: 'var(--text-muted)' },
  { id: 'admins', labelKey: 'nav.admins', icon: UserCog, module: 'admins', color: 'var(--accent-pink)' },
]

export function canViewNavItem(currentAdmin, item) {
  if (!currentAdmin || item.module === null) return true
  if (currentAdmin.super_admin) return true
  if (item.module === 'admins') return !!currentAdmin.manage_admins
  return !!currentAdmin.permissions?.[item.module]?.view
}

const themeOptions = [
  { value: 'system', labelKey: 'theme.system', icon: Monitor },
  { value: 'light', labelKey: 'theme.light', icon: Sun },
  { value: 'dark', labelKey: 'theme.dark', icon: Moon },
]

export default function Sidebar({ current, onChange, onLogout, theme, setTheme, open, onNavigate, currentAdmin }) {
  const { t, lang, setLang } = useLanguage()
  const visibleItems = items.filter(item => canViewNavItem(currentAdmin, item))
  return (
    <div className={`sidebar ${open ? 'open' : ''}`}>
      <div style={{ padding: '22px 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '9px', background: 'var(--primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px',
          }}>🐱</div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-.01em' }}>NannanCat Mail</div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{t('nav.subtitle')}</div>
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: '12px 10px', overflow: 'auto' }}>
        {visibleItems.map(item => {
          const Icon = item.icon
          const active = current === item.id
          return (
            <div key={item.id} onClick={() => { onChange(item.id); onNavigate?.() }} className={`nav-item ${active ? 'active' : ''}`}>
              {active && <span className="nav-indicator" />}
              <Icon size={16} strokeWidth={2.2} style={active ? undefined : { color: item.color }} />
              {t(item.labelKey)}
            </div>
          )
        })}
      </nav>

      <div style={{ padding: '14px 10px', borderTop: '1px solid var(--border)' }}>
        <div style={{ padding: '6px 10px 12px' }}>
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginBottom: '7px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            <Languages size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />語言 / Language
          </div>
          <select className="select" value={lang} onChange={e => setLang(e.target.value)} style={{ fontSize: 12, padding: '6px 8px' }}>
            {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div style={{ padding: '6px 10px 12px' }}>
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginBottom: '7px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('theme.label')}</div>
          <div style={{ display: 'flex', gap: '5px' }}>
            {themeOptions.map(opt => {
              const Icon = opt.icon
              const active = theme === opt.value
              return (
                <button key={opt.value} onClick={() => setTheme(opt.value)} title={t(opt.labelKey)}
                  style={{
                    flex: 1, padding: '7px 0', border: `1px solid ${active ? 'var(--primary)' : 'var(--border-input)'}`,
                    borderRadius: '8px', background: active ? 'var(--primary-soft)' : 'transparent',
                    color: active ? 'var(--primary)' : 'var(--text-muted)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  <Icon size={14} />
                </button>
              )
            })}
          </div>
        </div>
        <div onClick={onLogout} className="nav-item" style={{ color: 'var(--danger)' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-bg)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <LogOut size={16} /> {t('nav.logout')}
        </div>
        <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '10px', color: 'var(--text-muted)' }}>
          {t('login.copyright')}
        </div>
      </div>
    </div>
  )
}
