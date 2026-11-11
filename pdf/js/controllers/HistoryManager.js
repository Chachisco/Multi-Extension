export class HistoryManager {
    constructor(maxHistory = 50) {
        this.maxHistory = maxHistory;
        this.undoStack = [];
        this.redoStack = [];
    }

    record(action) {
        if (!action || typeof action.undo !== 'function' || typeof action.redo !== 'function') {
            throw new TypeError('As ações de histórico exigem métodos undo() e redo().');
        }

        this.undoStack.push(action);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.redoStack.length = 0; // clear redo stack on new action
    }

    async undo() {
        const action = this.undoStack[this.undoStack.length - 1];
        if (!action) return false;
        await action.undo();
        this.undoStack.pop();
        this.redoStack.push(action);
        return true;
    }

    async redo() {
        const action = this.redoStack[this.redoStack.length - 1];
        if (!action) return false;
        if (await action.redo() === false) {
            return false;
        }
        this.redoStack.pop();
        this.undoStack.push(action);
        return true;
    }

    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }
    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }
}