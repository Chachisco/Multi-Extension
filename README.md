# PDF Viewer & Better Web Search

This project merges two tools into a single extension.

An all-in-one Chrome/Brave extension that combines a feature-rich PDF viewer with a non-blocking, multi-track web search engine.

## Core Features

### 📄 PDF Viewer

A custom PDF reader built on top of `pdf.js`, heavily optimized for performance and reading focus.

* **Header UI Modes:**
  * `Ghost Mode`: The top bar becomes transparent and disappears when idle, showing only the page counter or the active tool, allowing the PDF to take up the entire screen.
  * `Minimal Mode`: Hides the toolbar when idle, keeping the interface clean.
  * `Fixed Mode`: The classic, always-visible toolbar.
* **Performance Focused:** Uses `IntersectionObserver` to lazy-load and render canvas elements only when they enter the viewport, saving RAM on large documents.
* **Annotation Tools:** Highlight and underline tools with multiple colors, thickness options, and an eraser.
* **Interactive Sticky Notes:**
  * Create notes anywhere on the document.
  * **Drag & Drop:** Click and hold to move notes fluidly across the page. (*Note: Unable do drag notes between pages*)
  * **Pinning:** Pin notes to keep them open while reading.
* **OS-Aware Path Copying:** Easily copy the local path of the PDF. Smart click detection copies standard Windows paths (Left Click) or converts them to Linux/WSL paths (Right Click/Ctrl+Click).
* **Navigation:** Smooth horizontal sliding and precise "Fit to Width / Fit to Height" zoom controls.

### 🔍 Better Web Search (Global & PDF)

A highly advanced search tool that works both inside the PDF Viewer and on any standard website.

* **Multi-Row Searching:** Search for multiple distinct terms simultaneously, assigning a unique highlight color to each term.
* **Non-Blocking Engine (Time-Slicing):** Uses `requestAnimationFrame` and time-chunking to process massive web pages (or large PDFs) without freezing the browser's main thread.
* **Advanced Filters:** Per-row toggles for `Match Case` (Aa), `Whole Word` ("W"), and `Regular Expressions` (.*).
* **CSS Highlight API:** Uses modern browser native highlighting instead of injecting `<mark>` HTML tags, preventing layout shifts and site breakages.
* **Smart Scrollbar Map:** A non-intrusive sidebar displays color-coded markers for every matched word relative to the document's height. Clicking a marker scrolls directly to that specific result.

---

## ⌨️ Shortcuts & Usage

### General Navigation

* **`H`**: Cycle through Header UI modes (Fixed -> Ghost -> Minimal).
* **`Ctrl` + `+` / `-` / `0`**: Zoom in, zoom out, or reset zoom.
* **`Arrow Keys`**: Smoothly snap to the previous or next page.

### Sticky Notes

* **`Ctrl` + `Click`**: Create a new sticky note at the mouse location.
* **Drag Note**: Click and hold the yellow marker to reposition it.
* **Delete Note**: Focus on a note and press `Ctrl` + `Delete` (or `Backspace`), or click the trash bin icon.
* **Pin Note**: Click the "Pin" icon inside an open note to prevent it from closing when losing focus.

### Advanced Search

* **`Ctrl` + `F`**: Override the native browser search and open the Better Web Search panel.
* **`Enter`**: Jump to the next search result in the current row.
* **`Shift` + `Enter`**: Jump to the previous search result.
* **`Up/Down Arrows`**: When the search input is unfocused, cycle globally through all matched results chronologically, regardless of their color.
* **`Esc`**: Close the search panel and clear all highlights.

---

## 🛠️ Installation (Developer Mode)

1. Clone or download this repository.
2. Open your browser and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing the `manifest.json`.

**Troubleshooting Ctrl + F:**
Because you are installing in Developer Mode, the browser should automatically override the native `Ctrl+F` shortcut. If it doesn't work, go to the **Keyboard Shortcuts** section in your extensions menu and manually assign `Ctrl+F` to this extension.

## 🔗 Standalone Versions

This repository contains the **All-in-One** Mega Extension. However, if you prefer to use these tools separately, you can find their individual repositories below:

* 📄 **[Better PDF Viewer (Standalone Viewer)](https://github.com/Chachisco/PDF_extension)**: The pure PDF reader without the custom search engine.
* 🔍 **[Better Web Search (Standalone)](https://github.com/Chachisco/Search-Extension)**: The advanced web search extension, ready to be injected into any standard website.

*(Note: The standalone versions do not share cross-integration features. This means the custom search engine will not be available inside the standalone PDF Viewer).*
