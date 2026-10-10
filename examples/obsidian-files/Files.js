class Files {
  constructor() {
    this.obsidian = window.app;
  }

  exists(rawPath) {
    const path = this.normalize(rawPath);
    if (!path) return false;
    return this.obsidian.getAbstractFileByPath(path) ? true : false;
  }

  ensureFolder(path) {}

  async moveTo(file, destFolder) {
    try {
    } catch (error) {
      throw new Error(
        `Files.moveTo: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  normalize(path) {}
}
