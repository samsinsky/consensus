/** Stops the browser opening a file dropped outside a drop area, which would lose the draft. */
export function guardFileDrops(target: Window): () => void {
  const block = (e: Event) => {
    const types = (e as DragEvent).dataTransfer?.types;
    if (types && Array.from(types).includes('Files')) e.preventDefault();
  };
  target.addEventListener('dragover', block);
  target.addEventListener('drop', block);
  return () => {
    target.removeEventListener('dragover', block);
    target.removeEventListener('drop', block);
  };
}
