import { useEffect, useRef, useState } from 'react'
import { RefreshCw, TriangleAlert, CheckCircle2, ShieldPlus, ShieldAlert, Package, LayoutGrid, Boxes, AppWindow, Bug, Timer, Power, Zap } from 'lucide-react'
import api from '../api/client'
import { PageHeader, Card, Button, Badge, EmptyState, SkeletonRows, Modal, MsgBanner } from '../components/ui'
import { useLanguage, localeFor } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'

function formatUptime(bootTime, now, t) {
  if (!bootTime) return '···'
  const total = Math.max(0, Math.floor(now / 1000) - bootTime)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return t('systemUpdates.uptimeDuration', { d, h, m, s })
}

function UpgradeConfirmModal({ onClose, onStarted, t }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ text: '', type: '' })
  const word = t('services.confirmWord')
  const ready = typed.trim().toUpperCase() === word

  const go = async () => {
    setBusy(true)
    try {
      const r = await api.post('/system-updates/upgrade')
      if (r.data?.error?.code === 'upgrade_already_running') {
        setMsg({ text: t('systemUpdates.upgradeAlreadyRunning'), type: 'error' })
        setBusy(false)
        return
      }
      onStarted()
      onClose()
    } catch (err) {
      setMsg({ text: t('services.powerActionFailed', { error: apiErrorText(err, t) }), type: 'error' })
      setBusy(false)
    }
  }

  return (
    <Modal title={t('systemUpdates.upgradeConfirmTitle')} onClose={onClose}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" variant="danger" disabled={!ready} loading={busy} onClick={go}>{t('common.confirm')}</Button>
      </>}>
      <MsgBanner msg={msg} onClose={() => setMsg({ text: '', type: '' })} />
      <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--text-primary)', fontSize: 12, marginBottom: 14 }}>
        <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 1, color: 'var(--danger)' }} />
        <span>{t('systemUpdates.upgradeWarning')}</span>
      </div>
      <div className="field" style={{ marginBottom: 4 }}>
        <label className="field-label">{t('services.typeToConfirm', { word })}</label>
        <input className="input" value={typed} onChange={e => setTyped(e.target.value)} autoFocus />
      </div>
    </Modal>
  )
}

function PackageChangelogModal({ pkg, fetchPath, title, onClose, t, lang }) {
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get(fetchPath || `/system-updates/changelog/${encodeURIComponent(pkg)}`)
      .then(r => { if (!cancelled) setResult(r.data) })
      .catch(() => { if (!cancelled) setResult({ fetch_failed: true, entries: [] }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [pkg, fetchPath])

  const entries = result?.entries || []

  return (
    <Modal title={title || t('systemUpdates.changelogTitle', { package: pkg })} onClose={onClose}
      footer={<Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>}>
      {result?.installed_version && (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, marginBottom: 8 }}>
          <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.changelogInstalledVersion')}</span>
          <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{result.installed_version}</span>
        </div>
      )}
      {loading && <div className="input-hint">{t('systemUpdates.changelogLoading')}</div>}
      {!loading && (result?.fetch_failed) && <div className="input-hint">{t('systemUpdates.changelogFetchFailed')}</div>}
      {!loading && !result?.fetch_failed && entries.length === 0 && (
        <div className="input-hint">{t('systemUpdates.changelogNoData')}</div>
      )}
      {!loading && entries.map((e, i) => (
        <div key={i} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: i < entries.length - 1 ? '1px solid var(--border)' : 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 700, fontSize: 12.5 }}>{e.version}</span>
            {e.date && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t('systemUpdates.changelogReleasedAt')}: {e.date}</span>}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
            {e.changes.map((c, j) => <li key={j}>{c.replace(/^[*-]\s*/, '')}</li>)}
          </ul>
        </div>
      ))}
    </Modal>
  )
}

