import { useEffect, useState } from 'react'
import { Settings, Shield, HardDrive, KeyRound, Trash2, Fingerprint, Phone } from 'lucide-react'
import { startRegistration } from '@simplewebauthn/browser'
import api from '../api/client'
import { PageHeader, Card, Button, MsgBanner } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'
import { formatPhoneInput, phonePlaceholder } from '../utils/phone'

export default function PageSettings() {
  const { t } = useLanguage()
  const [form, setForm] = useState({ spamassassin_threshold: 5, default_quota_mb: 10240 })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState({ text: '', type: '' })

  const [passkeys, setPasskeys] = useState([])
  const [nickname, setNickname] = useState('')
  const [registering, setRegistering] = useState(false)
  const [pkMsg, setPkMsg] = useState({ text: '', type: '' })

  const [me, setMe] = useState(null)
  const [phoneForm, setPhoneForm] = useState({ country: 'TW', phone: '' })
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [phoneMsg, setPhoneMsg] = useState({ text: '', type: '' })

  const loadPasskeys = () => api.get('/webauthn/credentials').then(r => setPasskeys(r.data)).catch(() => {})
  const loadMe = () => api.get('/admins/me').then(r => setMe(r.data)).catch(() => {})

  useEffect(() => {
    api.get('/settings/').then(r => setForm(r.data)).catch(() => {})
    loadPasskeys()
    loadMe()
  }, [])

  const bindPhone = async (e) => {
    e.preventDefault()
    setPhoneBusy(true)
    try {
      await api.post('/admins/me/phone', phoneForm)
      setPhoneMsg({ text: t('settings.bindSuccess'), type: 'success' })
      setPhoneForm({ ...phoneForm, phone: '' })
      loadMe()
    } catch (err) {
      setPhoneMsg({ text: t('settings.bindFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setPhoneBusy(false)
    }
  }

  const unbindPhone = async () => {
    setPhoneBusy(true)
    try {
      await api.delete('/admins/me/phone')
      setPhoneMsg({ text: t('settings.unbindSuccess'), type: 'success' })
      loadMe()
    } catch (err) {
      setPhoneMsg({ text: t('settings.unbindFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setPhoneBusy(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.post('/settings/', form)
      setMsg({ text: t('settings.saveSuccess'), type: 'success' })
    } catch (err) {
      setMsg({ text: t('settings.saveFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const registerPasskey = async () => {
    setRegistering(true)
    try {
      const startRes = await api.post('/webauthn/register/start')
      const { session_id, options } = startRes.data
      const credential = await startRegistration({ optionsJSON: options })
      await api.post('/webauthn/register/verify', { session_id, credential, nickname: nickname || t('settings.deviceNicknamePlaceholder') })
      setPkMsg({ text: t('settings.registerSuccess'), type: 'success' })
      setNickname('')
      loadPasskeys()
    } catch (err) {
      setPkMsg({ text: t('settings.registerFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setRegistering(false)
    }
  }

  const deletePasskey = async (credentialId) => {
    if (!confirm(t('settings.deletePasskeyConfirm'))) return
    await api.delete(`/webauthn/credentials/${encodeURIComponent(credentialId)}`)
    setPkMsg({ text: t('settings.deleted'), type: 'success' })
    loadPasskeys()
  }

  return (
    <div className="page">
      <PageHeader icon={Settings} title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="grid grid-2">
        <Card className="animate-in animate-in-1" style={{ alignSelf: 'start' }}>
          <div className="card-title"><Shield size={15} /> {t('settings.mailParams')}</div>
          <MsgBanner msg={msg} onClose={() => setMsg({ text: '', type: '' })} />
          <div className="field">
            <label className="field-label">{t('settings.spamThreshold')}</label>
            <input className="input" type="number" step="0.5" min="1" max="20"
              value={form.spamassassin_threshold}
              onChange={e => setForm({ ...form, spamassassin_threshold: parseFloat(e.target.value) })} />
            <div className="input-hint">{t('settings.spamThresholdHint')}</div>
          </div>
          <div className="field" style={{ marginBottom: '20px' }}>
            <label className="field-label"><HardDrive size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />{t('settings.defaultQuota')}</label>
            <input className="input" type="number" min="0"
              value={form.default_quota_mb}
              onChange={e => setForm({ ...form, default_quota_mb: parseInt(e.target.value) || 0 })} />
            <div className="input-hint">{t('settings.defaultQuotaHint')}</div>
          </div>
          <Button variant="primary" onClick={save} loading={saving}>{t('settings.saveSettings')}</Button>
        </Card>

        <Card className="animate-in animate-in-2" style={{ alignSelf: 'start' }}>
          <div className="card-title"><Fingerprint size={15} /> {t('settings.passkeyManagement')}</div>
          <MsgBanner msg={pkMsg} onClose={() => setPkMsg({ text: '', type: '' })} />

          <div style={{ marginBottom: '16px' }}>
            {passkeys.length === 0 && <div style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '8px 0' }}>{t('settings.noPasskeys')}</div>}
            {passkeys.map(p => (
              <div key={p.credential_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{p.nickname}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.created_at}</div>
                </div>
                <Button variant="danger" size="sm" icon={Trash2} onClick={() => deletePasskey(p.credential_id)}>{t('common.delete')}</Button>
              </div>
            ))}
          </div>

          <div className="field" style={{ marginBottom: '12px' }}>
            <label className="field-label">{t('settings.deviceNickname')}</label>
            <input className="input" value={nickname} onChange={e => setNickname(e.target.value)} placeholder={t('settings.deviceNicknamePlaceholder')} />
          </div>
          <Button variant="primary" icon={KeyRound} onClick={registerPasskey} loading={registering}>
            {t('settings.addPasskey')}
          </Button>
          <div className="input-hint" style={{ marginTop: '10px' }}>
            {t('settings.passkeyHint')}
          </div>
        </Card>

        <Card className="animate-in animate-in-3" style={{ alignSelf: 'start' }}>
          <div className="card-title"><Phone size={15} /> {t('settings.phoneLogin')}</div>
          <MsgBanner msg={phoneMsg} onClose={() => setPhoneMsg({ text: '', type: '' })} />

          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', padding: '4px 0 14px' }}>
            {me?.phone_e164 ? t('settings.currentlyBound', { phone: me.phone_e164 }) : t('settings.notBound')}
          </div>

          {me?.phone_e164 ? (
            <Button variant="danger" icon={Trash2} onClick={unbindPhone} loading={phoneBusy}>{t('settings.unbindPhone')}</Button>
          ) : (
            <form onSubmit={bindPhone}>
              <div className="field">
                <label className="field-label">{t('settings.countryLabel')}</label>
                <select className="select" value={phoneForm.country} onChange={e => setPhoneForm({ ...phoneForm, country: e.target.value, phone: formatPhoneInput(e.target.value, phoneForm.phone) })}>
                  <option value="TW">{t('settings.countryTW')}</option>
                  <option value="JP">{t('settings.countryJP')}</option>
                </select>
              </div>
              <div className="field" style={{ marginBottom: 4 }}>
                <label className="field-label">{t('settings.phoneLabel')}</label>
                <input required className="input" value={phoneForm.phone}
                  onChange={e => setPhoneForm({ ...phoneForm, phone: formatPhoneInput(phoneForm.country, e.target.value) })}
                  placeholder={phonePlaceholder(phoneForm.country)} />
              </div>
              <div className="input-hint" style={{ marginBottom: 12 }}>{t('settings.phoneLoginHint')}</div>
              <Button type="submit" variant="primary" icon={Phone} loading={phoneBusy}>{t('settings.bindPhone')}</Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
