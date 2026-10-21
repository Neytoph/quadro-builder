export const selectionTransformStrings = {
  zh: {title:'调整选中结构',move:'移动',rotate:'旋转',whole:'选整块',x:'X 位置',height:'高度',z:'Z 位置',axis:'旋转轴',angle:'角度',apply:'应用',snap:'吸附',unit:'cm',degree:'°',free:'自由',single:'组件操作',flip:'翻面',adjust:'调整方向',balls:'切换海洋球',curve:'切换弯曲方向',multiHint:'Shift 加选或选整块后，可移动和旋转整组选区。',
    rotationHelp:'每次拖动从0°开始计角，圆环同步旋转轴和角度。输入数值可开始一次新旋转；Esc取消。',
    help:'高度以选中结构最低接头中心为准。拖动箭头移动，拖动圆环旋转；Esc 取消。',
    incomplete:'请先选中完整结构，再移动或旋转。',invalid:'当前位置不可用，请调整后重试。',number:'请输入有效数值。',changed:'造型已在其他位置更新，请重新调整。'},
  en: {title:'Adjust selection',move:'Move',rotate:'Rotate',whole:'Select connected',x:'X position',height:'Height',z:'Z position',axis:'Rotation axis',angle:'Angle',apply:'Apply',snap:'Snap',unit:'cm',degree:'°',free:'Free',single:'Component actions',flip:'Flip',adjust:'Adjust orientation',balls:'Toggle balls',curve:'Reverse curve',multiHint:'Shift-click more parts or select connected parts to move and rotate the selection.',
    rotationHelp:'Each drag starts at 0°. Rings update the axis and angle. Enter a value for a new rotation; Esc cancels.',
    help:'Height is measured at the lowest selected connector centre. Drag arrows to move or rings to rotate; Esc cancels.',
    incomplete:'Select the complete structure before moving or rotating.',invalid:'This position is unavailable. Adjust it and try again.',number:'Enter a valid number.',changed:'The model changed elsewhere. Start the adjustment again.'},
  de: {title:'Auswahl anpassen',move:'Verschieben',rotate:'Drehen',whole:'Zusammenhängend auswählen',x:'X-Position',height:'Höhe',z:'Z-Position',axis:'Drehachse',angle:'Winkel',apply:'Anwenden',snap:'Einrasten',unit:'cm',degree:'°',free:'Frei',single:'Bauteilaktionen',flip:'Wenden',adjust:'Ausrichtung ändern',balls:'Bälle umschalten',curve:'Krümmung umkehren',multiHint:'Mit Umschalt-Klick weitere Teile oder zusammenhängende Teile auswählen, um die Auswahl zu verschieben und zu drehen.',
    rotationHelp:'Jeder Zug beginnt bei 0°. Ringe aktualisieren Achse und Winkel. Eine Eingabe startet eine neue Drehung; Esc bricht ab.',
    help:'Die Höhe bezieht sich auf die Mitte des tiefsten ausgewählten Verbinders. Pfeile zum Verschieben und Ringe zum Drehen ziehen; Esc bricht ab.',
    incomplete:'Vor dem Verschieben oder Drehen die vollständige Konstruktion auswählen.',invalid:'Diese Position ist nicht möglich. Position anpassen und erneut versuchen.',number:'Eine gültige Zahl eingeben.',changed:'Das Modell wurde andernorts geändert. Anpassung erneut beginnen.'},
} as const
