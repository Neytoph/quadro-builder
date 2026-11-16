import {photoCall,photoStyles} from './photo-render.js';
const words={
 zh:{title:'选择替换的图片',description:'新图生成成功后，才会删除选中的旧图。',usage:'此模型 {model}/{modelLimit} · 账号 {account}/{accountLimit}',confirm:'确认替换',cancel:'取消',unavailable:'模型已不可用',download:'下载'},
 en:{title:'Choose images to replace',description:'Selected images are deleted only after the new render succeeds.',usage:'This model {model}/{modelLimit} · Account {account}/{accountLimit}',confirm:'Confirm replacement',cancel:'Cancel',unavailable:'Model unavailable',download:'Download'},
 de:{title:'Bilder zum Ersetzen wählen',description:'Die gewählten Bilder werden erst nach erfolgreicher Erstellung gelöscht.',usage:'Dieses Modell {model}/{modelLimit} · Konto {account}/{accountLimit}',confirm:'Ersetzen bestätigen',cancel:'Abbrechen',unavailable:'Modell nicht verfügbar',download:'Herunterladen'}
};
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node};
export async function photoReplacements({source,owner,lang='zh',signal}){
 const quota=await photoCall('/retention?source='+encodeURIComponent(source),owner,'GET',undefined,signal);
 if(signal?.aborted)return null;
 if(!quota.modelRequired&&!quota.accountRequired)return [];
 photoStyles();const t=words[lang]||words.zh,previous=document.activeElement,controller=new AbortController();
 const dialog=el('dialog','photo-dialog'),header=el('header'),body=el('div','photo-replacement-content'),footer=el('footer'),cancel=el('button','photo-close',t.cancel),confirm=el('button','qb-btn',t.confirm),grid=el('div','photo-history');
 cancel.type='button';confirm.type='button';confirm.disabled=true;const heading=el('h2','',t.title);heading.id='photo-replacement-'+crypto.randomUUID();dialog.setAttribute('aria-labelledby',heading.id);header.append(heading,cancel);
 body.append(el('p','photo-replacement-description',t.description),el('p','photo-state',t.usage.replace('{model}',quota.modelCount).replace('{account}',quota.accountCount).replace('{modelLimit}',quota.modelLimit).replace('{accountLimit}',quota.accountLimit)),grid);footer.append(confirm);dialog.append(header,body,footer);let chosen=null;
 const checks=[];
 for(const item of quota.items){
  if(!quota.accountRequired&&item.source!==quota.source)continue;
  const card=el('label','photo-record photo-replacement'),check=el('input');check.type='checkbox';check.value=item.id;check.dataset.source=item.source;checks.push(check);
  if(item.readable){const image=el('img');image.src='/quadro/rendering/attempts/'+item.id+'/file?u='+encodeURIComponent(owner)+'&w=320';image.alt=item.name||t.title;image.loading='lazy';card.append(image)}
  card.append(check,el('span','photo-state',item.name||t.unavailable),el('time','',new Date(item.created*1000).toLocaleString(lang==='zh'?'zh-CN':lang)));
  if(item.readable){const download=el('a','photo-replacement-download',t.download);download.href='/quadro/rendering/attempts/'+item.id+'/file?u='+encodeURIComponent(owner)+'&download=1';download.download='render.png';card.append(download)}
  check.onchange=()=>{const selected=checks.filter(node=>node.checked);confirm.disabled=selected.length<quota.accountRequired||selected.filter(node=>node.dataset.source===quota.source).length<quota.modelRequired};grid.append(card);
 }
 cancel.onclick=()=>dialog.close();confirm.onclick=()=>{chosen=checks.filter(node=>node.checked).map(node=>node.value);dialog.close()};
 const invalid=event=>{if(event.type==='abort'||event.type==='quadro-account-invalidated'||!event.detail?.authenticated||String(event.detail.user_id)!==String(owner))dialog.close()};
 window.addEventListener('quadro-account-invalidated',invalid,{signal:controller.signal});document.addEventListener('qh-identity',invalid,{signal:controller.signal});signal?.addEventListener('abort',invalid,{signal:controller.signal});
 document.body.append(dialog);dialog.showModal();
 return new Promise(resolve=>dialog.addEventListener('close',()=>{controller.abort();dialog.remove();if(previous instanceof HTMLElement)previous.focus();resolve(chosen)},{once:true}));
}
