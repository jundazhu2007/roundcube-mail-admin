import { useEffect, useState } from 'react'
import { Lock, RefreshCw, UserCheck, UserX, Smartphone, Tablet, Laptop, Eye, Globe as GlobeIcon, Filter, X } from 'lucide-react'
import api from '../api/client'
import { PageHeader, Card, Button, Badge, Modal } from '../components/ui'
import { GeoInfo, pickPrimary, countryFlag, formatFull, formatTokyo, timeAgo } from './PageSecurity'
import { useLanguage } from '../i18n/LanguageContext'

function deviceIcon(deviceType) {
  if (deviceType === 'phone') return Smartphone
  if (deviceType === 'tablet' || deviceType === 'desktop_or_tablet') return Tablet
  return Laptop
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function taipeiToUTCISO(dateStr, hour, endOfHour = false) {
  if (!dateStr) return undefined
  const [y, m, d] = dateStr.split('-').map(Number)
  const h = hour === '' || hour == null ? (endOfHour ? 23 : 0) : Number(hour)
  const sec = endOfHour ? 59 : 0
  return new Date(Date.UTC(y, m - 1, d, h - 8, sec, sec)).toISOString()
}

function DetailModal({ record, onClose, t }) {
  if (!record) return null
  const geo = record.geo || {}
  const primary = !geo.is_private ? pickPrimary(geo, t) : null

  return (
    <Modal title={t('webmailLogins.detailTitle', { user: record.user })} onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>}>
      <div className="card-title" style={{ marginBottom: 8 }}>{t('webmailLogins.loginInfo')}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.account')}</span>
        <span style={{ color: 'var(--text-primary)' }}>{record.user}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.result')}</span>
        <Badge tone={record.success ? 'success' : 'danger'}>{record.success ? t('webmailLogins.loginSuccess') : t('webmailLogins.loginFailed')}</Badge>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.ipAddress')}</span>
        <span className="ip">{record.ip}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.timeTaiwan')}</span>
        <span>{formatFull(record.time, t)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.timeTokyo')}</span>
        <span>{formatTokyo(record.time, t)}</span>
      </div>

      <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('webmailLogins.deviceBrowser')}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.os')}</span>
        <span>{t(`enums.os.${record.os}`)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.deviceType')}</span>
        <span>{t(`enums.device_type.${record.device_type}`)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.browser')}</span>
        <span>{t(`enums.browser.${record.browser}`)}</span>
      </div>
      {record.raw && (
        <div style={{ padding: '7px 0', fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
          {t('webmailLogins.uaRaw')}{record.raw}
        </div>
      )}

      {geo.is_private ? (
        <>
          <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('webmailLogins.locationInfo')}</div>
          <div style={{ fontSize: 13 }}>{t('webmailLogins.privateCannotLocate')}</div>
        </>
      ) : (
        <>
          {primary && (
            <>
              <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('webmailLogins.mostLikelyLocation')}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.country')}</span>
                <span>{countryFlag(primary.countryCode)} {primary.country}</span>
              </div>
              {primary.city && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.city')}</span>
                  <span>{primary.city}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('webmailLogins.ispOrg')}</span>
                <span>{primary.isp}</span>
              </div>
            </>
          )}
          <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('webmailLogins.fullGeoRdap')}</div>
          <GeoInfo geo={geo} />
        </>
      )}
    </Modal>
  )
}

const emptyFilters = {
  user: '', ip: '', country: '', region: '',
  startDate: '', startHour: '', endDate: '', endHour: '',
}

export default function PageAdminLogins() {
  const { t } = useLanguage()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [filters, setFilters] = useState(emptyFilters)

  const load = (f) => {
    const params = {}
    if (f.user) params.user = f.user
    if (f.ip) params.ip = f.ip
    if (f.country) params.country = f.country
    if (f.region) params.region = f.region
    const start = taipeiToUTCISO(f.startDate, f.startHour, false)
    const end = taipeiToUTCISO(f.endDate, f.endHour, true)
    if (start) params.start = start
    if (end) params.end = end
    api.get('/admin-logins/', { params }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  const refresh = () => { setLoading(true); load(filters) }
  useEffect(() => { load(filters) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => { setLoading(true); load(filters) }
  const clearFilters = () => { setLoading(true); setFilters(emptyFilters); load(emptyFilters) }
  const setFilter = (key, value) => setFilters(f => ({ ...f, [key]: value }))

  const logins = (data || {}).logins || []
  const successCount = logins.filter(l => l.success).length
  const failCount = logins.length - successCount
  const filterOptions = (data || {}).filters || { users: [], countries: [] }
  const hasActiveFilters = Object.values(filters).some(v => v !== '')

  return (
    <div className="page">
      <PageHeader icon={Lock} title={t('adminLogins.title')} subtitle={t('adminLogins.subtitle')}
        actions={<Button variant="ghost" icon={RefreshCw} onClick={refresh} loading={loading}>{t('webmailLogins.refresh')}</Button>} />

      <div className="quick-stat-row" style={{ marginBottom: 18 }}>
        <div className="quick-stat">
          <div className="quick-stat-icon" style={{ color: 'var(--success)' }}><UserCheck size={16} /></div>
          <div>
            <div className="quick-stat-value">{successCount}</div>
            <div className="quick-stat-label">{t('webmailLogins.filterSuccessCount')}</div>
          </div>
        </div>
        <div className="quick-stat">
          <div className="quick-stat-icon" style={{ color: 'var(--danger)' }}><UserX size={16} /></div>
          <div>
            <div className="quick-stat-value">{failCount}</div>
            <div className="quick-stat-label">{t('webmailLogins.filterFailCount')}</div>
          </div>
        </div>
      </div>

      <Card className="animate-in animate-in-1" style={{ marginBottom: 18 }}>
        <div className="card-title"><Filter size={15} /> {t('webmailLogins.filterConditions')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <div className="input-hint" style={{ marginTop: 0, marginBottom: 4 }}>{t('webmailLogins.accountFilter')}</div>
            <select className="select" value={filters.user} onChange={e => setFilter('user', e.target.value)} style={{ minWidth: 180 }}>
              <option value="">{t('webmailLogins.allAccounts')}</option>
              {filterOptions.users.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <div className="input-hint" style={{ marginTop: 0, marginBottom: 4 }}>{t('webmailLogins.ipFilter')}</div>
            <input className="input" placeholder={t('webmailLogins.ipPlaceholder')} value={filters.ip}
              onChange={e => setFilter('ip', e.target.value)} style={{ minWidth: 140 }} />
          </div>
          <div>
            <div className="input-hint" style={{ marginTop: 0, marginBottom: 4 }}>{t('webmailLogins.countryFilter')}</div>
            <select className="select" value={filters.country} onChange={e => setFilter('country', e.target.value)} style={{ minWidth: 160 }}>
              <option value="">{t('webmailLogins.allCountries')}</option>
              {filterOptions.countries.map(c => (
                <option key={c.code} value={c.code}>{countryFlag(c.code)} {c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="input-hint" style={{ marginTop: 0, marginBottom: 4 }}>{t('webmailLogins.regionFilter')}</div>
            <input className="input" placeholder={t('webmailLogins.regionPlaceholder')} value={filters.region}
              onChange={e => setFilter('region', e.target.value)} style={{ minWidth: 140 }} />
          </div>
          <div>
            <div className="input-hint" style={{ marginTop: 0, marginBottom: 4 }}>{t('webmailLogins.startTime')}</div>
            <div className="input-row">
              <input type="date" className="input" value={filters.startDate} onChange={e => setFilter('startDate', e.target.value)} />
              <select className="select" value={filters.startHour} onChange={e => setFilter('startHour', e.target.value)} style={{ width: 80 }}>
                <option value="">{t('webmailLogins.hour')}</option>
                {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')} {t('webmailLogins.hour')}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div className="input-hint" style={{ marginTop: 0, marginBottom: 4 }}>{t('webmailLogins.endTime')}</div>
            <div className="input-row">
              <input type="date" className="input" value={filters.endDate} onChange={e => setFilter('endDate', e.target.value)} />
              <select className="select" value={filters.endHour} onChange={e => setFilter('endHour', e.target.value)} style={{ width: 80 }}>
                <option value="">{t('webmailLogins.hour')}</option>
                {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')} {t('webmailLogins.hour')}</option>)}
              </select>
            </div>
          </div>
          <Button variant="primary" onClick={applyFilters} loading={loading}>{t('webmailLogins.applyFilter')}</Button>
          {hasActiveFilters && <Button variant="ghost" icon={X} onClick={clearFilters}>{t('webmailLogins.clearFilter')}</Button>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
          {t('webmailLogins.totalCount', { total: data?.total_alltime ?? '···', filtered: data?.total_filtered ?? '···' })}
        </div>
      </Card>

      <Card className="animate-in animate-in-2">
        <div className="card-title"><Lock size={15} /> {t('webmailLogins.loginRecords')}</div>
        <div className="timeline" style={{ maxHeight: 640, overflow: 'auto' }}>
          {logins.map((l, i) => {
            const DeviceIcon = deviceIcon(l.device_type)
            const primary = !l.geo?.is_private ? pickPrimary(l.geo || {}, t) : null
            return (
              <div key={i} className="timeline-item" style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }}>
                <span className={`timeline-dot ${l.success ? 'unban' : 'ban'}`} />
                <div className="timeline-content">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Badge tone={l.success ? 'success' : 'danger'}>{l.success ? t('webmailLogins.loginSuccess') : t('webmailLogins.loginFailed')}</Badge>
                    <span style={{ fontWeight: 600 }}>{l.user}</span>
                    <span className="ip">{l.ip}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <DeviceIcon size={12} /> {t(`enums.os.${l.os}`)} · {t(`enums.browser.${l.browser}`)}
                    </span>
                    {l.geo?.is_private ? (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('webmailLogins.internalNetwork')}</span>
                    ) : primary ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: 'var(--text-secondary)' }}>
                        <GlobeIcon size={12} /> {countryFlag(primary.countryCode)} {primary.country}{primary.city ? ` · ${primary.city}` : ''}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('webmailLogins.locatingOrFailed')}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span className="timeline-time" title={formatFull(l.time, t)}>{timeAgo(l.time, t)}</span>
                  <Button variant="ghost" size="sm" icon={Eye} onClick={() => setDetail(l)}>{t('webmailLogins.details')}</Button>
                </div>
              </div>
            )
          })}
          {logins.length === 0 && <div className="empty-row">{t('webmailLogins.noLoginRecords')}</div>}
        </div>
      </Card>

      <DetailModal record={detail} onClose={() => setDetail(null)} t={t} />
    </div>
  )
}
