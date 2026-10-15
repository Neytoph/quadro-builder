// Lädt die aus der Herstellersoftware abgegriffenen 3D-Modelle
// (`data/models/*.json`, erzeugt von `tools/obj2mesh.py`).
//
// Bewusst OHNE Three.js: hier entstehen nur rohe Zahlenfelder, die
// `BufferGeometry` baut `scene.js` daraus -- Three.js bleibt damit auf eine
// Datei beschränkt. Geladen wird erst NACH dem ersten Bild; bis dahin (und
// wenn eine Datei fehlt) zeichnet die Szene wie bisher ihre eigenen Formen.

// Die Datei führt Positionen in 0,1 mm; der Editor rechnet in Zentimetern.
const POS_TO_CM = 1 / 100;
const NRM_SCALE = 1 / 1000;
import { publicResourceUrl } from './publicResources.js';

const stores = {};   // Dateiname -> Promise auf { name -> record }

/**
 * Ein Modell: `pos`/`nrm` als Float32Array (Position in cm), `idx` als
 * Uint16Array. `mask` gibt es nur bei Kupplungen -- die Bitfolge ihrer Arme.
 */
function toRecord(raw) {
  const pos = new Float32Array(raw.pos.length);
  for (let i = 0; i < raw.pos.length; i++) pos[i] = raw.pos[i] * POS_TO_CM;
  const nrm = new Float32Array(raw.nrm.length);
  for (let i = 0; i < raw.nrm.length; i++) nrm[i] = raw.nrm[i] * NRM_SCALE;
  return { pos, nrm, idx: new Uint16Array(raw.idx), mask: raw.mask };
}

function load(file, signal) {
  if (!stores[file]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`${file}: request timed out`)), 20000);
    const entry = { controller, users: 0, complete: false };
    stores[file] = entry;
    entry.promise = fetch(publicResourceUrl(`data/models/${file}`), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const out = {};
        for (const key of Object.keys(data)) out[key] = toRecord(data[key]);
        return out;
      })
      .catch((e) => {
        // Kein harter Fehler: ohne Modelle bleibt es bei den gezeichneten Formen.
        console.info("Modelle nicht geladen:", e.message);
        if (stores[file] === entry) delete stores[file];
        return null;
      }).finally(() => { clearTimeout(timeout); entry.complete = true; });
  }
  const entry = stores[file];
  entry.users++;
  return new Promise(resolve => {
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      entry.users--;
      if (!entry.users && !entry.complete) {
        if (stores[file] === entry) delete stores[file];
        entry.controller.abort();
      }
      resolve(value);
    };
    const abort = () => finish(null);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    entry.promise.then(finish);
  });
}

/**
 * Die feine Fassung ÜBER die grobe legen. `*-fine.json` führt nur die Modelle,
 * von denen es einen hochauflösenden Abgriff gibt (Dach, Integralrutsche und
 * die Platten stehen nur einfach da) -- der Rest kommt weiter aus der groben
 * Datei. Fehlt die feine Datei ganz oder kommt sie nicht an, bleibt es
 * ebenfalls bei der groben: eine Stufe gröber ist besser als kein Teil.
 *
 * Beide Dateien werden geholt, das ist der Preis dieser Aufteilung. Dafür
 * liegt kein Modell doppelt im Repo, und der Rückfall kostet keine Zeile.
 */
async function loadLevel(file, fine, { signal, onCoarse } = {}) {
  const coarse = await load(file, signal);
  if (signal?.aborted) return null;
  onCoarse?.(coarse);
  if (!fine) return coarse;
  // 完整coarse先进入可交互画面，细节请求在下一次绘制后启动。
  await new Promise(resolve => setTimeout(resolve, 32));
  if (signal?.aborted) return coarse;
  const detail = await load(file.replace('.json', '-fine.json'), signal);
  return detail ? Object.assign({}, coarse || {}, detail) : coarse;
}

// Alle Lader nehmen `fine`: auf der Qualitätsstufe "hoch" die hochauflösenden
// Modelle, sonst die groben.

/** Kupplungen, nach Katalog-Kennung ("straight", "t", "6way" ...). */
export function loadConnectorMeshes(fine, options) {
  return loadLevel("connectors.json", fine, options);
}

/** Rohre, nach QDF-Elementart -- bisher nur das Bogenrohr ("round-tube2"). */
export function loadTubeMeshes(fine, options) {
  return loadLevel("tubes.json", fine, options);
}

/** Rutschen und Dächer, nach QDF-Elementart ("slide2", "roof2" ...). */
export function loadSlideMeshes(fine, options) {
  return loadLevel("slides.json", fine, options);
}

/** Anbauteile: Räder, Klemmen, Tücher, Bällebad ... nach QDF-Elementart. */
export function loadFittingMeshes(fine, options) {
  return loadLevel("fittings.json", fine, options);
}

/**
 * Flächen (Platten, Tücher). Der Schlüssel führt das Maßpaar aus der QDF-Zeile
 * mit: `panel2_350x150` = Feld 3 (lokale Y-Achse) x Feld 5 (lokale X-Achse).
 */
export function loadSurfaceMeshes(fine, options) {
  return loadLevel("surfaces.json", fine, options);
}
