import { useEffect, useRef, useState } from 'react'
import {
  Bell, ShieldBan, RotateCcw, ShieldAlert, Mail, Bug, AlertTriangle, ServerCrash, X, Trash2,
} from 'lucide-react'
import api from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { timeAgo } from '../pages/PageSecurity'
import usePolling from '../utils/usePolling'

const POLL_MS = 30000

const TYPE_ICON = {
  auto_blacklist: ShieldBan,
  reboot_required: RotateCcw,
  apt_security_updates: ShieldAlert,
  roundcube_security_update: Mail,
  clamav_infected: Bug,
  rkhunter_warning: AlertTriangle,
  service_down: ServerCrash,
}

const SEVERITY_COLOR = {
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--primary)',
  success: 'var(--success)',
}

function titleFor(n, t) {
  switch (n.type) {
    case 'auto_blacklist':
      return t('notifications.autoBlacklistTitle', { ip: n.ip, count: n.banned_count })
    case 'reboot_required':
      return t('notifications.rebootRequiredTitle', { count: (n.packages || []).length })
    case 'apt_security_updates':
      return t('notifications.aptSecurityUpdatesTitle', { count: n.count })
    case 'roundcube_security_update':
      return t('notifications.roundcubeSecurityUpdateTitle', { current: n.current, latest: n.latest })
    case 'clamav_infected':
      return t('notifications.clamavInfectedTitle')
    case 'rkhunter_warning':
      return t('notifications.rkhunterWarningTitle', { count: n.count })
    case 'service_down':
      return t('notifications.serviceDownTitle', { service: n.service, status: n.status })
    default:
      return n.type
  }
}

export default function NotificationBell() {
  const { t } = useLanguage()
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('all')
  const ref = useRef(null)

  const load = () => {
    api.get('/notifications/').then(r => {
      setItems(r.data.items)
      setUnread(r.data.unread_count)
    }).catch(() => {})
  }

  usePolling(load, POLL_MS)

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const toggle = () => setOpen(o => !o)

  const markAllRead = async (e) => {
    e.stopPropagation()
    await api.post('/notifications/read-all').catch(() => {})
    load()
  }

  const markOneRead = (id) => {
    api.post(`/notifications/${id}/read`).then(load).catch(() => {})
  }

  const dismiss = (e, id) => {
    e.stopPropagation()
    setItems(prev => prev.filter(n => n.id !== id))
    api.delete(`/notifications/${id}`).then(load).catch(() => {})
  }

  const clearRead = async (e) => {
    e.stopPropagation()
    await api.delete('/notifications/clear-read').catch(() => {})
    load()
  }

  const visible = tab === 'unread' ? items.filter(n => !n.read) : items
  const hasReadItems = items.some(n => n.read)

  return (
    <div ref={ref} style={{ position: 'fixed', top: 16, right: 16, zIndex: 200 }}>
      <button
        onClick={toggle}
        title={t('notifications.title')}
        className={`notif-bell-btn ${unread > 0 ? 'has-unread' : ''}`}
      >
        <Bell size={17} />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span className="notif-panel-title">{t('notifications.title')}</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="notif-mark-all-btn">
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          <div className="notif-tabs">
            <button className={`notif-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
              {t('notifications.filterAll')} {items.length > 0 && `(${items.length})`}
            </button>
            <button className={`notif-tab ${tab === 'unread' ? 'active' : ''}`} onClick={() => setTab('unread')}>
              {t('notifications.filterUnread')} {unread > 0 && `(${unread})`}
            </button>
          </div>

          <div className="notif-list">
            {visible.length === 0 && (
              <div className="notif-empty">
                {tab === 'unread' ? t('notifications.emptyUnread') : t('notifications.empty')}
              </div>
            )}
            {visible.map(n => {
              const Icon = TYPE_ICON[n.type] || Bell
              const color = SEVERITY_COLOR[n.severity] || SEVERITY_COLOR.info
              return (
                <div
                  key={n.id}
                  className={`notif-item ${n.read ? '' : 'unread'}`}
                  style={{ borderLeftColor: n.read ? 'transparent' : color, cursor: n.read ? 'default' : 'pointer' }}
                  onClick={() => !n.read && markOneRead(n.id)}
                >
                  <Icon size={15} className="notif-item-icon" style={{ color }} />
                  <div className="notif-item-body">
                    <div className="notif-item-title">{titleFor(n, t)}</div>
                    <div className="notif-item-time">{timeAgo(n.created_at, t)}</div>
                  </div>
                  <button className="notif-item-dismiss" onClick={(e) => dismiss(e, n.id)} title={t('notifications.dismiss')}>
                    <X size={13} />
                  </button>
                </div>
              )
            })}
          </div>

          {hasReadItems && (
            <div className="notif-panel-footer">
              <button className="notif-clear-read-btn" onClick={clearRead}>
                <Trash2 size={12} /> {t('notifications.clearRead')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
