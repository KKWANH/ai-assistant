/// <reference types="vite/client" />

// CSS Modules — Vite guarantees every authored class name is defined at
// runtime.  We use a mapped type (not an index signature) so that
// `noUncheckedIndexedAccess` does not widen property reads to
// `string | undefined`.
declare module "*.module.css" {
  const classes: { readonly [k in string]: string };
  export default classes;
}
