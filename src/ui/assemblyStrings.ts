import type { Lang } from '../i18n'

const zh = {
  title: '安装说明书预览', subtitle: '先拼好各个区域，再连接成完整造型。画面与 PDF 使用同一份模型快照。',
  close: '关闭', regions: '拼装区域', steps: '拼装步骤', diagnostics: '需要检查', ready: '计划可以导出', blocked: '请先处理下列问题，再导出说明书。',
  auto: '自动划分', save: '保存区域设置', saved: '区域设置已保存，可撤销。', stale: '源模型已更新。当前仍预览打开时的快照；重新打开可读取最新模型。',
  split: '拆分所选零件', merge: '与下一区域合并', up: '上移', down: '下移', parts: '零件', edit: '选择零件', name: '区域名称', newRegion: '新区域',
  previous: '上一步', next: '下一步', all: '完整造型', action: '装配动作', rotate: '拖动画面可旋转，滚轮或双指可缩放。',
  export: '导出 PDF', exporting: '正在制作 PDF', order: '自动划分方向', locate: '定位问题', repair: '预览修正建议', apply: '应用到源模型', discard: '取消修正预览',
  repairTitle: '修正建议预览', repairHint: '检查变更清单和修正后的步骤，再决定是否应用。修正可通过撤销恢复。', readonly: '只读模型：区域调整和修正仅用于此次 PDF。',
  change: '变更', before: '修正前', after: '修正后', dependencies: '需先完成', attach: '连接区域', preassemble: '预拼区域', build: '安装零件',
  noRepair: '此问题暂时没有可自动应用的修正，请回到模型检查这些零件。', failedApply: '源模型或权限已变化，请重新打开预览。', remove: '移除冲突零件', connectors: '接头', tubes: '管', panels: '面板', textiles: '布件', slides: '滑梯', fittings: '配件', screws: '螺丝', reinforcements: '加固件',
  duplicatePort: '同一接头插口连接了多个零件。弯管与短立柱可能占用同一方向，请检查标记处。', invalidConfig: '区域配置已失效，请重新自动划分或调整零件归属。',
  repairPhysical: '已核对模型连通和配件引用；修正后的实际搭建与承载尚未现场核验。',
}
type Strings = typeof zh
const en: Strings = {
  repairPhysical: 'Model connectivity and accessory references were checked. Physical assembly and load capacity of the repair have not been verified on site.',
  title: 'Assembly manual preview', subtitle: 'Build each region, then connect the whole design. The preview and PDF use the same model snapshot.', close: 'Close', regions: 'Assembly regions', steps: 'Assembly steps', diagnostics: 'Check these items', ready: 'Ready to export', blocked: 'Resolve the issues below before exporting.', auto: 'Auto group', save: 'Save regions', saved: 'Region settings saved. You can undo this change.', stale: 'The source model has changed. This preview keeps its original snapshot; reopen to use the latest model.', split: 'Split selected parts', merge: 'Merge with next region', up: 'Move up', down: 'Move down', parts: 'Parts', edit: 'Select parts', name: 'Region name', newRegion: 'New region', previous: 'Previous', next: 'Next', all: 'Whole design', action: 'Assembly action', rotate: 'Drag to rotate; scroll or pinch to zoom.', export: 'Export PDF', exporting: 'Creating PDF', order: 'Grouping direction', locate: 'Locate issue', repair: 'Preview repair', apply: 'Apply to source model', discard: 'Discard repair preview', repairTitle: 'Repair preview', repairHint: 'Review the changes and repaired steps before applying. Changes can be undone.', readonly: 'Read-only model: region changes and repairs apply to this PDF only.', change: 'Change', before: 'Before', after: 'After', dependencies: 'Complete first', attach: 'Connect regions', preassemble: 'Preassemble region', build: 'Install parts', noRepair: 'No automatic repair is available. Check these parts in the model.', failedApply: 'The source model or permissions changed. Reopen the preview.', remove: 'Remove conflicting part', connectors: 'Connectors', tubes: 'Tubes', panels: 'Panels', textiles: 'Textiles', slides: 'Slides', fittings: 'Fittings', screws: 'Screws', reinforcements: 'Reinforcements', duplicatePort: 'Multiple parts occupy the same connector port. Check the marked curved tube and short riser.', invalidConfig: 'The region configuration is outdated. Regroup automatically or update part assignments.',
}
const de: Strings = {
  repairPhysical: 'Modellverbindungen und Zubehörverweise wurden geprüft. Der praktische Aufbau und die Belastbarkeit der Korrektur wurden noch nicht vor Ort geprüft.',
  title: 'Vorschau der Bauanleitung', subtitle: 'Zuerst die Bereiche bauen, dann das gesamte Modell verbinden. Vorschau und PDF verwenden denselben Modellstand.', close: 'Schließen', regions: 'Baubereiche', steps: 'Bauschritte', diagnostics: 'Bitte prüfen', ready: 'Bereit zum Export', blocked: 'Vor dem Export die folgenden Probleme beheben.', auto: 'Automatisch aufteilen', save: 'Bereiche speichern', saved: 'Bereiche gespeichert. Die Änderung lässt sich rückgängig machen.', stale: 'Das Ausgangsmodell wurde geändert. Die Vorschau behält ihren Modellstand; zum Aktualisieren erneut öffnen.', split: 'Gewählte Teile abtrennen', merge: 'Mit nächstem Bereich verbinden', up: 'Nach oben', down: 'Nach unten', parts: 'Teile', edit: 'Teile wählen', name: 'Bereichsname', newRegion: 'Neuer Bereich', previous: 'Zurück', next: 'Weiter', all: 'Gesamtes Modell', action: 'Montagebewegung', rotate: 'Ziehen zum Drehen; mit Rad oder zwei Fingern zoomen.', export: 'PDF exportieren', exporting: 'PDF wird erstellt', order: 'Aufbaurichtung', locate: 'Problem anzeigen', repair: 'Korrektur ansehen', apply: 'Im Ausgangsmodell anwenden', discard: 'Korrektur verwerfen', repairTitle: 'Korrekturvorschau', repairHint: 'Änderungen und Bauschritte vor dem Anwenden prüfen. Änderungen lassen sich rückgängig machen.', readonly: 'Schreibgeschütztes Modell: Änderungen gelten nur für dieses PDF.', change: 'Änderung', before: 'Vorher', after: 'Nachher', dependencies: 'Zuerst fertigstellen', attach: 'Bereiche verbinden', preassemble: 'Bereich vormontieren', build: 'Teile montieren', noRepair: 'Keine automatische Korrektur verfügbar. Diese Teile im Modell prüfen.', failedApply: 'Modell oder Berechtigungen wurden geändert. Vorschau erneut öffnen.', remove: 'Kollidierendes Teil entfernen', connectors: 'Kupplungen', tubes: 'Rohre', panels: 'Platten', textiles: 'Textilien', slides: 'Rutschen', fittings: 'Zubehör', screws: 'Schrauben', reinforcements: 'Verstärkungen', duplicatePort: 'Mehrere Teile belegen denselben Kupplungsanschluss. Markiertes Bogenrohr und kurze Stütze prüfen.', invalidConfig: 'Bereichseinstellungen sind veraltet. Automatisch aufteilen oder Teilezuordnung ändern.',
}
export const assemblyStrings: Record<Lang, Strings> = { zh, en, de }

