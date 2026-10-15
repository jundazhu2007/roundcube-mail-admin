import { useEffect, useState } from 'react'
import { AtSign, Plus, Trash2, ArrowRight } from 'lucide-react'
import api from '../api/client'
import { PageHeader, Button, Modal, MsgBanner, EmptyState, SkeletonRows } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'

export default function PageAliases() {
  const { t } = useLanguage()
  const [aliases, setAliases] = useState([])
  const [users, setUsers] = useState([])
  const [domains, setDomains] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ alias_prefix: '', domain: '', destination_email: '' })
  const [msg, setMsg] = useState({ text: '', type: '' })

  const load = () => {
    api.get('/aliases/').then(r => setAliases(r.data)).catch(() => {}).finally(() => setLoading(false))
    api.get('/users/').then(r => {
      setUsers(r.data)
      setForm(f => ({ ...f, destination_email: f.destination_email || r.data[0]?.email || '' }))
    }).catch(() => {})
    api.get('/domains/').then(r => {
      setDomains(r.data)
      setForm(f => ({ ...f, domain: f.domain || r.data[0]?.domain || '' }))
    }).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await api.post('/aliases/', form)
      setMsg({ text: t('aliases.createSuccess', { alias: `${form.alias_prefix}@${form.domain}`, target: form.destination_email }), type: 'success' })
      setShowModal(false)
      setForm(f => ({ ...f, alias_prefix: '' }))
      load()
    } catch (err) {
      setMsg({ text: t('aliases.createFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const del = async (a) => {
    if (!confirm(t('aliases.deleteConfirm', { alias: a.alias }))) return
    await api.delete(`/aliases/${a.id}`)
    setMsg({ text: t('aliases.deleteSuccess', { alias: a.alias }), type: 'success' })
    load()
  }

  return (
    <div className="page">
      <PageHeader icon={AtSign} title={t('aliases.title')} subtitle={t('aliases.subtitle')}
        actions={<Button variant="primary" icon={Plus} onClick={() => setShowModal(true)}>{t('aliases.addAlias')}</Button>} />

      <MsgBanner msg={msg} onClose={() => setMsg({ text: '', type: '' })} />

      <div className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('aliases.colAlias')}</th>
              <th></th>
              <th>{t('aliases.colTarget')}</th>
              <th style={{ width: 90 }}>{t('aliases.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows colSpan={4} />}
            {!loading && aliases.length === 0 && <EmptyState text={t('aliases.noAliasesFound')} colSpan={4} />}
            {aliases.map(a => (
              <tr key={a.id}>
                <td className="cell-strong">{a.alias}</td>
                <td style={{ color: 'var(--text-muted)' }}><ArrowRight size={14} /></td>
                <td>{a.target}</td>
                <td>
                  <Button variant="danger" size="sm" icon={Trash2} onClick={() => del(a)}>{t('common.delete')}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title={t('aliases.createModalTitle')} onClose={() => setShowModal(false)}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="alias-form" variant="primary" loading={submitting}>{t('aliases.createButton')}</Button>
          </>}>
          <form id="alias-form" onSubmit={create}>
            <div className="field">
              <label className="field-label">{t('aliases.aliasEmailLabel')}</label>
              <div className="input-row">
                <input required className="input" style={{ flex: 1 }} value={form.alias_prefix}
                  onChange={e => setForm({ ...form, alias_prefix: e.target.value })}
                  placeholder={t('aliases.aliasPrefixPlaceholder')} />
                <span style={{ color: 'var(--text-muted)' }}>@</span>
                <select className="select" style={{ width: '48%' }} value={form.domain}
                  onChange={e => setForm({ ...form, domain: e.target.value })}>
                  {domains.map(d => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <label className="field-label">{t('aliases.destinationLabel')}</label>
              <select required className="select" value={form.destination_email}
                onChange={e => setForm({ ...form, destination_email: e.target.value })}>
                {users.map(u => <option key={u.email} value={u.email}>{u.email}</option>)}
              </select>
              <div className="input-hint">
                {t('aliases.fullAliasLabel')}<strong style={{ color: 'var(--text-secondary)' }}>{form.alias_prefix || '...'}@{form.domain}</strong> → {form.destination_email || '...'}
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
