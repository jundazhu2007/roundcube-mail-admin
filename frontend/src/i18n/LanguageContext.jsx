import { createContext, useContext } from 'react'
import zhTW from './zh-TW'
import ja from './ja'
import en from './en'

const DICTS = { 'zh-TW': zhTW, ja, en }
export const LANGUAGES = [
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
]

function lookup(dict, key) {
  return key.split('.').reduce((obj, part) => (obj == null ? undefined : obj[part]), dict)
}

function interpolate(str, vars) {
  if (!vars) return str
  return str.replace(/\{\{(\w+)\}\}/g, (_, name) => (name in vars ? vars[name] : `{{${name}}}`))
}

function makeT(lang) {
  return function t(key, vars) {
    const value = lookup(DICTS[lang], key) ?? lookup(DICTS['zh-TW'], key) ?? key
    return typeof value === 'string' ? interpolate(value, vars) : value
  }
}

const LanguageContext = createContext({ lang: 'zh-TW', setLang: () => {}, t: makeT('zh-TW') })

export function LanguageProvider({ lang, setLang, children }) {
  const t = makeT(DICTS[lang] ? lang : 'zh-TW')
  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

export function localeFor(lang) {
  return { 'zh-TW': 'zh-TW', ja: 'ja-JP', en: 'en-US' }[lang] || 'zh-TW'
}
