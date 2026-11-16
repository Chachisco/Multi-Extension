export async function migrateLegacyStorage(storageAdapter) {
    const all = await storageAdapter.getAll();
    const updates = {};

    for (const [key, val] of Object.entries(all)) {
        if (!key.endsWith('_bookmarks') || !Array.isArray(val)) continue;

        const pageNum = Number(key.match(/_pg(\d+)_bookmarks$/)?.[1]);
        if (!Number.isInteger(pageNum) || pageNum < 1) continue;

        const realBookmarks = [];
        const normalizedBookmarks = [];
        val.forEach((item, index) => {
            if (!item || (item.type && item.type !== 'bookmark')) return;
            const bookmark = {
                ...item,
                id: item.id || `legacy-bookmark-${pageNum}-${index}`,
                type: 'bookmark'
            };
            realBookmarks.push(bookmark);
            normalizedBookmarks.push(bookmark);
        });
        const manualFigures = val.filter(item => item?.type && item.type !== 'bookmark');

        if (manualFigures.length > 0) {
            const elementsKey = key.replace(/_bookmarks$/, '_elements');
            const existing = Array.isArray(all[elementsKey]) ? all[elementsKey] : [];
            const migratedFigures = manualFigures.map((fig, index) => ({
                id: fig.id || `legacy-element-${pageNum}-${index}`,
                type: fig.type,
                fullText: fig.fullText || fig.title || '',
                isManual: true,
                y: fig.y,
                x: fig.x ?? 0
            }));
            const existingIds = new Set(existing.map(item => item.id).filter(Boolean));
            const additions = migratedFigures.filter(item => !existingIds.has(item.id));
            if (additions.length > 0) updates[elementsKey] = [...existing, ...additions];
        }

        if (normalizedBookmarks.some((item, index) =>
            item.id !== val[index]?.id || val[index]?.type !== 'bookmark'
        ) || realBookmarks.length !== val.length) {
            updates[key] = realBookmarks;
        }
    }

    if (Object.keys(updates).length > 0) {
        await storageAdapter.setMultiple(updates);
    }
}

/**
 * Migrates extension data from a path-based key to a document ID.
 * @param {StorageAdapter} storageAdapter
 * @param {string} oldPath - Previous path-based storage key
 * @param {string} documentId - Document ID
 */
export async function migratePathToDocumentId(storageAdapter, oldPath, documentId) {
    if (!documentId || !oldPath || oldPath === documentId) return;

    const all = await storageAdapter.getAll();
    const newPrefix = `${documentId}_pg`;
    const oldPrefixPath = `${oldPath}_pg`;
    const keysToMigrate = Object.keys(all).filter(k => k.startsWith(oldPrefixPath));

    const updates = {};
    const keysToDelete = [];

    keysToMigrate.forEach(oldKey => {
        const suffix = oldKey.substring(oldPrefixPath.length);
        const newKey = `${newPrefix}${suffix}`;
        if (suffix && !Object.hasOwn(all, newKey)) {
            updates[newKey] = all[oldKey];
            keysToDelete.push(oldKey);
        }
    });

    for (const [oldKey, newKey] of [
        [oldPath, documentId],
        [`${oldPath}_zoom`, `${documentId}_zoom`],
        [`${oldPath}_rotation`, `${documentId}_rotation`]
    ]) {
        if (Object.hasOwn(all, oldKey) && !Object.hasOwn(all, newKey)) {
            updates[newKey] = all[oldKey];
            keysToDelete.push(oldKey);
        }
    }

    if (Object.keys(updates).length > 0) {
        await storageAdapter.setMultiple(updates);
        await storageAdapter.removeMultiple(keysToDelete);
        console.log(`[Migração] Migradas com sucesso ${Object.keys(updates).length} chaves para o ID: ${documentId}`);
    }
}
