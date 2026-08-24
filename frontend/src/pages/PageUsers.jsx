import { useEffect, useState } from 'react'
import { Users, Plus, Trash2, Search, Pencil, KeyRound } from 'lucide-react'
import api from '../api/client'
import { PageHeader, Button, Modal, MsgBanner, EmptyState, SkeletonRows, Avatar } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'

export default function PageUsers() {
  const { t } = useLanguage()
  const [users, setUsers] = useState([])
  const [domains, setDomains] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ username:'', email_prefix:'', domain:'', password:'', quota_mb:10240 })
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState({ text:'', type:'' })

  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ quota_mb: 10240, active: true, new_password: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editMsg, setEditMsg] = useState({ text: '', type: '' })

  const load = () => {
    api.get('/users/').then(r=>setUsers(r.data)).catch(()=>{}).finally(()=>setLoading(false))
    api.get('/domains/').then(r=>{
      setDomains(r.data)
      setForm(f => ({ ...f, domain: f.domain || r.data[0]?.domain || '' }))
    }).catch(()=>{})
    api.get('/settings/').then(r=>{
      setForm(f => ({ ...f, quota_mb: r.data.default_quota_mb }))
    }).catch(()=>{})
  }
  useEffect(()=>{ load() },[])

  const create = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await api.post('/users/', {
        username: form.username,
        password: form.password,
        domain: form.domain,
        quota_mb: form.quota_mb
      })
      setMsg({ text: t('users.createSuccess', { username: form.username, email: `${form.email_prefix}@${form.domain}` }), type:'success' })
      setShowModal(false)
      setForm(f => ({ ...f, username:'', email_prefix:'', password:'', quota_mb:10240 }))
      load()
    } catch(err) {
      setMsg({ text: t('users.createFailed', { error: apiErrorText(err, t) }), type:'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const del = async (email) => {
    if (!confirm(t('users.deleteConfirm', { email }))) return
    await api.delete(`/users/${email}`)
    setMsg({ text: t('users.deleteSuccess', { email }), type:'success' })
    load()
  }

  const openEdit = (u) => {
    setEditing(u)
    setEditForm({ quota_mb: u.quota_mb, active: u.active, new_password: '' })
    setEditMsg({ text: '', type: '' })
  }

  const saveEdit = async (e) => {
    e.preventDefault()
    setSavingEdit(true)
    try {
      await api.put(`/users/${editing.email}`, { quota_mb: editForm.quota_mb, active: editForm.active })
      if (editForm.new_password) {
        await api.post(`/users/${editing.email}/password`, { password: editForm.new_password })
      }
      setMsg({ text: t('users.updateSuccess', { email: editing.email }), type: 'success' })
      setEditing(null)
      load()
    } catch (err) {
      setEditMsg({ text: t('users.updateFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setSavingEdit(false)
    }
  }

  const filtered = users.filter(u => u.username.includes(search) || u.email?.includes(search))

  return (
    <div className="page">
      <PageHeader icon={Users} title={t('users.title')} subtitle={t('users.subtitleCount', { count: users.length })}
        actions={<>
          <div className="search-box">
            <Search size={14} />
            <input className="input" placeholder={t('users.searchPlaceholder')} value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <Button variant="primary" icon={Plus} onClick={()=>setShowModal(true)}>{t('users.addUser')}</Button>
        </>} />

      <MsgBanner msg={msg} onClose={()=>setMsg({text:'',type:''})} />

      <div className="card table-wrap animate-in">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('users.colUser')}</th>
              <th>{t('users.colEmail')}</th>
              <th style={{width:160}}>{t('users.colUsage')}</th>
              <th style={{width:70}}>{t('users.colStatus')}</th>
              <th style={{width:150}}>{t('users.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows colSpan={5} />}
            {!loading && filtered.length === 0 && <EmptyState text={t('users.noUsersFound')} colSpan={5} />}
            {filtered.map(u => {
              const used = Number(u.maildir_size_mb) || 0
              const pct = u.quota_mb ? Math.min(100, Math.round((used / u.quota_mb) * 100)) : 0
              const barColor = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)'
              return (
                <tr key={u.email}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Avatar name={u.username} />
                      <span className="cell-strong">{u.username}</span>
                    </div>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                      {used} MB{u.quota_mb ? ` / ${(u.quota_mb / 1024).toFixed(0)} GB` : ` (${t('users.unlimited')})`}
                    </div>
                    {u.quota_mb > 0 && (
                      <div style={{ height: '5px', borderRadius: '4px', background: 'var(--metric-bg)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: '4px', background: barColor, transition: 'width .5s ease' }} />
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${u.active ? 'badge-success' : 'badge-neutral'}`}>{u.active ? t('common.active') : t('common.disabled')}</span>
                  </td>
                  <td style={{ display: 'flex', gap: '6px' }}>
                    <Button variant="ghost" size="sm" icon={Pencil} onClick={()=>openEdit(u)}>{t('common.edit')}</Button>
                    <Button variant="danger" size="sm" icon={Trash2} onClick={()=>del(u.email)}>{t('common.delete')}</Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title={t('users.createModalTitle')} onClose={()=>setShowModal(false)}
          footer={<>
            <Button type="button" variant="ghost" onClick={()=>setShowModal(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="user-form" variant="primary" loading={submitting}>{t('users.createButton')}</Button>
          </>}>
          <form id="user-form" onSubmit={create}>
            <div className="field">
              <label className="field-label">{t('users.usernameLabel')}</label>
              <input required className="input" value={form.username}
                onChange={e=>setForm({...form,username:e.target.value,email_prefix:e.target.value})}
                placeholder={t('users.usernamePlaceholder')} />
            </div>

            <div className="field">
              <label className="field-label">{t('users.emailLabel')}</label>
              <div className="input-row">
                <input className="input" style={{flex:1}} value={form.email_prefix}
                  onChange={e=>setForm({...form,email_prefix:e.target.value})}
                  placeholder={t('users.emailPrefixPlaceholder')} />
                <span style={{color:'var(--text-muted)'}}>@</span>
                <select className="select" style={{width:'48%'}} value={form.domain}
                  onChange={e=>setForm({...form,domain:e.target.value})}>
                  {domains.map(d => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
                </select>
              </div>
              <div className="input-hint">
                {t('users.fullEmailLabel')}<strong style={{color:'var(--text-secondary)'}}>{form.email_prefix||'...'}@{form.domain}</strong>
              </div>
            </div>

            <div className="field">
              <label className="field-label">{t('users.passwordLabel')}</label>
              <input required type="password" className="input" value={form.password}
                onChange={e=>setForm({...form,password:e.target.value})}
                placeholder={t('users.passwordPlaceholder')} />
            </div>

            <div className="field" style={{marginBottom:4}}>
              <label className="field-label">{t('users.quotaLabel')}</label>
              <select className="select" value={form.quota_mb}
                onChange={e=>setForm({...form,quota_mb:parseInt(e.target.value)})}>
                <option value={1024}>1 GB</option>
                <option value={5120}>5 GB</option>
                <option value={10240}>10 GB</option>
                <option value={20480}>20 GB</option>
                <option value={51200}>50 GB</option>
                <option value={0}>{t('users.unlimited')}</option>
              </select>
            </div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title={t('users.editModalTitle', { email: editing.email })} onClose={()=>setEditing(null)}
          footer={<>
            <Button type="button" variant="ghost" onClick={()=>setEditing(null)}>{t('common.cancel')}</Button>
            <Button type="submit" form="edit-user-form" variant="primary" loading={savingEdit}>{t('users.saveChanges')}</Button>
          </>}>
          <form id="edit-user-form" onSubmit={saveEdit}>
            <MsgBanner msg={editMsg} onClose={()=>setEditMsg({text:'',type:''})} />

            <div className="field">
              <label className="field-label">{t('users.quotaLabel')}</label>
              <select className="select" value={editForm.quota_mb}
                onChange={e=>setEditForm({...editForm,quota_mb:parseInt(e.target.value)})}>
                <option value={1024}>1 GB</option>
                <option value={5120}>5 GB</option>
                <option value={10240}>10 GB</option>
                <option value={20480}>20 GB</option>
                <option value={51200}>50 GB</option>
                <option value={0}>{t('users.unlimited')}</option>
              </select>
            </div>

            <div className="field">
              <label className="field-label">{t('users.accountStatus')}</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button type="button" variant={editForm.active ? 'primary' : 'ghost'} onClick={()=>setEditForm({...editForm, active:true})} style={{flex:1}}>{t('common.active')}</Button>
                <Button type="button" variant={!editForm.active ? 'danger' : 'ghost'} onClick={()=>setEditForm({...editForm, active:false})} style={{flex:1}}>{t('common.disabled')}</Button>
              </div>
              <div className="input-hint">{t('users.disabledHint')}</div>
            </div>

            <div className="field" style={{marginBottom:4}}>
              <label className="field-label"><KeyRound size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />{t('users.resetPasswordLabel')}</label>
              <input type="password" className="input" value={editForm.new_password}
                onChange={e=>setEditForm({...editForm, new_password:e.target.value})}
                placeholder={t('users.resetPasswordPlaceholder')} />
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
