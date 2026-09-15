const histories = new Map();
let activeKey = '';

function getActiveHistory() {
    if (!histories.has(activeKey)) {
        histories.set(activeKey, { undoStack: [], redoStack: [] });
    }
    return histories.get(activeKey);
}

export function activate(key) {
    activeKey = key || '';
    getActiveHistory();
}

export function record(action) {
    if (!action || typeof action.undo !== 'function' || typeof action.redo !== 'function') {
        throw new TypeError('History actions require undo and redo functions');
    }

    const history = getActiveHistory();
    history.undoStack.push(action);
    history.redoStack.length = 0;
}

export function undo() {
    const history = getActiveHistory();
    const action = history.undoStack.pop();
    if (!action) return false;

    action.undo();
    history.redoStack.push(action);
    return true;
}

export function redo() {
    const history = getActiveHistory();
    const action = history.redoStack.pop();
    if (!action) return false;

    if (action.redo() === false) {
        history.redoStack.push(action);
        return false;
    }
    history.undoStack.push(action);
    return true;
}

export function clear() {
    const history = getActiveHistory();
    history.undoStack.length = 0;
    history.redoStack.length = 0;
}

export function close(key) {
    histories.delete(key);
    if (activeKey === key) activeKey = '';
}

export function canUndo() {
    return getActiveHistory().undoStack.length > 0;
}

export function canRedo() {
    return getActiveHistory().redoStack.length > 0;
}
