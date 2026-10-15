import { useEffect, useState } from 'react'
import {
  ShieldAlert, ShieldBan, ShieldCheck, KeyRound, Terminal, Ban, RefreshCw, Building2, Router, TriangleAlert, Eye, Globe2,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ComposedChart, Line, CartesianGrid, Legend } from 'recharts'
import api from '../api/client'
import { PageHeader, Card, Button, Badge, FormattedNumber, Modal } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'

function jailLabel(jail, t) {
  const map = { 'postfix-sasl': 'smtpAuth', postfix: 'smtpConn', dovecot: 'imapPop3', sshd: 'ssh' }
  const key = map[jail]
  return key ? t(`security.jail.${key}`) : jail
}
const jailTone = {
  'postfix-sasl': 'var(--danger)', postfix: 'var(--warning)', dovecot: 'var(--accent-violet)', sshd: 'var(--info)',
}
function jailColor(jail) {
  return jailTone[jail] || 'var(--text-muted)'
}

export function countryFlag(code) {
  if (!code || code.length !== 2) return '🌐'
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)))
}

function toDate(ts) {
  return ts.includes('T') ? new Date(ts) : new Date(ts.replace(' ', 'T') + 'Z')
}

function partsInTZ(d, timeZone) {
  const parts = {}
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d)) parts[p.type] = p.value
  if (parts.hour === '24') parts.hour = '00'
  return parts
}

function formatInTZ(ts, timeZone, label, t) {
  const p = partsInTZ(toDate(ts), timeZone)
  const weekdays = t('common.weekdays')
  const weekdayIdx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday]
  return `${p.year}-${p.month}-${p.day} ${weekdays[weekdayIdx]} ${p.hour}:${p.minute}:${p.second} ${label}`
}

/** 主要顯示：台灣時間（UTC+8）。 */
export function formatFull(ts, t) {
  return formatInTZ(ts, 'Asia/Taipei', t('common.time.taiwanTime'), t)
}
/** 附加顯示：東京時間（UTC+9）。 */
export function formatTokyo(ts, t) {
  return formatInTZ(ts, 'Asia/Tokyo', t('common.time.tokyoTime'), t)
}

export function timeAgo(ts, t) {
  const then = toDate(ts).getTime()
  const diff = Math.max(0, Date.now() - then)
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return t('common.time.secondsAgo', { n: secs })
  const mins = Math.floor(secs / 60)
  if (mins < 60) return t('common.time.minutesAgo', { m: mins, s: secs % 60 })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('common.time.hoursAgo', { h: hrs, m: mins % 60 })
  const days = Math.floor(hrs / 24)
  return t('common.time.daysAgo', { d: days, h: hrs % 24 })
}

function countryName(code) {
  return code && code.length === 2 ? code.toUpperCase() : code
}

/** 綜合兩個來源，給出一個「最可能」的答案：優先採 GeoIP 的位置推測（對實際發送地判斷通常較準），
 * GeoIP 查無資料時才退回用 RDAP 登記資料。 */
export function pickPrimary(geo, t) {
  if (geo.geoip) {
    return {
      country: geo.geoip.country, countryCode: geo.geoip.country_code,
      city: geo.geoip.city, isp: geo.geoip.isp, source: t('security.geoipGuessSource'),
    }
  }
  if (geo.rdap && geo.rdap.registered_country !== 'unknown') {
    return {
      country: countryName(geo.rdap.registered_country), countryCode: geo.rdap.registered_country,
      city: null, isp: geo.rdap.registrant_org, source: t('security.rdapRegisteredSource', { registry: geo.rdap.registry }),
    }
  }
  return null
}

