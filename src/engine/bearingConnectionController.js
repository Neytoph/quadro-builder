import { getLang } from './i18n.js';

const copy={
 zh:{selected:'已选横管端头：移到固定竖管上，预览轴承后点击连接。',success:'轴承已连接现有管端。',distance:n=>`端头距轴承插口还差 ${n.toFixed(1)} cm，请调整管长或位置。`,axis:'上下活动连接未对齐同一根轴，不能安装。',perpendicular:'横管需要与承载管垂直。',tube_end:'轴承需要留出与竖管两端接头的安装空间。',occupied:'这里已有轴承，不能重复安装。',fixed:'不能把门扇连接回它自己的管件。',support:'请选择固定框架上的直管。',endpoint:'请选择只有一根直管相连的空闲端头。',touch:'轴承预览已显示，再点同一位置确认。'},
 en:{selected:'End selected: point at the fixed tube, preview the bearing, then click to connect.',success:'Bearing connected to the existing tube end.',distance:n=>`The end is ${n.toFixed(1)} cm from the bearing socket. Adjust the tube length or position.`,axis:'The moving joints must share the same rotation axis.',perpendicular:'The end tube must be perpendicular to the support tube.',tube_end:'Leave clearance from the connectors at both ends of the support.',occupied:'A bearing already occupies this position.',fixed:'The moving frame cannot attach to its own tube.',support:'Choose a straight tube on the fixed frame.',endpoint:'Choose a free end connected to one straight tube.',touch:'Preview shown. Tap the same position again to confirm.'},
 de:{selected:'Rohrende gewählt: festes Rohr anzeigen, Lager prüfen und zum Verbinden klicken.',success:'Lager mit vorhandenem Rohrende verbunden.',distance:n=>`Das Rohrende ist ${n.toFixed(1)} cm vom Lageranschluss entfernt. Rohrlänge oder Position anpassen.`,axis:'Die beweglichen Verbindungen müssen dieselbe Drehachse haben.',perpendicular:'Das Anschlussrohr muss senkrecht zum Trägerrohr stehen.',tube_end:'Abstand zu den Kupplungen an beiden Rohrenden lassen.',occupied:'An dieser Stelle sitzt bereits ein Lager.',fixed:'Der bewegliche Rahmen kann nicht am eigenen Rohr befestigt werden.',support:'Ein gerades Rohr am festen Rahmen wählen.',endpoint:'Ein freies Ende mit genau einem geraden Rohr wählen.',touch:'Vorschau sichtbar. Zum Bestätigen dieselbe Stelle erneut antippen.'}
};
const ready={zh:'轴承插口已对齐，点击连接；Esc 取消。',en:'Bearing socket aligned. Click to connect; Esc to cancel.',de:'Lageranschluss ausgerichtet. Zum Verbinden klicken; Esc zum Abbrechen.'};
export class BearingConnectionController {
 constructor(builder){this.builder=builder;this.selected=null;this.preview=null;this.previewKey=null;this.pendingTap=null;}
 text(reason,gap=0){const value=reason==='ready'?(ready[getLang()]||ready.en):(copy[getLang()]||copy.en)[reason];return typeof value==='function'?value(gap):value;}
 status(){const p=this.preview;return p ? this.text(p.valid?(this.builder.inputType==='touch'?'touch':'ready'):p.reason,p.gapCm) : null;}
 cancel(){this.selected=null;this.preview=null;this.previewKey=null;this.pendingTap=null;this.builder.scene.clearInstallationPreview?.();}
 validate(){if(this.selected&&!this.builder.model.bearingEndpoints().some(e=>e.nodeId===this.selected))this.cancel();}
 buildHandles(){
  const {model,scene}=this.builder;
  if(!this.selected){for(const end of model.bearingEndpoints())scene.addHandle(end.pos,{bearingEnd:end.nodeId,placeNode:true},'place');return;}
  const end=model.bearingEndpoints().find(e=>e.nodeId===this.selected);if(!end){this.cancel();return;}
  scene.addHandle(end.pos,{bearingEnd:end.nodeId,placeNode:true},'place');
  for(const tube of model.tubes.values()){
   if(tube.arm||tube.link||tube.bow)continue;
   const a=model.nodes.get(tube.a),b=model.nodes.get(tube.b),p=[(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2];
   if(tube.id===end.tubeId)continue;
   const direction=[b.x-a.x,b.y-a.y,b.z-a.z],length=Math.hypot(...direction);
   if(length<1e-8||Math.abs(direction.reduce((s,v,i)=>s+v*end.dir[i],0)/length)>.01)continue;
   scene.addHandle(p,{bearingSupport:tube.id},'dir');
  }
 }
 probe(e){
  const pick=this.builder.scene.pickTube(e.clientX,e.clientY);
  if(!pick?.point)return {pick:null,mount:null};
  return {pick,mount:this.builder.model.bearingConnectionProbe(this.selected,pick.data.id,[pick.point.x,pick.point.y,pick.point.z])};
 }
 show(mount){
  const previous=this.status();
  const key=mount?.center?JSON.stringify([mount.tubeId,mount.center.map(v=>Math.round(v*10)),mount.valid]):null;
  if(key!==this.previewKey){this.previewKey=key;this.builder.scene.showBearingConnectionPreview?.(mount);}
  this.preview=mount;
  if(previous!==this.status())this.builder.onPreview();
 }
 hover(e){const {pick,mount}=this.probe(e);this.show(mount);return pick?.object||null;}
 click(e){
  const b=this.builder;if(b.readOnly||b.busy())return true;
  const handle=b.scene.pickHandle(e.clientX,e.clientY);
  const pick=b.scene.pickForDelete(e.clientX,e.clientY);
  const endpoint=handle?.data.bearingEnd||(pick?.data.kind==='node'&&b.model.bearingEndpoints().some(n=>n.nodeId===pick.data.id)?pick.data.id:null);
  if(!this.selected){if(!endpoint)return false;this.selected=endpoint;b.selectedNodeId=null;b.onNotice(this.text('selected'));b.refresh();return true;}
  if(endpoint===this.selected){this.cancel();b.refresh();return true;}
  const {mount}=this.probe(e);if(!mount){b.onNotice(this.text('support'),'info');return true;}
  this.show(mount);
  if(!mount.valid){this.pendingTap=null;b.onNotice(this.text(mount.reason,mount.gapCm),'warn');return true;}
  // 触屏的确认依据上一次点按，悬停或落指前的移动预览不算第一次点按。
  const previous=this.pendingTap;
  if(b.inputType==='touch'&&(!previous||previous.tubeId!==mount.tubeId||Math.hypot(...previous.center.map((v,i)=>v-mount.center[i]))>.1)){this.pendingTap=mount;b.onNotice(this.text('touch'));return true;}
  let result;b.recordHistory(()=>{result=b.model.connectExistingBearing(this.selected,mount.tubeId,mount.center);});
  if(!result?.valid){b.onNotice(this.text(result?.reason||'endpoint',result?.gapCm),'warn');return true;}
  this.cancel();b.refresh();b.onNotice(this.text('success'));return true;
 }
}
