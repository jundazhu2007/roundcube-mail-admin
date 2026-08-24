import { useEffect, useRef, useState } from 'react'
import { Activity, Cpu, MemoryStick, HardDrive, Wifi, ArrowUp, ArrowDown } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import api from '../api/client'
import { PageHeader, Card, Badge } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'

const MAX_POINTS = 30
const POLL_MS = 2000

function formatRate(bytesPerSec) {
  if (bytesPerSec == null || Number.isNaN(bytesPerSec)) return '···'
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`
}

function StatBadge({ icon: Icon, label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="stat-icon" style={{ background: `${color}22`, color, marginBottom: 0 }}><Icon size={16} /></div>
      <div>
        <div className="stat-value" style={{ fontSize: 16 }}>{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}

export default function PageMonitor() {
  const { t } = useLanguage()
  const [points, setPoints] = useState([])
  const [latest, setLatest] = useState(null)
  const prevRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      api.get('/services/live-stats').then(r => {
        if (cancelled) return
        const cur = r.data
        const prev = prevRef.current
        const dt = prev ? (cur.timestamp - prev.timestamp) : null

        const rate = (curVal, prevVal) => {
          if (!dt || dt <= 0 || curVal == null || prevVal == null) return null
          const diff = curVal - prevVal
          return diff >= 0 ? diff / dt : null
        }

        const netUp = rate(cur.tx_bytes, prev?.tx_bytes)
        const netDown = rate(cur.rx_bytes, prev?.rx_bytes)
        const diskRead = rate(cur.disk_read_bytes, prev?.disk_read_bytes)
        const diskWrite = rate(cur.disk_write_bytes, prev?.disk_write_bytes)
        const memPercent = cur.mem_total_mb ? (cur.mem_used_mb / cur.mem_total_mb) * 100 : null

        const point = {
          time: new Date(cur.timestamp * 1000).toLocaleTimeString(),
          cpu: cur.cpu_percent,
          mem: memPercent,
          netUp, netDown, diskRead, diskWrite,
        }

        setPoints(p => [...p, point].slice(-MAX_POINTS))
        setLatest({ ...cur, netUp, netDown, diskRead, diskWrite, memPercent })
        prevRef.current = cur
      }).catch(() => {})
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  const chartCard = (titleKey, icon, children) => (
    <Card className="animate-in" style={{ marginBottom: 18 }}>
      <div className="card-title">{icon} {t(titleKey)}</div>
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </Card>
  )

  return (
    <div className="page">
      <PageHeader icon={Activity} title={t('monitor.title')} subtitle={t('monitor.subtitle')}
        actions={<span className="live-badge"><span className="live-dot" />{t('dashboard.liveMonitoring')}</span>} />

      <Card className="animate-in animate-in-1" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          <StatBadge icon={Cpu} label={t('monitor.cpu')} value={latest?.cpu_percent != null ? `${latest.cpu_percent.toFixed(1)}%` : '···'} color="var(--accent-violet)" />
          <StatBadge icon={MemoryStick} label={t('monitor.memory')} value={latest?.memPercent != null ? `${latest.memPercent.toFixed(1)}%` : '···'} color="var(--info)" />
          <StatBadge icon={ArrowUp} label={t('monitor.netUp')} value={formatRate(latest?.netUp)} color="var(--success)" />
          <StatBadge icon={ArrowDown} label={t('monitor.netDown')} value={formatRate(latest?.netDown)} color="var(--accent-teal)" />
          <StatBadge icon={HardDrive} label={t('monitor.diskRead')} value={formatRate(latest?.diskRead)} color="var(--warning)" />
          <StatBadge icon={HardDrive} label={t('monitor.diskWrite')} value={formatRate(latest?.diskWrite)} color="var(--danger)" />
        </div>
      </Card>

      <div className="grid grid-2">
        {chartCard('monitor.cpuChart', <Cpu size={15} />,
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={30} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} unit="%" domain={[0, 100]} />
            <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
            <Line type="monotone" dataKey="cpu" name={t('monitor.cpu')} stroke="var(--accent-violet)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        )}

        {chartCard('monitor.memChart', <MemoryStick size={15} />,
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={30} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} unit="%" domain={[0, 100]} />
            <Tooltip contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
            <Line type="monotone" dataKey="mem" name={t('monitor.memory')} stroke="var(--info)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        )}

        {chartCard('monitor.networkChart', <Wifi size={15} />,
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={30} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={formatRate} width={70} />
            <Tooltip formatter={formatRate} contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="netUp" name={t('monitor.netUp')} stroke="var(--success)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="netDown" name={t('monitor.netDown')} stroke="var(--accent-teal)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        )}

        {chartCard('monitor.diskChart', <HardDrive size={15} />,
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={30} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={formatRate} width={70} />
            <Tooltip formatter={formatRate} contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="diskRead" name={t('monitor.diskRead')} stroke="var(--warning)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="diskWrite" name={t('monitor.diskWrite')} stroke="var(--danger)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        )}
      </div>

      <Card className="animate-in animate-in-2">
        <div className="card-title"><Wifi size={15} /> {t('monitor.connections')}</div>
        <div className="input-hint" style={{ marginBottom: 10 }}>{t('monitor.connectionsHint')}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Badge tone="success">{t('monitor.internal')}: {latest?.connections?.internal ?? '···'}</Badge>
          <Badge tone="neutral">{t('monitor.external')}: {latest?.connections?.external ?? '···'}</Badge>
        </div>
      </Card>
    </div>
  )
}
