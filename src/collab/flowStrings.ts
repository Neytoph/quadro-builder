import { useI18n } from '../i18n'

const strings = {
  snapshot: ['固定版本 · 只读', 'Fixed version · read only', 'Feste Version · schreibgeschützt'],
  snapshotHint: ['这是保存时的模型。打开共享方案可继续设计和交流。', 'This is the model as saved. Open the shared plan to continue designing and discussing.', 'Dies ist das gespeicherte Modell. Im gemeinsamen Plan könnt ihr weiter gestalten und euch austauschen.'],
  openShared: ['打开共享方案', 'Open shared plan', 'Gemeinsamen Plan öffnen'],
  deliveryTitle: ['生成交付页', 'Create delivery page', 'Übergabeseite erstellen'],
  deliveryOptional: ['交付页（可选）', 'Delivery page (optional)', 'Übergabeseite (optional)'],
  deliveryIntro: ['预览时自动保存当前模型，并整理成含三维、配件清单和搭建手册的页面。生成后仍可继续共享协作。', 'Preview saves the current model and prepares a page with 3D, a parts list and assembly instructions. You can keep collaborating afterwards.', 'Die Vorschau speichert das aktuelle Modell für eine Seite mit 3D, Teileliste und Bauanleitung. Danach könnt ihr weiter zusammenarbeiten.'],
  deliveryHint: ['把当前模型整理成可打开的独立页面。', 'Prepare a separate page for the current model.', 'Eine eigene Seite für das aktuelle Modell erstellen.'],
  snapshotName: ['交付快照', 'Delivery snapshot', 'Übergabe-Snapshot'],
  currentModel: ['当前共享模型', 'Current shared model', 'Aktuelles gemeinsames Modell'],
  frozenHint: ['此页使用预览时保存的模型，后续共享编辑不会改变它。', 'This page uses the model saved for this preview. Later shared edits will not change it.', 'Diese Seite verwendet das für die Vorschau gespeicherte Modell. Spätere Änderungen bleiben davon getrennt.'],
  refreshSnapshot: ['重新取当前模型', 'Use current model again', 'Aktuelles Modell neu übernehmen'],
  resetImagesHint: ['重新取模型时会清空已选图片，请为新快照重新选择。', 'Taking a new snapshot clears the selected images so you can choose them for the new model.', 'Bei einem neuen Snapshot wird die Bildauswahl geleert, damit sie zum neuen Modell passt.'],
  ageNote: ['适龄说明', 'Age guidance', 'Altershinweise'],
  loadNote: ['使用说明', 'Use guidance', 'Nutzungshinweise'],
  defaultHint: ['通用说明，可按实际情况修改。', 'General guidance — edit to suit this design.', 'Allgemeine Hinweise, passend zum Entwurf anpassbar.'],
  ageDefault: ['请结合孩子的身高和活动能力判断是否适合，使用时由成人陪同。', 'Consider the child’s height and physical abilities when deciding whether this design is suitable. An adult should supervise use.', 'Bitte anhand von Größe und Bewegungsfähigkeit des Kindes entscheiden, ob der Entwurf geeignet ist. Die Nutzung sollte von Erwachsenen begleitet werden.'],
  loadDefault: ['搭建和使用请遵循配件说明；使用前检查连接与稳定性，遵守配件规定的使用限制。', 'Follow the component instructions for assembly and use. Check connections and stability before use, and observe the component usage limits.', 'Beim Aufbau und bei der Nutzung die Hinweise der Bauteile beachten. Vor der Nutzung Verbindungen und Standfestigkeit prüfen und die vorgesehenen Nutzungsgrenzen einhalten.'],
  images: ['图片（可选，最多 6 张）', 'Images (optional, up to 6)', 'Bilder (optional, bis zu 6)'],
  imageHint: ['可上传图片或选择本方案已有图片，也可以直接生成无图页面。', 'Upload images or choose existing images from this plan. You can also create a page without images.', 'Bilder hochladen oder vorhandene Bilder dieses Plans auswählen. Eine Seite ohne Bilder ist ebenfalls möglich.'],
  upload: ['上传图片', 'Upload images', 'Bilder hochladen'],
  existing: ['选择本方案已有图片', 'Choose existing plan images', 'Vorhandene Planbilder wählen'],
  remove: ['移除', 'Remove', 'Entfernen'],
  limit: ['最多选择 6 张图片', 'Select up to 6 images', 'Bis zu 6 Bilder wählen'],
  preview: ['预览交付页', 'Preview delivery page', 'Übergabeseite ansehen'],
  preparing: ['正在保存快照…', 'Saving snapshot…', 'Snapshot wird gespeichert…'],
  creating: ['正在生成页面…', 'Creating page…', 'Seite wird erstellt…'],
  edit: ['返回编辑说明', 'Edit details', 'Angaben bearbeiten'],
  noImages: ['本页不附图片', 'No images on this page', 'Diese Seite enthält keine Bilder'],
  parts: ['配件摘要', 'Parts summary', 'Teileübersicht'],
  loading: ['正在加载…', 'Loading…', 'Wird geladen…'],
  retry: ['重试', 'Retry', 'Erneut versuchen'],
  done: ['交付页已生成', 'Delivery page created', 'Übergabeseite erstellt'],
  continue: ['继续共享协作', 'Continue collaborating', 'Weiter zusammenarbeiten'],
  doneHint: ['可复制链接分享此页，共享方案仍然可以编辑和评论。', 'Copy the link to share this page. The shared plan remains open for editing and comments.', 'Den Link kopieren, um diese Seite zu teilen. Der gemeinsame Plan bleibt für Änderungen und Kommentare offen.'],
} as const
export type FlowKey = keyof typeof strings
export function useFlowText() {
  const { lang } = useI18n()
  return (key: FlowKey) => strings[key][lang === 'zh' ? 0 : lang === 'de' ? 2 : 1]
}

export function snapshotURL(plan: string, version: number | string, lang: string) {
  return `${location.pathname}?${new URLSearchParams({ plan, version: String(version), lang })}`
}
