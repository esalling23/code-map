// Dropping a file anywhere on the page opens it. The listeners live as long as the component using this.
import { useEffect, useState } from "react";

export function useFileDrop(onFile: (file: File) => void, enabled = true): boolean {
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDropping(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDropping(false);
      const file = e.dataTransfer?.files[0];
      if (file) onFile(file);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
    };
  }, [onFile, enabled]);

  useEffect(() => {
    document.body.classList.toggle("dropping", dropping);
    return () => document.body.classList.remove("dropping");
  }, [dropping]);
  return dropping;
}
