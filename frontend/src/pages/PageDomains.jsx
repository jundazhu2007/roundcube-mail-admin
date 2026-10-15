import { useEffect, useState } from 'react'
import { Globe, Users, Plus, Trash2 } from 'lucide-react'
import api from '../api/client'
import { PageHeader, Badge, EmptyState, SkeletonRows, Button, Modal, MsgBanner } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'

export default function PageDomains() {
  const { t } = useLanguage()
  const [domains, setDomains] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState({ text: '', type: '' })

  const load = () => api.get('/domains/').then(r => setDomains(r.data)).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await api.post('/domains/', { name })
      setMsg({ text: t('domains.createSuccess', { name }), type: 'success' })
      setShowModal(false)
      setName('')
      load()
    } catch (err) {
      setMsg({ text: t('domains.createFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const del = async (d) => {
    if (!confirm(t('domains.deleteConfirm', { domain: d.domain }))) return
    try {
      await api.delete(`/domains/${d.id}`)
      setMsg({ text: t('domains.deleteSuccess', { domain: d.domain }), type: 'success' })
      load()
    } catch (err) {
      setMsg({ text: t('domains.deleteFailed', { error: apiErrorText(err, t) }), type: 'error' })
    }
  }

  return (
    <div className="page">
      <PageHeader icon={Globe} title={t('domains.title')} subtitle={t('domains.subtitleCount', { count: domains.length })}
        actions={<Button variant="primary" icon={Plus} onClick={() => setShowModal(true)}>{t('domains.addDomain')}</Button>} />

      <MsgBanner msg={msg} onClose={() => setMsg({ text: '', type: '' })} />

      <div className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('domains.colDomain')}</th>
              <th>{t('domains.colUsers')}</th>
              <th>{t('domains.colStatus')}</th>
              <th style={{ width: 90 }}>{t('domains.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows colSpan={4} rows={2} />}
            {!loading && domains.length === 0 && <EmptyState text={t('domains.noDomainsFound')} colSpan={4} />}
            {domains.map(d => (
              <tr key={d.id}>
                <td className="cell-strong">{d.domain}</td>
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}><Users size={13} /> {d.users}</span></td>
                <td><Badge tone={d.status === 'active' ? 'success' : 'neutral'} dot>{d.status === 'active' ? t('common.active') : t('common.disabled')}</Badge></td>
                <td>
                  <Button variant="danger" size="sm" icon={Trash2} onClick={() => del(d)}>{t('common.delete')}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title={t('domains.createModalTitle')} onClose={() => setShowModal(false)}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="domain-form" variant="primary" loading={submitting}>{t('domains.createButton')}</Button>
          </>}>
          <form id="domain-form" onSubmit={create}>
            <div className="field" style={{ marginBottom: 4 }}>
              <label className="field-label">{t('domains.domainNameLabel')}</label>
              <input required className="input" value={name} onChange={e => setName(e.target.value)}
                placeholder={t('domains.domainNamePlaceholder')} />
              <div className="input-hint">
                {t('domains.domainNameHint')}
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
