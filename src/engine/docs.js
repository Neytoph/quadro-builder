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

function isLegacyUnverified(doc) {
  return Boolean(doc && (doc.legacyPending || doc.dirty && !doc.saveId && doc.rev > 0));
}

function contentJSON(data) {
  return JSON.stringify(data, (_key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  });
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
    if (current?.legacyDeletionAt) result.doc.legacyDeletionAt = current.legacyDeletionAt;
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

export function pendingStats() {
  return dbTx(DB_STORES.sync, "readonly", store => store.getAll())
    .then(rows => rows.filter(row => row.id.startsWith('models-stats:')));
}

/** 发布冷存档也需要真实统计回执；核对模型与登记待补在同一事务完成。 */
export function queueStats(task) {
  const result = { queued: false };
  return dbTx([DB_STORES.docs, DB_STORES.sync], "readwrite", stores => {
    const request = stores[DB_STORES.docs].get(task.docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (!doc || doc.deletedAt || doc.legacyPending || doc.pendingRemote || doc.dirty
        || doc.rev !== task.rev || doc.saveId !== task.saveId || contentJSON(doc.data) !== contentJSON(task.data)) return;
      const pending = stores[DB_STORES.sync].get(task.id);
      pending.onsuccess = () => {
        const previous = pending.result;
        const same = previous?.rev === task.rev && previous.saveId === task.saveId
          && previous.engineVersion === task.engineVersion && contentJSON(previous.data) === contentJSON(task.data);
        stores[DB_STORES.sync].put(same ? { ...previous, retryAt: undefined, error: undefined } : task);
        result.queued = true;
      };
    };
    return result;
  });
}

/** 只更新同一个统计版本；晚到的旧回执不能清掉较新待补。 */
/** @param {object | null} [patch] */
export function settleStats(task, patch = null) {
  return dbTx(DB_STORES.sync, "readwrite", store => {
    const request = store.get(task.id);
    request.onsuccess = () => {
      const current = request.result;
      if (!current || current.rev !== task.rev || current.saveId !== task.saveId || current.engineVersion !== task.engineVersion
        || contentJSON(current.data) !== contentJSON(task.data)) return;
      if (patch) store.put({ ...current, ...patch });
      else store.delete(task.id);
    };
    return request;
  });
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
/**
 * @param {string} docId
 * @param {number} rev
 * @param {number | undefined} [expectUpdatedAt]
 * @param {string | undefined} [sentCover]
 * @param {string | undefined} [expectSaveId]
 * @param {number | undefined} [sentBaseRev]
 * @param {object | null} [pendingStats] 独立统计待补快照，与模型回执原子落盘。
 */
export function markDocSynced(docId, rev, expectUpdatedAt, sentCover, expectSaveId, sentBaseRev, pendingStats = null) {
  const result = {};
  return dbTx([DB_STORES.docs, DB_STORES.sync], "readwrite", stores => {
    const store = stores[DB_STORES.docs];
    const links = stores[DB_STORES.sync];
    const request = store.get(docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (!doc) return;
      if (pendingStats) {
        const statsRequest = links.get(`models-stats:${docId}`);
        statsRequest.onsuccess = () => {
          if (!statsRequest.result || statsRequest.result.rev <= rev) links.put({ ...pendingStats, id: `models-stats:${docId}` });
        };
      }
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
function hasRecoverableData(record) {
  const data = record.data ?? record.recoveryData;
  return data !== null && data !== undefined;
}

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
        // 旧 removeDoc 丢弃了 data，不能把该删除意图伪装成可上传空模型。
        if (candidate.deletedAt && !hasRecoverableData(candidate)) continue;
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
        delete copy.legacyPending;
        delete copy.legacyRecoveryId;
        store.put(copy);
        copies[key] = copyId;
        result.copies[key] = copyId;
      }
      if (current?.dirty && current.saveId === sent.saveId) {
        const sentKey = sent.saveId || `legacy:${sent.updatedAt}`;
        const latestKey = current.saveId || `legacy:${current.updatedAt}`;
        if (copies[latestKey]) copies[sentKey] = result.copies[sentKey] = copies[latestKey];
      }
      result.copyId = copies[sent.saveId || `legacy:${sent.updatedAt}`];
      // 新的本地保存已保全为副本；接受的远端不冒充本次保存回执。
      const latestRemote = current?.pendingRemote?.rev > remote.rev ? current.pendingRemote : remote;
      const legacyRecoveryId = authoritativeLegacy && current?.dirty && !current.saveId
        ? copies[`legacy:${current.updatedAt}`] : current?.legacyRecoveryId;
      const legacyDeletionAt = authoritativeLegacy && sent.deletedAt && !hasRecoverableData(sent)
        ? sent.deletedAt : current?.legacyDeletionAt;
      if (!current || current.dirty && authoritativeLegacy || (current.rev || 0) <= latestRemote.rev) store.put({ ...remoteDoc(latestRemote), conflictCopies: copies,
        ...(legacyRecoveryId ? { legacyRecoveryId } : {}), ...(legacyDeletionAt ? { legacyDeletionAt } : {}) });
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
      if (!isLegacyUnverified(current)) return;
      if (current.deletedAt && !hasRecoverableData(current)) {
        store.put({ ...current, legacyPending: true });
        result.local = current;
        return;
      }
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
        delete copy.legacyPending;
        delete copy.legacyRecoveryId;
        store.put(copy);
        copies[key] = copy.id;
        store.put({ ...current, conflictCopies: copies, legacyRecoveryId: copies[key], legacyPending: true });
      }
      if (copies[key]) store.put({ ...current, conflictCopies: copies, legacyRecoveryId: copies[key], legacyPending: true });
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
 * @param {{docId?: string | null, name: string, data: unknown, baseRev?: number | null, parentSaveId?: string, baseContent?: string}} options
 */
export function saveDoc({ docId, name, data, baseRev = null, parentSaveId, baseContent }) {
  const jetzt = Date.now();
  const savedId = docId || id("d");
  // Read and write in one transaction so concurrent saves receive distinct versions.
  return dbTx([DB_STORES.docs, DB_STORES.sync], "readwrite", (stores) => {
    const store = stores[DB_STORES.docs];
    const doc = {};
    const request = store.get(savedId);
    const writeSaved = (previous, targetId, redirected = false) => {
      const alt = previous?.deletedAt ? null : previous;
      const confirmedParent = typeof parentSaveId === "string" && alt?.saveId === parentSaveId
        && alt.syncedSaveId === parentSaveId && !alt.pendingRemote;
      const actualParent = parentSaveId && (!redirected || alt?.saveId === parentSaveId);
      let rev = alt?.rev || 0;
      if (!redirected && typeof baseRev === "number") rev = baseRev;
      if (confirmedParent) rev = Math.max(rev, alt.rev || 0);
      Object.assign(doc, {
        id: targetId,
        name: (name || alt?.name || "").trim() || "Unbenannt",
        data,
        createdAt: alt?.createdAt || jetzt,
        updatedAt: Math.max(jetzt, (alt?.updatedAt || 0) + 1),
        rev,
        saveId: id("s"),
        ...(actualParent ? { parentSaveId } : {}),
        dirty: true,
      });
      if (alt?.conflictCopies) doc.conflictCopies = alt.conflictCopies;
      if (alt?.legacyRecoveryId) doc.legacyRecoveryId = alt.legacyRecoveryId;
      if ((redirected || typeof baseRev !== "number") && alt?.cover && contentJSON(alt.data) === contentJSON(data)) doc.cover = alt.cover;
      if (alt?.pendingRemote) doc.pendingRemote = alt.pendingRemote;
      if (alt && !alt.dirty && (alt.rev || 0) > doc.rev) doc.pendingRemote = alt;
      store.put(doc);
      putSaveLink(stores[DB_STORES.sync], doc);
    };
    request.onsuccess = () => {
      const original = request.result;
      const explicitParent = typeof parentSaveId === "string" && original?.saveId === parentSaveId;
      const verifiedContent = typeof baseRev === "number" && baseRev === original?.rev
        && typeof baseContent === "string" && baseContent === contentJSON(original?.data);
      const staleRecoveryBinding = original?.legacyRecoveryId && !explicitParent && !verifiedContent;
      if (!isLegacyUnverified(original) && !staleRecoveryBinding) { writeSaved(original, savedId); return; }
      // 未核对历史记录的原 ID 永远只等待 GET；手动保存也不能洗掉保护。
      const copyId = original.legacyRecoveryId || id("d");
      const copies = { ...(original.conflictCopies || {}), [`legacy:${original.updatedAt}`]: copyId };
      store.put({ ...original, ...(isLegacyUnverified(original) ? { dirty: true, legacyPending: true } : {}),
        legacyRecoveryId: copyId, conflictCopies: copies });
      const copyRequest = store.get(copyId);
      copyRequest.onsuccess = () => {
        const existing = copyRequest.result;
        const copy = existing || { createdAt: jetzt, rev: 0, data: original.data ?? original.recoveryData, cover: original.cover };
        const copyContent = contentJSON(copy.data);
        const originalContent = contentJSON(original.data ?? original.recoveryData);
        const distinctWork = existing && !existing.deletedAt && copyContent !== contentJSON(data) && copyContent !== originalContent
          && parentSaveId !== existing.saveId && baseContent !== copyContent;
        if (distinctWork) {
          // 另一标签已编辑恢复copy；没有父保存/基线证明时保全它，另存当前工作。
          const nextId = id("d");
          copies[`legacy:${original.updatedAt}`] = nextId;
          store.put({ ...original, ...(isLegacyUnverified(original) ? { dirty: true, legacyPending: true } : {}),
            legacyRecoveryId: nextId, conflictCopies: copies });
          writeSaved(null, nextId, true);
          return;
        }
        writeSaved(copy, copyId, true);
      };
    };
    return doc;
  });
}

/**
 * 给这份存档记一张封面（图片的 data URL），下一次同步时跟着交上去，交成功就清掉。
 * 批量导入 .qdf 用它：「我的设计」和发到广场的方案要有这一座的画面。
 */
export function setDocCover(docId, cover, expectUpdatedAt, expectSaveId, requireExactVersion = false) {
  let applied = false;
  return dbTx(DB_STORES.docs, "readwrite", (store) => {
    const request = store.get(docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (!doc || doc.deletedAt || (typeof expectSaveId === "string" ? doc.saveId !== expectSaveId : typeof expectUpdatedAt === "number" && doc.updatedAt !== expectUpdatedAt)) return;
      if (requireExactVersion && doc.updatedAt !== expectUpdatedAt) return;
      if (isLegacyUnverified(doc)) doc.legacyPending = true;
      if (!doc.saveId && !doc.dirty) doc.saveId = id("s");
      doc.cover = cover;
      doc.updatedAt = Math.max(Date.now(), (doc.updatedAt || 0) + 1);
      doc.dirty = true;
      store.put(doc);
      applied = true;
    };
    return request;
  }).then(doc => requireExactVersion && !applied ? null : doc);
}

export function renameDoc(docId, name) {
  const result = {};
  return dbTx(DB_STORES.docs, "readwrite", store => {
    const request = store.get(docId);
    request.onsuccess = () => {
      const doc = request.result;
      if (!doc || doc.deletedAt) return;
      if (isLegacyUnverified(doc)) doc.legacyPending = true;
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
      const legacyPending = isLegacyUnverified(doc);
      store.put({ ...doc, data: null, recoveryData: doc.data, deletedAt: Date.now(),
        updatedAt: Math.max(Date.now(), (doc.updatedAt || 0) + 1),
        ...(legacyPending ? { legacyPending: true } : { saveId: id("s") }), dirty: true });
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
