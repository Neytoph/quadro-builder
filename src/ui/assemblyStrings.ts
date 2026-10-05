import type { Lang } from '../i18n'

const zh = {
  overview: '本步总览', details: '本步局部详图', detailHint: '先看总览，再逐幅查看局部动作。材料圆圈与动作序号分别对应下方清单。',
  detailPrevious: '上一幅', detailNext: '下一幅', enlarge: '放大图示', shrink: '返回阅读', readInstructions: '阅读本图操作', actionView: '装配动作', completedView: '装好后',
  materials: '本图材料', operations: '依次操作', instructions: '安装提示', location: '本图在本层的位置', front: '正面视角', back: '背面视角', bottom: '底部视角', custom: '指定视角',
  materialLegend: '圆圈数字：材料编号', operationLegend: '①②③：动作顺序', physicalUnverified: '这份说明书未进行现场搭建及承载核验。',
  safetyNotice: '先按总表清点零件，按长度与颜色分组。按层从下往上拼接。主体拼好后从下往上固定，板位用板螺丝；固定完成前不能使用。',
  preassemblyHint: '零件分开展示；关闭“装配动作”可查看拼好的框架，再进行下一步安装。',
  title: '安装说明书预览', subtitle: '按层搭建主体，再安装尖顶和其他配件。画面与 PDF 使用同一份模型快照。',
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
  overview: 'Step overview', details: 'Details of this step', detailHint: 'Start with the overview, then inspect each detail. Material circles and action numbers match the lists below.',
  detailPrevious: 'Previous detail', detailNext: 'Next detail', enlarge: 'Enlarge drawing', shrink: 'Back to reading', readInstructions: 'Read these actions', actionView: 'Assembly action', completedView: 'Completed step',
  materials: 'Materials in this detail', operations: 'Action order', instructions: 'Assembly notes', location: 'Location in this layer', front: 'Front view', back: 'Rear view', bottom: 'Underside view', custom: 'Specified view',
  materialLegend: 'Circled numbers: materials', operationLegend: '①②③: action order', physicalUnverified: 'Drawings and model checks do not verify physical assembly or load capacity on site.',
  safetyNotice: 'Check the parts against the complete list, then group them by length and colour. Build layer by layer from bottom to top. Once the structure is assembled, secure it from bottom to top, using panel screws at panels. Do not use it before all fixings are complete.',
  preassemblyHint: 'Parts are shown separately. Turn off “Assembly action” to see the assembled frame before installing it.',
  repairPhysical: 'Model connectivity and accessory references were checked. Physical assembly and load capacity of the repair have not been verified on site.',
  title: 'Assembly manual preview', subtitle: 'Build each region, then connect the whole design. The preview and PDF use the same model snapshot.', close: 'Close', regions: 'Assembly regions', steps: 'Assembly steps', diagnostics: 'Check these items', ready: 'Ready to export', blocked: 'Resolve the issues below before exporting.', auto: 'Auto group', save: 'Save regions', saved: 'Region settings saved. You can undo this change.', stale: 'The source model has changed. This preview keeps its original snapshot; reopen to use the latest model.', split: 'Split selected parts', merge: 'Merge with next region', up: 'Move up', down: 'Move down', parts: 'Parts', edit: 'Select parts', name: 'Region name', newRegion: 'New region', previous: 'Previous', next: 'Next', all: 'Whole design', action: 'Assembly action', rotate: 'Drag to rotate; scroll or pinch to zoom.', export: 'Export PDF', exporting: 'Creating PDF', order: 'Grouping direction', locate: 'Locate issue', repair: 'Preview repair', apply: 'Apply to source model', discard: 'Discard repair preview', repairTitle: 'Repair preview', repairHint: 'Review the changes and repaired steps before applying. Changes can be undone.', readonly: 'Read-only model: region changes and repairs apply to this PDF only.', change: 'Change', before: 'Before', after: 'After', dependencies: 'Complete first', attach: 'Connect regions', preassemble: 'Preassemble region', build: 'Install parts', noRepair: 'No automatic repair is available. Check these parts in the model.', failedApply: 'The source model or permissions changed. Reopen the preview.', remove: 'Remove conflicting part', connectors: 'Connectors', tubes: 'Tubes', panels: 'Panels', textiles: 'Textiles', slides: 'Slides', fittings: 'Fittings', screws: 'Screws', reinforcements: 'Reinforcements', duplicatePort: 'Multiple parts occupy the same connector port. Check the marked curved tube and short riser.', invalidConfig: 'The region configuration is outdated. Regroup automatically or update part assignments.',
}
const de: Strings = {
  overview: 'Übersicht dieses Schritts', details: 'Details dieses Schritts', detailHint: 'Zuerst die Übersicht, dann jedes Detail ansehen. Materialkreise und Aktionsnummern entsprechen den Listen darunter.',
  detailPrevious: 'Vorheriges Detail', detailNext: 'Nächstes Detail', enlarge: 'Abbildung vergrößern', shrink: 'Zurück zur Anleitung', readInstructions: 'Aktionen lesen', actionView: 'Montagebewegung', completedView: 'Fertiger Schritt',
  materials: 'Material in diesem Detail', operations: 'Reihenfolge der Aktionen', instructions: 'Montagehinweise', location: 'Position in dieser Ebene', front: 'Vorderansicht', back: 'Rückansicht', bottom: 'Ansicht von unten', custom: 'Vorgegebene Ansicht',
  materialLegend: 'Kreisnummern: Materialien', operationLegend: '①②③: Aktionsfolge', physicalUnverified: 'Abbildungen und Modellprüfungen bestätigen weder den praktischen Aufbau noch die Belastbarkeit vor Ort.',
  safetyNotice: 'Teile anhand der Gesamtliste prüfen und nach Länge und Farbe sortieren. Ebene für Ebene von unten nach oben bauen. Den fertig zusammengesteckten Aufbau von unten nach oben sichern; an Platten die Plattenschrauben verwenden. Erst nach vollständiger Befestigung benutzen.',
  preassemblyHint: 'Teile sind getrennt dargestellt. „Montagebewegung“ ausschalten, um den vormontierten Rahmen zu sehen.',
  repairPhysical: 'Modellverbindungen und Zubehörverweise wurden geprüft. Der praktische Aufbau und die Belastbarkeit der Korrektur wurden noch nicht vor Ort geprüft.',
  title: 'Vorschau der Bauanleitung', subtitle: 'Zuerst die Bereiche bauen, dann das gesamte Modell verbinden. Vorschau und PDF verwenden denselben Modellstand.', close: 'Schließen', regions: 'Baubereiche', steps: 'Bauschritte', diagnostics: 'Bitte prüfen', ready: 'Bereit zum Export', blocked: 'Vor dem Export die folgenden Probleme beheben.', auto: 'Automatisch aufteilen', save: 'Bereiche speichern', saved: 'Bereiche gespeichert. Die Änderung lässt sich rückgängig machen.', stale: 'Das Ausgangsmodell wurde geändert. Die Vorschau behält ihren Modellstand; zum Aktualisieren erneut öffnen.', split: 'Gewählte Teile abtrennen', merge: 'Mit nächstem Bereich verbinden', up: 'Nach oben', down: 'Nach unten', parts: 'Teile', edit: 'Teile wählen', name: 'Bereichsname', newRegion: 'Neuer Bereich', previous: 'Zurück', next: 'Weiter', all: 'Gesamtes Modell', action: 'Montagebewegung', rotate: 'Ziehen zum Drehen; mit Rad oder zwei Fingern zoomen.', export: 'PDF exportieren', exporting: 'PDF wird erstellt', order: 'Aufbaurichtung', locate: 'Problem anzeigen', repair: 'Korrektur ansehen', apply: 'Im Ausgangsmodell anwenden', discard: 'Korrektur verwerfen', repairTitle: 'Korrekturvorschau', repairHint: 'Änderungen und Bauschritte vor dem Anwenden prüfen. Änderungen lassen sich rückgängig machen.', readonly: 'Schreibgeschütztes Modell: Änderungen gelten nur für dieses PDF.', change: 'Änderung', before: 'Vorher', after: 'Nachher', dependencies: 'Zuerst fertigstellen', attach: 'Bereiche verbinden', preassemble: 'Bereich vormontieren', build: 'Teile montieren', noRepair: 'Keine automatische Korrektur verfügbar. Diese Teile im Modell prüfen.', failedApply: 'Modell oder Berechtigungen wurden geändert. Vorschau erneut öffnen.', remove: 'Kollidierendes Teil entfernen', connectors: 'Kupplungen', tubes: 'Rohre', panels: 'Platten', textiles: 'Textilien', slides: 'Rutschen', fittings: 'Zubehör', screws: 'Schrauben', reinforcements: 'Verstärkungen', duplicatePort: 'Mehrere Teile belegen denselben Kupplungsanschluss. Markiertes Bogenrohr und kurze Stütze prüfen.', invalidConfig: 'Bereichseinstellungen sind veraltet. Automatisch aufteilen oder Teilezuordnung ändern.',
}
export const assemblyStrings: Record<Lang, Strings> = { zh, en, de }
en.subtitle = 'Build the structure layer by layer, then fit the roof and other accessories. The preview and PDF use the same model snapshot.'
de.subtitle = 'Den Aufbau Ebene für Ebene bauen, dann Dach und Zubehör montieren. Vorschau und PDF verwenden denselben Modellstand.'

