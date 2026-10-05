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

function saveLinkKey(docId, saveId) { return `models-save:${JSON.stringify([docId, saveId])}`; }

function putSaveLink(store, doc, baseRev = doc.rev) {
  if (doc.saveId) store.put({ id: saveLinkKey(doc.id, doc.saveId), parentSaveId: doc.parentSaveId, baseRev });
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
function remoteDoc(record) {
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
  if (record.saveId) doc.saveId = doc.syncedSaveId = record.saveId;
  return doc;
}

function applyRemote(store, record, result) {
  const request = store.get(record.id);
  request.onsuccess = () => {
    const current = request.result;
    if (current?.dirty) {
      if (record.rev > (current.rev || 0) && record.rev > (current.pendingRemote?.rev || 0)) {
        current.pendingRemote = record;
        store.put(current);
      }
      result.doc = current;
      return;
    }
    if (current && (current.rev || 0) >= record.rev) { result.doc = current; return; }
    result.doc = remoteDoc(record);
    if (current?.conflictCopies) result.doc.conflictCopies = current.conflictCopies;
    if (current?.legacyRecoveryId) result.doc.legacyRecoveryId = current.legacyRecoveryId;
    store.put(result.doc);
    result.applied = true;
  };
}

/** 在写事务当下保护本地修改；远端分歧留在同一账户库。 */
export function putRemoteDoc(record) {
  const result = {};
  return dbTx(DB_STORES.docs, "readwrite", store => { applyRemote(store, record, result); return result; })
    .then(() => result.doc);
}

export function readPullCheckpoint() {
  return dbTx(DB_STORES.sync, "readonly", store => store.get("models-pull"))
    .then(row => row?.rev || 0);
}

/** 响应内容及检查点一起提交；dirty 项的 pendingRemote 也先持久化。 */
export function applyRemoteBatch(items, rev) {
  const results = [];
  return dbTx([DB_STORES.docs, DB_STORES.sync], "readwrite", stores => {
    // 旧ACK到达后变为clean的分歧，即使已跨过checkpoint也继续处理。
    const pending = stores[DB_STORES.docs].getAll();
    pending.onsuccess = () => {
      const candidates = new Map(items.map(record => [record.id, record]));
      for (const doc of pending.result) {
        if (!doc.dirty && doc.pendingRemote?.rev > (doc.rev || 0)
          && doc.pendingRemote.rev > (candidates.get(doc.id)?.rev || 0)) candidates.set(doc.id, doc.pendingRemote);
      }
      for (const record of candidates.values()) {
        const result = {};
        results.push(result);
        applyRemote(stores[DB_STORES.docs], record, result);
      }
    };
    const checkpoint = stores[DB_STORES.sync].get("models-pull");
    checkpoint.onsuccess = () => stores[DB_STORES.sync].put({ id: "models-pull", rev: Math.max(rev, checkpoint.result?.rev || 0) });
    return results;
  }).then(() => results.filter(result => result.applied).length);
}

/**
 * Nach erfolgreichem Hochladen: Revision merken, Marke löschen. Wurde in der
 * Zwischenzeit weitergearbeitet (`updatedAt` weicht ab), bleibt die Marke
 * stehen -- der nächste Abgleich schickt den neueren Stand hinterher.
 */
export function markDocSynced(docId, rev, expectUpdatedAt, sentCover, expectSaveId, sentBaseRev) {
  const result = {};
  return dbTx([DB_STORES.docs, DB_STORES.sync], "readwrite", stores => {
    const store = stores[DB_STORES.docs];
    const links = stores[DB_STORES.sync];
    const request = store.get(docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (!doc) return;
      const sameSave = typeof expectSaveId === "string" ? doc.saveId === expectSaveId : typeof expectUpdatedAt !== "number" || doc.updatedAt === expectUpdatedAt;
      if (!sameSave) {
        // 同一本地分支在等待回执时又保存：只推进已确认的基线，保留新内容及dirty。
        if (typeof expectSaveId === "string" && typeof sentBaseRev === "number"
          && doc.rev === sentBaseRev && !doc.pendingRemote) {
          const seen = new Set();
          const follow = parent => {
            if (!parent || seen.has(parent)) return;
            if (parent === expectSaveId) {
              doc.rev = Math.max(rev, doc.rev || 0);
              store.put(doc);
              putSaveLink(links, doc);
              return;
            }
            seen.add(parent);
            const link = links.get(saveLinkKey(doc.id, parent));
            link.onsuccess = () => {
              if (link.result?.baseRev === sentBaseRev) follow(link.result.parentSaveId);
            };
          };
          follow(doc.parentSaveId);
        }
        result.doc = doc;
        return;
      }
      doc.rev = Math.max(rev, doc.rev || 0);
      if (expectSaveId) doc.syncedSaveId = expectSaveId;
      if (expectUpdatedAt == null || doc.updatedAt === expectUpdatedAt) doc.dirty = false;
      // 交上去的封面就是现在记着的这张：交完不再带；推送途中换了新的，留着下次交
      if (sentCover && doc.cover === sentCover) delete doc.cover;
      if (doc.cover) doc.dirty = true;
      if (doc.pendingRemote?.rev <= rev) delete doc.pendingRemote;
      result.doc = doc;
      store.put(doc);
      putSaveLink(links, doc);
    };
    return result;
  }).then(() => result.doc || null);
}

/** PUT 等待期间的最新保存和发送快照都在同一事务内保全。 */
export function resolveDocConflict(sent, remote, authoritativeLegacy = false) {
  const result = { copies: {} };
  return dbTx(DB_STORES.docs, "readwrite", store => {
    const request = store.get(sent.id);
    request.onsuccess = () => {
      const current = request.result;
      const copies = { ...(current?.conflictCopies || {}) };
      let candidates = [sent];
      if (current?.dirty) candidates = current.saveId === sent.saveId ? [current] : [sent, current];
      for (const candidate of candidates) {
        const key = candidate.saveId || `legacy:${candidate.updatedAt}`;
        if (copies[key]) { result.copies[key] = copies[key]; continue; }
        const copyId = id("d");
        const copy = { ...candidate, id: copyId, saveId: candidate.saveId || id("s"), name: `${candidate.name}（冲突副本）`,
          data: candidate.data ?? candidate.recoveryData, rev: 0, dirty: true };
        delete copy.deletedAt;
        delete copy.syncedSaveId;
        delete copy.pendingRemote;
        delete copy.conflictCopies;
        delete copy.parentSaveId;
        store.put(copy);
        copies[key] = copyId;
        result.copies[key] = copyId;
      }
      if (current?.dirty && current.saveId === sent.saveId) {
        const sentKey = sent.saveId || `legacy:${sent.updatedAt}`;
        const latestKey = current.saveId || `legacy:${current.updatedAt}`;
        copies[sentKey] = result.copies[sentKey] = copies[latestKey];
      }
      result.copyId = copies[sent.saveId || `legacy:${sent.updatedAt}`];
      // 新的本地保存已保全为副本；接受的远端不冒充本次保存回执。
      const latestRemote = current?.pendingRemote?.rev > remote.rev ? current.pendingRemote : remote;
      const legacyRecoveryId = authoritativeLegacy && current?.dirty && !current.saveId
        ? copies[`legacy:${current.updatedAt}`] : current?.legacyRecoveryId;
      if (!current || current.dirty && authoritativeLegacy || (current.rev || 0) <= latestRemote.rev) store.put({ ...remoteDoc(latestRemote), conflictCopies: copies,
        ...(legacyRecoveryId ? { legacyRecoveryId } : {}) });
      else store.put({ ...current, conflictCopies: copies });
    };
    return result;
  });
}

/** 历史dirty基线不可信；先留可恢复副本及幂等定位，等待云端核对。 */
export function protectLegacyDoc(sent) {
  const result = {};
  return dbTx(DB_STORES.docs, "readwrite", store => {
    const request = store.get(sent.id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current?.dirty || current.saveId || !(current.rev > 0)) return;
      const key = `legacy:${current.updatedAt}`;
      const copies = { ...(current.conflictCopies || {}) };
      if (!copies[key]) {
        const copy = { ...current, id: id("d"), saveId: id("s"), name: `${current.name}（冲突副本）`,
          data: current.data ?? current.recoveryData, rev: 0, dirty: true };
        delete copy.deletedAt;
        delete copy.syncedSaveId;
        delete copy.pendingRemote;
        delete copy.conflictCopies;
        delete copy.parentSaveId;
        store.put(copy);
        copies[key] = copy.id;
        store.put({ ...current, conflictCopies: copies, legacyRecoveryId: copies[key] });
      }
      if (!current.legacyRecoveryId && copies[key]) store.put({ ...current, conflictCopies: copies, legacyRecoveryId: copies[key] });
      result.local = current;
      result.copyId = copies[key];
    };
    return result;
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
 * @param {{docId?: string | null, name: string, data: unknown, baseRev?: number | null, parentSaveId?: string}} options
 */
export function saveDoc({ docId, name, data, baseRev = null, parentSaveId }) {
  const jetzt = Date.now();
  const savedId = docId || id("d");
  // Read and write in one transaction so concurrent saves receive distinct versions.
  return dbTx([DB_STORES.docs, DB_STORES.sync], "readwrite", (stores) => {
    const store = stores[DB_STORES.docs];
    const doc = {};
    const request = store.get(savedId);
    request.onsuccess = () => {
      const alt = request.result?.deletedAt ? null : request.result;
      const confirmedParent = typeof parentSaveId === "string" && alt?.saveId === parentSaveId
        && alt.syncedSaveId === parentSaveId && !alt.pendingRemote;
      let rev = typeof baseRev === "number" ? baseRev : alt?.rev || 0;
      if (confirmedParent) rev = Math.max(rev, alt.rev || 0);
      Object.assign(doc, {
        id: savedId,
        name: (name || alt?.name || "").trim() || "Unbenannt",
        data,
        createdAt: alt?.createdAt || jetzt,
        updatedAt: Math.max(jetzt, (alt?.updatedAt || 0) + 1),
        rev,
        saveId: id("s"),
        ...(parentSaveId ? { parentSaveId } : {}),
        dirty: true,
      });
      if (alt?.conflictCopies) doc.conflictCopies = alt.conflictCopies;
      if (alt?.legacyRecoveryId) doc.legacyRecoveryId = alt.legacyRecoveryId;
      if (typeof baseRev !== "number" && alt?.cover) doc.cover = alt.cover;
      if (alt?.pendingRemote) doc.pendingRemote = alt.pendingRemote;
      if (alt && !alt.dirty && (alt.rev || 0) > doc.rev) doc.pendingRemote = alt;
      store.put(doc);
      putSaveLink(stores[DB_STORES.sync], doc);
    };
    return doc;
  });
}

/**
 * 给这份存档记一张封面（图片的 data URL），下一次同步时跟着交上去，交成功就清掉。
 * 批量导入 .qdf 用它：「我的设计」和发到广场的方案要有这一座的画面。
 */
export function setDocCover(docId, cover, expectUpdatedAt, expectSaveId) {
  return dbTx(DB_STORES.docs, "readwrite", (store) => {
    const request = store.get(docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (!doc || doc.deletedAt || (typeof expectSaveId === "string" ? doc.saveId !== expectSaveId : typeof expectUpdatedAt === "number" && doc.updatedAt !== expectUpdatedAt)) return;
      if (!doc.saveId && !doc.dirty) doc.saveId = id("s");
      doc.cover = cover;
      doc.updatedAt = Math.max(Date.now(), (doc.updatedAt || 0) + 1);
      doc.dirty = true;
      store.put(doc);
    };
    return request;
  });
}

export function renameDoc(docId, name) {
  const result = {};
  return dbTx(DB_STORES.docs, "readwrite", store => {
    const request = store.get(docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (!doc || doc.deletedAt) return;
      if (!doc.saveId && !doc.dirty) doc.saveId = id("s");
      doc.name = (name || "").trim() || doc.name;
      doc.updatedAt = Math.max(Date.now(), (doc.updatedAt || 0) + 1);
      doc.dirty = true;
      result.doc = doc;
      store.put(doc);
    };
    return result;
  }).then(() => result.doc || null);
}

/**
 * Löschen. Mit Sync bleibt ein Grabstein liegen, bis der Server die Löschung
 * übernommen hat -- sonst käme die Datei beim nächsten Abgleich zurück.
 */
export function removeDoc(docId) {
  if (!syncMode) return dropDoc(docId);
  return dbTx(DB_STORES.docs, "readwrite", store => {
    const request = store.get(docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (!doc || doc.deletedAt) return;
      if (!doc.rev) { store.delete(docId); return; }
      store.put({ ...doc, data: null, recoveryData: doc.data, deletedAt: Date.now(),
        updatedAt: Math.max(Date.now(), (doc.updatedAt || 0) + 1), saveId: id("s"), dirty: true });
    };
    return request;
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
