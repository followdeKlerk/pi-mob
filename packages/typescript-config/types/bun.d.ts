// Bun extensions on `import.meta`. The TypeScript `lib` does not know
// about Bun-specific import-meta fields; this augmentation brings them
// into scope for every workspace package without each one re-declaring
// the same interface.

interface ImportMeta {
  readonly main: boolean;
  readonly dir: string;
  readonly file: string;
  readonly path: string;
}