export const assemblyPdfStrings: Record<Lang, Record<string, string>> = {
  zh: { actionView: '装配动作', completeView: '装好后', regionOverview: '拼装区域总览', regionShape: '区域形状', regionLocation: '在完整造型中的位置', regionOrder: '拼装顺序', finalTitle: '完整造型', detailTitle: '连接细节', instructionsTitle: '安装说明' },
  en: { actionView: 'Assembly action', completeView: 'Completed step', regionOverview: 'Assembly regions', regionShape: 'Region shape', regionLocation: 'Location in the whole design', regionOrder: 'Assembly order', finalTitle: 'Complete design', detailTitle: 'Connection details', instructionsTitle: 'Assembly instructions' },
  de: { actionView: 'Montagebewegung', completeView: 'Fertiger Schritt', regionOverview: 'Baubereiche im Überblick', regionShape: 'Form des Bereichs', regionLocation: 'Position im gesamten Modell', regionOrder: 'Baureihenfolge', finalTitle: 'Fertiges Modell', detailTitle: 'Verbindungsdetails', instructionsTitle: 'Bauanleitung' },
}

assemblyPdfStrings.zh.contextHint = '操作图暂时隐藏周围零件；完整形态见区域页和成品页。'
assemblyPdfStrings.zh.beforeView = '装配前'
assemblyPdfStrings.zh.layerAction = '本层安装'
assemblyPdfStrings.zh.layerComplete = '本层装好后'
assemblyPdfStrings.zh.layerHint = '灰色是已装主体，彩色是本层新增件；先拼好本层框架，再按箭头套入对应立柱。'
assemblyPdfStrings.zh.bodyHint = '保留已装主体，彩色突出本步新增件，按层逐步搭建。'
assemblyPdfStrings.en.layerAction = 'Install this layer'
assemblyPdfStrings.en.layerComplete = 'Layer completed'
assemblyPdfStrings.en.layerHint = 'Grey shows the built structure; colour shows this layer. Assemble its frames, then lower each onto the matching uprights as shown.'
assemblyPdfStrings.en.bodyHint = 'The built structure stays visible. Colour highlights new parts as you build layer by layer.'
assemblyPdfStrings.de.layerAction = 'Diese Ebene montieren'
assemblyPdfStrings.de.layerComplete = 'Ebene fertig montiert'
assemblyPdfStrings.de.layerHint = 'Grau zeigt den bestehenden Aufbau, Farbe die neue Ebene. Rahmen zusammensetzen und nach den Pfeilen auf die passenden Stützen absenken.'
assemblyPdfStrings.de.bodyHint = 'Der bestehende Aufbau bleibt sichtbar. Neue Teile sind farbig hervorgehoben; Ebene für Ebene bauen.'
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

