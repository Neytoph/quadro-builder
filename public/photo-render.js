const translations={
 zh:{title:'生成效果图',history:'效果图',take:'拍照',retake:'重新取景',prompt:'画面描述',generate:'生成 · 5 麦粒',close:'关闭',loading:'正在读取…',preparing:'正在拍照…',empty:'还没有效果图',queued:'排队中',running:'生成中',checking:'检查中',completed:'已完成',failed:'生成失败',cancelled:'已取消',refund:'已退回',pending:'退款处理中',cover:'设为封面',restore:'恢复模型预览',download:'下载',selected:'封面已更新',changed:'这张图片来自较早的模型版本，仍设为封面？',error:'操作失败，请重试',render_unavailable:'生成服务暂不可用',render_busy:'生成任务已满，请稍后再试',insufficient_grain:'麦粒不足',render_forbidden:'当前没有编辑权限',render_not_found:'造型或图片已不可用',account_changed:'账号已切换，请重新打开',source_changed:'模型已更新',resize:'调整取景框',description:'例如：温暖窗光下的真实摄影，保留现有场景',retry:'重试'},
 en:{title:'Generate render',history:'Renders',take:'Take photo',retake:'Retake',prompt:'Image description',generate:'Generate · 5 grains',close:'Close',loading:'Loading…',preparing:'Taking photo…',empty:'No renders yet',queued:'Queued',running:'Generating',checking:'Checking',completed:'Completed',failed:'Generation failed',cancelled:'Cancelled',refund:'Refunded',pending:'Refund pending',cover:'Set as cover',restore:'Restore model preview',download:'Download',selected:'Cover updated',changed:'This image uses an earlier model version. Set it as the cover?',error:'Could not complete the action. Please retry.',render_unavailable:'Generation is temporarily unavailable',render_busy:'Generation queue is full. Please try later.',insufficient_grain:'Not enough grains',render_forbidden:'Editing permission is required',render_not_found:'The model or image is unavailable',account_changed:'Account changed. Please reopen.',source_changed:'Model updated',resize:'Resize photo frame',description:'For example: realistic photography in warm window light, keeping the current scene',retry:'Retry'},
 de:{title:'Effektbild erstellen',history:'Effektbilder',take:'Foto aufnehmen',retake:'Neu aufnehmen',prompt:'Bildbeschreibung',generate:'Erstellen · 5 Körner',close:'Schließen',loading:'Wird geladen…',preparing:'Foto wird aufgenommen…',empty:'Noch keine Effektbilder',queued:'In Warteschlange',running:'Wird erstellt',checking:'Wird geprüft',completed:'Fertig',failed:'Erstellung fehlgeschlagen',cancelled:'Abgebrochen',refund:'Erstattet',pending:'Erstattung ausstehend',cover:'Als Titelbild verwenden',restore:'Modellvorschau wiederherstellen',download:'Herunterladen',selected:'Titelbild aktualisiert',changed:'Dieses Bild zeigt eine frühere Modellversion. Als Titelbild verwenden?',error:'Aktion fehlgeschlagen. Bitte erneut versuchen.',render_unavailable:'Erstellung vorübergehend nicht verfügbar',render_busy:'Warteschlange voll. Bitte später erneut versuchen.',insufficient_grain:'Nicht genug Körner',render_forbidden:'Bearbeitungsrechte erforderlich',render_not_found:'Modell oder Bild nicht verfügbar',account_changed:'Konto gewechselt. Bitte erneut öffnen.',source_changed:'Modell aktualisiert',resize:'Bildausschnitt anpassen',description:'Zum Beispiel: realistische Fotografie bei warmem Fensterlicht, mit der vorhandenen Umgebung',retry:'Erneut versuchen'}
};
const framing={zh:{move:'移动取景框',take:'生成渲染图',prompt:'画面描述（可选）',description:'留空使用默认效果，也可以描述你想要的光照和画风'},en:{move:'Move photo frame',take:'Generate render',prompt:'Image description (optional)',description:'Leave blank for the default look, or describe your lighting and style'},de:{move:'Bildausschnitt verschieben',take:'Rendering erstellen',prompt:'Bildbeschreibung (optional)',description:'Für den Standardlook leer lassen oder Licht und Stil beschreiben'}};
const retention={
 zh:{delete:'删除',deleteConfirm:'删除这张效果图？删除后无法恢复。',render_storage_changed:'图片列表已变化，请重新选择替换对象',render_cover_protected:'正在使用的封面不能删除或替换',render_replacement_busy:'这张图片正在等待新图替换',render_capture_expired:'基础图已过期，请重新取景',protected:'当前封面'},
 en:{delete:'Delete',deleteConfirm:'Delete this render? This cannot be undone.',render_storage_changed:'Images changed. Please choose replacements again.',render_cover_protected:'A current cover cannot be deleted or replaced.',render_replacement_busy:'This image is reserved for replacement.',render_capture_expired:'The base image expired. Please retake it.',protected:'Current cover'},
 de:{delete:'Löschen',deleteConfirm:'Dieses Effektbild unwiderruflich löschen?',render_storage_changed:'Bilder geändert. Bitte erneut zum Ersetzen wählen.',render_cover_protected:'Ein aktuelles Titelbild kann nicht gelöscht oder ersetzt werden.',render_replacement_busy:'Dieses Bild ist zum Ersetzen vorgemerkt.',render_capture_expired:'Das Ausgangsbild ist abgelaufen. Bitte neu aufnehmen.',protected:'Aktuelles Titelbild'}
};
const savedCover={zh:'保留的封面',en:'Saved cover',de:'Gespeichertes Titelbild'};
export const photoWords=lang=>({...translations[lang]||translations.zh,...framing[lang]||framing.zh,...retention[lang]||retention.zh});
export function photoStyles(){if(document.querySelector('[data-photo-styles]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href='/builder/photo-render.css?v=20261116.3';link.dataset.photoStyles='';document.head.append(link)}
export async function photoCall(path,owner,method='GET',body,signal){
 const response=await fetch('/quadro/rendering'+path,{method,credentials:'same-origin',cache:'no-store',signal,headers:{'Content-Type':'application/json','X-Builder-User-ID':String(owner)},body:body===undefined?undefined:JSON.stringify(body)});
 const value=await response.json();if(!response.ok){const error=new Error(value.code||'error');error.code=value.code;throw error}return value;
}
export function photoSize(ratio){ratio=Math.max(1/3,Math.min(3,ratio));return ratio>=1?{width:1536,height:Math.max(512,Math.round(1536/ratio/16)*16)}:{width:Math.max(512,Math.round(1536*ratio/16)*16),height:1536}}
export function photoFrame(rect,viewport){
 const size=photoSize(rect.width/rect.height),ratio=size.width/size.height;
 const width=Math.min(rect.width,rect.height*ratio,viewport.width),height=width/ratio;
 return {x:Math.max(0,Math.min(viewport.width-width,rect.x+(rect.width-width)/2)),y:Math.max(0,Math.min(viewport.height-height,rect.y+(rect.height-height)/2)),width,height,...sizeForOutput(size)};
}
const sizeForOutput=size=>({outputWidth:size.width,outputHeight:size.height});
export function presetFrame(viewport,ratio=4/3){const width=Math.min(viewport.width*.82,viewport.height*.68*ratio),height=width/ratio;return photoFrame({x:(viewport.width-width)/2,y:(viewport.height-height)/2,width,height},viewport)}
export function resizePhotoFrame(start,handle,dx,dy,viewport){
 if(handle==='move')return {...start,x:Math.max(0,Math.min(viewport.width-start.width,start.x+dx)),y:Math.max(0,Math.min(viewport.height-start.height,start.y+dy))};
 let left=start.x,top=start.y,right=left+start.width,bottom=top+start.height;
 if(handle.includes('w'))left=Math.max(0,Math.min(right-48,left+dx));if(handle.includes('e'))right=Math.min(viewport.width,Math.max(left+48,right+dx));
 if(handle.includes('n'))top=Math.max(0,Math.min(bottom-48,top+dy));if(handle.includes('s'))bottom=Math.min(viewport.height,Math.max(top+48,bottom+dy));
 return photoFrame({x:left,y:top,width:right-left,height:bottom-top},viewport);
}
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node};
export function photoCoverChanged(source){window.dispatchEvent(new CustomEvent('quadro-photo-cover',{detail:{source}}));if(parent!==window)parent.postMessage({type:'xmf-model-editor:cover-changed',source},location.origin)}
export async function openPhotoHistory({source,owner,lang='zh'}){
 photoStyles();const t=photoWords(lang),controller=new AbortController(),previous=document.activeElement;
 const dialog=element('dialog','photo-dialog'),header=element('header'),title=element('h2','',t.history),close=element('button','photo-close',t.close),body=element('div','photo-history'),notice=element('p','photo-error'),footer=element('footer'),restore=element('button','qb-btn qb-btn-ghost',t.restore);
 close.type='button';restore.type='button';header.append(title,close);footer.append(restore);dialog.append(header,body,notice,footer);document.body.append(dialog);dialog.showModal();let timer,loading=false;
 const finish=()=>{controller.abort();clearTimeout(timer);dialog.remove();if(previous instanceof HTMLElement)previous.focus()};close.onclick=()=>dialog.close();dialog.addEventListener('close',finish,{once:true});
 const identity=event=>{if(event.type==='quadro-account-invalidated'||!event.detail?.authenticated||String(event.detail.user_id)!==String(owner))dialog.close()};window.addEventListener('quadro-account-invalidated',identity,{signal:controller.signal});document.addEventListener('qh-identity',identity,{signal:controller.signal});
 window.addEventListener('xmf-editor:can-park',identity,{signal:controller.signal});
 const errorText=error=>t[error.code]||t.error;
 restore.onclick=async()=>{restore.disabled=true;try{await photoCall('/cover?source='+encodeURIComponent(source),owner,'DELETE');notice.textContent=t.selected;photoCoverChanged(source);void load()}catch(error){notice.textContent=errorText(error)}finally{restore.disabled=false}};
 async function load(){if(loading||controller.signal.aborted)return;loading=true;
  try{
   const {items}=await photoCall('/attempts?source='+encodeURIComponent(source),owner,'GET',undefined,controller.signal);
   if(controller.signal.aborted)return;body.replaceChildren();if(!items.length)body.append(element('p','photo-empty',t.empty));
   for(const item of items){const card=element('article','photo-record'),state=element('p','photo-state',t[item.state]||item.state),when=element('time','',new Date(item.created*1000).toLocaleString(lang==='zh'?'zh-CN':lang));card.append(state,when);
    if(item.state==='completed'){
     const file='/quadro/rendering/attempts/'+item.id+'/file?u='+encodeURIComponent(owner),link=element('a','photo-image-link'),image=element('img');link.href=file;link.target='_blank';link.rel='noopener';image.src=file+'&w=320';image.alt=t.completed;image.loading='lazy';link.append(image);card.prepend(link);
     const actions=element('div','photo-actions'),download=element('a','qb-btn qb-btn-ghost',t.download),cover=element('button','qb-btn',t.cover);download.href=file+'&download=1';download.download='render.png';cover.type='button';
     cover.disabled=!!item.reserved;
     cover.onclick=async()=>{cover.disabled=true;try{try{await photoCall('/attempts/'+item.id+'/cover',owner,'POST',{})}catch(error){if(error.code!=='source_changed')throw error;if(!window.confirm(t.changed))return;await photoCall('/attempts/'+item.id+'/cover',owner,'POST',{force:true})}notice.textContent=t.selected;photoCoverChanged(source);void load()}catch(error){notice.textContent=errorText(error)}finally{cover.disabled=!!item.reserved}};
     actions.append(download,cover);card.append(actions);
     if(item.protected)card.append(element('p','photo-state',item.currentCover?t.protected:savedCover[lang]||savedCover.zh));
     if(!item.currentCover){const remove=element('button','photo-delete',t.delete);remove.type='button';remove.disabled=!!item.reserved;remove.onclick=async()=>{if(!window.confirm(t.deleteConfirm))return;remove.disabled=true;try{await photoCall('/attempts/'+item.id,owner,'DELETE',undefined,controller.signal);void load()}catch(error){if(!controller.signal.aborted)notice.textContent=errorText(error)}finally{remove.disabled=!!item.reserved}};actions.append(remove)}
    }else if(item.refundStatus)card.append(element('p','photo-state',item.refundStatus==='refunded'?t.refund:t.pending));
    if(item.summary?.prompt)card.append(element('p','photo-state',item.summary.prompt));body.append(card);
   }
   if(items.some(item=>['queued','running','checking'].includes(item.state)))timer=setTimeout(load,3000);
  }catch(error){if(!controller.signal.aborted){notice.textContent=errorText(error);const retry=element('button','qb-btn',t.retry);retry.onclick=()=>void load();body.replaceChildren(retry)}}finally{loading=false}
 }
 body.textContent=t.loading;void load();return dialog;
}
