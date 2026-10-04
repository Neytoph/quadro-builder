// Datei- und Sitzungsschicht: die "virtuellen Dateien" des Editors.
//
// Ein Dokument ist ein gespeichertes Modell mit Namen -- wie eine Datei auf der
// Platte, nur im Browser. Die offene Sitzung merkt sich, welche Dateien in Tabs
// liegen und wie weit darin gearbeitet wurde; damit übersteht auch ein noch
// nicht gespeicherter Stand einen Reload.
//
// Kein DOM, kein Three.js -- wie model.js in Node testbar. Der Speicher liegt in
// derselben IndexedDB wie die Modell-Sammlung (siehe storage.js).
//
// Mit Backend (sync.js) bleibt dieser Speicher der EINZIGE Arbeitsbestand; er
// ist dann zugleich vollständige Kopie des Servers. Dafür tragen die Datensätze
// drei zusätzliche Felder:
//
//   rev       Revision, aus der der Inhalt stammt (0 = dem Server unbekannt)
//   dirty     lokal geändert, noch nicht hochgeladen
//   deletedAt Grabstein: lokal gelöscht, der Server weiß es noch nicht
//
// Ohne Backend bleiben die Felder bedeutungslos und Löschen wirft den Datensatz
// wie bisher sofort weg.

import { dbTx, DB_STORES, listNames, loadNamed, loadAutosave, getAccountScope } from "./storage.js";

const MIGRATED_KEY = "quadro.migrated.v2";
const SESSION_ID = "current";

// Läuft ein Sync? Setzt sync.js beim Start. Nur davon hängt ab, ob eine
// Löschung einen Grabstein hinterlässt.
let syncMode = false;
export function setSyncMode(on) { syncMode = !!on; }

