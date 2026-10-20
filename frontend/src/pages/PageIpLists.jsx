import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ShieldCheck, ShieldBan, Plus, Trash2, ShieldAlert, Info, Network, Search, RefreshCw,
  ChevronLeft, ChevronRight, ArrowUp, ArrowDown,
} from 'lucide-react'
import api from '../api/client'
import { PageHeader, Card, Button, Modal, MsgBanner, EmptyState, SkeletonRows, Badge, FormattedNumber } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'
import { GeoInfo, pickPrimary, countryFlag, formatFull, formatTokyo, timeAgo } from './PageSecurity'

const TABS = [
  { id: 'blacklist', labelKey: 'ipLists.blacklist', icon: ShieldBan, color: 'var(--danger)' },
  { id: 'banned', labelKey: 'ipLists.tabBanned', icon: ShieldAlert, color: 'var(--warning)' },
  { id: 'ranges', labelKey: 'ipLists.tabRanges', icon: Network, color: 'var(--accent-violet)' },
  { id: 'whitelist', labelKey: 'ipLists.whitelist', icon: ShieldCheck, color: 'var(--success)' },
]
const PAGE_SIZES = [25, 50, 100, 200]
const TAB_STORAGE_KEY = 'ipLists.tab'

function readStoredTab() {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY)
    return TABS.some(tab => tab.id === v) ? v : 'blacklist'
  } catch {
    return 'blacklist'
  }
}

/** IPv4 逐段補零後字串排序就等於數值排序；IPv6 排在 IPv4 後面。 */
function ipSortKey(ip) {
  const octets = ip.split('/')[0].split('.')
  if (octets.length === 4) return '4' + octets.map(n => n.padStart(3, '0')).join('.')
  return '6' + ip
}

/** 頁碼列：頭、尾、目前頁前後各一頁，中間跳過的用 … 表示。 */
function pageWindow(page, count) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const pages = [...new Set([1, count, page - 1, page, page + 1])].filter(p => p >= 1 && p <= count).sort((a, b) => a - b)
  const out = []
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push(null)
    out.push(p)
  })
  return out
}

function splitIps(text) {
  return text.split(/[\s,;]+/).filter(Boolean)
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

/** 清單只帶快取的地理資訊（黑名單上百筆，不能每筆都即時查），打開詳情時才即時查這一個 IP。 */
function IpDetailModal({ item, onClose, t }) {
  const { record, kind } = item
  const [geo, setGeo] = useState(record.geo)
  const [geoLoading, setGeoLoading] = useState(true)

  useEffect(() => {
    api.get(`/ip-lists/geo/${encodeURIComponent(record.ip)}`)
      .then(r => setGeo(r.data))
      .catch(() => {})
      .finally(() => setGeoLoading(false))
  }, [record.ip])

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

      <div className="card-title" style={{ marginTop: 16, marginBottom: 8 }}>
        {t('ipLists.geoDetails')}
        {geoLoading && <span className="spinner spinner-dark" />}
      </div>
      <GeoInfo geo={geo} />
    </Modal>
  )
}

function GeoLine({ geo, t }) {
  if (!geo) return null
  if (geo.is_private) return <div className="cell-sub">{t('security.privateNetwork')}</div>
  const p = pickPrimary(geo, t)
  if (!p) return null
  const full = [p.country, p.city, p.isp].filter(Boolean).join(' · ')
  return <div className="cell-sub" title={full}>{countryFlag(p.countryCode)} {p.countryCode}{p.isp ? ` · ${p.isp}` : ''}</div>
}

function SortHeader({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey
  const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <button type="button" className={`th-sort ${active ? 'active' : ''}`} onClick={() => onSort(sortKey)}>
      {label} {active && <Arrow size={11} />}
    </button>
  )
}

