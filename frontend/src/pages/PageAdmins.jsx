import { useEffect, useState } from 'react'
import { UserCog, Plus, Trash2, Pencil, KeyRound, ShieldCheck } from 'lucide-react'
import api from '../api/client'
import { PageHeader, Button, Modal, MsgBanner, EmptyState, SkeletonRows, Avatar, Badge } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'

const MODULES = [
  { key: 'users', navKey: 'users', modify: true },
  { key: 'domains', navKey: 'domains', modify: true },
  { key: 'aliases', navKey: 'aliases', modify: true },
  { key: 'services', navKey: 'services', modify: true },
  { key: 'settings', navKey: 'settings', modify: true },
  { key: 'ip_lists', navKey: 'ipLists', modify: true },
  { key: 'webmail_policy', navKey: 'webmailPolicy', modify: true },
  { key: 'logs', navKey: 'logs', modify: false },
  { key: 'stats', navKey: 'stats', modify: false },
  { key: 'security', navKey: 'security', modify: false },
  { key: 'webmail_logins', navKey: 'webmailLogins', modify: false },
  { key: 'admin_logins', navKey: 'adminLogins', modify: false },
]

function emptyPermissions() {
  const p = {}
  for (const m of MODULES) p[m.key] = { view: false, modify: false }
  return p
}

