import type { ComponentChoice } from '../store/componentChoices'

export function componentMenuLabel(choice: ComponentChoice, lang: 'zh' | 'en' | 'de') {
  const shortNames: Record<string, string> = {
    'panel:panel_40x40': '40×40 面板', 'panel:hole_panel_40x40': '40×40 洞洞板', 'panel:panel_40x20': '40×20 面板',
    'connector:double_tube': '双管连接', 'slide:slide_integral': '整体滑梯', 'accessory:textile_rainbow': '彩虹带',
  }
  return lang === 'zh' ? shortNames[choice.key] || choice.label.replace(/\s*cm\b/gi, '') : choice.label
}

export const customComponentStrings = {
  zh: {
    title: '自定义组件', configure: '配置组件', saveSelection: '保存选中零件', cancel: '取消', cancelOnRelease: '松开 4 取消', holdHint: '松开 4 选择 · 滚轮换组', releaseHint: '松开 4 选择',
    empty: '点击中心配置，将已有组件加入快捷菜单', local: '配置保存在此浏览器，可在不同造型中使用。',
    name: '组件名称', placeholder: '例如：窗框、楼梯单元', save: '保存组件',
    selected: '将当前选中的零件保存为一个组件，保留颜色和组合。',
    selectFirst: '请先选中要保存的零件。', saved: '组件已保存', renamed: '组件已重命名',
    deleted: '组件已删除', rename: '重命名', delete: '删除',
    deleteConfirm: '删除这个组件？已放到造型中的零件会保留。',
    deleteCancel: '保留', confirmDelete: '删除组件', close: '关闭', back: '返回选择',
    previous: '上一组', next: '下一组', page: '组', error: '组件操作失败',
    placing: '组件跟随指针。↑↓ 升降，Q/E 旋转，点击放下，Esc 取消。',
    centreClick: '中心配置 · 右下取消', centreRelease: '松开 4，打开组件配置', cancelClick: '点击取消，收起菜单', cancelRelease: '松开 4，取消本次选择', useRelease: '松开 4，使用', unconfigured: '此位置还没有组件', outside: '移到圆环外，方向选择仍然有效', clickHint: '按住 4 选择，或直接点击组件', scrollHint: '滚轮换组',
    noSelection: '当前没有选中零件', count: '个组件', loading: '正在读取组件…', savedList: '已保存组件', noneSaved: '还没有自定义组件', incomplete: '请一并选择配件所连接的管子或接头，再保存组件。', retry: '重新读取',
  },
  en: {
    title: 'Custom components', configure: 'Configure', saveSelection: 'Save selected parts', cancel: 'Cancel', cancelOnRelease: 'Release 4 to cancel', holdHint: 'Release 4 to select · Scroll for groups', releaseHint: 'Release 4 to select',
    empty: 'Configure in the centre to add existing components', local: 'Menu settings are saved in this browser, across designs.',
    name: 'Component name', placeholder: 'e.g. Window frame, stair unit', save: 'Save component',
    selected: 'Save the selected parts together, including their colours and groups.',
    selectFirst: 'Select the parts to save first.', saved: 'Component saved', renamed: 'Component renamed',
    deleted: 'Component deleted', rename: 'Rename', delete: 'Delete',
    deleteConfirm: 'Delete this component? Parts already placed in designs will remain.',
    deleteCancel: 'Keep', confirmDelete: 'Delete component', close: 'Close', back: 'Back to selection',
    previous: 'Previous group', next: 'Next group', page: 'Group', error: 'Component operation failed',
    placing: 'Component follows the pointer. ↑↓ to lift, Q/E to rotate, click to place, Esc to cancel.',
    centreClick: 'Configure in the centre · Cancel lower right', centreRelease: 'Release 4 to configure', cancelClick: 'Click to close the menu', cancelRelease: 'Release 4 to cancel', useRelease: 'Release 4 to use', unconfigured: 'No component in this position', outside: 'Directions also work outside the ring', clickHint: 'Hold 4 to select, or click a component', scrollHint: 'Scroll for groups',
    noSelection: 'No parts selected', count: 'components', loading: 'Loading components…', savedList: 'Saved components', noneSaved: 'No custom components yet', incomplete: 'Also select the tubes or joints supporting these accessories before saving.', retry: 'Reload',
  },
  de: {
    title: 'Eigene Komponenten', configure: 'Verwalten', saveSelection: 'Auswahl speichern', cancel: 'Abbrechen', cancelOnRelease: '4 loslassen zum Abbrechen', holdHint: '4 loslassen · Scrollen für Gruppen', releaseHint: '4 loslassen zum Auswählen',
    empty: 'In der Mitte vorhandene Komponenten zum Menü hinzufügen', local: 'Menüeinstellungen in diesem Browser, für alle Entwürfe gespeichert.',
    name: 'Name der Komponente', placeholder: 'z. B. Fensterrahmen, Treppenelement', save: 'Komponente speichern',
    selected: 'Ausgewählte Teile mit ihren Farben und Gruppen zusammen speichern.',
    selectFirst: 'Zuerst die zu speichernden Teile auswählen.', saved: 'Komponente gespeichert', renamed: 'Komponente umbenannt',
    deleted: 'Komponente gelöscht', rename: 'Umbenennen', delete: 'Löschen',
    deleteConfirm: 'Diese Komponente löschen? Bereits platzierte Teile bleiben im Entwurf.',
    deleteCancel: 'Behalten', confirmDelete: 'Komponente löschen', close: 'Schließen', back: 'Zurück zur Auswahl',
    previous: 'Vorige Gruppe', next: 'Nächste Gruppe', page: 'Gruppe', error: 'Komponentenaktion fehlgeschlagen',
    placing: 'Komponente folgt dem Zeiger. ↑↓ heben, Q/E drehen, klicken zum Platzieren, Esc bricht ab.',
    centreClick: 'Mitte konfigurieren · Rechts unten abbrechen', centreRelease: '4 loslassen zum Konfigurieren', cancelClick: 'Klicken zum Schließen', cancelRelease: '4 loslassen zum Abbrechen', useRelease: '4 loslassen für', unconfigured: 'Hier ist keine Komponente', outside: 'Richtungsauswahl auch außerhalb des Rings', clickHint: '4 halten oder Komponente anklicken', scrollHint: 'Scrollen für Gruppen',
    noSelection: 'Keine Teile ausgewählt', count: 'Komponenten', loading: 'Komponenten werden geladen…', savedList: 'Gespeicherte Komponenten', noneSaved: 'Noch keine eigenen Komponenten', incomplete: 'Auch die tragenden Rohre oder Kupplungen auswählen, dann speichern.', retry: 'Neu laden',
  },
}
