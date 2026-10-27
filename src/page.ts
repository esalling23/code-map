// Kept only so `src/pagedata.ts` (owned by another task) keeps importing its helpers from here.
// The helpers live in `src/viewer/text.ts`; delete this file once pagedata imports from there.
export { dataIdsOf, mmd, shortPath } from "./viewer/text";