function PermissionMatrix({ permissions, onChange, disabled, t }) {
  return (
    <div className="field">
      <label className="field-label">{t('admins.permissionMatrixLabel')}</label>
      <div className="table-wrap" style={{ border: '1px solid var(--border)' }}>
        <table className="data-table">
          <thead>
            <tr><th>{t('admins.colModule')}</th><th style={{ width: 70, textAlign: 'center' }}>{t('admins.colView')}</th><th style={{ width: 70, textAlign: 'center' }}>{t('admins.colModify')}</th></tr>
          </thead>
          <tbody>
            {MODULES.map(m => {
              const p = permissions[m.key] || { view: false, modify: false }
              return (
                <tr key={m.key}>
                  <td>{t(`nav.${m.navKey}`)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" disabled={disabled} checked={!!p.view}
                      onChange={e => onChange({
                        ...permissions,
                        [m.key]: { view: e.target.checked, modify: e.target.checked ? p.modify : false },
                      })} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {m.modify ? (
                      <input type="checkbox" disabled={disabled || !p.view} checked={!!p.modify}
                        onChange={e => onChange({ ...permissions, [m.key]: { ...p, modify: e.target.checked } })} />
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function PageAdmins({ currentAdmin }) {
  const { t } = useLanguage()
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState({ text: '', type: '' })

  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState({
    username: '', password: '', display_name: '',
    permissions: emptyPermissions(), manage_admins: false, super_admin: false,
  })

  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const [resetting, setResetting] = useState(null)
  const [resetPassword, setResetPassword] = useState('')

  const iAmSuperAdmin = !!currentAdmin?.super_admin

  const load = () => {
    api.get('/admins/').then(r => setAdmins(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    setCreating(true)
    try {
      await api.post('/admins/', createForm)
      setMsg({ text: t('admins.createSuccess', { username: createForm.username }), type: 'success' })
      setShowCreate(false)
      setCreateForm({ username: '', password: '', display_name: '', permissions: emptyPermissions(), manage_admins: false, super_admin: false })
      load()
    } catch (err) {
      setMsg({ text: t('admins.createFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setCreating(false)
    }
  }

  const openEdit = (a) => {
    setEditing(a)
    setEditForm({
      display_name: a.display_name, disabled: a.disabled,
      permissions: { ...emptyPermissions(), ...a.permissions },
      manage_admins: a.manage_admins, super_admin: a.super_admin,
    })
  }

  const saveEdit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.put(`/admins/${editing.username}`, editForm)
      setMsg({ text: t('admins.updateSuccess', { username: editing.username }), type: 'success' })
      setEditing(null)
      load()
    } catch (err) {
      setMsg({ text: t('admins.updateFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const del = async (username) => {
    if (!confirm(t('admins.deleteConfirm', { username }))) return
    try {
      await api.delete(`/admins/${username}`)
      setMsg({ text: t('admins.deleteSuccess', { username }), type: 'success' })
      load()
    } catch (err) {
      setMsg({ text: t('admins.deleteFailed', { error: apiErrorText(err, t) }), type: 'error' })
    }
  }

  const doResetPassword = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/admins/${resetting}/password`, { password: resetPassword })
      setMsg({ text: t('admins.resetSuccess', { username: resetting }), type: 'success' })
      setResetting(null)
      setResetPassword('')
    } catch (err) {
      setMsg({ text: t('admins.resetFailed', { error: apiErrorText(err, t) }), type: 'error' })
    }
  }

  return (
    <div className="page">
      <PageHeader icon={UserCog} title={t('admins.title')} subtitle={t('admins.subtitleCount', { count: admins.length })}
        actions={<Button variant="primary" icon={Plus} onClick={() => setShowCreate(true)}>{t('admins.addAdmin')}</Button>} />

      <MsgBanner msg={msg} onClose={() => setMsg({ text: '', type: '' })} />

      <div className="card table-wrap animate-in">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('admins.colAccount')}</th><th>{t('admins.colRole')}</th><th style={{ width: 70 }}>{t('admins.colStatus')}</th><th style={{ width: 220 }}>{t('admins.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows colSpan={4} />}
            {!loading && admins.length === 0 && <EmptyState text={t('admins.noAdminsFound')} colSpan={4} />}
            {admins.map(a => (
              <tr key={a.username}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={a.display_name || a.username} />
                    <div>
                      <div className="cell-strong">{a.display_name || a.username}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.username}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {a.super_admin && <Badge tone="danger">{t('admins.roleSuperAdmin')}</Badge>}
                  {!a.super_admin && a.manage_admins && <Badge tone="warning">{t('admins.roleManageAdmins')}</Badge>}
                  {!a.super_admin && !a.manage_admins && <Badge tone="neutral">{t('admins.roleNormal')}</Badge>}
                </td>
                <td><span className={`badge ${a.disabled ? 'badge-neutral' : 'badge-success'}`}>{a.disabled ? t('common.disabled') : t('common.active')}</span></td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEdit(a)}>{t('common.edit')}</Button>
                  <Button variant="ghost" size="sm" icon={KeyRound} onClick={() => { setResetting(a.username); setResetPassword('') }}>{t('admins.resetPasswordButton')}</Button>
                  {a.username !== currentAdmin?.username && (
                    <Button variant="danger" size="sm" icon={Trash2} onClick={() => del(a.username)}>{t('common.delete')}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title={t('admins.createModalTitle')} onClose={() => setShowCreate(false)}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button>
            <Button type="submit" form="admin-create-form" variant="primary" loading={creating}>{t('admins.createButton')}</Button>
          </>}>
          <form id="admin-create-form" onSubmit={create}>
            <div className="field">
              <label className="field-label">{t('admins.usernameLabel')}</label>
              <input required className="input" value={createForm.username}
                onChange={e => setCreateForm({ ...createForm, username: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">{t('admins.displayNameLabel')}</label>
              <input className="input" value={createForm.display_name}
                onChange={e => setCreateForm({ ...createForm, display_name: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">{t('admins.passwordLabel')}</label>
              <input required type="password" className="input" value={createForm.password}
                onChange={e => setCreateForm({ ...createForm, password: e.target.value })} />
            </div>
            <PermissionMatrix permissions={createForm.permissions} t={t}
              onChange={p => setCreateForm({ ...createForm, permissions: p })} />
            {iAmSuperAdmin && (
              <div className="field">
                <label className="field-label"><ShieldCheck size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />{t('admins.specialRoleLabel')}</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={createForm.manage_admins}
                      onChange={e => setCreateForm({ ...createForm, manage_admins: e.target.checked })} /> {t('admins.manageAdminsToggle')}
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={createForm.super_admin}
                      onChange={e => setCreateForm({ ...createForm, super_admin: e.target.checked })} /> {t('admins.superAdminToggle')}
                  </label>
                </div>
              </div>
            )}
          </form>
        </Modal>
      )}

      {editing && editForm && (
        <Modal title={t('admins.editModalTitle', { username: editing.username })} onClose={() => setEditing(null)}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button type="submit" form="admin-edit-form" variant="primary" loading={saving}>{t('admins.saveChanges')}</Button>
          </>}>
          <form id="admin-edit-form" onSubmit={saveEdit}>
            <div className="field">
              <label className="field-label">{t('admins.displayNameLabel')}</label>
              <input className="input" value={editForm.display_name}
                onChange={e => setEditForm({ ...editForm, display_name: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">{t('admins.accountStatus')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button type="button" variant={!editForm.disabled ? 'primary' : 'ghost'} style={{ flex: 1 }}
                  onClick={() => setEditForm({ ...editForm, disabled: false })}>{t('common.active')}</Button>
                <Button type="button" variant={editForm.disabled ? 'danger' : 'ghost'} style={{ flex: 1 }}
                  onClick={() => setEditForm({ ...editForm, disabled: true })}>{t('common.disabled')}</Button>
              </div>
            </div>
            <PermissionMatrix permissions={editForm.permissions} disabled={editForm.super_admin} t={t}
              onChange={p => setEditForm({ ...editForm, permissions: p })} />
            {editForm.super_admin && <div className="input-hint">{t('admins.superAdminHint')}</div>}
            {iAmSuperAdmin && (
              <div className="field">
                <label className="field-label"><ShieldCheck size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />{t('admins.specialRoleLabel')}</label>
                <div style={{ display: 'flex', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={editForm.manage_admins}
                      onChange={e => setEditForm({ ...editForm, manage_admins: e.target.checked })} /> {t('admins.manageAdminsToggle')}
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={editForm.super_admin}
                      onChange={e => setEditForm({ ...editForm, super_admin: e.target.checked })} /> {t('admins.superAdminToggle')}
                  </label>
                </div>
              </div>
            )}
          </form>
        </Modal>
      )}

      {resetting && (
        <Modal title={t('admins.resetModalTitle', { username: resetting })} onClose={() => setResetting(null)}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setResetting(null)}>{t('common.cancel')}</Button>
            <Button type="submit" form="admin-reset-form" variant="primary">{t('admins.confirmReset')}</Button>
          </>}>
          <form id="admin-reset-form" onSubmit={doResetPassword}>
            <div className="field" style={{ marginBottom: 4 }}>
              <label className="field-label">{t('admins.newPasswordLabel')}</label>
              <input required type="password" className="input" value={resetPassword}
                onChange={e => setResetPassword(e.target.value)} placeholder={t('users.passwordPlaceholder')} />
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
