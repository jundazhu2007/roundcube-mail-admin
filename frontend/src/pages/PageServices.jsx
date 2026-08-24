import { useEffect, useState } from 'react'
import { ServerCog, RefreshCw, Activity, Gauge, CheckCircle2, XCircle, Power, RotateCcw, TriangleAlert } from 'lucide-react'
import api from '../api/client'
import { PageHeader, Card, Button, StatusBadge, Modal, MsgBanner } from '../components/ui'
import { useLanguage } from '../i18n/LanguageContext'
import { apiErrorText } from '../i18n/errorText'

function PowerConfirmModal({ action, onClose, onConfirmed, t }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ text: '', type: '' })
  const word = t('services.confirmWord')
  const ready = typed.trim().toUpperCase() === word

  const go = async () => {
    setBusy(true)
    try {
      await api.post(`/services/power/${action}`)
      onConfirmed(action)
      onClose()
    } catch (err) {
      setMsg({ text: t('services.powerActionFailed', { error: apiErrorText(err, t) }), type: 'error' })
      setBusy(false)
    }
  }

  return (
    <Modal title={action === 'reboot' ? t('services.rebootConfirmTitle') : t('services.shutdownConfirmTitle')} onClose={onClose}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="button" variant="danger" disabled={!ready} loading={busy} onClick={go}>{t('common.confirm')}</Button>
      </>}>
      <MsgBanner msg={msg} onClose={() => setMsg({ text: '', type: '' })} />
      <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--text-primary)', fontSize: 12, marginBottom: 14 }}>
        <TriangleAlert size={14} style={{ flexShrink: 0, marginTop: 1, color: 'var(--danger)' }} />
        <span>{t('services.powerWarning')}</span>
      </div>
      <div className="field" style={{ marginBottom: 4 }}>
        <label className="field-label">{t('services.typeToConfirm', { word })}</label>
        <input className="input" value={typed} onChange={e => setTyped(e.target.value)} autoFocus />
      </div>
    </Modal>
  )
}

export default function PageServices({ currentAdmin }) {
  const { t } = useLanguage()
  const [services, setServices] = useState([])
  const [system, setSystem] = useState({})
  const [restarting, setRestarting] = useState('')
  const [loading, setLoading] = useState(false)
  const [powerAction, setPowerAction] = useState(null) // 'reboot' | 'shutdown' | null
  const [powerMsg, setPowerMsg] = useState({ text: '', type: '' })

  const load = () => {
    Promise.all([
      api.get('/services/').then(r=>setServices(r.data)).catch(()=>{}),
      api.get('/services/system').then(r=>setSystem(r.data)).catch(()=>{}),
    ]).finally(()=>setLoading(false))
  }
  const refresh = () => { setLoading(true); load() }
  useEffect(()=>{ load() },[])

  const restart = async (svc) => {
    if (!confirm(t('services.confirmRestart', { service: svc }))) return
    setRestarting(svc)
    await api.post(`/services/restart/${svc}`).catch(()=>{})
    setTimeout(()=>{ load(); setRestarting('') }, 2000)
  }

  return (
    <div className="page">
      <PageHeader icon={ServerCog} title={t('services.title')} subtitle={t('services.subtitle')}
        actions={<Button variant="ghost" icon={RefreshCw} onClick={refresh} loading={loading}>{t('services.refresh')}</Button>} />

      <div className="grid grid-2">
        <Card className="animate-in animate-in-1">
          <div className="card-title"><Activity size={15} /> {t('services.serviceStatus')}</div>
          {services.map(s => (
            <div key={s.name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:'1px solid var(--border)'}}>
              <div style={{display:'flex',alignItems:'center',gap:'9px',fontSize:'13px',color:'var(--text-primary)'}}>
                <span className={`dot ${s.status==='active'?'dot-success':'dot-danger'}`} />
                {s.name}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <StatusBadge active={s.status==='active'} />
                <Button size="sm" variant="ghost" loading={restarting===s.name} onClick={()=>restart(s.name)} disabled={restarting===s.name}>
                  {restarting===s.name?t('services.restarting'):t('services.restart')}
                </Button>
              </div>
            </div>
          ))}
          {services.length === 0 && <div className="empty-row">{t('common.loading')}</div>}
        </Card>

        <Card className="animate-in animate-in-2">
          <div className="card-title"><Gauge size={15} /> {t('services.systemResources')}</div>
          {[[t('dashboard.cpu'),system.cpu],[t('dashboard.memory'),system.memory],[t('dashboard.diskRoot'),system.disk_root],[t('dashboard.diskNas'),system.disk_nas]].map(([k,v])=>(
            <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--border)',fontSize:'13px'}}>
              <span style={{color:'var(--text-secondary)'}}>{k}</span>
              <span style={{fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace',color:'var(--text-primary)',fontWeight:600}}>{v||'···'}</span>
            </div>
          ))}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',fontSize:'13px'}}>
            <span style={{color:'var(--text-secondary)'}}>{t('services.nfsMount')}</span>
            <span style={{color:system.nfs==='mounted'?'var(--success)':'var(--danger)',fontWeight:600,display:'flex',alignItems:'center',gap:'5px'}}>
              {system.nfs==='mounted'?<CheckCircle2 size={14}/>:<XCircle size={14}/>}
              {system.nfs==='mounted'?t('services.mounted'):t('services.notMounted')}
            </span>
          </div>
        </Card>

        {currentAdmin?.super_admin && (
          <Card className="animate-in animate-in-3">
            <div className="card-title"><Power size={15} /> {t('services.powerControl')}</div>
            <MsgBanner msg={powerMsg} onClose={() => setPowerMsg({ text: '', type: '' })} />
            <div className="input-hint" style={{ marginBottom: 12 }}>{t('services.powerWarning')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" icon={RotateCcw} onClick={() => setPowerAction('reboot')}>{t('services.reboot')}</Button>
              <Button variant="danger" icon={Power} onClick={() => setPowerAction('shutdown')}>{t('services.shutdown')}</Button>
            </div>
          </Card>
        )}
      </div>

      {powerAction && (
        <PowerConfirmModal action={powerAction} t={t} onClose={() => setPowerAction(null)}
          onConfirmed={(action) => setPowerMsg({
            text: action === 'reboot' ? t('services.rebootTriggered') : t('services.shutdownTriggered'),
            type: 'success',
          })} />
      )}
    </div>
  )
}
