import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldBan, Plus, Trash2, ShieldAlert, Info } from 'lucide-react'
import api from '../api/client'
import { PageHeader, Card, Button, Modal, MsgBanner, EmptyState, SkeletonRows, Badge } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'
import { GeoInfo, formatFull, formatTokyo, timeAgo } from './PageSecurity'

function DetailRow({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function IpDetailModal({ item, onClose, t }) {
  if (!item) return null
  const { record, kind } = item
  return (
    <Modal title={t('security.fullDetails', { ip: record.ip })} onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>}>
      <div className="card-title" style={{ marginBottom: 8 }}>{t('ipLists.basicInfo')}</div>
      <DetailRow label={t('security.ipAddress')} value={record.ip} />
      {kind === 'list' && <DetailRow label={t('ipLists.colNote')} value={record.note} />}
      {kind === 'list' && <DetailRow label={t('ipLists.colAddedBy')} value={record.added_by} />}
      {kind === 'list' && <DetailRow label={t('ipLists.addedAtTaiwan')} value={formatFull(record.added_at, t)} />}
      {kind === 'list' && <DetailRow label={t('ipLists.addedAtTokyo')} value={formatTokyo(record.added_at, t)} />}
      {kind === 'banned' && <DetailRow label={t('security.sourceJail')} value={record.jail} />}
      {kind === 'banned' && <DetailRow label={t('security.banStartTaiwan')} value={formatFull(record.since, t)} />}
      {kind === 'banned' && <DetailRow label={t('security.banStartTokyo')} value={formatTokyo(record.since, t)} />}
      {kind === 'banned' && <DetailRow label={t('security.timeSinceLabel')} value={timeAgo(record.since, t)} />}

      <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>{t('ipLists.geoDetails')}</div>
      <GeoInfo geo={record.geo} />
    </Modal>
  )
}

function IpTable({ title, icon: Icon, entries, loading, onDelete, onDetail, emptyText, t }) {
  return (
    <Card className="animate-in animate-in-1">
      <div className="card-title"><Icon size={15} /> {title}</div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('ipLists.colIp')}</th><th>{t('ipLists.colNote')}</th>
              <th>{t('ipLists.colAddedBy')}</th><th>{t('ipLists.colAddedAt')}</th>
              <th style={{ width: 150 }}>{t('ipLists.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows colSpan={5} rows={2} />}
            {!loading && entries.length === 0 && <EmptyState text={emptyText} colSpan={5} />}
            {entries.map(e => (
              <tr key={e.ip}>
                <td className="cell-strong ip">{e.ip}</td>
                <td>{e.note || '—'}</td>
                <td>{e.added_by}</td>
                <td style={{ fontSize: 11.5 }}>{formatFull(e.added_at, t)}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <Button variant="ghost" size="sm" icon={Info} onClick={() => onDetail(e)}>{t('ipLists.detail')}</Button>
                  <Button variant="danger" size="sm" icon={Trash2} onClick={() => onDelete(e.ip)}>{t('common.delete')}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export default function PageIpLists() {
  const { t } = useLanguage()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState({ text: '', type: '' })
  const [showAdd, setShowAdd] = useState(null) // 'whitelist' | 'blacklist' | null
  const [form, setForm] = useState({ ip: '', note: '' })
  const [submitting, setSubmitting] = useState(false)
  const [detailItem, setDetailItem] = useState(null)

  const load = () => {
    api.get('/ip-lists/').then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const del = async (kind, ip) => {
    if (!confirm(t('ipLists.deleteConfirm', { ip }))) return
    try {
      await api.delete(`/ip-lists/${kind}/${ip}`)
      setMsg({ text: t('ipLists.deleteSuccess', { ip }), type: 'success' })
      load()
    } catch (err) {
      setMsg({ text: apiErrorText(err, t), type: 'error' })
    }
  }

  const submitAdd = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await api.post(`/ip-lists/${showAdd}`, form)
      setMsg({ text: t('ipLists.addSuccess', { ip: form.ip }), type: 'success' })
      setShowAdd(null)
      setForm({ ip: '', note: '' })
      load()
    } catch (err) {
      setMsg({ text: t('ipLists.addFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const promote = async (ip) => {
    try {
      await api.post('/ip-lists/blacklist', { ip, note: '' })
      setMsg({ text: t('ipLists.addSuccess', { ip }), type: 'success' })
      load()
    } catch (err) {
      setMsg({ text: t('ipLists.addFailed', { error: apiErrorText(err, t) }), type: 'error' })
    }
  }

  const d = data || { whitelist: [], blacklist: [], fail2ban_banned: [] }
  const blacklistIps = new Set(d.blacklist.map(e => e.ip))

  return (
    <div className="page">
      <PageHeader icon={ShieldBan} title={t('ipLists.title')} subtitle={t('ipLists.subtitle')} />
      <MsgBanner msg={msg} onClose={() => setMsg({ text: '', type: '' })} />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>{t('ipLists.syncHint')}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>{t('ipLists.autoBlacklistHint', { count: 3 })}</div>

      <div className="grid grid-2" style={{ marginBottom: 18, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <Button variant="primary" size="sm" icon={Plus} onClick={() => { setShowAdd('whitelist'); setForm({ ip: '', note: '' }) }}>{t('ipLists.addIp')}</Button>
          </div>
          <IpTable title={t('ipLists.whitelist')} icon={ShieldCheck} entries={d.whitelist} loading={loading}
            onDelete={ip => del('whitelist', ip)} onDetail={e => setDetailItem({ record: e, kind: 'list' })}
            emptyText={t('ipLists.noWhitelist')} t={t} />
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <Button variant="primary" size="sm" icon={Plus} onClick={() => { setShowAdd('blacklist'); setForm({ ip: '', note: '' }) }}>{t('ipLists.addIp')}</Button>
          </div>
          <IpTable title={t('ipLists.blacklist')} icon={ShieldBan} entries={d.blacklist} loading={loading}
            onDelete={ip => del('blacklist', ip)} onDetail={e => setDetailItem({ record: e, kind: 'list' })}
            emptyText={t('ipLists.noBlacklist')} t={t} />
        </div>
      </div>

      <Card className="animate-in animate-in-2">
        <div className="card-title"><ShieldAlert size={15} /> {t('ipLists.fail2banBanned')}</div>
        {d.fail2ban_banned.length === 0 && <div className="empty-row">{t('ipLists.noBannedIps')}</div>}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {d.fail2ban_banned.map((b, i) => (
            <div key={`${b.jail}-${b.ip}`} className="banned-ip-chip" style={{ animationDelay: `${i * 0.03}s`, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="ip">{b.ip}</span>
                <Badge tone="danger">{b.jail}</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                  {t('ipLists.bannedSince')} {timeAgo(b.since, t)}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button variant="ghost" size="sm" icon={Info} onClick={() => setDetailItem({ record: b, kind: 'banned' })}>{t('ipLists.detail')}</Button>
                  <Button variant="ghost" size="sm" disabled={blacklistIps.has(b.ip)} onClick={() => promote(b.ip)}>
                    {blacklistIps.has(b.ip) ? t('ipLists.blacklist') : t('ipLists.promoteToBlacklist')}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {showAdd && (
        <Modal title={t('ipLists.addIp')} onClose={() => setShowAdd(null)}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setShowAdd(null)}>{t('common.cancel')}</Button>
            <Button type="submit" form="ip-add-form" variant="primary" loading={submitting}>{t('common.confirm')}</Button>
          </>}>
          <form id="ip-add-form" onSubmit={submitAdd}>
            <div className="field">
              <label className="field-label">{t('ipLists.ipLabel')}</label>
              <input required className="input" value={form.ip} onChange={e => setForm({ ...form, ip: e.target.value })} placeholder="1.2.3.4" />
            </div>
            <div className="field" style={{ marginBottom: 4 }}>
              <label className="field-label">{t('ipLists.noteLabel')}</label>
              <input className="input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder={t('ipLists.notePlaceholder')} />
            </div>
          </form>
        </Modal>
      )}

      <IpDetailModal item={detailItem} onClose={() => setDetailItem(null)} t={t} />
    </div>
  )
}