export function GeoInfo({ geo }) {
  const { t } = useLanguage()
  if (!geo) return null
  if (geo.is_private) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
        <Router size={11} /> {t('security.privateNetwork')}
      </span>
    )
  }
  const { rdap, geoip, queried_at } = geo
  if (!rdap && !geoip) return <span style={{ color: 'var(--text-muted)' }}>{t('security.queryFailed')}</span>

  const primary = pickPrimary(geo, t)
  const rdapCountry = rdap?.registered_country && rdap.registered_country !== 'unknown' ? rdap.registered_country : null
  const mismatch = rdapCountry && geoip?.country_code && rdapCountry !== geoip.country_code

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {primary && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          padding: '5px 9px', borderRadius: 8, background: 'var(--primary-soft)',
        }}>
          <Badge tone="info">{t('security.mostLikely')}</Badge>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            {countryFlag(primary.countryCode)} {primary.country}{primary.city ? ` · ${primary.city}` : ''}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--text-secondary)' }}>
            <Building2 size={11} /> {primary.isp}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({primary.source})</span>
        </div>
      )}

      {rdap && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', fontSize: 11 }}>
          <Badge tone="neutral">{t('security.rdapOfficialBadge', { registry: rdap.registry })}</Badge>
          <span>{rdapCountry ? `${countryFlag(rdapCountry)} ${countryName(rdapCountry)}` : t('security.unknown')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--text-muted)' }}>
            <Building2 size={11} /> {rdap.registrant_org}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>netname: {rdap.netname}</span>
        </div>
      )}
      {geoip && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', fontSize: 11 }}>
          <Badge tone="neutral">{t('security.geoipGuessBadge')}</Badge>
          <span>{countryFlag(geoip.country_code)} {geoip.country}{geoip.city ? ` · ${geoip.city}` : ''}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--text-muted)' }}>
            <Building2 size={11} /> {geoip.isp}
          </span>
          {geoip.as && <span style={{ color: 'var(--text-muted)' }}>{geoip.as}</span>}
        </div>
      )}
      {mismatch && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--warning)', fontWeight: 600, fontSize: 10.5 }}>
          <TriangleAlert size={11} /> {t('security.mismatchWarning')}
        </div>
      )}
      {queried_at && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('security.queryTime', { time: formatFull(queried_at, t) })}</div>
      )}
    </div>
  )
}

function DetailRow({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function DetailModal({ item, onClose, t }) {
  if (!item) return null
  const { record, kind } = item
  const geo = record.geo || {}
  const primary = !geo.is_private ? pickPrimary(geo, t) : null

  return (
    <Modal title={t('security.fullDetails', { ip: record.ip })} onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        {kind === 'banned' ? t('security.banStatus') : t('security.event')}
      </div>
      <DetailRow label={t('security.ipAddress')} value={record.ip} />
      <DetailRow label={t('security.sourceJail')} value={jailLabel(record.jail, t)} />
      {kind === 'banned' && <DetailRow label={t('security.banStartTaiwan')} value={formatFull(record.since, t)} />}
      {kind === 'banned' && <DetailRow label={t('security.banStartTokyo')} value={formatTokyo(record.since, t)} />}
      {kind === 'banned' && <DetailRow label={t('security.timeSinceLabel')} value={timeAgo(record.since, t)} />}
      {kind === 'event' && <DetailRow label={t('security.action')} value={record.action} />}
      {kind === 'event' && <DetailRow label={t('security.eventTimeTaiwan')} value={formatFull(record.time, t)} />}
      {kind === 'event' && <DetailRow label={t('security.eventTimeTokyo')} value={formatTokyo(record.time, t)} />}
      {kind === 'event' && <DetailRow label={t('security.timeSinceLabel')} value={timeAgo(record.time, t)} />}

      {geo.is_private ? (
        <>
          <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('security.segmentInfo')}</div>
          <DetailRow label={t('security.type')} value={t('security.privateNetworkFull')} />
        </>
      ) : (
        <>
          {primary && (
            <>
              <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('security.mostLikelyConclusion')}</div>
              <DetailRow label={t('security.judgmentBasis')} value={primary.source} />
              <DetailRow label={t('security.country')} value={`${countryFlag(primary.countryCode)} ${primary.country}`} />
              <DetailRow label={t('security.city')} value={primary.city} />
              <DetailRow label={t('security.ispOrg')} value={primary.isp} />
            </>
          )}
          {geo.rdap && (
            <>
              <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('security.rdapOfficialData')}</div>
              <DetailRow label={t('security.registryLabel')} value={geo.rdap.registry} />
              <DetailRow label={t('security.registeredCountry')} value={geo.rdap.registered_country !== 'unknown' ? `${countryFlag(geo.rdap.registered_country)} ${countryName(geo.rdap.registered_country)}` : t('security.unknown')} />
              <DetailRow label={t('security.registeredOrg')} value={geo.rdap.registrant_org} />
              <DetailRow label={t('security.netnameLabel')} value={geo.rdap.netname} />
            </>
          )}
          {geo.geoip && (
            <>
              <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('security.geoipData')}</div>
              <DetailRow label={t('security.guessedCountry')} value={`${countryFlag(geo.geoip.country_code)} ${geo.geoip.country}`} />
              <DetailRow label={t('security.guessedCity')} value={geo.geoip.city} />
              <DetailRow label={t('security.ispLabel')} value={geo.geoip.isp} />
              <DetailRow label={t('security.asOrg')} value={geo.geoip.as} />
            </>
          )}
          {geo.queried_at && (
            <>
              <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('security.queryInfo')}</div>
              <DetailRow label={t('security.queryTimeTaiwan')} value={formatFull(geo.queried_at, t)} />
              <DetailRow label={t('security.queryTimeTokyo')} value={formatTokyo(geo.queried_at, t)} />
              <DetailRow label={t('security.cacheTtl')} value={t('security.oneHour')} />
            </>
          )}
        </>
      )}
    </Modal>
  )
}

