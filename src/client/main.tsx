import { render } from 'preact';
import { App } from './app.tsx';
import './styles.css';

/**
 * A file dropped anywhere but a drop zone is the browser's to handle, and the
 * browser navigates to it — the editor is gone and the image fills the tab.
 * Only file drags are refused; dragging text or an outline row is untouched.
 * Drop zones stop propagation, so they never reach these.
 */
const isFileDrag = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'none';
});
window.addEventListener('drop', (e) => { if (isFileDrag(e)) e.preventDefault(); });

const root = document.getElementById('app');
if (root) render(<App />, root);
