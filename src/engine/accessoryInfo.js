import { getLang } from './i18n.js';
import { getPartById, partName } from './catalog.js';
import { confirmedSpec, confirmedColor } from './componentPack.js';

const INFO = {
  steering_wheel: {
    zh: ['每套含2个卡箍及紧固件', '方向盘安装', '将两个卡箍分别固定在横管上，连接底座，确认圆环朝向与周围净空。'],
    en: ['Each kit includes 2 pipe clamps and fasteners', 'Install steering wheel', 'Secure both clamps to the horizontal tube, attach the hub and check the wheel direction and clearance.'],
    de: ['Je Set: 2 Rohrschellen und Befestigungen', 'Lenkrad montieren', 'Beide Schellen am waagerechten Rohr befestigen, die Nabe anbringen und Richtung sowie Freiraum prüfen.'],
  },
  swing: {
    zh: ['每套含2个吊点夹具、2组吊绳及座椅', '秋千安装', '先固定横梁上的两个吊点，再连接吊绳与座椅，检查两侧支撑及前后活动空间。'],
    en: ['Each kit includes 2 beam clamps, 2 rope sets and the seat', 'Install swing', 'Secure both beam clamps, attach the ropes and seat, and check support on both sides and the swing clearance.'],
    de: ['Je Set: 2 Balkenschellen, 2 Seilsätze und Sitz', 'Schaukel montieren', 'Beide Balkenschellen befestigen, Seile und Sitz anbringen sowie beidseitige Stützen und Schaukelfreiraum prüfen.'],
  },
  panel_40x40_busy: {
    zh: ['每套含4个边角固定夹及活动模块', '忙碌板安装', '在竖直完整方框内放入面板，逐一固定四角，检查齿轮、滑块和转盘前方净空。'],
    en: ['Each kit includes 4 corner clips and activity modules', 'Install activity board', 'Fit the board inside the complete vertical frame, secure all four corners and check clearance in front of the modules.'],
    de: ['Je Set: 4 Eckclips und Spielmodule', 'Spielplatte montieren', 'Die Platte in den vollständigen senkrechten Rahmen einsetzen, alle vier Ecken befestigen und Freiraum vor den Modulen prüfen.'],
  },
  panel_40x40_pocket: {
    zh: ['每套含4组角部绑带及布兜', '布兜安装', '将四角绑带分别固定到水平完整方框上，展开兜口，检查兜底与下方零件及地面的间距。'],
    en: ['Each kit includes 4 corner strap sets and the fabric pouch', 'Install fabric pouch', 'Fasten all four corner straps to the complete horizontal frame, open the pouch and check clearance below the fabric bottom.'],
    de: ['Je Set: 4 Eckgurtsätze und Stofftasche', 'Stofftasche montieren', 'Alle vier Eckgurte am vollständigen waagerechten Rahmen befestigen, die Tasche öffnen und Freiraum unter dem Stoffboden prüfen.'],
  },
};

export const ORIGINAL_COMPONENT_IDS = new Set(Object.keys(INFO));

export function componentPartId(part) {
  return part?.partId || part?.panelId || part?.kind;
}

export function componentSizeLabel(part) {
  if (componentPartId(part) !== 'trampoline' || part?.appearanceVersion !== 2) return '';
  const width = Number(part.w ?? part.params?.width), height = Number(part.h ?? part.params?.height);
  return [width, height].every(n => n === 40 || n === 80) ? `${width}×${height} cm` : '';
}

export function componentFittingKey(part, catalogId = componentPartId(part)) {
  const size = componentSizeLabel(part);
  return size ? `${catalogId}|${size}` : catalogId;
}

export function componentOutputColor(part) {
  return confirmedColor(part);
}

