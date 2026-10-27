// The sticky bar over a map: its title, links to its sections and the levels control, plus the way home when hosted.
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** What the hosted viewer adds to the bar; standalone pages have none of it. */
export interface MapNav {
  name: string;
  onHome: () => void;
}

/** A section of the page the bar links to, by element id. */
export interface MapSection {
  id: string;
  label: string;
}

/** Scrolls in place: the URL's hash is the viewer's (#map=…), so the links don't change it. */
function SectionLinks({ sections }: { sections: MapSection[] }) {
  return (
    <span className="bar-sections">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          {s.label}
        </a>
      ))}
    </span>
  );
}

export function MapBar({ title, sections, nav, children }: { title: string; sections: MapSection[]; nav?: MapNav; children: ReactNode }) {
  const bar = useRef<HTMLElement>(null);
  // Jumps to steps and the sticky code panel sit below the bar (--bar-h), which grows when it wraps.
  useLayoutEffect(() => {
    const el = bar.current!;
    const root = document.documentElement.style;
    const observer = new ResizeObserver(() => root.setProperty("--bar-h", `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.removeProperty("--bar-h");
    };
  }, []);
  return (
    <nav className="viewerbar" ref={bar}>
      {nav && (
        <a
          href="./"
          className="home-link"
          title="All code maps"
          aria-label="All code maps"
          onClick={(e) => {
            e.preventDefault();
            nav.onHome();
          }}
        >
          ←
        </a>
      )}
      <strong className="bar-title" title={nav ? `${title} (${nav.name})` : title}>
        {title}
      </strong>
      <span className="bar-break" />
      <SectionLinks sections={sections} />
      {children}
    </nav>
  );
}
