declare module 'virtual:public-resources' {
  const manifest: { schemaVersion: number; engineVersion: string; resources: Record<string, { hash: string; url: string }> }
  export default manifest
}