function id(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// --- Dateien ------------------------------------------------------------

/** Alle Dateien, zuletzt geänderte zuerst. Grabsteine bleiben außen vor. */
export function listDocs() {
  return allRecords()
    .then((rows) => rows.filter((d) => !d.deletedAt)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
}

/** Roh, mit Grabsteinen -- nur für den Abgleich in sync.js. */
export function allRecords() {
  return dbTx(DB_STORES.docs, "readonly", (store) => store.getAll())
    .then((rows) => rows || []);
}

export function getDoc(docId) {
  return dbTx(DB_STORES.docs, "readonly", (store) => store.get(docId))
    .then((doc) => (doc && doc.deletedAt ? null : doc));
}

/** Datensatz wirklich aus der Datenbank werfen (Grabstein abgearbeitet). */
export function dropDoc(docId) {
  return dbTx(DB_STORES.docs, "readwrite", (store) => store.delete(docId));
}

/**
 * Serverstand übernehmen: gilt ab sofort als abgeglichen. Ein Grabstein vom
 * Server bleibt Grabstein -- sonst stünde die anderswo gelöschte Datei ohne
 * Inhalt in der Liste.
 */
export function putRemoteDoc(record) {
  const doc = {
    id: record.id,
    name: record.name || "Unbenannt",
    data: record.deletedAt ? null : record.data,
    createdAt: record.createdAt || Date.now(),
    updatedAt: record.updatedAt || Date.now(),
    rev: record.rev || 0,
    dirty: false,
  };
  if (record.deletedAt) doc.deletedAt = record.deletedAt;
  return dbTx(DB_STORES.docs, "readwrite", (store) => store.put(doc)).then(() => doc);
}

/**
 * Nach erfolgreichem Hochladen: Revision merken, Marke löschen. Wurde in der
 * Zwischenzeit weitergearbeitet (`updatedAt` weicht ab), bleibt die Marke
 * stehen -- der nächste Abgleich schickt den neueren Stand hinterher.
 */
export function markDocSynced(docId, rev, expectUpdatedAt, sentCover) {
  return dbTx(DB_STORES.docs, "readonly", (store) => store.get(docId)).then((doc) => {
    if (!doc) return null;
    doc.rev = rev;
    if (expectUpdatedAt == null || doc.updatedAt === expectUpdatedAt) doc.dirty = false;
    // 交上去的封面就是现在记着的这张：交完不再带；推送途中换了新的，留着下次交
    if (sentCover && doc.cover === sentCover) delete doc.cover;
    if (doc.cover) doc.dirty = true;
    return dbTx(DB_STORES.docs, "readwrite", (store) => store.put(doc)).then(() => doc);
  });
}

/** Datei mit diesem Namen suchen (für die Rückfrage beim Überschreiben). */
export function docByName(name) {
  const gesucht = (name || "").trim().toLowerCase();
  return listDocs().then((rows) => rows.find((d) => d.name.trim().toLowerCase() === gesucht) || null);
}

/**
 * Datei anlegen oder überschreiben. Ohne `docId` entsteht eine neue Datei.
 * Liefert den gespeicherten Datensatz zurück.
 */
export function saveDoc({ docId, name, data }) {
  const jetzt = Date.now();
  const savedId = docId || id("d");
  // Read and write in one transaction so concurrent saves receive distinct versions.
  return dbTx(DB_STORES.docs, "readwrite", (store) => {
    const doc = {};
    const request = store.get(savedId);
    request.onsuccess = () => {
      const alt = request.result?.deletedAt ? null : request.result;
      Object.assign(doc, {
        id: savedId,
        name: (name || alt?.name || "").trim() || "Unbenannt",
        data,
        createdAt: alt?.createdAt || jetzt,
        updatedAt: Math.max(jetzt, (alt?.updatedAt || 0) + 1),
        rev: alt?.rev || 0,
        dirty: true,
      });
      if (alt?.cover) doc.cover = alt.cover;
      store.put(doc);
    };
    return doc;
  });
}

/**
 * 给这份存档记一张封面（图片的 data URL），下一次同步时跟着交上去，交成功就清掉。
 * 批量导入 .qdf 用它：「我的设计」和发到广场的方案要有这一座的画面。
 */
export function setDocCover(docId, cover, expectUpdatedAt) {
  return dbTx(DB_STORES.docs, "readwrite", (store) => {
    const request = store.get(docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (!doc || doc.deletedAt || (expectUpdatedAt != null && doc.updatedAt !== expectUpdatedAt)) return;
      doc.cover = cover;
      doc.updatedAt = Math.max(Date.now(), (doc.updatedAt || 0) + 1);
      doc.dirty = true;
      store.put(doc);
    };
    return request;
  });
}

export function renameDoc(docId, name) {
  return getDoc(docId).then((doc) => {
    if (!doc) return null;
    doc.name = (name || "").trim() || doc.name;
    doc.updatedAt = Math.max(Date.now(), (doc.updatedAt || 0) + 1);
    doc.dirty = true;
    return dbTx(DB_STORES.docs, "readwrite", (store) => store.put(doc)).then(() => doc);
  });
}

/**
 * Löschen. Mit Sync bleibt ein Grabstein liegen, bis der Server die Löschung
 * übernommen hat -- sonst käme die Datei beim nächsten Abgleich zurück.
 */
export function removeDoc(docId) {
  if (!syncMode) return dropDoc(docId);
  return dbTx(DB_STORES.docs, "readonly", (store) => store.get(docId)).then((doc) => {
    if (!doc) return null;
    if (!doc.rev) return dropDoc(docId);      // war nie auf dem Server
    return dbTx(DB_STORES.docs, "readwrite",
      (store) => store.put({ ...doc, data: null, deletedAt: Date.now(), dirty: true }));
  });
}

// --- Sitzung ------------------------------------------------------------
// Ein einziger Datensatz: die Liste der offenen Tabs samt Arbeitsstand und der
// gerade aktive Tab. Geschrieben wird sie nach jeder Änderung (entprellt in
// ui.js), gelesen genau einmal beim Start.

export function loadSession() {
  return dbTx(DB_STORES.session, "readonly", (store) => store.get(SESSION_ID))
    .then((row) => (row && Array.isArray(row.tabs) ? row : null));
}

export function saveSession({ tabs, activeTabId }) {
  return dbTx(DB_STORES.session, "readwrite",
    (store) => store.put({ id: SESSION_ID, tabs, activeTabId, savedAt: Date.now() }));
}

export function newTabId() {
  return id("t");
}

// --- Migration ----------------------------------------------------------

/**
 * Alter Stand (benannte Entwürfe + Autosave in localStorage) wird einmalig zu
 * Dateien. Die alten Schlüssel bleiben liegen -- geht etwas schief, ist nichts
 * verloren. Liefert die Zahl der übernommenen Dateien.
 */
export function migrateOldDrafts() {
  // 旧库没有可靠归属。仅本地版自动迁移；账户库保留空白，旧文件可由用户明确导入。
  if (getAccountScope() !== "local") return Promise.resolve(0);
  if (localStorage.getItem(MIGRATED_KEY)) return Promise.resolve(0);
  let uebernommen = 0;
  const arbeit = [];
  for (const name of listNames()) {
    const data = loadNamed(name);
    if (data) { arbeit.push(saveDoc({ name, data })); uebernommen++; }
  }
  const auto = loadAutosave();
  if (auto && Array.isArray(auto.nodes) && auto.nodes.length) {
    arbeit.push(saveDoc({ name: "Unbenannt", data: auto }));
    uebernommen++;
  }
  return Promise.all(arbeit).then(() => {
    localStorage.setItem(MIGRATED_KEY, String(Date.now()));
    return uebernommen;
  });
}
