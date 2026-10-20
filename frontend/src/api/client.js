import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    // 登入逾時（token 過期或失效）：清掉 token 後重新載入目前網址，App 會顯示登入頁，登入後回到同一頁。
    // 原本是導到 /login，但後台在 /admin/ 底下，/login 不存在，會停在 404 頁面進不了登入畫面。
    // 還沒登入時（例如 Passkey 驗證失敗）不重新載入，讓登入頁自己顯示錯誤訊息。
    if (err.response?.status === 401 && localStorage.getItem('token')) {
      localStorage.removeItem('token')
      window.location.reload()
    }
    return Promise.reject(err)
  }
)

export default api
