// Renders a map page to HTML without a browser, for tests and anything else that wants the markup.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { CodeMapDocument } from "../pagedata";
import { MapPage } from "./map/MapPage";

export const renderMapHtml = (doc: CodeMapDocument) => renderToString(createElement(MapPage, { doc }));
