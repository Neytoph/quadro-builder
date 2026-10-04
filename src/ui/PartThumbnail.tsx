import { PartImg, partIcon } from './icons'
import './partPresentation.css'

export default function PartThumbnail({ id, kind, imageKey }: { id?: string; kind?: string; imageKey?: string }) {
  return <span className="qb-material-image"><PartImg id={id} imageKey={imageKey} svg={partIcon(id, kind)} size={44} /></span>
}