export const assemblyPdfStrings: Record<Lang, Record<string, string>> = {
  zh: { actionView: '装配动作', completeView: '装好后', regionOverview: '拼装区域总览', regionShape: '区域形状', regionLocation: '在完整造型中的位置', regionOrder: '拼装顺序', finalTitle: '完整造型', detailTitle: '连接细节', instructionsTitle: '安装说明' },
  en: { actionView: 'Assembly action', completeView: 'Completed step', regionOverview: 'Assembly regions', regionShape: 'Region shape', regionLocation: 'Location in the whole design', regionOrder: 'Assembly order', finalTitle: 'Complete design', detailTitle: 'Connection details', instructionsTitle: 'Assembly instructions' },
  de: { actionView: 'Montagebewegung', completeView: 'Fertiger Schritt', regionOverview: 'Baubereiche im Überblick', regionShape: 'Form des Bereichs', regionLocation: 'Position im gesamten Modell', regionOrder: 'Baureihenfolge', finalTitle: 'Fertiges Modell', detailTitle: 'Verbindungsdetails', instructionsTitle: 'Bauanleitung' },
}

assemblyPdfStrings.zh.contextHint = '操作图暂时隐藏周围零件；完整形态见区域页和成品页。'
assemblyPdfStrings.zh.beforeView = '装配前'
assemblyPdfStrings.en.beforeView = 'Before assembly'
assemblyPdfStrings.de.beforeView = 'Vor der Montage'
assemblyPdfStrings.zh.preassemblyBefore = '预拼零件'
assemblyPdfStrings.zh.preassemblyComplete = '预拼完成'
assemblyPdfStrings.en.preassemblyBefore = 'Parts for preassembly'
assemblyPdfStrings.en.preassemblyComplete = 'Preassembled frame'
assemblyPdfStrings.de.preassemblyBefore = 'Teile zur Vormontage'
assemblyPdfStrings.de.preassemblyComplete = 'Vormontierter Rahmen'
assemblyPdfStrings.zh.preassemblyHint = '零件分开展示；先拼成右图框架，再进行下一步安装。'
assemblyPdfStrings.en.preassemblyHint = 'Parts are shown separately. Build the frame on the right, then install it in the next step.'
assemblyPdfStrings.de.preassemblyHint = 'Teile sind getrennt dargestellt. Zuerst den rechten Rahmen bauen, dann im nächsten Schritt einsetzen.'
assemblyPdfStrings.en.contextHint = 'Surrounding parts are temporarily hidden for clarity. Region and final pages show the complete shape.'
assemblyPdfStrings.de.contextHint = 'Umliegende Teile sind für freie Sicht ausgeblendet. Bereichs- und Abschlussseiten zeigen die vollständige Form.'
assemblyPdfStrings.zh.roofCoverHint = '底部视角：I 为顶棚参考定位；实际扣位按支撑杆核对。'
assemblyPdfStrings.en.roofCoverHint = 'Underside view: I marks a canopy reference. Match the actual clips to the support rails.'
assemblyPdfStrings.de.roofCoverHint = 'Ansicht von unten: I ist eine Dachreferenz. Tatsächliche Clips an den Tragrohren prüfen.'

