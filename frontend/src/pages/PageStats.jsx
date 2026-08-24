import { useEffect, useState } from 'react'
import { BarChart3, Send, ShieldOff, Bug, MailWarning } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts'
import api from '../api/client'
import { PageHeader, Card, AnimatedNumber } from '../components/ui'

const items = [
  { key: 'sent', label: '已發送', icon: Send, tone: 'success', color: 'var(--success)' },
  { key: 'blocked', label: '已攔截', icon: ShieldOff, tone: 'danger', color: 'var(--danger)' },
  { key: 'virus', label: '病毒', icon: Bug, tone: 'danger', color: '#e0525c' },
  { key: 'spam', label: '垃圾信', icon: MailWarning, tone: 'warning', color: 'var(--warning)' },
]

const toneVars = {
  success: { bg: 'var(--success-bg)', color: 'var(--success)' },
  danger: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
  warning: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
}

export default function PageStats() {
  const [stats, setStats] = useState({})
  useEffect(() => { api.get('/stats/').then(r => setStats(r.data)).catch(() => {}) }, [])

  const chartData = items.map(it => ({ name: it.label, value: stats[it.key] || 0, color: it.color }))

  return (
    <div className="page">
      <PageHeader icon={BarChart3} title="統計報表" subtitle="今日郵件流量統計" />
      <div className="grid grid-4" style={{ marginBottom: '18px' }}>
        {items.map((it, i) => {
          const Icon = it.icon
          const t = toneVars[it.tone]
          return (
            <div key={it.key} className={`stat-card animate-in animate-in-${i + 1}`}>
              <div className="stat-icon" style={{ background: t.bg, color: t.color }}>
                <Icon size={17} />
              </div>
              <div className="stat-label">{it.label}</div>
              <div className="stat-value" style={{ color: t.color }}>
                {stats[it.key] != null ? <AnimatedNumber value={stats[it.key]} /> : '···'}
              </div>
            </div>
          )
        })}
      </div>

      <Card className="animate-in animate-in-4">
        <div className="card-title"><BarChart3 size={15} /> 今日分佈</div>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'var(--hover)' }}
                contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: 'var(--text-primary)' }}
              />
              <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={56}>
                {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  )
}
