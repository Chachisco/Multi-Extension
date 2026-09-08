export const state = {
    pdfDoc: null,
    currentFilename: '',
    currentScale: 1,
    headerMode: 'minimal',
    annotationActive: false,
    eraserActive: false,
    currentAnnotationMode: 'highlight',
    currentAnnotationColor: '#ffeb3b',
    currentAnnotationSize: 4,
    renderTasks: {},
    renderingStates: {},
    textLayerTasks: {},
    annotationHistory: [],
    annotationLoadVersions: {},
    pendingAnnotationRemovals: new Map()
};