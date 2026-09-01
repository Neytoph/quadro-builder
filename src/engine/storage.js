// Speicher-Layer: IndexedDB (Modelle, Sitzung, Sammlung) + Datei Export/Import.
// Bewusst gekapselt: ein späteres Django-Backend ersetzt nur dieses Modul und
// docs.js (z. B. saveDoc -> POST /api/models, listDocs -> GET /api/models).
//
// Die drei Funktionen zum alten localStorage-Stand (autosave + benannte
// Entwürfe) bleiben nur als LESEZUGRIFF für die einmalige Übernahme in
// docs.migrateOldDrafts() stehen.

import { AUTOSAVE_KEY } from "./config.js";

const INDEX_KEY = "quadro.designs.index.v1";
const PREFIX = "quadro.design.v1.";



/** Alter Autosave-Stand (nur noch für die Übernahme). */
export function loadAutosave() {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Namen der alten Entwürfe (nur noch für die Übernahme). */
export function listNames() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}


/** Alten Entwurf lesen (nur noch für die Übernahme). */
export function loadNamed(name) {
  const raw = localStorage.getItem(PREFIX + name);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}


// --- Modell-Bibliothek (IndexedDB) --------------------------------------
// Die Bibliothek nimmt ganze QDF-Ordner auf (die Beispielsammlung der
// Herstellersoftware sind ~235 Dateien, zusammen gut 3 MB). Das sprengt
// localStorage, das sich die 5 MB mit Autosave und Entwuerfen teilt -- deshalb
// hier IndexedDB. Gespeichert wird der QDF-Text im Original plus die beim
// Einlesen berechneten Kennzahlen; geparst wird erst beim Oeffnen.

const LIB_DB = "quadro.library.v1";
const LIB_STORE = "designs";
// Version 2 bringt zwei weitere Speicher in dieselbe Datenbank: die eigenen
// Modelle ("docs", je Datei ein Eintrag) und die offene Sitzung ("session",
// ein einziger Eintrag mit allen Tabs samt Arbeitsstand). Beides gehört nicht
// in localStorage -- dort teilen sich alle Schlüssel 5 MB, und ein großes
// Modell wiegt schon gut 150 KB.
const DOC_STORE = "docs";
const SESSION_STORE = "session";

