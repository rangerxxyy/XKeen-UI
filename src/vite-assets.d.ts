declare module '*.yaml?raw' {
  const content: string;
  export default content;
}

declare module '*.json?raw' {
  const content: string;
  export default content;
}

declare module '*.jsonc?raw' {
  const content: string;
  export default content;
}