export default function PageSecurity() {
  const { t } = useLanguage()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)

  const load = () => {
    api.get('/security/').then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  const refresh = () => { setLoading(true); load() }
  useEffect(() => { load() }, [])

  const d = data || {}
  const chartData = Object.entries(d.banned_by_jail || {}).map(([jail, count]) => ({
    name: jailLabel(jail, t), value: count, color: jailColor(jail),
  }))
  const since = d.history_since ? t('security.sinceDate', { date: d.history_since }) : ''
  const sinceTrend = d.history_since ? t('security.dailyTrendSince', { date: d.history_since }) : ''

  return (
    <div className="page">
      <PageHeader icon={ShieldAlert} title={t('security.title')} subtitle={t('security.subtitle')}
        actions={<>
          <span className="live-badge"><span className="live-dot" />{t('security.liveMonitoring')}</span>
          <Button variant="ghost" icon={RefreshCw} onClick={refresh} loading={loading}>{t('security.refresh')}</Button>
        </>} />

      <div className="quick-stat-row">
        <QuickStat icon={ShieldAlert} label={t('security.totalAttacksSince', { since })} value={d.total_attacks_alltime} color="var(--danger)" />
        <QuickStat icon={ShieldAlert}
          label={t('security.totalAttacksTracking', { date: d.tracking_started_at || '···' })}
          value={d.attacks_since_tracking} color="var(--danger)" />
        <QuickStat icon={ShieldBan} label={t('security.totalBansSince', { since })} value={d.total_bans_alltime} color="var(--accent-violet)" />
        <QuickStat icon={KeyRound} label={t('security.todaySaslFailures')} value={d.sasl_failures_today} color="var(--danger)" />
        <QuickStat icon={Terminal} label={t('security.todaySshFailures')} value={d.ssh_failures_today} color="var(--info)" />
        <QuickStat icon={Ban} label={t('security.currentlyBanned')} value={d.total_banned} color="var(--warning)" />
        <QuickStat icon={ShieldBan} label={t('security.todayNewBans')} value={d.bans_today} color="var(--accent-violet)" />
      </div>

      <Card style={{ marginBottom: 18 }}>
        <div className="card-title"><ShieldAlert size={15} /> {t('security.dailyTrend', { since: sinceTrend })}</div>
        {(d.daily_series || []).length === 0 ? (
          <div className="empty-row">{t('security.noHistoryData')}</div>
        ) : (
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <ComposedChart data={d.daily_series} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false}
                  tickFormatter={v => v.slice(5)} />
                <YAxis yAxisId="attacks" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="bans" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false} yAxisId="attacks" dataKey="attacks" name={t('security.attackAttempts')} fill="var(--info)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Line isAnimationActive={false} yAxisId="bans" dataKey="bans" name={t('security.banCount')} stroke="var(--danger)" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid dashboard-split" style={{ marginBottom: 18 }}>
        <Card>
          <div className="card-title"><Ban size={15} /> {t('security.banDistribution')}</div>
          {chartData.length === 0 ? (
            <div className="empty-row">{t('security.noBanRecords')}</div>
          ) : (
            <div style={{ width: '100%', height: 160 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip
                    cursor={{ fill: 'var(--hover)' }}
                    contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                  />
                  <Bar isAnimationActive={false} dataKey="value" radius={[0, 8, 8, 0]} maxBarSize={28}>
                    {chartData.map((c, i) => <Cell key={i} fill={c.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <div className="card-title"><Globe2 size={15} /> {t('security.countryDistribution')}</div>
          {(d.country_distribution || []).length === 0 ? (
            <div className="empty-row">{t('security.notEnoughData')}</div>
          ) : (
            <div style={{ width: '100%', height: 160 }}>
              <ResponsiveContainer>
                <BarChart data={(d.country_distribution || []).slice(0, 8).map(c => ({ name: `${countryFlag(c.country_code)} ${c.country}`, value: c.count }))}
                  layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip
                    cursor={{ fill: 'var(--hover)' }}
                    contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                  />
                  <Bar isAnimationActive={false} dataKey="value" fill="var(--danger)" radius={[0, 8, 8, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>
            {t('security.knownCountriesOf', { known: (d.country_distribution || []).reduce((s, c) => s + c.count, 0), total: d.unique_attacker_ips_alltime ?? '···' })}
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 18 }}>
        <div className="card-title"><ShieldBan size={15} /> {t('security.currentlyBannedDetail')}</div>
        {(d.currently_banned || []).length === 0 && (
          <div className="empty-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={22} style={{ color: 'var(--success)' }} />
            {t('security.noCurrentBans')}
          </div>
        )}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {(d.currently_banned || []).map(b => (
            <div key={`${b.jail}-${b.ip}`} className="banned-ip-chip" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="ip">{b.ip}</span>
                <Badge tone="danger">{jailLabel(b.jail, t)}</Badge>
              </div>
              <GeoInfo geo={b.geo} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }} title={formatFull(b.since, t)}>
                  {t('security.bannedAt', { time: formatFull(b.since, t), ago: timeAgo(b.since, t) })}
                </span>
                <Button variant="ghost" size="sm" icon={Eye} onClick={() => setDetail({ record: b, kind: 'banned' })}>{t('security.details')}</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ marginTop: 18 }}>
        <div className="card-title"><ShieldAlert size={15} /> {t('security.recentEvents')}</div>
        <div className="timeline" style={{ maxHeight: 460, overflow: 'auto' }}>
          {(d.recent_events || []).map((e, i) => (
            <div key={i} className="timeline-item">
              <span className={`timeline-dot ${e.action.includes('Ban') ? 'ban' : 'unban'}`} />
              <div className="timeline-content">
                <div>
                  <Badge tone={e.action.includes('Ban') ? 'danger' : 'success'}>{jailLabel(e.jail, t)}</Badge>
                  {' '}
                  <span className="ip">{e.ip}</span>
                  {' '}
                  {e.action.includes('Ban') ? t('security.banned') : t('security.unbanned')}
                </div>
                <div style={{ fontSize: 11, marginTop: 3 }}>
                  <GeoInfo geo={e.geo} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span className="timeline-time" title={formatFull(e.time, t)}>{timeAgo(e.time, t)}</span>
                <Button variant="ghost" size="sm" icon={Eye} onClick={() => setDetail({ record: e, kind: 'event' })}>{t('security.details')}</Button>
              </div>
            </div>
          ))}
          {(d.recent_events || []).length === 0 && <div className="empty-row">{t('security.noEvents')}</div>}
        </div>
      </Card>

      <DetailModal item={detail} onClose={() => setDetail(null)} t={t} />
    </div>
  )
}

function QuickStat({ icon: Icon, label, value, color }) {
  return (
    <div className="quick-stat">
      <div className="quick-stat-icon" style={{ color }}><Icon size={16} /></div>
      <div>
        <div className="quick-stat-value">{value != null ? <FormattedNumber value={value} /> : '···'}</div>
        <div className="quick-stat-label">{label}</div>
      </div>
    </div>
  )
}
