// The viewer: boots from the page or URL, then shows the home screen or a map. Opening another map,
// going home or moving through history swaps the screen without reloading the page.
import { useCallback, useEffect, useState } from "react";
import { boot, fromUrl, goHome, openFile, openRecent, type Screen } from "./boot";
import { Home } from "./home/Home";
import { useFileDrop } from "./home/useFileDrop";
import { MapPage } from "./map/MapPage";

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  // Each opened map gets a fresh page state (levels expansions, tabs, navigator).
  const [opened, setOpened] = useState(0);
  const standalone = screen.kind === "map" && !!screen.standalone;
  const show = useCallback((s: Screen) => {
    setScreen(s);
    setOpened((n) => n + 1);
    if (s.kind === "map") scrollTo(0, 0);
  }, []);
  const onFile = useCallback((file: File) => void openFile(file).then(show), [show]);

  useEffect(() => {
    boot().then(show);
  }, [show]);

  // Back, forward and edits to the URL's #map=… open what the URL names.
  useEffect(() => {
    if (standalone) return;
    const onPop = () => void fromUrl().then(show, (e) => show({ kind: "home", error: String(e) }));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [standalone, show]);

  useFileDrop(onFile, screen.kind === "home");

  useEffect(() => {
    if (screen.kind === "map") document.title = screen.doc.system.title;
  }, [screen]);

  if (screen.kind === "loading") return null;
  if (screen.kind === "home") return <Home error={screen.error} onFile={onFile} onRecent={(id) => void openRecent(id).then(show)} />;
  return (
    <MapPage key={opened} doc={screen.doc} nav={screen.standalone ? undefined : { name: screen.name, onHome: () => show(goHome()) }} />
  );
}