export function componentColorName(color, fallback) {
  const names = {
    '#237841': ['乐高绿', 'Brick green', 'Bausteingrün'],
    '#2fcb5a': ['经典绿', 'Classic green', 'Klassisches Grün'],
    '#39a7df': ['天蓝', 'Sky blue', 'Himmelblau'],
    '#64b66b': ['草绿', 'Grass green', 'Grasgrün'],
    '#ed5b49': ['珊瑚红', 'Coral red', 'Korallrot'],
    '#008ce7': ['亮蓝', 'Bright blue', 'Leuchtblau'],
    '#f3f3ed': ['米白', 'Cream', 'Creme'],
    '#efc947': ['暖黄', 'Warm yellow', 'Warmes Gelb'],
    '#f6d334': ['黄色', 'Yellow', 'Gelb'],
    '#77bf64': ['绿色', 'Green', 'Grün'],
    '#ec9eb2': ['粉色', 'Pink', 'Rosa'],
    '#f0d33f': ['黄色', 'Yellow', 'Gelb'],
    '#f0d665': ['浅黄', 'Light yellow', 'Hellgelb'],
    '#f5ba33': ['琥珀黄', 'Amber yellow', 'Bernsteingelb'],
    '#d4d8da': ['金属本色', 'Natural metal', 'Metall natur'],
    '#b9c0c5': ['金属本色', 'Natural metal', 'Metall natur'],
    '#f294be': ['粉色', 'Pink', 'Rosa'],
    '#a9acb0': ['灰色', 'Grey', 'Grau'],
    '#26292b': ['黑色', 'Black', 'Schwarz'],
    '#f0e8d6': ['米白', 'Cream', 'Creme'],
    '#f6f2e7': ['米白', 'Cream', 'Creme'],
    '#eaf7fa': ['透明', 'Clear', 'Transparent'],
    '#efcd47': ['浅黄', 'Light yellow', 'Hellgelb'],
  };
  const entry = names[String(color).toLowerCase()];
  return entry ? entry[{ zh: 0, en: 1, de: 2 }[getLang()] ?? 1] : fallback;
}