const diagnosticCopy: Record<string, [string, string, string]> = {
  DUPLICATE_CONNECTOR_PORT: [zh.duplicatePort, en.duplicatePort, de.duplicatePort],
  INVALID_ASSEMBLY_CONFIG: [zh.invalidConfig, en.invalidConfig, de.invalidConfig],
  INVALID_REGION: ['区域编号重复或区域没有零件。请调整区域设置。', 'A region is empty or has a duplicate ID. Update the regions.', 'Ein Bereich ist leer oder hat eine doppelte ID. Bereiche anpassen.'],
  UNKNOWN_REGION_PART: ['区域引用了已删除的零件。请重新划分。', 'A region references a deleted part. Regroup the model.', 'Ein Bereich verweist auf ein gelöschtes Teil. Modell neu aufteilen.'],
  DUPLICATE_REGION_PART: ['一个零件属于多个区域。请调整零件归属。', 'A part belongs to multiple regions. Update its assignment.', 'Ein Teil gehört zu mehreren Bereichen. Zuordnung korrigieren.'],
  INCOMPLETE_REGION: ['区域遗漏了零件。请重新自动划分。', 'Parts are missing from a region. Regroup automatically.', 'Teile fehlen in einem Bereich. Automatisch neu aufteilen.'],
  INVALID_REGION_ORDER: ['区域顺序包含重复或已删除的区域。', 'The order contains duplicate or deleted regions.', 'Die Reihenfolge enthält doppelte oder gelöschte Bereiche.'],
  INVALID_ASSEMBLY_ORDER: ['接口的支撑区域需要先完成。请调整区域顺序。', 'Complete the supporting region before this connection. Change the order.', 'Vor dieser Verbindung den tragenden Bereich fertigstellen. Reihenfolge ändern.'],
  REGION_ORDER_ADJUSTED: ['已按接口依赖调整实际拼装顺序。', 'The actual assembly order was adjusted to respect connections.', 'Die tatsächliche Reihenfolge wurde an die Verbindungen angepasst.'],
  INCOMPATIBLE_INTERFACE_AXES: ['预装区域的接口无法沿同一方向插接。请调整区域或将边界框架纳入模块。', 'The preassembled region cannot fit along one direction. Adjust regions or include the boundary frame.', 'Der vormontierte Bereich lässt sich nicht in einer Richtung einsetzen. Bereiche oder Grenzrahmen anpassen.'],
  INSTALLATION_PATH_BLOCKED: ['预装区域的安装路径被其他零件挡住。请调整顺序或拆分区域。', 'Other parts block the installation path. Change the order or split the region.', 'Andere Teile blockieren den Montageweg. Reihenfolge ändern oder Bereich aufteilen.'],
  ASSEMBLY_DEPENDENCY_CYCLE: ['区域接口互相依赖，无法确定安装顺序。请合并或重新划分。', 'Region connections form a dependency cycle. Merge or regroup the regions.', 'Bereiche hängen gegenseitig voneinander ab. Zusammenfassen oder neu aufteilen.'],
  MISSING_TUBE_ENDPOINT: ['管件缺少有效端点，请定位并检查模型。', 'A tube has a missing endpoint. Locate it and check the model.', 'Ein Rohr hat keinen gültigen Endpunkt. Im Modell prüfen.'],
  MISSING_C45_ADAPTER: ['斜管缺少真实的 45°适配器或安装空间。', 'A diagonal tube needs a 45° adapter and installation clearance.', 'Ein Schrägrohr benötigt einen 45°-Adapter und Montageplatz.'],
  UNSUPPORTED_CONNECTOR_ANGLE: ['现有连接件无法连接这些方向。请核对管端和接头朝向。', 'The available connector cannot join these directions. Check tube ends and connector orientation.', 'Die Kupplung kann diese Richtungen nicht verbinden. Rohrenden und Ausrichtung prüfen.'],
  INCOMPATIBLE_CONNECTOR_TYPE: ['保存的连接件型号或朝向与实际插口不匹配，请核对接头与管端。', 'The saved connector type or orientation does not fit the tube ports. Check the connector and tube ends.', 'Der gespeicherte Kupplungstyp oder seine Ausrichtung passt nicht zu den Rohranschlüssen. Kupplung und Rohrenden prüfen.'],
  INCOMPATIBLE_SAVED_CONNECTOR_ARMS: ['保存的连接件臂方向缺少实际管件所需的插口，请调整连接件朝向。', 'The saved connector arms do not include the ports needed by the tubes. Adjust the connector orientation.', 'Die gespeicherten Kupplungsarme bieten nicht die benötigten Rohranschlüsse. Ausrichtung anpassen.'],
  UNKNOWN_CONNECTOR: ['无法确定此节点使用的连接件。', 'No suitable connector could be determined for this node.', 'Für diesen Knoten konnte keine geeignete Kupplung bestimmt werden.'],
  PART_UNASSIGNED: ['零件没有对应的区域或装配步骤。', 'A part has no region or assembly step.', 'Ein Teil hat keinen Bereich oder Bauschritt.'],
  BOM_UNASSIGNED: ['部分材料无法分配到装配步骤，材料账目尚未完整。', 'Some materials could not be assigned to steps. The parts ledger is incomplete.', 'Einige Materialien konnten keinem Schritt zugeordnet werden. Die Stückliste ist unvollständig.'],
  DUPLICATE_PART_STEP: ['零件重复出现在多个装配步骤中。', 'A part appears in more than one assembly step.', 'Ein Teil erscheint in mehreren Bauschritten.'],
  REPAIR_BLOCKED: ['无法安全应用此自动修正。请检查标记的连接和支撑。', 'This automatic repair cannot be applied safely. Check the marked connections and supports.', 'Diese automatische Korrektur lässt sich nicht sicher anwenden. Verbindungen und Stützen prüfen.'],
  REPAIR_INVALID_DEPENDENCY: ['修正会留下失效的零件引用，暂时无法应用。', 'The repair would leave invalid part references and cannot be applied.', 'Die Korrektur würde ungültige Teileverweise erzeugen und kann nicht angewandt werden.'],
  REPAIR_LOST_GROUND_CONNECTION: ['修正后框架会失去地面支撑，暂时无法应用。', 'The repair would disconnect the frame from ground support and cannot be applied.', 'Die Korrektur würde die Bodenverbindung lösen und kann nicht angewandt werden.'],
  REPAIR_BELOW_GROUND: ['修正后的零件会低于地面，暂时无法应用。', 'The repair would place parts below ground and cannot be applied.', 'Die Korrektur würde Teile unter den Boden versetzen und kann nicht angewandt werden.'],
}

export function assemblyDiagnosticText(lang: Lang, code: string, fallback: string): string {
  return diagnosticCopy[code]?.[lang === 'zh' ? 0 : lang === 'en' ? 1 : 2] || fallback
}
