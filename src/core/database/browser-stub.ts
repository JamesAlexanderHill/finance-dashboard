// This stub is used in the client (browser) bundle where postgres is not available.
// TanStack Start's createServerFn ensures DB code never actually runs in the browser;
// this file exists solely so Rollup can resolve the import without bundling Node.js code.
export default {}
