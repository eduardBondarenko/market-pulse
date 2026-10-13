export class LatestSnapshotPublisher<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latestSnapshot: (() => T) | null = null;
  private lastPublishedAt: number | null = null;

  constructor(
    private readonly publishSnapshot: (snapshot: T) => void,
    private readonly minimumIntervalMs: number
  ) {}

  publish(getSnapshot: () => T): void {
    this.latestSnapshot = getSnapshot;
    const now = Date.now();
    const elapsed = this.lastPublishedAt === null
      ? this.minimumIntervalMs
      : now - this.lastPublishedAt;

    if (elapsed >= this.minimumIntervalMs) {
      this.flush();
      return;
    }

    if (this.timer === null) {
      this.timer = setTimeout(
        () => this.flush(),
        this.minimumIntervalMs - elapsed
      );
    }
  }

  flush(): void {
    this.clearTimer();

    if (this.latestSnapshot === null) {
      return;
    }

    const getSnapshot = this.latestSnapshot;
    this.latestSnapshot = null;
    this.lastPublishedAt = Date.now();
    this.publishSnapshot(getSnapshot());
  }

  reset(): void {
    this.clearTimer();
    this.latestSnapshot = null;
    this.lastPublishedAt = null;
  }

  dispose(): void {
    this.reset();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