const MOUNT_COPY = {
  trampoline: {
    zh: ['四边弹力绳与多点固定', '检查实际框架尺寸、四边连续承载管及下方净空，沿四边逐点连接弹力绳并避开接头，逐边检查固定点与张紧状态。'],
    en: ['Elastic cords and multiple fixings on all four edges', 'Check the actual frame dimensions, continuous support tubes on all four edges and clearance below. Attach each elastic cord, leave connectors clear, and inspect every fixing and edge tension.'],
    de: ['Elastische Seile und mehrere Befestigungen an allen vier Seiten', 'Tatsächliche Rahmenmaße, durchgehende Trägerrohre an allen vier Seiten und Freiraum darunter prüfen. Jedes elastische Seil befestigen, Verbinder freihalten sowie alle Befestigungen und die Spannung prüfen.'],
  },
  'opposite-transparent-screws': {
    zh: ['每套含4颗透明螺丝，对边各2颗', '检查框格尺寸及两条对边的连续承载管，放入内嵌板，分别拧紧两边各2颗透明螺丝，检查板面方向及周围净空。'],
    en: ['Each kit includes 4 clear screws, 2 on each opposite edge', 'Check the frame dimensions and continuous support tubes on two opposite edges, insert the inset panel, tighten two clear screws on each edge, and check its facing and clearance.'],
    de: ['Je Set: 4 transparente Schrauben, je 2 an gegenüberliegenden Kanten', 'Rahmenmaße und durchgehende Trägerrohre an zwei gegenüberliegenden Kanten prüfen, die Einlegeplatte einsetzen, je zwei transparente Schrauben festziehen sowie Ausrichtung und Freiraum prüfen.'],
  },
  frame: {
    zh: ['四边支撑与角部固定', '检查框格尺寸及全部边管，放入组件并逐一固定角部，检查板面方向和周围净空。'],
    en: ['Frame supports and corner retainers', 'Check the frame size and every edge tube, secure all corner retainers, and check the facing and clearance.'],
    de: ['Rahmenstützen und Eckbefestigungen', 'Rahmengröße und alle Randrohre prüfen, sämtliche Ecken befestigen sowie Ausrichtung und Freiraum prüfen.'],
  },
  rails: {
    zh: ['两条平行支撑管与连续套管边', '检查两条支撑管的间距和长度，沿两侧安装套管边或横杠端部，避让接头，检查全部固定点。'],
    en: ['Two parallel support tubes and continuous sleeve edges', 'Check both rail dimensions, fit the sleeve edges or bar ends, leave the connectors clear, and inspect all fixing points.'],
    de: ['Zwei parallele Trägerrohre und durchgehende Stoffhülsen', 'Abstand und Länge prüfen, Stoffhülsen oder Stabenden montieren, Verbinder freihalten und alle Befestigungen prüfen.'],
  },
  'curved-frame': {
    zh: ['双弧管、端部横管与沿边固定', '检查两条同向弧管及端部横管，沿弧面逐段安装布套或网绳，保持全部固定点及接头完整。'],
    en: ['Paired curved rails, end crossbars and edge fixings', 'Check both matching curved rails and end crossbars, fit the fabric or net along the curve, and inspect every fixing and connector.'],
    de: ['Zwei Bogenrohre, Querstreben und Randbefestigungen', 'Gleichgerichtete Bogenrohre und Querstreben prüfen, Stoff oder Netz entlang des Bogens befestigen und alle Befestigungen prüfen.'],
  },
  'net-frame': {
    zh: ['四边网绳与多点固定', '检查完整框架，沿四边固定网绳并检查各连接点，逐边调整张紧状态及周围净空。'],
    en: ['Four net edges and multiple fixing points', 'Check the complete frame, fasten the net along all four edges, inspect each fixing, and check tension and clearance.'],
    de: ['Vier Netzränder und mehrere Befestigungspunkte', 'Vollständigen Rahmen prüfen, alle vier Netzränder befestigen und Befestigungen, Spannung und Freiraum prüfen.'],
  },
  corner: {
    zh: ['弧管与两条直边固定', '检查扇形板对应的弧管、两条直边及端部接头，沿真实支撑边固定，检查圆弧方向。'],
    en: ['Curved tube and two straight support edges', 'Check the curved tube, both straight support edges and end connectors, then secure the panel and check its orientation.'],
    de: ['Bogenrohr und zwei gerade Trägerkanten', 'Bogenrohr, beide geraden Kanten und Verbinder prüfen, die Platte befestigen und ihre Ausrichtung prüfen.'],
  },
  tube: {
    zh: ['承载管与端部固定', '检查承载管及两端接头，将套筒或轮装在对应管轴上，检查轴向固定与转动空间。'],
    en: ['Support tube and end retainers', 'Check the tube and both end connectors, fit the sleeve or wheel on its axis, and check retention and rotational clearance.'],
    de: ['Trägerrohr und Endbefestigungen', 'Rohr und beide Verbinder prüfen, Polster oder Rad aufsetzen sowie axialen Halt und Drehfreiraum prüfen.'],
  },
  rope: {
    zh: ['两端绳结固定', '分别检查绳子两端的承载管和固定点，沿连接路径系牢，检查张紧状态及与其它部件的干涉。'],
    en: ['Knotted fixings at both ends', 'Check both support tubes and endpoints, secure the rope along its path, and check tension and interference.'],
    de: ['Knotenbefestigungen an beiden Enden', 'Beide Trägerrohre und Endpunkte prüfen, das Seil entlang seines Verlaufs sichern sowie Spannung und Überschneidungen prüfen.'],
  },
};

function confirmedCopy(partId) {
  const spec = confirmedSpec(partId);
  if (!spec) return null;
  const lang = getLang();
  const key = spec.feature === 'trampoline' ? 'trampoline' : ['vertical-frame', 'horizontal-frame'].includes(spec.mountType) ? 'frame' : spec.mountType;
  const text = MOUNT_COPY[key]?.[lang] || MOUNT_COPY[key]?.en;
  if (!text) throw new Error(`缺少组件固定方式说明：${partId}/${spec.mountType}`);
  const name = partName(getPartById(spec.id)) || spec.name;
  const title = lang === 'zh' ? `${name}安装` : lang === 'de' ? `${name} montieren` : `Install ${name}`;
  const qualifier = lang === 'zh' ? '；固定件规格待核实' : lang === 'de' ? '; Befestigungsspezifikationen noch zu prüfen' : '; retainer specifications unverified';
  return [text[0] + qualifier, title, text[1]];
}

