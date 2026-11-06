/// <reference types="vite/client" />

declare module '*.tla?raw' {
  const content: string;
  export default content;
}

declare module '*.cfg?raw' {
  const content: string;
  export default content;
}
