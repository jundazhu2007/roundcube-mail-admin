import { useEffect, useState } from 'react'
import { Globe2, Plus, X, ShieldAlert } from 'lucide-react'
import api from '../api/client'
import { PageHeader, Card, Button, MsgBanner, Badge } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'
import { countryFlag } from './PageSecurity'
import { CONTINENTS } from '../data/countries'

export default function PageWebmailPolicy() {
  const { t } = useLanguage()
  const [policy, setPolicy] = useState({ mode: 'disabled', countries: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState({ text: '', type: '' })
  const [newCode, setNewCode] = useState('')

  useEffect(() => {
    api.get('/webmail-policy/').then(r => setPolicy(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const addCountry = () => {
    const code = newCode.trim().toUpperCase()
    if (!code || code.length !== 2) return
    if (policy.countries.includes(code)) return
    setPolicy({ ...policy, countries: [...policy.countries, code] })
    setNewCode('')
  }

  const removeCountry = (code) => {
    setPolicy({ ...policy, countries: policy.countries.filter(c => c !== code) })
  }

  const toggleCountry = (code) => {
    if (policy.countries.includes(code)) removeCountry(code)
    else setPolicy({ ...policy, countries: [...policy.countries, code] })
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/webmail-policy/', policy)
      setMsg({ text: t('webmailPolicy.saveSuccess'), type: 'success' })
    } catch (err) {
      setMsg({ text: t('webmailPolicy.saveFailed', { error: apiErrorText(err, t) }), type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="page"><div className="empty-row">{t('common.loading')}</div></div>

  return (
    <div className="page">
      <PageHeader icon={Globe2} title={t('webmailPolicy.title')} subtitle={t('webmailPolicy.subtitle')} />
      <MsgBanner msg={msg} onClose={() => setMsg({ text: '', type: '' })} />

      <Card className="animate-in animate-in-1" style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--primary-soft)', marginBottom: 16, fontSize: 12 }}>
          <ShieldAlert size={14} style={{ marginTop: 1, flexShrink: 0, color: 'var(--primary)' }} />
          <span>{t('webmailPolicy.failOpenNotice')}</span>
        </div>

        <div className="field">
          <label className="field-label">{t('webmailPolicy.mode')}</label>
          <select className="select" value={policy.mode} onChange={e => setPolicy({ ...policy, mode: e.target.value })}>
            <option value="disabled">{t('webmailPolicy.modeDisabled')}</option>
            <option value="whitelist">{t('webmailPolicy.modeWhitelist')}</option>
            <option value="blacklist">{t('webmailPolicy.modeBlacklist')}</option>
          </select>
        </div>

        {policy.mode === 'disabled' ? (
          <div className="input-hint" style={{ marginBottom: 16 }}>{t('webmailPolicy.disabledNotice')}</div>
        ) : (
          <div className="field">
            <label className="field-label">{t('webmailPolicy.countries')}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {policy.countries.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
              {policy.countries.map(code => (
                <Badge key={code} tone="neutral">
                  {countryFlag(code)} {code}
                  <X size={11} style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => removeCountry(code)} />
                </Badge>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {CONTINENTS.map(continent => (
                <details key={continent.key} style={{
                  border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', background: 'var(--bg-secondary)',
                }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '4px 0' }}>
                    {t(continent.labelKey)} ({continent.countries.filter(([code]) => policy.countries.includes(code)).length}/{continent.countries.length})
                  </summary>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '6px 2px 4px' }}>
                    {continent.countries.map(([code, name]) => (
                      <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', minWidth: 150 }}>
                        <input type="checkbox" checked={policy.countries.includes(code)} onChange={() => toggleCountry(code)} />
                        {countryFlag(code)} {name} ({code})
                      </label>
                    ))}
                  </div>
                </details>
              ))}
            </div>

            <div className="input-row">
              <input className="input" style={{ flex: 1 }} value={newCode}
                onChange={e => setNewCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCountry())}
                placeholder={t('webmailPolicy.countryCodePlaceholder')} maxLength={2} />
              <Button type="button" variant="ghost" icon={Plus} onClick={addCountry}>{t('webmailPolicy.addCountry')}</Button>
            </div>
          </div>
        )}

        <Button variant="primary" onClick={save} loading={saving}>{t('webmailPolicy.save')}</Button>
      </Card>
    </div>
  )
}
