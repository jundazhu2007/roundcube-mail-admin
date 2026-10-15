import { useEffect, useRef } from 'react'

// 定時輪詢，但分頁切到背景（看不到）時暫停，切回來立刻補抓一次再繼續。
// 後台開著放在背景分頁時不會持續打 API 佔用伺服器資源，回來看時資料也是最新的。
export default function usePolling(fn, ms) {
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn })

  useEffect(() => {
    let timer = null
    const start = () => { if (!timer) timer = setInterval(() => fnRef.current(), ms) }
    const stop = () => { clearInterval(timer); timer = null }
    const onVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        fnRef.current()
        start()
      }
    }
    fnRef.current()
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms])
}
