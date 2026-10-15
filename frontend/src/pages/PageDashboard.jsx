import { useEffect, useState } from 'react'
import {
  LayoutDashboard, Activity, ScrollText, Gauge, Globe, Users, AtSign,
  Plus, Zap, Send, MailWarning, ShieldAlert, Ban, KeyRound, ArrowRight, PackageCheck,
} from 'lucide-react'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import api from '../api/client'
import { PageHeader, Card, StatusBadge, RadialGauge, Button, FormattedNumber, Badge } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'

function parsePercent(str) {
  const m = /\(([\d.]+)%\)/.exec(str || '')
  return m ? parseFloat(m[1]) : 0
}
function parseMemPercent(str) {
  const m = /^([\d.]+)\/([\d.]+)/.exec(str || '')
  if (!m) return 0
  return (parseFloat(m[1]) / parseFloat(m[2])) * 100
}

function QuickStat({ icon: Icon, label, value, color }) {
  return (
    <div className="quick-stat">
      <div className="quick-stat-icon" style={{ color }}><Icon size={16} /></div>
      <div>
        <div className="quick-stat-value">{value}</div>
        <div className="quick-stat-label">{label}</div>
      </div>
    </div>
  )
}

export default function PageDashboard({ onNavigate }) {
  const { t } = useLanguage()
  const [services, setServices] = useState([])
  const [system, setSystem] = useState({})
  const [logs, setLogs] = useState([])
  const [counts, setCounts] = useState({ domains: 0, users: 0, aliases: 0 })
  const [stats, setStats] = useState({})
  const [security, setSecurity] = useState(null)
  const [updates, setUpdates] = useState(null)

  useEffect(() => {
    api.get('/services/').then(r => setServices(r.data)).catch(()=>{})
    api.get('/services/system').then(r => setSystem(r.data)).catch(()=>{})
    api.get('/logs/?limit=8').then(r => setLogs(r.data)).catch(()=>{})
    api.get('/stats/').then(r => setStats(r.data)).catch(()=>{})
    api.get('/security/').then(r => setSecurity(r.data)).catch(()=>{})
    api.get('/system-updates/summary').then(r => setUpdates(r.data)).catch(()=>{})
    Promise.all([api.get('/domains/'), api.get('/users/'), api.get('/aliases/')])
      .then(([d, u, a]) => setCounts({ domains: d.data.length, users: u.data.length, aliases: a.data.length }))
      .catch(()=>{})
  }, [])

  const typeColor = { blocked: 'var(--danger)', virus: 'var(--danger)', error: 'var(--danger)', sent: 'var(--success)', info: 'var(--text-secondary)' }
  const chartData = [
    { name: t('dashboard.chart.sent'), value: stats.sent || 0, color: 'var(--success)' },
    { name: t('dashboard.chart.blocked'), value: stats.blocked || 0, color: 'var(--danger)' },
    { name: t('dashboard.chart.virus'), value: stats.virus || 0, color: '#e0525c' },
    { name: t('dashboard.chart.spam'), value: stats.spam || 0, color: 'var(--warning)' },
  ]

  return (
    <div className="page">
      <PageHeader icon={LayoutDashboard} title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

      <div className="quick-stat-row">
        <QuickStat icon={Globe} label={t('dashboard.domains')} value={counts.domains} color="var(--accent-violet)" />
        <QuickStat icon={Users} label={t('dashboard.users')} value={counts.users} color="var(--info)" />
        <QuickStat icon={AtSign} label={t('dashboard.aliases')} value={counts.aliases} color="var(--accent-teal)" />
        <QuickStat icon={Send} label={t('dashboard.todaySent')} value={stats.sent ?? '···'} color="var(--success)" />
      </div>

      <Card style={{ marginBottom: '18px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 0 }}><ShieldAlert size={15} /> {t('dashboard.securityOverview')}</div>
          <span className="live-badge"><span className="live-dot" />{t('dashboard.liveMonitoring')}</span>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="stat-icon" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', marginBottom: 0 }}><ShieldAlert size={16} /></div>
            <div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {security ? <FormattedNumber value={security.total_attacks_alltime} /> : '···'}
              </div>
              <div className="stat-label">{t('dashboard.totalAttacks')}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="stat-icon" style={{ background: 'var(--accent-violet)', color: '#fff', marginBottom: 0 }}><Ban size={16} /></div>
            <div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {security ? <FormattedNumber value={security.total_bans_alltime} /> : '···'}
              </div>
              <div className="stat-label">{t('dashboard.totalBans')}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="stat-icon" style={{ background: 'var(--warning-bg)', color: 'var(--warning)', marginBottom: 0 }}><KeyRound size={16} /></div>
            <div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {security ? <FormattedNumber value={security.sasl_failures_today} /> : '···'}
              </div>
              <div className="stat-label">{t('dashboard.todayAuthFailures')}</div>
            </div>
          </div>
          <Button variant="ghost" icon={ArrowRight} onClick={() => onNavigate?.('security')} style={{ marginLeft: 'auto' }}>
            {t('dashboard.viewSecurityCenter')}
          </Button>
        </div>
      </Card>

      <Card style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 0 }}><PackageCheck size={15} /> {t('dashboard.systemUpdatesOverview')}</div>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="stat-icon" style={{
              background: updates?.total_needing_action ? 'var(--warning-bg)' : 'var(--success-bg)',
              color: updates?.total_needing_action ? 'var(--warning)' : 'var(--success)', marginBottom: 0,
            }}><PackageCheck size={16} /></div>
            <div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {updates ? <FormattedNumber value={updates.total_needing_action} /> : '···'}
              </div>
              <div className="stat-label">{t('dashboard.itemsNeedingAction')}</div>
            </div>
          </div>
          {updates?.reboot_required && (
            <Badge tone="warning">{t('systemUpdates.rebootRequired')}</Badge>
          )}
          <Button variant="ghost" icon={ArrowRight} onClick={() => onNavigate?.('system-updates')} style={{ marginLeft: 'auto' }}>
            {t('dashboard.viewSystemUpdates')}
          </Button>
        </div>
      </Card>

      <Card style={{ marginBottom: '18px' }}>
        <div className="card-title"><Gauge size={15} /> {t('dashboard.resourceUsage')}</div>
        <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '20px', padding: '10px 0 4px' }}>
          <RadialGauge value={parseFloat(system.cpu) || 0} color="var(--accent-violet)" size={104} label={t('dashboard.cpu')} sublabel={system.cpu ? `${system.cpu}%` : '···'} />
          <RadialGauge value={parseMemPercent(system.memory)} color="var(--info)" size={104} label={t('dashboard.memory')} sublabel={system.memory ? `${system.memory} MB` : '···'} />
          <RadialGauge value={parsePercent(system.disk_root)} color="var(--accent-teal)" size={104} label={t('dashboard.diskRoot')} sublabel={system.disk_root || '···'} />
          <RadialGauge value={parsePercent(system.disk_nas)} color={system.nfs === 'mounted' ? 'var(--success)' : 'var(--danger)'} size={104} label={t('dashboard.diskNas')} sublabel={system.disk_nas || '···'} />
        </div>
      </Card>

      <div className="grid dashboard-split" style={{ marginBottom: '18px' }}>
        <Card>
          <div className="card-title"><Zap size={15} /> {t('dashboard.quickActions')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Button variant="primary" icon={Plus} onClick={() => onNavigate?.('users')}>{t('dashboard.addUser')}</Button>
            <Button variant="ghost" icon={Plus} onClick={() => onNavigate?.('aliases')}>{t('dashboard.addAlias')}</Button>
            <Button variant="ghost" icon={Plus} onClick={() => onNavigate?.('domains')}>{t('dashboard.addDomain')}</Button>
          </div>
        </Card>

        <Card>
          <div className="card-title"><MailWarning size={15} /> {t('dashboard.todayMailDistribution')}</div>
          <div style={{ width: '100%', height: 160 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -28, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'var(--hover)' }}
                  contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                <Bar isAnimationActive={false} dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={40}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid dashboard-split">
        <Card>
          <div className="card-title"><Activity size={15} /> {t('dashboard.serviceStatus')}</div>
          <div className="service-chip-grid">
            {services.map(s => (
              <div key={s.name} className="service-chip">
                <span className={`dot ${s.status === 'active' ? 'dot-success' : 'dot-danger'}`} />
                <span className="service-chip-name">{s.name}</span>
                <StatusBadge active={s.status === 'active'} />
              </div>
            ))}
          </div>
          {services.length === 0 && <div className="empty-row">{t('common.loading')}</div>}
        </Card>

        <Card>
          <div className="card-title"><ScrollText size={15} /> {t('dashboard.latestLogs')}</div>
          {logs.map((l, i) => (
            <div key={i} style={{
              fontSize: '12px', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', padding: '6px 0',
              borderBottom: '1px solid var(--border)', color: typeColor[l.type] || 'var(--text-secondary)',
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}>
              {l.raw}
            </div>
          ))}
          {logs.length === 0 && <div className="empty-row">{t('dashboard.noLogs')}</div>}
        </Card>
      </div>
    </div>
  )
}
