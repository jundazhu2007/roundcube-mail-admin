import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts'
import { useLanguage, localeFor } from '../i18n/LanguageContext'

export function PageHeader({ icon: Icon, title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h2 className="page-title">{Icon && <Icon size={19} />} {title}</h2>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function Card({ children, hover, style, className = '' }) {
  return (
    <div className={`card card-pad ${hover ? 'card-hover' : ''} ${className}`} style={style}>
      {children}
    </div>
  )
}

export function Button({ variant = 'ghost', size, icon: Icon, loading, children, className = '', ...props }) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', className].join(' ')
  return (
    <button className={cls} {...props}>
      {loading ? <span className={variant === 'primary' ? 'spinner' : 'spinner spinner-dark'} /> : (Icon && <Icon size={14} />)}
      {children}
    </button>
  )
}

export function Badge({ tone = 'neutral', dot, children }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className={`dot ${tone === 'success' ? 'dot-success' : tone === 'danger' ? 'dot-danger' : ''}`} />}
      {tone === 'success' && <span className="badge-sparkle">✨</span>}
      {children}
    </span>
  )
}

export function StatusBadge({ active, activeLabel, inactiveLabel }) {
  const { t } = useLanguage()
  return (
    <Badge tone={active ? 'success' : 'danger'} dot>
      {active ? (activeLabel ?? t('common.running')) : (inactiveLabel ?? t('common.stopped'))}
    </Badge>
  )
}

export function Modal({ title, onClose, children, footer, width }) {
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={width ? { width } : undefined} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export function MsgBanner({ msg, onClose }) {
  useEffect(() => {
    if (!msg?.text) return
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [msg?.text, msg?.type])

  if (!msg?.text) return null
  const emoji = msg.type === 'success' ? '😻' : msg.type === 'error' ? '😿' : '🐱'
  return (
    <div key={msg.text} className={`msg-banner ${msg.type}`}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="msg-banner-emoji">{emoji}</span>
        <span>{msg.text}</span>
      </span>
      <span className="close-x" onClick={onClose}><X size={14} /></span>
      <span className="progress-bar" />
    </div>
  )
}

const EMPTY_STATE_EMOJI = ['🐾', '😴', '📭', '🐟', '🧶']

export function EmptyState({ text, colSpan }) {
  const emoji = EMPTY_STATE_EMOJI[text ? text.length % EMPTY_STATE_EMOJI.length : 0]
  return (
    <tr><td colSpan={colSpan} className="empty-row"><span className="empty-row-paw">{emoji}</span>{text}</td></tr>
  )
}

export function Skeleton({ width = '100%', height = 14 }) {
  return <div className="skeleton" style={{ width, height }} />
}

export function SkeletonRows({ colSpan, rows = 4 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="skeleton-row">
      <td colSpan={colSpan}><Skeleton height={16} width={`${85 - i * 8}%`} /></td>
    </tr>
  ))
}

const AVATAR_HUES = ['#6d5bf6', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6', '#8b5cf6']

export function Avatar({ name, size = 32 }) {
  const str = name || '?'
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  const hue = AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length]
  const initials = str.slice(0, 2).toUpperCase()
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: `${hue}26`, color: hue,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, flexShrink: 0, letterSpacing: '-.02em',
    }}>
      {initials}
    </div>
  )
}

export function RadialGauge({ value = 0, color = 'var(--primary)', size = 96, label, sublabel }) {
  const pct = Math.min(100, Math.max(0, Math.round(value)))
  const data = [{ value: pct }]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: size, height: size, position: 'relative' }}>
        <RadialBarChart width={size} height={size} innerRadius="72%" outerRadius="100%"
          data={data} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={20} fill={color} background={{ fill: 'var(--metric-bg)' }} />
        </RadialBarChart>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.2, fontWeight: 700, color: 'var(--text-primary)',
        }}>{pct}%</div>
      </div>
      {label && <div style={{ fontSize: 12, fontWeight: 600, marginTop: 10, color: 'var(--text-primary)' }}>{label}</div>}
      {sublabel && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sublabel}</div>}
    </div>
  )
}

export function AnimatedNumber({ value, duration = 800 }) {
  const { lang } = useLanguage()
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    const target = Number(value) || 0
    const from = fromRef.current
    const start = performance.now()
    let raf
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(from + (target - from) * eased))
      if (progress < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return display.toLocaleString(localeFor(lang))
}