function openLib() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LIB_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LIB_STORE)) db.createObjectStore(LIB_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Transaktion auf einem beliebigen Speicher der Datenbank. */
export function dbTx(storeName, mode, fn) {
  return openLib().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const out = fn(tx.objectStore(storeName));
    tx.oncomplete = () => { db.close(); resolve(out && out.result !== undefined ? out.result : out); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

export const DB_STORES = { docs: DOC_STORE, session: SESSION_STORE };

function libTx(mode, fn) {
  return dbTx(LIB_STORE, mode, fn);
}

// Mit Backend (sync.js) ist dieser Speicher zugleich Kopie der Server-Sammlung:
// `rev`/`dirty`/`deletedAt` wie bei den Modellen (siehe docs.js), und `qdf` darf
// null sein -- dann liegen nur die Kennzahlen vor und der Text wird beim Oeffnen
// nachgeholt.
let syncMode = false;
export function setSyncMode(on) { syncMode = !!on; }

/** Eintraege ablegen (gleiche id ueberschreibt). Sie gelten als noch nicht hochgeladen. */
export function libPut(entries) {
  return libTx("readwrite", (store) => {
    for (const e of entries) store.put({ ...e, rev: e.rev || 0, dirty: true });
  });
}

/** Alle Eintraege, nach Namen sortiert. Grabsteine bleiben aussen vor. */
export function libAll() {
  return libAllRecords()
    .then((rows) => rows.filter((e) => !e.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name, "de")));
}

/** Roh, mit Grabsteinen -- nur fuer den Abgleich in sync.js. */
export function libAllRecords() {
  return libTx("readonly", (store) => store.getAll()).then((rows) => rows || []);
}

export function libGet(id) {
  return libTx("readonly", (store) => store.get(id));
}

/** Serverstand uebernehmen (Kennzahlen, Text folgt bei Bedarf). */
export function libPutRemote(entry) {
  return libTx("readwrite", (store) => store.put({ ...entry, dirty: false }));
}

export function libDrop(id) {
  return libTx("readwrite", (store) => store.delete(id));
}

/**
 * EINEN Eintrag entfernen -- wie `libClear`, nur fuer eine Zeile. Mit Sync
 * bleibt ein Grabstein liegen, bis der Server die Loeschung uebernommen hat;
 * ohne den kam der Eintrag beim naechsten Abgleich einfach wieder herunter
 * (`syncLibrary` haelt ein rein lokales Fehlen fuer "anderswo geloescht").
 */
export function libRemove(id) {
  if (!syncMode) return libDrop(id);
  return libGet(id).then((entry) => {
    if (!entry) return null;
    if (!entry.rev) return libDrop(id);        // war nie auf dem Server
    return libTx("readwrite",
      (store) => store.put({ ...entry, qdf: null, deletedAt: Date.now(), dirty: true }));
  });
}

/** Nachgeladenen QDF-Text im Cache ablegen. */
export function libSetQdf(id, qdf, rev) {
  return libGet(id).then((entry) => {
    if (!entry) return null;
    const updated = { ...entry, qdf, rev: rev || entry.rev || 0 };
    return libTx("readwrite", (store) => store.put(updated)).then(() => updated);
  });
}

export function libMarkSynced(id, rev) {
  return libGet(id).then((entry) => {
    if (!entry) return null;
    const updated = { ...entry, rev: rev || entry.rev || 0, dirty: false };
    return libTx("readwrite", (store) => store.put(updated)).then(() => updated);
  });
}

/**
 * Sammlung leeren. Mit Sync bleiben Grabsteine liegen, bis der Server die
 * Loeschung uebernommen hat -- sonst kaeme die Sammlung beim Abgleich zurueck.
 */
export function libClear() {
  if (!syncMode) return libTx("readwrite", (store) => store.clear());
  return libAllRecords().then((rows) => libTx("readwrite", (store) => {
    for (const e of rows) {
      if (!e.rev) store.delete(e.id);          // war nie auf dem Server
      else store.put({ ...e, qdf: null, deletedAt: Date.now(), dirty: true });
    }
  }));
}

// --- Bestand ------------------------------------------------------------
// Der eigene Teilebestand ist EIN kleiner Datensatz und bleibt deshalb in
// localStorage. Fuer den Abgleich braucht er dieselben Marken wie Modelle und
// Sammlung; sie stehen daneben in einem eigenen Schluessel.

const INV_KEY = "quadro.inventory.v1";
const INV_META_KEY = "quadro.inventory.meta.v1";   // { rev, dirty, updatedAt }

export function loadInventory() {
  try { return JSON.parse(localStorage.getItem(INV_KEY)) || null; }
  catch { return null; }
}

export function inventoryMeta() {
  try {
    const meta = JSON.parse(localStorage.getItem(INV_META_KEY)) || {};
    return { rev: meta.rev || 0, dirty: !!meta.dirty, updatedAt: meta.updatedAt || 0 };
  } catch { return { rev: 0, dirty: false, updatedAt: 0 }; }
}

function saveInventoryMeta(meta) {
  localStorage.setItem(INV_META_KEY, JSON.stringify(meta));
}

/** Bestand schreiben. Ohne Gegenrede gilt er als noch nicht hochgeladen. */
export function saveInventory(inv, { dirty = true, rev = null } = {}) {
  localStorage.setItem(INV_KEY, JSON.stringify(inv));
  const meta = inventoryMeta();
  saveInventoryMeta({
    rev: rev == null ? meta.rev : rev,
    dirty,
    updatedAt: Date.now(),
  });
}

/** Serverstand uebernehmen. */
export function putRemoteInventory(record) {
  localStorage.setItem(INV_KEY, JSON.stringify(record.data || {}));
  saveInventoryMeta({ rev: record.rev || 0, dirty: false, updatedAt: record.updatedAt || Date.now() });
  return record;
}

/** Nach dem Hochladen: Revision merken. Wurde inzwischen weitergearbeitet
 *  (`updatedAt` weicht ab), bleibt die Marke stehen. */
export function markInventorySynced(rev, expectUpdatedAt) {
  const meta = inventoryMeta();
  saveInventoryMeta({
    rev,
    dirty: expectUpdatedAt != null && meta.updatedAt !== expectUpdatedAt,
    updatedAt: meta.updatedAt,
  });
}

// --- Datei Export/Import (echte Offline-Sicherung) ----------------------
export function exportFile(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "quadro-entwurf.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Beliebigen Text als Datei anbieten (QDF-Export). */
export function exportText(text, filename, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); }
      catch (e) { reject(new Error("Datei ist kein gueltiges JSON")); }
    };
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
    reader.readAsText(file);
  });
}