function ScanConfirmModal({ title, warningText, triggerPath, onClose, onStarted, t }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ text: '', type: '' })
  const word = t('services.confirmWord')
  const ready = typed.trim().toUpperCase() === word

  const go = async () => {
    setBusy(true)
    try {
      const r = await api.post(triggerPath)
      if (r.data?.error?.code) {
        setMsg({ text: t('systemUpdates.scanAlreadyRunning'), type: 'error' })
        setBusy(false)
        return
      }
      onStarted()
      onClose()
    } catch (err) {
      setMsg({ text: t('services.powerActionFailed', { error: apiErrorText(err, t) }), type: 'error' })
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" variant="danger" disabled={!ready} loading={busy} onClick={go}>{t('common.confirm')}</Button>
      </>}>
      <MsgBanner msg={msg} onClose={() => setMsg({ text: '', type: '' })} />
      <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--text-primary)', fontSize: 12, marginBottom: 14 }}>
        <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 1, color: 'var(--danger)' }} />
        <span>{warningText}</span>
      </div>
      <div className="field" style={{ marginBottom: 4 }}>
        <label className="field-label">{t('services.typeToConfirm', { word })}</label>
        <input className="input" value={typed} onChange={e => setTyped(e.target.value)} autoFocus />
      </div>
    </Modal>
  )
}

function WarningDetailModal({ warning, onClose, t }) {
  return (
    <Modal title={t('systemUpdates.warningDetailTitle')} onClose={onClose}
      footer={<Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>}>
      <div style={{ marginBottom: 14 }}>
        <div className="input-hint" style={{ marginBottom: 6 }}>{t('systemUpdates.warningExplanation')}</div>
        <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-primary)' }}>{warning.explanation}</div>
      </div>
      <div>
        <div className="input-hint" style={{ marginBottom: 6 }}>{t('systemUpdates.warningRawText')}</div>
        <pre style={{
          maxHeight: 200, overflow: 'auto', fontSize: 11.5, lineHeight: 1.6, padding: 10, borderRadius: 8,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          color: 'var(--text-primary)',
        }}>{warning.raw}</pre>
      </div>
    </Modal>
  )
}

function ScanCard({ icon: Icon, title, warningText, triggerPath, statusPath, runLabel, runningLabel, statusBadges, extraInfo, renderBeforeLog, currentAdmin, t }) {
  const [state, setState] = useState({ status: 'idle', log_tail: '' })
  const [showConfirm, setShowConfirm] = useState(false)

  const loadStatus = () => { api.get(statusPath).then(r => setState(r.data)).catch(() => {}) }
  useEffect(() => { loadStatus() }, [])
  useEffect(() => {
    if (state.status !== 'running') return
    const timer = setInterval(loadStatus, 5000)
    return () => clearInterval(timer)
  }, [state.status])

  if (!currentAdmin?.super_admin) return null

  const badge = statusBadges[state.status]

  return (
    <Card style={{ marginBottom: 18 }}>
      <div className="card-title"><Icon size={15} /> {title}</div>
      <div className="input-hint" style={{ marginBottom: 12 }}>{warningText}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button variant="danger" icon={Icon} disabled={state.status === 'running'} loading={state.status === 'running'}
          onClick={() => setShowConfirm(true)}>
          {state.status === 'running' ? runningLabel : runLabel}
        </Button>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        {extraInfo ? extraInfo(state) : null}
      </div>
      {renderBeforeLog ? renderBeforeLog(state) : null}
      {state.log_tail && (
        <div style={{ marginTop: 12 }}>
          <div className="input-hint" style={{ marginBottom: 6 }}>{t('systemUpdates.upgradeLog')}</div>
          <pre style={{
            maxHeight: 240, overflow: 'auto', fontSize: 11.5, lineHeight: 1.6, padding: 10, borderRadius: 8,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            color: 'var(--text-primary)',
          }}>{state.log_tail}</pre>
        </div>
      )}
      {showConfirm && (
        <ScanConfirmModal t={t} title={title} warningText={warningText} triggerPath={triggerPath}
          onClose={() => setShowConfirm(false)}
          onStarted={() => { loadStatus(); setState(s => ({ ...s, status: 'running' })) }} />
      )}
    </Card>
  )
}

