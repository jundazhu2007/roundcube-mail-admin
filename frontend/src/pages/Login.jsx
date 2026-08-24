import { useState } from 'react'
import { KeyRound, LogIn, ShieldCheck } from 'lucide-react'
import { PasskeyLogin } from '../components/PasskeyAuth'
import { useLanguage } from '../i18n/LanguageContext'
import { detailToText } from '../i18n/errorText'
import { formatPhoneInput, phonePlaceholder } from '../utils/phone'
import '../styles/login.css'

export default function Login({ onLogin }) {
  const { t } = useLanguage()
  const [loginMode, setLoginMode] = useState('account') // 'account' | 'phone'
  const [username, setUsername] = useState('')
  const [phoneCountry, setPhoneCountry] = useState('TW')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPasskey, setShowPasskey] = useState(false)

  const handlePasswordLogin = async () => {
    try {
      setLoading(true)
      setError('')

      const body = loginMode === 'phone'
        ? { phone_country: phoneCountry, phone: phoneNumber, password }
        : { username, password }

      const resp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}))
        throw new Error(detailToText(errBody.detail, t) || t('common.unknownError'))
      }
      const { access_token } = await resp.json()
      localStorage.setItem('token', access_token)
      if (loginMode !== 'phone') localStorage.setItem('currentUser', username)
      onLogin()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-blob b1" />
      <div className="login-blob b2" />
      <div className="login-blob b3" />
      <span className="login-paw p1">🐾</span>
      <span className="login-paw p2">🐾</span>
      <span className="login-paw p3">🐾</span>
      <span className="login-paw p4">🐾</span>
      <span className="login-paw p5">🐾</span>
      <span className="login-paw p6">🐾</span>
      <span className="login-paw p7">🐾</span>
      <span className="login-paw p8">🐾</span>
      <span className="login-deco d1">✨</span>
      <span className="login-deco d2">💛</span>
      <span className="login-deco d3">✨</span>
      <span className="login-deco d4">🧶</span>
      <span className="login-deco d5">🐟</span>
      <span className="login-deco d6">✨</span>
      <span className="login-zzz">💤</span>

      <div className="login-card">
        <div className="login-logo-wrap">
          <div className="login-logo">🐱</div>
          <span className="login-logo-sparkle s1">✨</span>
          <span className="login-logo-sparkle s2">⭐</span>
        </div>
        <h1>NannanCat Mail Admin</h1>
        <div className="subtitle">{t('login.subtitle')}</div>

        {!showPasskey && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button type="button" onClick={() => setLoginMode('account')}
                className={`back-btn`} style={{ flex: 1, marginTop: 0, fontWeight: loginMode === 'account' ? 700 : 400,
                  borderColor: loginMode === 'account' ? 'var(--primary)' : undefined,
                  color: loginMode === 'account' ? 'var(--primary)' : undefined }}>
                {t('login.loginByAccount')}
              </button>
              <button type="button" onClick={() => setLoginMode('phone')}
                className={`back-btn`} style={{ flex: 1, marginTop: 0, fontWeight: loginMode === 'phone' ? 700 : 400,
                  borderColor: loginMode === 'phone' ? 'var(--primary)' : undefined,
                  color: loginMode === 'phone' ? 'var(--primary)' : undefined }}>
                {t('login.loginByPhone')}
              </button>
            </div>

            <div className="login-form">
              {loginMode === 'account' ? (
                <input
                  type="text"
                  placeholder={t('login.username')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                />
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={phoneCountry} onChange={e => { setPhoneCountry(e.target.value); setPhoneNumber(formatPhoneInput(e.target.value, phoneNumber)) }} disabled={loading}
                    style={{ borderRadius: 10, border: '1px solid var(--border-input)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', padding: '0 8px' }}>
                    <option value="TW">🇹🇼 TW</option>
                    <option value="JP">🇯🇵 JP</option>
                  </select>
                  <input
                    type="tel"
                    placeholder={phonePlaceholder(phoneCountry)}
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(formatPhoneInput(phoneCountry, e.target.value))}
                    disabled={loading}
                    onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                    style={{ flex: 1 }}
                  />
                </div>
              )}
              <input
                type="password"
                placeholder={t('login.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
              />
              <button onClick={handlePasswordLogin} disabled={loading}>
                {loading ? <span className="spinner" /> : <LogIn size={16} />}
                {loading ? t('login.loggingIn') : t('login.login')}
              </button>
            </div>

            <div className="divider">{t('login.or')}</div>

            <button
              className="passkey-btn"
              onClick={() => setShowPasskey(true)}
            >
              <KeyRound size={16} /> {t('login.loginWithPasskey')}
            </button>

            {error && <p className="error">{error}</p>}
          </>
        )}

        {showPasskey && (
          <>
            <PasskeyLogin
              onSuccess={() => { onLogin() }}
              onError={(msg) => setError(msg)}
            />
            {error && <p className="error">{error}</p>}
            <button
              className="back-btn"
              onClick={() => {
                setShowPasskey(false)
                setError('')
              }}
            >
              {t('login.back')}
            </button>
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', marginTop: '18px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <ShieldCheck size={12} /> {t('login.encryptedConnection')}
        </div>
        <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '10.5px', color: 'var(--text-muted)' }}>
          {t('login.copyright')}
        </div>
      </div>
    </div>
  )
}
