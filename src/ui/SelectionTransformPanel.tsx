import {useEffect,useState,type FormEvent} from 'react'
import {Move3D,Rotate3D} from 'lucide-react'
import {useEngine} from '../store/EngineContext'
import {useI18n} from '../i18n'
import {selectionTransformStrings} from './selectionTransformStrings'
import './selectionTransform.css'
import AccessoryInstallation from './AccessoryInstallation'
import SingleSelectionPanel from './SingleSelectionPanel'
import ClampGuide from './ClampGuide'

export default function SelectionTransformPanel({menuOpen}:{menuOpen:boolean}) {
  const api=useEngine(),{lang,t}=useI18n(),s=selectionTransformStrings[lang],state=api.selectionTransform
  const [accessoryOpen,setAccessoryOpen]=useState(false)
  const hasAccessory=!!(api.selectedPanelFixing || api.canFlipAccessory || api.installationPreview)
  useEffect(()=>setAccessoryOpen(false),[state?.key,api.activeTabId])
  useEffect(()=>{if(state?.busy)setAccessoryOpen(false)},[state?.busy])
  const showingAccessory=accessoryOpen && hasAccessory
  const [position,setPosition]=useState(['0','0','0'])
  const [axis,setAxis]=useState<'X'|'Y'|'Z'|'free'>('Y'),[angle,setAngle]=useState('0'),[error,setError]=useState('')
  const [rotationDirty,setRotationDirty]=useState(false)
  const coordinates=state?.position.join(',')
  useEffect(()=>{if(coordinates)setPosition(coordinates.split(','));setError('')},[coordinates,state?.key,api.activeTabId])
  const rotation=state?.rotation
  useEffect(()=>{
    setAxis(rotation?.axis || 'Y');setAngle(String(rotation?.degrees ?? 0));setRotationDirty(false)
  },[rotation?.axis,rotation?.degrees,rotation?.revision,state?.key,api.activeTabId])
  if(menuOpen || api.readOnly)return null
  if(api.mode==='select' && api.selectionCount===1)return <SingleSelectionPanel/>
  if(api.engine()?.builder.clampAdjustment())return <div data-ui="clamp-guide"><ClampGuide/></div>
  if(!state)return null
  const submit=(event:FormEvent)=>{
    event.preventDefault()
    if(showingAccessory)return
    if(state.mode==='rotate' && (!rotationDirty || axis==='free'))return
    const values=state.mode==='translate' ? position : [angle]
    if(values.some(value=>!value.trim() || !Number.isFinite(Number(value)))){setError(s.number);return}
    setError('')
    if(state.mode==='translate'){
      const next=position.map(Number);next[1]=Math.max(0,next[1]);setPosition(next.map(String));api.setSelectionPosition(next)
    }
    else if(axis!=='free')api.rotateSelectionAxis(axis,Number(angle))
  }
  return <form className="qb-card qb-transform-panel pointer-events-auto" data-ui="selection-transform" aria-label={s.title} onSubmit={submit}>
    <div className="qb-transform-actions">
      <div role="group" aria-label={s.title} className="qb-transform-modes">
        <button type="button" className="qb-btn qb-btn-sm qb-btn-ghost" aria-pressed={!showingAccessory && state.mode==='translate'} onClick={()=>{setAccessoryOpen(false);api.setSelectionTransformMode('translate')}} disabled={state.busy}><Move3D size={15}/>{s.move}</button>
        <button type="button" className="qb-btn qb-btn-sm qb-btn-ghost" aria-pressed={!showingAccessory && state.mode==='rotate'} onClick={()=>{setAccessoryOpen(false);api.setSelectionTransformMode('rotate')}} disabled={state.busy}><Rotate3D size={15}/>{s.rotate}</button>
        {hasAccessory && <button type="button" className="qb-btn qb-btn-sm qb-btn-ghost" data-ui="selection-accessory-tab" aria-pressed={showingAccessory} onClick={()=>setAccessoryOpen(true)} disabled={state.busy}>{t('tool.accessories')}</button>}
      </div>
      {!showingAccessory && <>
      <button type="button" className="qb-btn qb-btn-sm qb-btn-ghost qb-transform-whole" onClick={api.selectTransformBlock} disabled={state.busy}>{s.whole}</button>
      <label className="qb-transform-snap"><input type="checkbox" checked={state.snap} onChange={event=>api.setSelectionTransformSnap(event.target.checked)}/>{s.snap}</label>
      <button type="submit" className="qb-btn qb-btn-sm" disabled={state.busy || state.mode==='rotate' && (!rotationDirty || axis==='free')}>{s.apply}</button>
      </>}
    </div>
    {showingAccessory && <AccessoryInstallation menuOpen={false} embedded/>}
    {!showingAccessory && <>{state.mode==='translate' ? <div className="qb-transform-fields">
      {[s.x,s.height,s.z].map((label,i)=><label key={i} data-axis={['X','Y','Z'][i]}><span>{label} <small>{s.unit}</small></span><input type="number" step="0.01" inputMode="decimal" aria-label={`${label} (${s.unit})`} value={position[i]} disabled={state.busy} onChange={event=>setPosition(old=>old.map((value,index)=>index===i ? event.target.value : value))}/></label>)}
    </div> : <div className="qb-transform-fields qb-transform-rotation">
      <label><span>{s.axis}</span><select aria-label={s.axis} value={axis} disabled={state.busy} onChange={event=>{setAxis(event.target.value as 'X'|'Y'|'Z');setAngle('0');setRotationDirty(false)}}><option value="X">X</option><option value="Y">Y</option><option value="Z">Z</option>{axis==='free' && <option value="free" disabled>{s.free}</option>}</select></label>
      <label><span>{s.angle} <small>{s.degree}</small></span><input type="number" step="0.01" inputMode="decimal" aria-label={`${s.angle} (${s.degree})`} value={angle} disabled={state.busy || axis==='free'} onChange={event=>{setAngle(event.target.value);setRotationDirty(true)}}/></label>
    </div>}
    <p className="qb-transform-help">{state.mode==='rotate' ? s.rotationHelp : s.help}</p>
    </>}
    {(error || state.error) && <p className="qb-transform-error" role="alert">{error || state.error}</p>}
  </form>
}
