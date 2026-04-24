// Ambient declarations for Vite-specific import query suffixes used by the client bundle.
// Consumed by: tsc during `npm run typecheck`. Keeps demo-mode JSON imports typed without
// enabling `resolveJsonModule` globally.

declare module "*?raw" {
  const content: string;
  export default content;
}
