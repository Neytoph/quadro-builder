import type { ComponentChoice } from '../store/componentChoices'
import { PartImg } from './icons'
import CustomComponentPreview from './CustomComponentPreview'

export default function ComponentChoicePreview({ choice }: { choice: ComponentChoice }) {
  if (choice.fragment) return <CustomComponentPreview fragment={choice.fragment} />
  if (choice.image) return <img src={choice.image} alt="" className="qb-component-preview" draggable={false} />
  return <PartImg id={choice.partId || ''} svg={choice.icon} size={40} />
}
