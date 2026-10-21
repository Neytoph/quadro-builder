import {BuildModel} from './model.js';
import {infeasibleConnectors} from './bom.js';
import {geometry} from './catalog.js';
import {selectionBounds,incompleteRigidSelection} from './selectionTransform.js';

// 预览用独立模型，保存、协作和料表始终读取已确认的模型。
export class SelectionTransformSession {
  constructor(builder) {
    this.builder=builder;
    this.bounds=selectionBounds(builder.model,builder.selection);
    this.selection=new Map(builder.selection);
    this.before=JSON.stringify(builder.model.toJSON());
    this.history=builder.history;
    this.model=new BuildModel();
    this.valid=false;
    this.reason=null;
  }

  preview({translation=[0,0,0],axis=[0,1,0],angle=0}={}) {
    this.model.loadJSON(JSON.parse(this.before));
    if (!this.bounds || incompleteRigidSelection(this.model,this.bounds.targets)) {
      this.valid=false;this.reason='accessory_mounts';return false;
    }
    if (!Array.isArray(translation) || !translation.every(Number.isFinite) || translation.length!==3 || !Number.isFinite(angle)) {
      this.valid=false;this.reason='empty';return false;
    }
    let result={ok:true};
    if (Math.abs(angle)>1e-9) result=this.model.rotateSelectionAxis(this.selection,axis,angle,this.bounds.center,{validate:infeasibleConnectors,connectorSize:geometry().connectorSize});
    if (result.ok) result=this.model.moveSelection(this.selection,...translation,{merge:false,validate:infeasibleConnectors,snapDist:0});
    this.valid=result.ok;this.reason=result.reason || null;
    // 无效位置仍展示刚体候选，已确认模型不变。旋转失败时保持原姿态并给出原因。
    if (!result.ok && Math.abs(angle)<1e-9) this.model.translateSelection(this.selection,...translation);
    return this.valid;
  }

  commit() {
    const builder=this.builder;
    if (!this.valid || builder.readOnly || builder.history!==this.history || builder._externalPending
        || JSON.stringify(builder.model.toJSON())!==this.before) return false;
    builder.model.loadJSON(this.model.toJSON());
    builder._pushHistory(this.before);
    return true;
  }
}
