import type { ReactNode } from 'react'
import {useEngine} from '../store/EngineContext'
import AccessoryInstallation from './AccessoryInstallation'
import ClampGuide from './ClampGuide'
import FlexiGuide from './FlexiGuide'
import SelectionTransformPanel from './SelectionTransformPanel'
import SingleSelectionPanel from './SingleSelectionPanel'
import { PastePlacementPanel, SelectionEditActions } from './MobileEditing'

export default function ComponentAdjustmentPanel({menuOpen}:{menuOpen:boolean}) {
  const api=useEngine(),builder=api.engine()?.builder
  if(menuOpen)return null
  if(!api.readOnly){
    if (api.pasting && api.touchEditing) return <PastePlacementPanel />
    const withSelectionActions = (panel: ReactNode) => {
      if (!api.touchEditing || api.mode !== 'select' || !api.selectionCount) return panel
      return <div className="qb-edit-special-stack">
        <div className="qb-card qb-transform-panel qb-edit-special-actions pointer-events-auto">
          <SelectionEditActions disabled={builder?.busy()} />
        </div>
        {panel}
      </div>
    }
    if(api.mode==='select' && api.selectionCount===1)return withSelectionActions(<SingleSelectionPanel/>)
    if(builder?.clampAdjustment())return withSelectionActions(<div data-ui="clamp-guide"><ClampGuide/></div>)
    const flexi=(api.mode==='fitting' && ['flexi','flexi_bolt','flexi_hinge'].includes(api.fittingKind))
      || (api.mode==='select' && !!builder?.flexiTarget())
    if(flexi && !api.boxSelect)return withSelectionActions(<div data-ui="flexi-guide"><FlexiGuide/></div>)
    if(api.selectionTransform)return <SelectionTransformPanel menuOpen={false}/>
  }
  return <AccessoryInstallation menuOpen={false}/>
}
