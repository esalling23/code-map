import { forwardRef, memo, type ReactNode } from "react";
import { Title } from "./ui";

export const Panel = memo(
  forwardRef<HTMLElement, { title: string; children: ReactNode }>(function Panel({ title, children }, ref) {
    return (
      <section ref={ref}>
        <Title text={title} />
        {children}
      </section>
    );
  }),
);