function RoundcubeVersionCard({ t, lang }) {
  const [status, setStatus] = useState(null)
  const [showChangelog, setShowChangelog] = useState(false)

  useEffect(() => {
    api.get('/system-updates/roundcube-status').then(r => setStatus(r.data)).catch(() => {})
  }, [])

  const s = status || {}

  return (
    <Card style={{ marginBottom: 18 }}>
      <div className="card-title"><Package size={15} /> Roundcube Webmail</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.colCurrent')}</span>
        <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{s.installed_version || '···'}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
        <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.colNew')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{s.latest_version || '···'}</span>
          {s.is_security_pending && <Badge tone="danger">{t('systemUpdates.securityBadge')}</Badge>}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {status && (
          <Badge tone={s.fetch_failed ? 'neutral' : s.up_to_date ? 'success' : 'warning'}>
            {s.fetch_failed ? t('systemUpdates.changelogFetchFailed') : s.up_to_date ? t('systemUpdates.upToDate') : t('systemUpdates.hasUpdate')}
          </Badge>
        )}
        {status && !s.up_to_date && !s.fetch_failed && (
          <Button size="sm" variant="ghost" onClick={() => setShowChangelog(true)}>{t('systemUpdates.viewDetail')}</Button>
        )}
      </div>
      {showChangelog && (
        <PackageChangelogModal pkg="roundcube" fetchPath="/system-updates/roundcube-changelog"
          title={t('systemUpdates.roundcubeChangelogTitle')} t={t} lang={lang} onClose={() => setShowChangelog(false)} />
      )}
    </Card>
  )
}

const TABS = [
  { key: 'overview', icon: LayoutGrid, labelKey: 'systemUpdates.tabOverview' },
  { key: 'os', icon: Boxes, labelKey: 'systemUpdates.tabOs' },
  { key: 'software', icon: AppWindow, labelKey: 'systemUpdates.tabSoftware' },
  { key: 'antivirus', icon: Bug, labelKey: 'systemUpdates.tabAntivirus' },
]

