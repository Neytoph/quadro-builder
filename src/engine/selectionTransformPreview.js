import {Matrix4,Vector3} from 'three';

/** 拖动只更新已绘制零件的矩阵；完整模型校验留在松手提交时执行。 */
export class SelectionTransformPreview {
  constructor(scene,model,bounds) {
    this.scene=scene;this.model=model;this.origin=bounds;this.bounds=bounds;
    this.value={translation:[0,0,0],axis:[0,1,0],angle:0};this.valid=true;
    this.matrix=new Matrix4();this.rotationOnly=new Matrix4();this.rotation=new Matrix4();this.scratch=new Matrix4();this.point=new Vector3();this.axis=new Vector3();
    const targets=bounds.targets,ids=new Set([...targets.nodes,...targets.clamps,...targets.slides,...targets.fittings]);
    for(const tube of model.tubes.values())if(targets.nodes.has(tube.a) && targets.nodes.has(tube.b))ids.add(tube.id);
    for(const map of [model.panels,model.textiles])for(const part of map.values()){
      const supports=part.supportTubes || [part.a,part.b];
      if(supports.length && supports.every(id=>ids.has(id)))ids.add(part.id);
    }
    // 旧轴承由接头旋转时自动带动；未被选中时，平移仍沿模型原有规则保持原位。
    const bearings=new Set([...targets.nodes].map(id=>model.nodes.get(id)?.bearingOn).filter(id=>id && !ids.has(id)));
    const points=[...targets.nodes].map(id=>model.nodes.get(id));
    if(!points.length)for(const key of ['clamps','slides','fittings'])for(const id of targets[key])points.push(model[key].get(id));
    this.points=points.filter(Boolean).map(p=>[p.x,p.y,p.z]);
    scene._finishMotion();scene.setHoverPart(null);
    const pieces=[];
    for(const rec of scene._indexParts(scene.buildGroup.children).values()){
      if(ids.has(rec.id))pieces.push(...rec.pieces);
      else if(bearings.has(rec.id))pieces.push(...rec.pieces.map(p=>({...p,rotationOnly:true})));
    }
    scene.buildGroup.traverse(obj=>{if(ids.has(obj.userData.partOutlineFor))pieces.push({obj,index:-1});});
    // 同一零件的嵌套Mesh只移动最外层，避免父子节点叠加两次变换。
    const moving=new Set(pieces.filter(p=>p.index<0).map(p=>p.obj));
    const roots=pieces.filter(p=>{if(p.index>=0)return true;for(let parent=p.obj.parent;parent;parent=parent.parent)if(moving.has(parent))return false;return true;});
    this.pieces=scene._bindPieces(roots).map((p,i)=>({...p,rotationOnly:!!roots[i].rotationOnly}));
    this.instances=new Map(this.pieces.filter(p=>p.index>=0).map(p=>[p.obj,{frustumCulled:p.obj.frustumCulled,boundingSphere:p.obj.boundingSphere}]));
    for(const obj of this.instances.keys())obj.frustumCulled=false;
    this.labelsVisible=scene.labelGroup.visible;scene.labelGroup.visible=false;
    scene.selectionTransformPreview=this;
  }

  update({translation=[0,0,0],axis=[0,1,0],angle=0}={}) {
    if(!Array.isArray(translation) || translation.length!==3 || !translation.every(Number.isFinite)
        || !Array.isArray(axis) || axis.length!==3 || !axis.every(Number.isFinite) || Math.hypot(...axis)<1e-9 || !Number.isFinite(angle)){
      this.valid=false;this.reason='empty';return false;
    }
    // 平移到地面即停，横向分量仍可继续；预览与松手提交共用修正后的位移。
    translation=[...translation];
    if(Math.abs(angle)<1e-9)translation[1]=Math.max(translation[1],-this.origin.height);
    this.value={translation,axis:[...axis],angle};
    this.axis.fromArray(axis).normalize();
    const center=this.origin.center;
    this.matrix.makeTranslation(-center[0],-center[1],-center[2]);
    this.matrix.premultiply(this.rotation.makeRotationAxis(this.axis,angle));
    this.matrix.premultiply(this.rotation.makeTranslation(...center));
    this.rotationOnly.copy(this.matrix);
    this.matrix.premultiply(this.rotation.makeTranslation(...translation));
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const p of this.points){
      this.point.fromArray(p).applyMatrix4(this.matrix);
      for(let i=0;i<3;i++){const value=this.point.getComponent(i);min[i]=Math.min(min[i],value);max[i]=Math.max(max[i],value);}
    }
    this.bounds={center:min.map((v,i)=>(v+max[i])/2),height:min[1]};
    this.reason=this.model.isBelowGround(min[1]) ? 'ground' : null;
    this.valid=!this.reason;this.apply();return this.valid;
  }

  apply(restore=false) {
    for(const p of this.pieces){
      const matrix=this.scratch;
      if(restore)matrix.copy(p.base);
      else matrix.multiplyMatrices(p.rotationOnly ? this.rotationOnly : this.matrix,p.P).premultiply(p.Pinv).multiply(p.base);
      if(p.index>=0){p.obj.setMatrixAt(p.index,matrix);p.obj.instanceMatrix.needsUpdate=true;}
      else if(p.obj.matrixAutoUpdate)matrix.decompose(p.obj.position,p.obj.quaternion,p.obj.scale);
      else {p.obj.matrix.copy(matrix);p.obj.matrixWorldNeedsUpdate=true;}
    }
    this.scene._shadowsDirty();this.scene.requestRender();
  }

  dispose() {
    this.apply(true);
    for(const [obj,state] of this.instances){obj.frustumCulled=state.frustumCulled;obj.boundingSphere=state.boundingSphere;}
    this.scene.labelGroup.visible=this.labelsVisible;
    if(this.scene.selectionTransformPreview===this)this.scene.selectionTransformPreview=null;
  }
}
