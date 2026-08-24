import { useState, useEffect } from 'react'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import api from './api/client'
import { LanguageProvider } from './i18n/LanguageContext'

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem('token'))
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system')
  const [currentAdmin, setCurrentAdmin] = useState(null)
  const [lang, setLang] = useState(localStorage.getItem('lang') || 'zh-TW')

  useEffect(() => {
    localStorage.setItem('lang', lang)
  }, [lang])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', theme)
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    if (!authed) {
      setCurrentAdmin(null)
      return
    }
    api.get('/admins/me').then(r => setCurrentAdmin(r.data)).catch(() => {})
  }, [authed])

  return (
    <LanguageProvider lang={lang} setLang={setLang}>
      {authed
        ? <Dashboard
            onLogout={() => { localStorage.removeItem('token'); setAuthed(false) }}
            theme={theme}
            setTheme={setTheme}
            currentAdmin={currentAdmin}
          />
        : <Login onLogin={() => setAuthed(true)} theme={theme} />}
    </LanguageProvider>
  )
}
