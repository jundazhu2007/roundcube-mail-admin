// 每個頁面都有自己的網址：/admin/<頁面 id>（儀表板就是 /admin/）。
// Apache 的 FallbackResource 會把 /admin/ 底下所有路徑都交給 index.html，
// 所以重新整理、加書籤、直接貼網址都會回到同一頁。
const BASE = import.meta.env.BASE_URL // vite.config.js 的 base：'/admin/'

export function pagePath(id) {
  return id === 'dashboard' ? BASE : `${BASE}${id}`
}

/** 從目前網址取出頁面 id，認不得的路徑一律當成儀表板。 */
export function pageIdFromLocation(validIds) {
  const id = window.location.pathname.slice(BASE.length).split('/')[0]
  return validIds.includes(id) ? id : 'dashboard'
}

/** 'webmail-logins' → 'nav.webmailLogins'，跟側邊欄用同一組文字當分頁標題。 */
export function navLabelKey(id) {
  return 'nav.' + id.replace(/-(\w)/g, (_, c) => c.toUpperCase())
}
