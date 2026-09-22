# PDF Viewer & Web Search

An extension that combines a custom PDF viewer and editor and a multi-track web search engine.

## Core Features

### 📄 PDF Viewer

A custom PDF reader built on top of `pdf.js` and `pdf-lib`.

* **Header UI Modes:**
  * `Ghost Mode`: The top bar becomes transparent and disappears when idle. Shows the page counter or active tool on hover.
  * `Minimal Mode`: Hides the entire toolbar when idle.
  * `Fixed Mode`: The toolbar remains permanently visible.
* **Page Management:**
  * **Reorder:** Drag and drop pages in the thumbnail sidebar to change their order.
  * **Edit:** Rotate (90º increments) or delete individual pages.
  * **Merge:** Insert external PDFs into the current document at a specific page index (or append to the end).
* **Sidebar Navigation:** Switch between the native PDF Outline (Table of Contents) and Page Thumbnails. The sidebar can be docked to the left or right side of the screen.
* **Focus Mode:** A reading ruler with two visual modes (`Lantern` and `Line`) that tracks the mouse position. The focus area size is adjustable.
* **Annotation & Drawing Tools:**
  * Highlight and underline text.
  * Freehand drawing tool.
  * Color and thickness customization.
  * Universal eraser for both text highlights and freehand drawings.
  * **History:** Undo (`Ctrl+Z`) and Redo (`Ctrl+Y`) support for all annotations and drawings.
* **Interactive Sticky Notes:**
  * Create notes anywhere on the document.
  * **Drag & Drop:** Click and hold to move notes across the page.
  * **Pinning & Locking:** Pin notes to keep them open, or lock them to prevent accidental edits/deletion.
  * **Notes Sidebar:** A visual tracking bar displays markers for every note relative to the document's height. Clicking a marker scrolls to that page.
* **Export & Save Options:**
  * `Save`: Downloads the PDF with its current page structure (reordered/rotated/deleted pages).
  * `Save As`: Downloads a copy of the updated PDF structure.
  * `Burn-in Notes`: Embeds all highlights, vector drawings, and sticky notes natively into the PDF file so they are visible in standard PDF readers.
  * `Save & Copy Notes`: Creates a new PDF file and automatically migrates the extension's local database notes to the new filename.
* **OS-Aware Path Copying:** Copies the local path of the PDF. Click for Windows paths; Right-Click for Linux/WSL paths.

### 🔍 Web Search (Global & PDF)

A search tool that works inside the PDF Viewer and on standard websites.

* **Multi-Row Searching:** Search for multiple distinct terms simultaneously, assigning a unique highlight color to each term.
* **Non-Blocking Engine:** Uses `requestAnimationFrame` and time-chunking to process large documents without freezing the browser's main thread.
* **Advanced Filters:** Per-row toggles for `Match Case` (Aa), `Whole Word` ("W"), and `Regular Expressions` (.*).
* **CSS Highlight API:** Uses browser native highlighting instead of injecting `<mark>` HTML tags, preventing layout shifts.
* **Smart Scrollbar Map:** A sidebar displays color-coded markers for every matched word relative to the document's height. Clicking a marker scrolls directly to that result.

---

## ⌨️ Shortcuts & Usage

### General Navigation & PDF Actions

* **`H`**: Cycle through Header UI modes (Fixed -> Ghost -> Minimal).
* **`Alt` + `Left/Right Arrow`**: Move the sidebar to the left or right side of the screen.
* **`Ctrl` + `+` / `-` / `0`**: Zoom in, zoom out, or reset zoom.
* **`Arrow Keys`**: Scroll or snap to the previous/next page.
* **`Shift` + `Scroll`**: Increase or decrease the Focus Mode area size.
* **`Ctrl` + `A`**: Selects only the PDF text content, ignoring UI elements.
* **`Ctrl` + `Z` / `Ctrl` + `Y`**: Undo / Redo annotations and drawings.
* **`Ctrl` + `S`**: Quick save (Standard PDF structure).

### Sticky Notes

* **`Ctrl` + `Click`**: Create a new sticky note at the mouse location.
* **Drag Note**: Click and hold the yellow marker to reposition it.
* **Delete Note**: Focus on a note and press `Ctrl` + `Delete` (or `Backspace`), or click the trash bin icon.

### Advanced Search

* **`Ctrl` + `F`**: Override the native browser search and open the custom Web Search panel.
* **`Enter`**: Jump to the next search result in the current row.
* **`Shift` + `Enter`**: Jump to the previous search result.
* **`Up/Down Arrows`**: When the search input is unfocused, cycle globally through all matched results chronologically.
* **`Esc`**: Close the search panel and clear all highlights.

---

## 🛠️ Installation (Developer Mode)

1. Clone or download this repository.
2. Open your browser and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing the `manifest.json`.

**Troubleshooting Ctrl + F:**
Because the extension is installed in Developer Mode, the browser should automatically override the native `Ctrl+F` shortcut. If it doesn't work, go to the **Keyboard Shortcuts** section in your extensions menu and manually assign `Ctrl+F` to this extension.

## 🔗 Standalone Versions

This repository contains the integrated extension. The standalone versions can be found below:

* 📄 **[Better PDF Viewer (Standalone Viewer)](https://github.com/Chachisco/PDF_extension)**
* 🔍 **[Better Web Search (Standalone)](https://github.com/Chachisco/Search-Extension)**

*(Note: The custom search engine is not available inside the standalone PDF Viewer repository).*