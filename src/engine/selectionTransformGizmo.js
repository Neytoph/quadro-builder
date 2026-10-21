import {Object3D,Vector3} from 'three';
import {TransformControls} from 'three/examples/jsm/controls/TransformControls.js';
import {selectionBounds} from './selectionTransform.js';
import {applySelectionTransformAppearance} from './selectionTransformAppearance.js';

/** Three.js 操作轴只改变代理对象，由 Builder 完成模型预览与一次性提交。 */
export class SelectionTransformGizmo {
  constructor(builder) {
    this.builder=builder;this.scene=builder.scene;
    this.pointerId=null;this.orbitEnabled=null;
    this.proxy=new Object3D();
    this.control=new TransformControls(this.scene.camera);
    this.control.setSpace('world');this.control.setSize(0.95);
    applySelectionTransformAppearance(this.control);
    this.control.attach(this.proxy);
    this.helper=this.control.getHelper();
    this.scene.scene.add(this.proxy,this.helper);
    this.control.addEventListener('change',()=>this.scene.requestRender());
    this.control.addEventListener('objectChange',()=>this.preview());
    this.handlers={pointerdown:e=>this.down(e),pointermove:e=>this.move(e),pointerup:e=>this.up(e),pointercancel:e=>this.cancel(e),lostpointercapture:e=>this.cancel(e)};
    this.bindCanvas();
  }

  bindCanvas() {
    if(this.canvas)for(const [type,handler] of Object.entries(this.handlers))this.canvas.removeEventListener(type,handler,true);
    this.cancel();this.canvas=this.scene.renderer.domElement;
    this.control.domElement=this.canvas;
    for(const [type,handler] of Object.entries(this.handlers))this.canvas.addEventListener(type,handler,true);
  }

  sync() {
    const b=this.builder,bounds=selectionBounds(b.model,b.selection);
    const visible=b.mode==='select' && b.selection.size>1 && !b.readOnly && !b.boxSelect && !b._paste && !b._clampDrag && !b._hingeDrag && !b.held && !!bounds;
    this.control.camera=this.scene.camera;
    this.control.enabled=visible;this.helper.visible=visible;
    if(!visible){this.cancel();return;}
    this.control.setMode(b.transformMode || 'translate');
    if(this.pointerId===null){this.proxy.position.fromArray(bounds.center);this.proxy.quaternion.identity();}
    this.proxy.updateMatrixWorld(true);this.helper.updateMatrixWorld(true);
  }

  updateCamera() {this.control.camera=this.scene.camera;this.flushPreview();}

  pointer(e) {
    const r=this.canvas.getBoundingClientRect();
    return {x:(e.clientX-r.left)/r.width*2-1,y:-(e.clientY-r.top)/r.height*2+1,button:e.button};
  }

  down(e) {
    if(this.pointerId!==null){this.cancel();return;}
    if(!this.control.enabled || e.button!==0 || e.altKey || e.ctrlKey || e.metaKey)return;
    this.control.pointerHover(this.pointer(e));
    if(!this.control.axis)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(!this.builder.beginSelectionTransform({visualPreview:true}))return;
    if(this.control.mode==='rotate'){
      this.control.rotationAngle=0;
      this.builder.setSelectionRotationReadout(['X','Y','Z'].includes(this.control.axis) ? this.control.axis : 'free',0);
    }
    this.pointerId=e.pointerId;
    this.orbitEnabled=this.scene.controls.enabled;this.scene.controls.enabled=false;
    this.canvas.setPointerCapture(e.pointerId);
    this.snapping(e);this.control.pointerDown(this.pointer(e));
  }

  snapping(e) {
    const snap=this.builder.transformSnap || e.shiftKey;
    this.control.setTranslationSnap(snap ? 5 : null);
    this.control.setRotationSnap(snap ? Math.PI/12 : null);
  }

  move(e) {
    if(this.pointerId!==null){
      if(e.pointerId!==this.pointerId)return;
      e.preventDefault();e.stopImmediatePropagation();this.snapping(e);this.control.pointerMove(this.pointer(e));
    }else if(this.control.enabled){
      this.control.pointerHover(this.pointer(e));
      if(this.control.axis){e.stopImmediatePropagation();this.scene.setHoverPart(null);this.scene.setCursor('grab');}
    }
  }

  preview() {
    if(!this.builder._selectionTransform || this.pointerId===null)return;
    this.pendingPreview=true;this.scene.requestRender();
  }

  flushPreview() {
    if(!this.pendingPreview)return;
    this.pendingPreview=false;
    const session=this.builder._selectionTransform;
    if(!session || this.pointerId===null)return;
    const q=this.proxy.quaternion,axis=new Vector3(q.x,q.y,q.z),length=axis.length();
    const angle=length>1e-9 ? 2*Math.atan2(length,q.w) : 0;
    if(this.control.mode==='rotate'){
      const named=['X','Y','Z'].includes(this.control.axis);
      // 使用Three的实际吸附后角度；正对轴端时按世界轴正方向统一符号。
      const sign=named && this.control.rotationAxis.getComponent('XYZ'.indexOf(this.control.axis))<0 ? -1 : 1;
      this.builder.setSelectionRotationReadout(named ? this.control.axis : 'free',sign*this.control.rotationAngle*180/Math.PI,false);
    }
    this.builder.previewSelectionTransform({translation:this.proxy.position.toArray().map((v,i)=>v-session.bounds.center[i]),axis:length>1e-9 ? axis.divideScalar(length).toArray() : [0,1,0],angle});
    if(this.control.mode==='translate' && session.visualPreview){
      const translation=session.visualPreview.value.translation;
      this.proxy.position.fromArray(session.bounds.center.map((v,i)=>v+translation[i]));
      this.proxy.updateMatrixWorld(true);
    }
  }

  up(e) {
    if(e.pointerId!==this.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();
    this.flushPreview();this.control.pointerUp({button:0});this.release();this.builder.finishSelectionTransform();
  }

  release() {
    this.pendingPreview=false;
    const id=this.pointerId;this.pointerId=null;
    if(id!==null && this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);
    if(this.orbitEnabled!==null){this.scene.controls.enabled=this.orbitEnabled;this.orbitEnabled=null;}
    this.scene.setCursor('default');
  }

  cancel(e) {
    if(e && e.pointerId!==this.pointerId)return;
    if(this.pointerId===null)return;
    this.control.pointerUp({button:0});this.release();this.builder.cancelSelectionTransform();
  }

  dispose() {
    this.cancel();
    for(const [type,handler] of Object.entries(this.handlers))this.canvas.removeEventListener(type,handler,true);
    this.control.dispose();this.helper.removeFromParent();this.proxy.removeFromParent();
  }
}