function copy(partId, part) {
  if (part?.params?.mountLayout === 'opposite-transparent-screws') {
    const lang = getLang();
    const text = MOUNT_COPY['opposite-transparent-screws'][lang] || MOUNT_COPY['opposite-transparent-screws'].en;
    const name = partName(getPartById(partId)) || partId;
    return [text[0], lang === 'zh' ? `${name}安装` : lang === 'de' ? `${name} montieren` : `Install ${name}`, text[1]];
  }
  const info = INFO[partId];
  return info ? info[getLang()] || info.en : confirmedCopy(partId);
}

export function isOriginalComponent(part) {
  const id = componentPartId(part);
  return part?.appearanceVersion === 2 ? !!confirmedSpec(id)
    : part?.appearanceVersion === 1 && ORIGINAL_COMPONENT_IDS.has(id);
}

export function componentKitFields(partId, designCount, total = designCount, insetCount = 0) {
  const text = copy(partId, insetCount === designCount && insetCount ? { params: { mountLayout: 'opposite-transparent-screws' } } : null);
  if (!text || !designCount) return {};
  const lang = getLang();
  const qualifier = total === designCount ? '' : lang === 'zh' ? `（其中新版${designCount}套）`
    : lang === 'de' ? ` (${designCount} neue Sets)` : ` (${designCount} new kits)`;
  const mountQualifier = insetCount && insetCount !== designCount
    ? lang === 'zh' ? `（其中${insetCount}套改为4颗透明螺丝，对边各2颗，其余保留原固定方式）`
      : lang === 'de' ? ` (${insetCount} Sets mit 4 transparenten Schrauben, je 2 gegenüberliegend; übrige Befestigungen unverändert)`
        : ` (${insetCount} kits use 4 clear screws, 2 per opposite edge; other kits retain their original fixings)`
    : '';
  return { kitContents: text[0] + mountQualifier + qualifier, designAssumption: true, loadVerified: false };
}

export function componentInstallCopy(partId, part) {
  const text = copy(partId, part);
  if (!text) throw new Error(`缺少组件安装说明：${partId}`);
  const lang = getLang();
  const status = lang === 'zh' ? '按框格设计的安装口径；实物尺寸与承载能力待验证。'
    : lang === 'de' ? 'Montagemaße nach Rahmenraster; reale Maße und Tragfähigkeit noch nicht geprüft.'
      : 'Installation dimensions follow the frame grid; physical dimensions and load capacity are unverified.';
  const size = componentSizeLabel(part);
  let instructions = text[2];
  if (part?.params?.mountLayout === 'opposite-transparent-screws') {
    const horizontal = part.params.screwAxis === 'horizontal';
    instructions += lang === 'zh' ? ` 螺丝固定在板面${horizontal ? '上下' : '左右'}两边，每边两颗。`
      : lang === 'de' ? ` Je zwei Schrauben befestigen die ${horizontal ? 'obere und untere' : 'linke und rechte'} Plattenkante.`
        : ` Two screws secure each ${horizontal ? 'top and bottom' : 'left and right'} panel edge.`;
  }
  if (size) instructions = (lang === 'zh' ? `安装框架尺寸：${size}。` : lang === 'de' ? `Montagerahmen: ${size}. ` : `Mounting frame: ${size}. `) + instructions;
  return { title: text[1] + (size ? ` ${size}` : ''), instructions: [instructions, text[0] + (lang === 'zh' ? '。' : '.'), status] };
}

export function componentStepLabel() {
  return getLang() === 'zh' ? '配件安装' : getLang() === 'de' ? 'Zubehör montieren' : 'Install accessories';
}
