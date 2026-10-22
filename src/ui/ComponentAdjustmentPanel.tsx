import {useEngine} from '../store/EngineContext'
import AccessoryInstallation from './AccessoryInstallation'
import ClampGuide from './ClampGuide'
import FlexiGuide from './FlexiGuide'
import SelectionTransformPanel from './SelectionTransformPanel'
import SingleSelectionPanel from './SingleSelectionPanel'

export default function ComponentAdjustmentPanel({menuOpen}:{menuOpen:boolean}) {
  const api=useEngine(),builder=api.engine()?.builder
  if(menuOpen)return null
  if(!api.readOnly){
    if(api.mode==='select' && api.selectionCount===1)return <SingleSelectionPanel/>
    if(builder?.clampAdjustment())return <div data-ui="clamp-guide"><ClampGuide/></div>
    const flexi=(api.mode==='fitting' && ['flexi','flexi_bolt','flexi_hinge'].includes(api.fittingKind))
      || (api.mode==='select' && !!builder?.flexiTarget())
    if(flexi && !api.boxSelect)return <div data-ui="flexi-guide"><FlexiGuide/></div>
    if(api.selectionTransform)return <SelectionTransformPanel menuOpen={false}/>
  }
  return <AccessoryInstallation menuOpen={false}/>
}
