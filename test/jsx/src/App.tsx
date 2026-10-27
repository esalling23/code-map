import { Panel } from "./Panel";
import * as ui from "./ui";

export function App({ items }: { items: string[] }) {
  return (
    <main>
      <Panel title="Items">
        {items.map((i) => (
          <ui.Row key={i} text={i} />
        ))}
      </Panel>
      <Fragment />
    </main>
  );
}
