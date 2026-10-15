import { useEffect, useState } from 'react'
import { ScrollText, Search, RefreshCw } from 'lucide-react'
import api from '../api/client'
import { PageHeader, Button } from '../components/ui'

export default function PageLogs() {
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState('')
  const [limit, setLimit] = useState(100)
  const [loading, setLoading] = useState(false)

  const load = () => {
    api.get(`/logs/?limit=${limit}&filter=${filter}`).then(r=>setLogs(r.data)).catch(()=>{}).finally(()=>setLoading(false))
  }
  const refresh = () => { setLoading(true); load() }
  useEffect(()=>{ load() },[limit])

  const typeColor = { blocked:'#ff7a7a', virus:'#ff7a7a', error:'#ff7a7a', sent:'#3ddc97', info:'#c7cad1' }

  return (
    <div className="page">
      <PageHeader icon={ScrollText} title="郵件 Log" subtitle="即時郵件收發紀錄"
        actions={<>
          <div className="search-box">
            <Search size={14} />
            <input className="input" placeholder="搜尋..." value={filter} onChange={e=>setFilter(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && refresh()} />
          </div>
          <Button variant="ghost" icon={RefreshCw} onClick={refresh} loading={loading}>重新整理</Button>
          <select className="select" style={{width:'auto'}} value={limit} onChange={e=>setLimit(e.target.value)}>
            <option value={50}>最近 50 筆</option>
            <option value={100}>最近 100 筆</option>
            <option value={200}>最近 200 筆</option>
            <option value={500}>最近 500 筆</option>
          </select>
        </>} />

      <div style={{
        background: '#14151c', border: '1px solid #262834', borderRadius: 'var(--radius-lg)',
        overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ display: 'flex', gap: '6px', padding: '10px 14px', borderBottom: '1px solid #262834' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
        </div>
        <div style={{ padding: '12px 16px', maxHeight: '580px', overflow: 'auto' }}>
          {logs.map((l,i) => (
            <div key={i} style={{
              fontSize: '12px', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', padding: '4px 0',
              color: typeColor[l.type] || '#c7cad1', wordBreak: 'break-all', lineHeight: 1.6,
            }}>
              {l.raw}
            </div>
          ))}
          {logs.length===0 && <div style={{color:'#676e7d',textAlign:'center',padding:'24px',fontSize:'13px'}}>沒有 Log 資料</div>}
        </div>
      </div>
    </div>
  )
}