function PackageTable({ packages, loading, t, onViewDetail }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('systemUpdates.colPackage')}</th><th>{t('systemUpdates.colCurrent')}</th>
            <th>{t('systemUpdates.colNew')}</th><th>{t('systemUpdates.colSource')}</th><th></th>
          </tr>
        </thead>
        <tbody>
          {loading && <SkeletonRows colSpan={5} rows={4} />}
          {!loading && packages.length === 0 && <EmptyState text={t('systemUpdates.noPendingPackages')} colSpan={5} />}
          {packages.map(p => (
            <tr key={p.name}>
              <td className="cell-strong">{p.name} {p.is_security && <Badge tone="danger">{t('systemUpdates.securityBadge')}</Badge>}</td>
              <td style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12 }}>{p.current_version}</td>
              <td style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12 }}>{p.new_version}</td>
              <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.repo}</td>
              <td><Button size="sm" variant="ghost" onClick={() => onViewDetail(p.name)}>{t('systemUpdates.viewDetail')}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PageSystemUpdates({ currentAdmin }) {
  const { t, lang } = useLanguage()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [now, setNow] = useState(Date.now())
  const [showUpgradeConfirm, setShowUpgradeConfirm] = useState(false)
  const [upgrade, setUpgrade] = useState({ status: 'idle', log_tail: '' })
  const [detailPackage, setDetailPackage] = useState(null)
  const [detailWarning, setDetailWarning] = useState(null)
  const prevUpgradeStatus = useRef('idle')

  const load = () => {
    api.get('/system-updates/').then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  const refresh = () => { setLoading(true); load() }
  useEffect(() => { load() }, [])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const loadUpgradeStatus = () => {
    api.get('/system-updates/upgrade-status').then(r => setUpgrade(r.data)).catch(() => {})
  }
  useEffect(() => { loadUpgradeStatus() }, [])
  useEffect(() => {
    if (upgrade.status !== 'running') return
    const timer = setInterval(loadUpgradeStatus, 3000)
    return () => clearInterval(timer)
  }, [upgrade.status])
  useEffect(() => {
    if (prevUpgradeStatus.current === 'running' && (upgrade.status === 'success' || upgrade.status === 'failed')) {
      load()
    }
    prevUpgradeStatus.current = upgrade.status
  }, [upgrade.status])

  const [summary, setSummary] = useState(null)
  useEffect(() => {
    api.get('/system-updates/summary').then(r => setSummary(r.data)).catch(() => {})
  }, [data])

  const d = data || {}
  const overview = d.overview || {}
  const osUpdates = d.os_updates || { packages: [] }
  const softwareUpdates = d.software_updates || { packages: [], tracked_services: [] }
  const av = d.antivirus_updates || {}
  const dbDate = av.db_updated_at
    ? new Date(av.db_updated_at * 1000).toLocaleString(localeFor(lang))
    : '···'
  const bootTimeStr = overview.boot_time
    ? new Date(overview.boot_time * 1000).toLocaleString(localeFor(lang))
    : '···'
  const lastPackageUpdateStr = overview.last_package_update_at
    ? new Date(overview.last_package_update_at * 1000).toLocaleString(localeFor(lang))
    : t('systemUpdates.noUpdateRecord')

  return (
    <div className="page">
      <PageHeader icon={Package} title={t('systemUpdates.title')} subtitle={t('systemUpdates.subtitle')}
        actions={<Button variant="ghost" icon={RefreshCw} onClick={refresh} loading={loading}>{t('services.refresh')}</Button>} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, marginBottom: 18,
        background: overview.reboot_required ? 'var(--warning-bg)' : 'var(--success-bg)',
        color: overview.reboot_required ? 'var(--warning-text)' : 'var(--success-text)',
      }}>
        {overview.reboot_required ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {overview.reboot_required ? t('systemUpdates.rebootRequired') : t('systemUpdates.noRebootNeeded')}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map(tb => (
          <button key={tb.key} type="button" onClick={() => setTab(tb.key)}
            style={{
              padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
              background: tab === tb.key ? 'var(--primary-soft)' : 'var(--bg-secondary)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontWeight: tab === tb.key ? 700 : 400,
              border: `1px solid ${tab === tb.key ? 'var(--primary)' : 'var(--border)'}`,
              color: tab === tb.key ? 'var(--primary)' : 'var(--text-primary)',
            }}>
            <tb.icon size={14} /> {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <Card style={{ marginBottom: 18 }}>
            <div className="card-title"><Timer size={15} /> {t('systemUpdates.uptimeTitle')}</div>
            <div className="grid grid-2">
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}><Power size={12} style={{ verticalAlign: -1, marginRight: 4 }} />{t('systemUpdates.bootTime')}</span>
                  <span>{bootTimeStr}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.uptime')}</span>
                  <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{formatUptime(overview.boot_time, now, t)}</span>
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.lastPackageUpdate')}</span>
                  <span>{lastPackageUpdateStr}</span>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid-2" style={{ marginBottom: 18, alignItems: 'start' }}>
            <Card>
              <div className="card-title"><ShieldPlus size={15} /> {t('systemUpdates.unattendedUpgrades')}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.unattendedUpgrades')}</span>
                <Badge tone={overview.unattended_upgrades?.active ? 'success' : 'neutral'}>
                  {overview.unattended_upgrades?.active ? t('systemUpdates.uuEnabled') : t('systemUpdates.uuDisabled')}
                </Badge>
              </div>
            </Card>
            <Card>
              <div className="card-title">{t('systemUpdates.overviewCounts')}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.tabOs')}</span>
                <Badge tone={overview.os_package_count ? 'warning' : 'success'}>{overview.os_package_count ?? 0}</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.tabSoftware')}</span>
                <Badge tone={overview.software_package_count ? 'warning' : 'success'}>{overview.software_package_count ?? 0}</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.tabAntivirus')}</span>
                <Badge tone={overview.clamav_ok ? 'success' : 'danger'}>{overview.clamav_ok ? t('systemUpdates.uuEnabled') : t('systemUpdates.uuDisabled')}</Badge>
              </div>
              {summary && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Roundcube</span>
                    {(() => {
                      const rc = summary.items.find(i => i.key === 'roundcube')
                      return (
                        <Badge tone={rc?.needs_action ? (rc.is_security ? 'danger' : 'warning') : 'success'}>
                          {rc?.needs_action ? (rc.is_security ? t('systemUpdates.securityBadge') : t('systemUpdates.hasUpdate')) : t('systemUpdates.upToDate')}
                        </Badge>
                      )
                    })()}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>rkhunter</span>
                    <Badge tone={summary.items.find(i => i.key === 'rkhunter')?.needs_action ? 'warning' : 'success'}>
                      {summary.items.find(i => i.key === 'rkhunter')?.needs_action ? t('systemUpdates.scanWarning') : t('systemUpdates.scanClean')}
                    </Badge>
                  </div>
                </>
              )}
              {overview.security_packages > 0 && (
                <div className="input-hint" style={{ marginTop: 6 }}>{t('systemUpdates.securityCount', { count: overview.security_packages })}</div>
              )}
            </Card>
          </div>

          {currentAdmin?.super_admin && (
            <Card style={{ marginBottom: 18 }}>
              <div className="card-title"><Zap size={15} /> {t('systemUpdates.oneClickUpdate')}</div>
              <div className="input-hint" style={{ marginBottom: 12 }}>{t('systemUpdates.upgradeWarning')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Button variant="danger" icon={Zap} disabled={upgrade.status === 'running'} loading={upgrade.status === 'running'}
                  onClick={() => setShowUpgradeConfirm(true)}>
                  {upgrade.status === 'running' ? t('systemUpdates.upgradeRunning') : t('systemUpdates.runUpgrade')}
                </Button>
                {upgrade.status === 'success' && <Badge tone="success">{t('systemUpdates.upgradeSuccess')}</Badge>}
                {upgrade.status === 'failed' && <Badge tone="danger">{t('systemUpdates.upgradeFailed')}</Badge>}
              </div>
              {upgrade.log_tail && (
                <div style={{ marginTop: 12 }}>
                  <div className="input-hint" style={{ marginBottom: 6 }}>{t('systemUpdates.upgradeLog')}</div>
                  <pre style={{
                    maxHeight: 240, overflow: 'auto', fontSize: 11.5, lineHeight: 1.6, padding: 10, borderRadius: 8,
                    background: 'var(--bg-secondary)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    color: 'var(--text-primary)',
                  }}>{upgrade.log_tail}</pre>
                </div>
              )}
            </Card>
          )}

          {overview.reboot_required_packages?.length > 0 && (
            <Card>
              <div className="card-title"><TriangleAlert size={15} /> {t('systemUpdates.rebootRequiredPackages')}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                {overview.reboot_required_packages.join(', ')}
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'os' && (
        <Card>
          <div className="card-title"><Boxes size={15} />
            {t('systemUpdates.pendingPackages', { count: osUpdates.packages.length })}
          </div>
          <PackageTable packages={osUpdates.packages} loading={loading} t={t} onViewDetail={setDetailPackage} />
        </Card>
      )}

      {tab === 'software' && (
        <>
          <Card style={{ marginBottom: 18 }}>
            <div className="card-title"><AppWindow size={15} /> {t('systemUpdates.trackedServices')}</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>{t('systemUpdates.colPackage')}</th><th>{t('systemUpdates.colCurrent')}</th><th>{t('systemUpdates.colStatus')}</th></tr>
                </thead>
                <tbody>
                  {loading && <SkeletonRows colSpan={3} rows={3} />}
                  {(softwareUpdates.tracked_services || []).map(s => (
                    <tr key={s.name}>
                      <td className="cell-strong">{s.name}</td>
                      <td style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12 }}>{s.installed_version || '—'}</td>
                      <td><Badge tone={s.upgradable ? 'warning' : 'success'}>{s.upgradable ? t('systemUpdates.hasUpdate') : t('systemUpdates.upToDate')}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="input-hint" style={{ marginTop: 8 }}>{t('systemUpdates.roundcubeTrackedHint')}</div>
          </Card>

          <RoundcubeVersionCard t={t} lang={lang} />

          <ScanCard t={t} currentAdmin={currentAdmin} icon={Package}
            title={t('systemUpdates.roundcubeUpdate')}
            warningText={t('systemUpdates.roundcubeUpdateWarning')}
            triggerPath="/system-updates/roundcube-update" statusPath="/system-updates/roundcube-update-status"
            runLabel={t('systemUpdates.runUpdate')} runningLabel={t('systemUpdates.scanRunning')}
            statusBadges={{
              success: { tone: 'success', label: t('systemUpdates.upgradeSuccess') },
              up_to_date: { tone: 'success', label: t('systemUpdates.upToDate') },
              failed: { tone: 'danger', label: t('systemUpdates.upgradeFailed') },
            }} />

          <Card>
            <div className="card-title"><Package size={15} />
              {t('systemUpdates.pendingPackages', { count: softwareUpdates.packages.length })}
            </div>
            <PackageTable packages={softwareUpdates.packages} loading={loading} t={t} onViewDetail={setDetailPackage} />
          </Card>
        </>
      )}

      {tab === 'antivirus' && (
        <>
          <Card style={{ marginBottom: 18 }}>
            <div className="card-title">{t('systemUpdates.clamavStatus')}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.clamavVersion')}</span>
              <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}>{av.version || '···'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{t('systemUpdates.dbUpdatedAt')}</span>
              <span>{dbDate}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '6px 0' }}>
              <Badge tone={av.daemon_active ? 'success' : 'danger'} dot>{t('systemUpdates.daemonActive')}</Badge>
              <Badge tone={av.freshclam_active ? 'success' : 'danger'} dot>{t('systemUpdates.freshclamActive')}</Badge>
            </div>
          </Card>

          <ScanCard t={t} currentAdmin={currentAdmin} icon={Bug}
            title={t('systemUpdates.clamavFullScan')}
            warningText={t('systemUpdates.clamavFullScanWarning')}
            triggerPath="/system-updates/clamav-scan" statusPath="/system-updates/clamav-scan-status"
            runLabel={t('systemUpdates.runScan')} runningLabel={t('systemUpdates.scanRunning')}
            statusBadges={{
              clean: { tone: 'success', label: t('systemUpdates.scanClean') },
              infected: { tone: 'danger', label: t('systemUpdates.scanInfected') },
              failed: { tone: 'danger', label: t('systemUpdates.scanFailed') },
            }} />

          <ScanCard t={t} currentAdmin={currentAdmin} icon={ShieldAlert}
            title={t('systemUpdates.rkhunterCheck')}
            warningText={t('systemUpdates.rkhunterCheckWarning')}
            triggerPath="/system-updates/rkhunter-check" statusPath="/system-updates/rkhunter-status"
            runLabel={t('systemUpdates.runScan')} runningLabel={t('systemUpdates.scanRunning')}
            statusBadges={{
              clean: { tone: 'success', label: t('systemUpdates.scanClean') },
              warning: { tone: 'warning', label: t('systemUpdates.scanWarning') },
              failed: { tone: 'danger', label: t('systemUpdates.scanFailed') },
            }}
            extraInfo={(state) => state.warning_count > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {t('systemUpdates.rkhunterWarningCount', { count: state.warning_count })}
              </span>
            )}
            renderBeforeLog={(state) => state.warnings?.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {state.warnings.map((w, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                    padding: '9px 0', borderBottom: i < state.warnings.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {w.raw.split('\n')[0].replace(/^Warning:\s*/, '')}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setDetailWarning(w)}>{t('systemUpdates.viewDetail')}</Button>
                  </div>
                ))}
              </div>
            )} />
        </>
      )}

      {showUpgradeConfirm && (
        <UpgradeConfirmModal t={t} onClose={() => setShowUpgradeConfirm(false)}
          onStarted={() => { loadUpgradeStatus(); setUpgrade(u => ({ ...u, status: 'running' })) }} />
      )}

      {detailPackage && (
        <PackageChangelogModal pkg={detailPackage} t={t} lang={lang} onClose={() => setDetailPackage(null)} />
      )}

      {detailWarning && (
        <WarningDetailModal warning={detailWarning} t={t} onClose={() => setDetailWarning(null)} />
      )}
    </div>
  )
}