function Pager({ page, pageCount, total, pageSize, onPage, onPageSize, t }) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="pager">
      <span>{t('ipLists.pageRange', { from, to, total })}</span>
      <div className="pager-pages">
        <select className="select" value={pageSize} onChange={e => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map(n => <option key={n} value={n}>{t('ipLists.perPage', { n })}</option>)}
        </select>
        <button type="button" className="pager-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('ipLists.prevPage')}>
          <ChevronLeft size={14} />
        </button>
        {pageWindow(page, pageCount).map((p, i) => p == null
          ? <span key={`gap-${i}`} className="pager-gap">…</span>
          : <button type="button" key={p} className={`pager-btn ${p === page ? 'active' : ''}`} onClick={() => onPage(p)}>{p}</button>)}
        <button type="button" className="pager-btn" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label={t('ipLists.nextPage')}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

export default function PageIpLists() {
  const { t } = useLanguage()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [msg, setMsg] = useState({ text: '', type: '' })
  const [tab, setTab] = useState(readStoredTab)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'time', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [detailItem, setDetailItem] = useState(null)
  const [showAdd, setShowAdd] = useState(null) // 'whitelist' | 'blacklist' | null
  const [form, setForm] = useState({ ips: '', note: '' })
  const [addError, setAddError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showAddRange, setShowAddRange] = useState(false)
  const [rangeForm, setRangeForm] = useState({ cidr: '', note: '' })
  const [submittingRange, setSubmittingRange] = useState(false)
  const listTopRef = useRef(null)

  const load = () => api.get('/ip-lists/').then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const resetView = () => {
    setPage(1)
    setSelected(new Set())
  }

  const switchTab = (id) => {
    setTab(id)
    setQuery('')
    setFilter('all')
    setSort({ key: 'time', dir: 'desc' })
    resetView()
    try { localStorage.setItem(TAB_STORAGE_KEY, id) } catch { /* 無法存就每次回到預設分頁 */ }
  }

  const toggleSort = (key) => {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'time' ? 'desc' : 'asc' })
    setPage(1)
  }

  const d = useMemo(() => data || { whitelist: [], blacklist: [], blocked_ranges: [], fail2ban_banned: [] }, [data])
  const blacklistIps = useMemo(() => new Set(d.blacklist.map(e => e.ip)), [d.blacklist])
  const counts = { blacklist: d.blacklist.length, banned: d.fail2ban_banned.length, ranges: d.blocked_ranges.length, whitelist: d.whitelist.length }

  // 統一成同一種列格式：key / ip / 時間 / 搜尋用字串，後面的篩選、排序、分頁不用每個分頁籤各寫一套
  const rows = useMemo(() => {
    const geoText = (geo) => {
      const p = geo && !geo.is_private ? pickPrimary(geo, t) : null
      return p ? [p.country, p.countryCode, p.city, p.isp].filter(Boolean).join(' ') : ''
    }
    if (tab === 'ranges') {
      return d.blocked_ranges.map(e => ({
        key: e.cidr, ip: e.cidr, time: e.added_at, record: e, selectable: false,
        search: [e.cidr, e.note, e.added_by].join(' ').toLowerCase(),
      }))
    }
    if (tab === 'banned') {
      return d.fail2ban_banned.map(b => ({
        key: `${b.jail}-${b.ip}`, ip: b.ip, time: b.since, record: b, selectable: !blacklistIps.has(b.ip),
        search: [b.ip, b.jail, geoText(b.geo)].join(' ').toLowerCase(),
      }))
    }
    return d[tab].map(e => ({
      key: e.ip, ip: e.ip, time: e.added_at, record: e, selectable: true,
      search: [e.ip, e.note, e.added_by, geoText(e.geo)].join(' ').toLowerCase(),
    }))
  }, [tab, d, blacklistIps, t])

  // 篩選選項：黑名單依來源（系統自動／手動）+ 依備註分組（同一批匯入的通常同一段備註），fail2ban 依 jail
  const filterOptions = useMemo(() => {
    if (tab === 'banned') {
      const jails = [...new Set(rows.map(r => r.record.jail))].sort()
      return jails.length > 1 ? jails.map(j => ({ value: `jail:${j}`, label: j })) : []
    }
    if (tab !== 'blacklist') return []
    const noteCounts = new Map()
    rows.forEach(r => { if (r.record.note) noteCounts.set(r.record.note, (noteCounts.get(r.record.note) || 0) + 1) })
    const autoCount = rows.filter(r => r.record.added_by === 'system-auto').length
    return [
      { value: 'auto', label: `${t('ipLists.filterAuto')} (${autoCount})` },
      { value: 'manual', label: `${t('ipLists.filterManual')} (${rows.length - autoCount})` },
      ...[...noteCounts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
        .map(([note, n]) => ({ value: `note:${note}`, label: `${note} (${n})`, group: true })),
    ]
  }, [tab, rows, t])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matchesFilter = (r) => {
      if (filter === 'all') return true
      if (filter === 'auto') return r.record.added_by === 'system-auto'
      if (filter === 'manual') return r.record.added_by !== 'system-auto'
      if (filter.startsWith('note:')) return r.record.note === filter.slice(5)
      if (filter.startsWith('jail:')) return r.record.jail === filter.slice(5)
      return true
    }
    const out = rows.filter(r => matchesFilter(r) && (!q || r.search.includes(q)))
    const dir = sort.dir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      const ka = sort.key === 'ip' ? ipSortKey(a.ip) : a.time
      const kb = sort.key === 'ip' ? ipSortKey(b.ip) : b.time
      if (ka !== kb) return ka < kb ? -dir : dir
      return ipSortKey(a.ip) < ipSortKey(b.ip) ? -1 : 1
    })
    return out
  }, [rows, query, filter, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const curPage = Math.min(page, pageCount)
  const pageRows = filtered.slice((curPage - 1) * pageSize, curPage * pageSize)
  const selectablePageIps = pageRows.filter(r => r.selectable).map(r => r.ip)
  const allPageSelected = selectablePageIps.length > 0 && selectablePageIps.every(ip => selected.has(ip))
  const somePageSelected = selectablePageIps.some(ip => selected.has(ip))
  const selectableFiltered = filtered.filter(r => r.selectable)
  const canSelect = tab !== 'ranges'

  const goPage = (p) => {
    setPage(p)
    const el = listTopRef.current
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' })
  }

  const toggleOne = (ip) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(ip)) next.delete(ip)
    else next.add(ip)
    return next
  })

  const togglePage = () => setSelected(prev => {
    const next = new Set(prev)
    selectablePageIps.forEach(ip => (allPageSelected ? next.delete(ip) : next.add(ip)))
    return next
  })

  const del = async (kind, ip) => {
    if (!confirm(t('ipLists.deleteConfirm', { ip }))) return
    try {
      await api.delete(`/ip-lists/${kind}/${encodeURIComponent(ip)}`)
      setMsg({ text: t('ipLists.deleteSuccess', { ip }), type: 'success' })
      setSelected(prev => { const next = new Set(prev); next.delete(ip); return next })
      load()
    } catch (err) {
      setMsg({ text: apiErrorText(err, t), type: 'error' })
    }
  }

  const bulkDelete = async () => {
    const ips = [...selected]
    if (!confirm(t('ipLists.bulkDeleteConfirm', { n: ips.length, list: t(`ipLists.${tab}`) }))) return
    setBusy(true)
    try {
      const r = await api.post(`/ip-lists/${tab}/bulk-delete`, { ips })
      setMsg({ text: t('ipLists.bulkDeleteSuccess', { n: r.data.removed }), type: 'success' })
      setSelected(new Set())
      load()
    } catch (err) {
      setMsg({ text: apiErrorText(err, t), type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  /** 把後端回傳的 added/duplicates/invalid 組成一句話，例如「已加入 3 個 IP，1 個已在清單中」 */
  const bulkResultText = ({ added, duplicates, invalid }) => {
    const parts = [t('ipLists.bulkAdded', { n: added.length })]
    if (duplicates.length) parts.push(t('ipLists.bulkDuplicates', { n: duplicates.length }))
    if (invalid.length) parts.push(t('ipLists.bulkInvalid', { n: invalid.length, list: invalid.slice(0, 5).join(', ') }))
    return parts.join(t('ipLists.listSeparator'))
  }

  const promote = async (ips) => {
    setBusy(true)
    try {
      const r = await api.post('/ip-lists/blacklist/bulk', { ips, note: '' })
      setMsg({ text: bulkResultText(r.data), type: 'success' })
      setSelected(new Set())
      load()
    } catch (err) {
      setMsg({ text: t('ipLists.addFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const openAdd = () => {
    if (tab === 'ranges') {
      setRangeForm({ cidr: '', note: '' })
      setShowAddRange(true)
      return
    }
    setForm({ ips: '', note: '' })
    setAddError('')
    setShowAdd(tab)
  }

  const submitAdd = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setAddError('')
    try {
      const r = await api.post(`/ip-lists/${showAdd}/bulk`, { ips: splitIps(form.ips), note: form.note })
      if (r.data.added.length === 0) {
        setAddError(bulkResultText(r.data))
        return
      }
      setMsg({ text: bulkResultText(r.data), type: r.data.invalid.length ? 'error' : 'success' })
      setShowAdd(null)
      load()
    } catch (err) {
      setAddError(t('ipLists.addFailed', { error: apiErrorText(err, t) }))
    } finally {
      setSubmitting(false)
    }
  }

  const delRange = async (cidr) => {
    if (!confirm(t('ipLists.deleteRangeConfirm', { cidr }))) return
    try {
      await api.delete(`/ip-lists/blocked-ranges/${encodeURIComponent(cidr)}`)
      setMsg({ text: t('ipLists.deleteSuccess', { ip: cidr }), type: 'success' })
      load()
    } catch (err) {
      setMsg({ text: apiErrorText(err, t), type: 'error' })
    }
  }

  const submitAddRange = async (e) => {
    e.preventDefault()
    setSubmittingRange(true)
    try {
      await api.post('/ip-lists/blocked-ranges', rangeForm)
      setMsg({ text: t('ipLists.addSuccess', { ip: rangeForm.cidr }), type: 'success' })
      setShowAddRange(false)
      setRangeForm({ cidr: '', note: '' })
      load()
    } catch (err) {
      setMsg({ text: t('ipLists.addFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setSubmittingRange(false)
    }
  }

  const hints = {
    blacklist: [t('ipLists.syncHint'), t('ipLists.autoBlacklistHint', { count: 3 })],
    whitelist: [t('ipLists.syncHint')],
    banned: [t('ipLists.bannedHint')],
    ranges: [t('ipLists.blockedRangesHint')],
  }[tab]

  const emptyText = rows.length > 0 ? t('ipLists.noMatches') : {
    blacklist: t('ipLists.noBlacklist'), whitelist: t('ipLists.noWhitelist'),
    banned: t('ipLists.noBannedIps'), ranges: t('ipLists.noBlockedRanges'),
  }[tab]
  const colSpan = canSelect ? 5 : 4
  const addIps = splitIps(form.ips)

  return (
    <div className="page">
      <PageHeader icon={ShieldBan} title={t('ipLists.title')} subtitle={t('ipLists.subtitle')}
        actions={<Button variant="ghost" icon={RefreshCw} loading={refreshing} onClick={refresh}>{t('ipLists.refresh')}</Button>} />
      <MsgBanner msg={msg} onClose={() => setMsg({ text: '', type: '' })} />

      <div className="list-tabs" role="tablist">
        {TABS.map(({ id, labelKey, icon: Icon, color }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={`list-tab ${tab === id ? 'active' : ''}`} onClick={() => switchTab(id)}>
            <span className="list-tab-icon" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
              <Icon size={17} />
            </span>
            <span style={{ minWidth: 0 }}>
              <div className="list-tab-count">{loading ? '–' : <FormattedNumber value={counts[id]} />}</div>
              <div className="list-tab-label">{t(labelKey)}</div>
            </span>
          </button>
        ))}
      </div>

      <div ref={listTopRef} style={{ scrollMarginTop: 72 }}>
        <Card>
          <div className="list-toolbar">
            <div className="search-box">
              <Search size={14} />
              <input className="input" value={query} placeholder={t(tab === 'ranges' ? 'ipLists.searchRangesPlaceholder' : 'ipLists.searchPlaceholder')}
                onChange={e => { setQuery(e.target.value); resetView() }} />
            </div>
            {filterOptions.length > 0 && (
              <select className="select" value={filter} onChange={e => { setFilter(e.target.value); resetView() }}>
                <option value="all">{t(tab === 'banned' ? 'ipLists.filterAllJails' : 'ipLists.filterAll')}</option>
                {filterOptions.filter(o => !o.group).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                {filterOptions.some(o => o.group) && (
                  <optgroup label={t('ipLists.filterByNote')}>
                    {filterOptions.filter(o => o.group).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </optgroup>
                )}
              </select>
            )}
            {tab !== 'banned' && (
              <Button variant="primary" icon={Plus} onClick={openAdd}>{t(tab === 'ranges' ? 'ipLists.addRange' : 'ipLists.addIp')}</Button>
            )}
          </div>

          <div className="list-hint">
            <Info size={13} />
            <div>{hints.map(h => <div key={h}>{h}</div>)}</div>
          </div>

          {selected.size > 0 && (
            <div className="selection-bar">
              <span>{t('ipLists.selectedCount', { n: selected.size })}</span>
              {selected.size < selectableFiltered.length && (
                <button type="button" className="link-btn" onClick={() => setSelected(new Set(selectableFiltered.map(r => r.ip)))}>
                  {t('ipLists.selectAllMatching', { n: selectableFiltered.length })}
                </button>
              )}
              <button type="button" className="link-btn muted" onClick={() => setSelected(new Set())}>{t('ipLists.clearSelection')}</button>
              <span style={{ flex: 1 }} />
              {tab === 'banned'
                ? <Button variant="primary" size="sm" icon={ShieldBan} loading={busy} onClick={() => promote([...selected])}>{t('ipLists.promoteSelected')}</Button>
                : <Button variant="danger" size="sm" icon={Trash2} loading={busy} onClick={bulkDelete}>{t('ipLists.removeSelected')}</Button>}
            </div>
          )}

          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  {canSelect && (
                    <th className="col-check">
                      <input type="checkbox" checked={allPageSelected} disabled={selectablePageIps.length === 0}
                        ref={el => { if (el) el.indeterminate = somePageSelected && !allPageSelected }}
                        onChange={togglePage} aria-label={t('ipLists.selectPage')} />
                    </th>
                  )}
                  <th><SortHeader label={t(tab === 'ranges' ? 'ipLists.colRange' : 'ipLists.colIp')} sortKey="ip" sort={sort} onSort={toggleSort} /></th>
                  <th>{t(tab === 'banned' ? 'ipLists.jail' : 'ipLists.colNote')}</th>
                  <th><SortHeader label={t(tab === 'banned' ? 'ipLists.colBannedAt' : 'ipLists.colAdded')} sortKey="time" sort={sort} onSort={toggleSort} /></th>
                  <th style={{ textAlign: 'right' }}>{t('ipLists.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && <SkeletonRows colSpan={colSpan} rows={5} />}
                {!loading && pageRows.length === 0 && <EmptyState text={emptyText} colSpan={colSpan} />}
                {!loading && pageRows.map(({ key, ip, record, selectable }) => (
                  <tr key={key} className={selected.has(ip) ? 'row-selected' : ''}>
                    {canSelect && (
                      <td className="col-check">
                        <input type="checkbox" checked={selected.has(ip)} disabled={!selectable} onChange={() => toggleOne(ip)} aria-label={ip} />
                      </td>
                    )}
                    <td>
                      <div className="cell-strong ip">{ip}</div>
                      {tab !== 'ranges' && <GeoLine geo={record.geo} t={t} />}
                    </td>
                    {tab === 'banned' ? (
                      <td><Badge tone="danger">{record.jail}</Badge></td>
                    ) : (
                      <td><div className="cell-clip" title={record.note || undefined}>{record.note || '—'}</div></td>
                    )}
                    <td title={formatFull(tab === 'banned' ? record.since : record.added_at, t)}>
                      {tab === 'banned' ? (
                        <div style={{ whiteSpace: 'nowrap' }}>{timeAgo(record.since, t)}</div>
                      ) : (
                        <>
                          <div style={{ whiteSpace: 'nowrap' }}>{timeAgo(record.added_at, t)}</div>
                          <div className="cell-sub">
                            {record.added_by === 'system-auto' ? <Badge tone="info">{t('ipLists.autoAdded')}</Badge> : record.added_by}
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        {tab === 'banned' && (blacklistIps.has(ip)
                          ? <Badge tone="neutral">{t('ipLists.inBlacklist')}</Badge>
                          : <Button variant="ghost" size="sm" icon={ShieldBan} disabled={busy} onClick={() => promote([ip])}>{t('ipLists.promoteShort')}</Button>)}
                        {tab !== 'ranges' && (
                          <Button variant="ghost" size="sm" icon={Info} className="btn-icon" title={t('ipLists.detail')} aria-label={t('ipLists.detail')}
                            onClick={() => setDetailItem({ record, kind: tab === 'banned' ? 'banned' : 'list' })} />
                        )}
                        {tab !== 'banned' && (
                          <Button variant="danger" size="sm" icon={Trash2} className="btn-icon" title={t('common.delete')} aria-label={t('common.delete')}
                            onClick={() => (tab === 'ranges' ? delRange(ip) : del(tab, ip))} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && (
            <Pager page={curPage} pageCount={pageCount} total={filtered.length} pageSize={pageSize}
              onPage={goPage} onPageSize={n => { setPageSize(n); setPage(1) }} t={t} />
          )}
        </Card>
      </div>

      {showAdd && (
        <Modal title={t(showAdd === 'blacklist' ? 'ipLists.addToBlacklist' : 'ipLists.addToWhitelist')} onClose={() => setShowAdd(null)}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setShowAdd(null)}>{t('common.cancel')}</Button>
            <Button type="submit" form="ip-add-form" variant="primary" loading={submitting} disabled={addIps.length === 0}>
              {addIps.length > 1 ? t('ipLists.addCount', { n: addIps.length }) : t('common.confirm')}
            </Button>
          </>}>
          <form id="ip-add-form" onSubmit={submitAdd}>
            {addError && <div className="msg-banner error">{addError}</div>}
            <div className="field">
              <label className="field-label">{t('ipLists.ipsLabel')}</label>
              <textarea required autoFocus className="input" rows={4} style={{ resize: 'vertical', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }}
                value={form.ips} onChange={e => setForm({ ...form, ips: e.target.value })} placeholder={'1.2.3.4\n5.6.7.8'} />
              <div className="input-hint">{t('ipLists.ipsHint', { n: addIps.length })}</div>
            </div>
            <div className="field" style={{ marginBottom: 4 }}>
              <label className="field-label">{t('ipLists.noteLabel')}</label>
              <input className="input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder={t('ipLists.notePlaceholder')} />
            </div>
          </form>
        </Modal>
      )}

      {showAddRange && (
        <Modal title={t('ipLists.addRange')} onClose={() => setShowAddRange(false)}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setShowAddRange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="range-add-form" variant="primary" loading={submittingRange}>{t('common.confirm')}</Button>
          </>}>
          <form id="range-add-form" onSubmit={submitAddRange}>
            <div className="field">
              <label className="field-label">{t('ipLists.rangeLabel')}</label>
              <input required autoFocus className="input" value={rangeForm.cidr} onChange={e => setRangeForm({ ...rangeForm, cidr: e.target.value })} placeholder="203.0.113.0/24" />
            </div>
            <div className="field" style={{ marginBottom: 4 }}>
              <label className="field-label">{t('ipLists.noteLabel')}</label>
              <input className="input" value={rangeForm.note} onChange={e => setRangeForm({ ...rangeForm, note: e.target.value })} placeholder={t('ipLists.notePlaceholder')} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('ipLists.blockedRangesHint')}</div>
          </form>
        </Modal>
      )}

      {detailItem && <IpDetailModal key={detailItem.record.ip} item={detailItem} onClose={() => setDetailItem(null)} t={t} />}
    </div>
  )
}
