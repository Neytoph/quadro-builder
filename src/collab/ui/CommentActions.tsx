import {useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {MoreHorizontal,MapPin,Pencil,Trash2} from 'lucide-react'
import {useCollab} from '../CollabContext'
import type {Post,Thread} from '../api'
import {useCommentText} from '../commentStrings'
import {Modal} from './Modals'

export function CommentActions({thread,post,first=false}:{thread:Thread;post:Post;first?:boolean}){
 const collab=useCollab(),text=useCommentText(),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null)
 const [open,setOpen]=useState(false),[target,setTarget]=useState<{thread:Thread;post:Post;remove:boolean}|null>(null),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const mine=post.userId===collab.plan?.me?.userId,manage=collab.role==='owner'||collab.role==='editor'
 const enabled=collab.canComment&&!post.deleted&&!!post.revision&&!!thread.revision
 const canEdit=enabled&&mine,canDelete=enabled&&(mine||manage),canMove=enabled&&first&&thread.kind==='pin'&&(mine||manage)
 useEffect(()=>{
  if(!open)return
  const close=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setOpen(false)}
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus()}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const items=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button')||[]),i=items.indexOf(document.activeElement as HTMLButtonElement);items[(i+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}}
  menu.current?.querySelector('button')?.focus();document.addEventListener('pointerdown',close);document.addEventListener('keydown',key,true)
  return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key,true)}
 },[open])
 if(!canEdit&&!canDelete&&!canMove)return null
 const rect=trigger.current?.getBoundingClientRect(),left=Math.max(8,Math.min(window.innerWidth-216,(rect?.right||216)-208)),top=Math.min(window.innerHeight-160,(rect?.bottom||0)+4)
 const choose=(remove:boolean)=>{setOpen(false);setTarget({thread,post,remove});setBody(post.body);setError('')}
 const close=()=>{if(!busy)setTarget(null)}
 const submit=async()=>{if(!target||busy)return;setBusy(true);setError('');try{
  if(target.remove){if(first&&thread.kind==='pin')await collab.deletePin(target.thread);else await collab.deletePost(target.thread,target.post)}
  else await collab.editPost(target.thread,target.post,body.trim())
  setTarget(null)
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 const pinDelete=first&&thread.kind==='pin'
 let title=text('edit');if(target?.remove)title=text(pinDelete?'deletePin':'deletePost')
 return <>
  <button ref={trigger} type="button" className="cb-comment-more" data-ui="comment-actions" aria-label={text('actions')} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><MoreHorizontal size={18}/></button>
  {open&&createPortal(<div ref={menu} className="cb-comment-menu qb-card" role="menu" style={{left,top}}>
   {canEdit&&<button type="button" role="menuitem" onClick={()=>choose(false)}><Pencil size={16}/>{text('edit')}</button>}
   {canMove&&<button type="button" role="menuitem" onClick={()=>{setOpen(false);collab.startMovePin(thread)}}><MapPin size={16}/>{text('move')}</button>}
   {canDelete&&<button type="button" role="menuitem" className="danger" onClick={()=>choose(true)}><Trash2 size={16}/>{text(pinDelete?'deletePin':'deletePost')}</button>}
  </div>,document.body)}
  {target&&<Modal label={title} onClose={close} className="cb-comment-dialog"><h3>{title}</h3>
   {target.remove?<p>{text(pinDelete?'deletePinBody':'deletePostBody',{n:collab.pinNumber(thread)})}</p>:<textarea autoFocus aria-label={text('edit')} value={body} maxLength={2000} disabled={busy} onChange={e=>setBody(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void submit()}}}/>}
   {error&&<p role="alert" className="cb-comment-error">{error}</p>}
   <div className="foot"><button type="button" className="qb-btn qb-btn-ghost" autoFocus={target.remove} disabled={busy} onClick={close}>{text('cancel')}</button><button type="button" className="qb-btn" data-button={target.remove?'danger':undefined} disabled={busy||!target.remove&&!body.trim()&&!target.post.photos.length} aria-busy={busy} onClick={()=>void submit()}>{text(target.remove?'remove':'save')}</button></div>
  </Modal>}
 </>
}
