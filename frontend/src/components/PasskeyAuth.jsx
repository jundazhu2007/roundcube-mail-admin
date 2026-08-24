import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { startAuthentication } from '@simplewebauthn/browser'
import api from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'

export function PasskeyLogin({ onSuccess, onError }) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(false)

  const handlePasskeyLogin = async () => {
    try {
      setLoading(true)
      const startRes = await api.post('/webauthn/auth/start')
      const { session_id, options } = startRes.data
      const credential = await startAuthentication({ optionsJSON: options })
      const verifyRes = await api.post('/webauthn/auth/verify', { session_id, credential })
      localStorage.setItem('token', verifyRes.data.access_token)
      onSuccess()
    } catch (err) {
      onError(apiErrorText(err, t) || t('errors.passkey_login_failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-form">
      <button onClick={handlePasskeyLogin} disabled={loading}>
        {loading ? <span className="spinner" /> : <KeyRound size={16} />}
        {loading ? t('login.waitingForDevice') : t('login.loginWithPasskey')}
      </button>
    </div>
  )
}