for (const lang of ['zh', 'en', 'de'] as const) {
  const strings = assemblyStrings[lang]
  Object.assign(assemblyPdfStrings[lang], {
    safetyTitle: strings.instructions, safetyNotice: strings.safetyNotice,
    safetySource: lang === 'zh' ? 'QUADRO 官方安全指南（2025）' : lang === 'de' ? 'QUADRO Sicherheitshinweise (2025)' : 'QUADRO official safety guide (2025)',
    localDetail: strings.details, detailReference: lang === 'zh' ? '材料编号供定位；数量已计入本步。' : lang === 'de' ? 'Materialnummern dienen zur Orientierung; Mengen sind im Schritt enthalten.' : 'Material numbers identify parts; quantities are already included in this step.',
    locationView: strings.location, viewFront: strings.front, viewBack: strings.back, viewBottom: strings.bottom, viewCustom: strings.custom,
    continuation: lang === 'zh' ? '续页' : lang === 'de' ? 'Fortsetzung' : 'Continued',
  })
}

const diagnosticCopy: Record<string, [string, string, string]> = {
  INVALID_STEP_DEPENDENCY: ['主步骤的前置步骤缺失或顺序无效，请检查区域设置和搭建顺序。', 'A prerequisite step is missing or out of order. Check the regions and assembly order.', 'Ein vorausgesetzter Bauschritt fehlt oder steht in der falschen Reihenfolge. Baubereiche und Aufbaureihenfolge prüfen.'],
  MISSING_THREAD_SUPPORT: ['穿管配件缺少可确认的支撑管，无法安排封口前安装。请检查部件及管轴。', 'A threaded accessory has no confirmed support tube. Check the part and tube axis before scheduling closure.', 'Für das aufgefädelte Zubehör ist kein Trägerrohr bestätigt. Teil und Rohrachse vor dem Schließen prüfen.'],
  MISSING_DOUBLE_TUBE_SUPPORT: ['双管连接环缺少可识别的两根穿管轴，请检查连接环与支撑管。', 'The double-tube connector has no identifiable pair of tube axes. Check the connector and supports.', 'Am Doppelrohrverbinder sind keine zwei Rohrachsen erkennbar. Verbinder und Trägerrohre prüfen.'],
  MISSING_WHEEL_BEARING: ['多功能轮缺少明确的轮轴承安装引用，请核对轮轴和朝向。', 'The wheel has no confirmed bearing reference. Check its axle, bearing and orientation.', 'Für das Rad ist keine eindeutige Lagerreferenz bestätigt. Achse, Lager und Ausrichtung prüfen.'],
  ACCESSORY_INSTALLATION_INVALID: ['配件安装引用、方向、支撑或空间无效，请检查标记部件。', 'An accessory has invalid references, orientation, support or clearance. Check the marked parts.', 'Zubehörverweise, Ausrichtung, Träger oder Freiraum sind ungültig. Markierte Teile prüfen.'],
  ACCESSORY_INSTALLATION_PATH_UNRESOLVED: ['板面或配件尚无可确认的无遮挡安装路径，请调整朝向、支撑或局部顺序。', 'No clear installation path has been verified for this panel or accessory. Adjust its orientation, support or local assembly order.', 'Für diese Platte oder dieses Zubehör ist kein freier Montageweg bestätigt. Ausrichtung, Träger oder örtliche Montagefolge anpassen.'],
  REINFORCEMENT_CHANNEL_SPLIT: ['加固芯的贯通管段被分在不同步骤中。请把管段和中间接头共同预装，保留穿芯通道后再合拢。', 'The continuous profile channel is split across assembly steps. Preassemble its tubes and intermediate connectors together, keeping the channel open before closing the ends.', 'Der durchgehende Profilkanal ist auf mehrere Schritte verteilt. Rohre und Zwischenkupplungen gemeinsam vormontieren und den Kanal bis zum Schließen der Enden offen halten.'],
  REINFORCEMENT_PLACEMENT_UNVERIFIED: ['加固型材的长度、材质或管内放置位置尚未确认，请核对原始设计与配件目录。', 'The reinforcement profile length, material or position inside the tubes is unconfirmed. Check the original design and parts catalogue.', 'Länge, Material oder Lage des Verstärkungsprofils im Rohr sind ungeklärt. Originalentwurf und Teilekatalog prüfen.'],
  REINFORCEMENT_PATH_UNVERIFIED: ['木质加固芯的贯通安装路径尚未确认。请保留管端和中间接头的开放通道，确认安装方法后再导出。', 'The continuous insertion path for the wooden profile is unconfirmed. Keep tube ends and intermediate connectors open and confirm the method before exporting.', 'Der durchgehende Einführweg für das Holzprofil ist ungeklärt. Rohrenden und Zwischenkupplungen offen halten und das Verfahren vor dem Export bestätigen.'],
  PRETHREAD_METHOD_UNVERIFIED: ['穿管配件的安装顺序或移动路径尚未确认。请在封闭管轴前共同预装配件与载管。', 'The threaded accessory sequence or movement path is unconfirmed. Preassemble the accessory with its carrier tubes before closing their ends.', 'Montagefolge oder Bewegungsweg des aufgefädelten Zubehörs sind ungeklärt. Zubehör und Trägerrohre vor dem Schließen der Enden gemeinsam vormontieren.'],
  UNKNOWN_INSTALLATION_GEOMETRY: ['此配件缺少可核验的几何包络，暂时无法确认安装路径。', 'This accessory has no verifiable geometry envelope, so its installation path cannot be confirmed yet.', 'Für dieses Zubehör fehlt eine überprüfbare Geometrie; der Montageweg kann daher noch nicht bestätigt werden.'],
  UNRESOLVED_FRAME_CLOSURE: ['闭环框架缺少可确认的合拢方法，请调整区域或连接方式。', 'The closed frame has no confirmed assembly method. Adjust the region or connections.', 'Für den geschlossenen Rahmen ist kein Montageverfahren bestätigt. Bereich oder Verbindungen anpassen.'],
  UNVERIFIED_IN_PLACE_CLOSURE: ['管件两端接头已固定，原位封口顺序尚未确认。请先留开接头或预拼框架。', 'Both tube ends are fixed and the closure sequence is unconfirmed. Leave a joint open or preassemble the frame.', 'Beide Rohrenden sind befestigt; die Schließfolge ist ungeklärt. Anschluss offen lassen oder Rahmen vormontieren.'],
  INVALID_OPERATION_DEPENDENCY: ['安装动作所需的前置动作尚未完成，请检查操作顺序。', 'A required preceding action is incomplete. Check the action order.', 'Eine benötigte vorherige Aktion ist unvollständig. Aktionsfolge prüfen.'],
  INVALID_OPERATION_DIRECTION: ['安装箭头与实际移动方向不一致，请核对所指动作后再导出。', 'The installation arrow disagrees with the actual motion. Check the indicated action before export.', 'Montagepfeil und tatsächliche Bewegung stimmen nicht überein. Angegebene Aktion vor dem Export prüfen.'],
  NATIVE_SUPPORT_UNRESOLVED: ['此配件的实际安装支撑或管轴尚未确认，请核对连接位置与朝向后再导出。', 'The actual support or mounting axis of this accessory is unresolved. Check its joint position and orientation before export.', 'Tatsächliche Stütze oder Montageachse dieses Zubehörs ist ungeklärt. Anschlussposition und Ausrichtung vor dem Export prüfen.'],
  OPERATION_CONSUMPTION_MISMATCH: ['安装动作遗漏或重复使用了同一零件，暂时无法导出。请检查标记零件的动作归属。', 'Assembly actions omit a part or consume it more than once. Check the marked part assignments before exporting.', 'Montageaktionen lassen ein Teil aus oder verwenden es mehrfach. Zuordnung der markierten Teile vor dem Export prüfen.'],
  OPERATION_MATERIAL_UNASSIGNED: ['材料没有对应的安装动作，暂时无法导出。请检查材料与步骤的归属。', 'A material has no corresponding assembly action. Check its step assignment before exporting.', 'Für ein Material fehlt eine Montageaktion. Zuordnung zum Bauschritt vor dem Export prüfen.'],
  DUPLICATE_CONNECTOR_PORT: [zh.duplicatePort, en.duplicatePort, de.duplicatePort],
  INVALID_ASSEMBLY_CONFIG: [zh.invalidConfig, en.invalidConfig, de.invalidConfig],
  INVALID_REGION: ['区域编号重复或区域没有零件。请调整区域设置。', 'A region is empty or has a duplicate ID. Update the regions.', 'Ein Bereich ist leer oder hat eine doppelte ID. Bereiche anpassen.'],
  UNKNOWN_REGION_PART: ['区域引用了已删除的零件。请重新划分。', 'A region references a deleted part. Regroup the model.', 'Ein Bereich verweist auf ein gelöschtes Teil. Modell neu aufteilen.'],
  DUPLICATE_REGION_PART: ['一个零件属于多个区域。请调整零件归属。', 'A part belongs to multiple regions. Update its assignment.', 'Ein Teil gehört zu mehreren Bereichen. Zuordnung korrigieren.'],
  INCOMPLETE_REGION: ['区域遗漏了零件。请重新自动划分。', 'Parts are missing from a region. Regroup automatically.', 'Teile fehlen in einem Bereich. Automatisch neu aufteilen.'],
  INVALID_REGION_ORDER: ['区域顺序包含重复或已删除的区域。', 'The order contains duplicate or deleted regions.', 'Die Reihenfolge enthält doppelte oder gelöschte Bereiche.'],
  INVALID_ASSEMBLY_ORDER: ['接口的支撑区域需要先完成。请调整区域顺序。', 'Complete the supporting region before this connection. Change the order.', 'Vor dieser Verbindung den tragenden Bereich fertigstellen. Reihenfolge ändern.'],
  INVALID_UPPER_FRAME_ORDER: ['上层框架的支撑立柱尚未完成。请先装好对应立柱，再安装上层框架。', 'The upper frame uprights are incomplete. Install the supporting uprights before fitting this frame.', 'Die Stützen des oberen Rahmens sind unvollständig. Tragende Stützen vor diesem Rahmen montieren.'],
  INCOMPATIBLE_BODY_INTERFACES: ['主体区域的接口无法沿同一方向接合。请合并连续框架或调整区域边界。', 'The body region ports cannot join along one direction. Merge the continuous frame or adjust region boundaries.', 'Die Anschlüsse des Grundrahmenbereichs lassen sich nicht in einer Richtung verbinden. Durchgehenden Rahmen zusammenfassen oder Bereichsgrenzen anpassen.'],
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
