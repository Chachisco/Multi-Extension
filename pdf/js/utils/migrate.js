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