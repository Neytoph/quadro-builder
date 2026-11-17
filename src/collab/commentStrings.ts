import {useI18n} from '../i18n'
const messages = {
  actions: ['评论操作','Comment actions','Kommentaraktionen'],
  edit: ['修改评论','Edit comment','Kommentar bearbeiten'],
  move: ['调整位置','Move pin','Position ändern'],
  deletePin: ['删除位置评论','Delete pinned comment','Positionskommentar löschen'],
  deletePost: ['删除评论','Delete comment','Kommentar löschen'],
  deletePinBody: ['删除位置评论 #{n} 及其中的全部回复？','Delete pinned comment #{n} and all its replies?','Positionskommentar #{n} und alle Antworten löschen?'],
  deletePostBody: ['删除这条评论？','Delete this comment?','Diesen Kommentar löschen?'],
  deleted: ['评论已删除','Comment deleted','Kommentar gelöscht'],
  edited: ['已修改','Edited','Bearbeitet'],
  save: ['保存','Save','Speichern'],
  cancel: ['取消','Cancel','Abbrechen'],
  remove: ['删除','Delete','Löschen'],
  place: ['点击新的位置','Choose a new position','Neue Position wählen'],
  moveTitle: ['调整评论位置','Move comment pin','Kommentarposition ändern'],
} as const
export function useCommentText(){const {lang}=useI18n();const column={zh:0,en:1,de:2}[lang];return(key:keyof typeof messages,values:Record<string,string|number>={})=>Object.entries(values).reduce((text,[k,v])=>text.replaceAll('{'+k+'}',String(v)),messages[key][column] as string)}
