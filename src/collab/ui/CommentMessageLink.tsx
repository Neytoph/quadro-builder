import { useEffect, useRef, useState } from 'react'
import { useCollab } from '../CollabContext'
import { useDock } from '../../ui/dock'

export default function CommentMessageLink() {
  const collab = useCollab()
  const { pane, setPane, setCommentsTab } = useDock()
  const request = useRef(new URLSearchParams(location.search))
  const [post, setPost] = useState(0)
  const consumed = useRef(false)

  useEffect(() => {
    const query = request.current
    if (consumed.current || query.get('comments') !== '1' || collab.plan?.id !== query.get('plan') || !collab.threads.length) return
    const wanted = Number(query.get('post'))
    const thread = collab.threads.find(th => th.posts.some(item => item.id === wanted))
      || collab.threads.find(th => th.id === Number(query.get('thread')))
      || collab.threads.find(th => th.posts.some(collab.isUnread))
      || collab.threads[0]
    consumed.current = true
    setCommentsTab(thread.kind === 'chat' ? 'chat' : 'pins')
    setPane('comments')
    if (thread.kind === 'pin') collab.focusThread(thread)
    setPost(thread.posts.find(item => item.id === wanted)?.id || thread.posts.find(collab.isUnread)?.id || thread.posts[0]?.id || 0)
    const url = new URL(location.href)
    for (const name of ['comments','thread','post']) url.searchParams.delete(name)
    history.replaceState(null, '', url)
  }, [collab, setCommentsTab, setPane])

  useEffect(() => {
    if (!post || pane !== 'comments') return
    let attempts = 0, timer = 0, target: HTMLElement | null = null
    const focus = () => {
      const node = document.querySelector<HTMLElement>(`[data-message-post="${post}"]`)
      if (!node) { if (++attempts < 30) timer = window.setTimeout(focus,100); return }
      target = node
      node.scrollIntoView({block:'center',behavior:'instant'})
      node.classList.add('cb-message-target')
      node.tabIndex = -1; node.focus({preventScroll:true})
      timer = window.setTimeout(() => node.classList.remove('cb-message-target'),2400)
    }
    timer = window.setTimeout(focus,0)
    return () => { clearTimeout(timer); target?.classList.remove('cb-message-target') }
  }, [post,pane])
  return null
}
