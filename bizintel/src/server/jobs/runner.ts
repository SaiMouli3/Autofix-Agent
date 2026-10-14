/** Tracks in-flight background work so it can be cancelled, and bounds concurrency per job kind. */
type Task = () => Promise<void>;

class Lane {
  private running = 0;
  private queue: Task[] = [];
  constructor(private limit: number) {}
  push(task: Task) {
    this.queue.push(task);
    this.pump();
  }
  private pump() {
    while (this.running < this.limit && this.queue.length) {
      const task = this.queue.shift()!;
      this.running++;
      task()
        .catch((e) => console.error("[jobs] unhandled job error", e))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}

export const lanes = {
  search: new Lane(2),
  research: new Lane(3),
  export: new Lane(1),
};

const controllers = new Map<string, AbortController>();

export function registerController(id: string): AbortController {
  const c = new AbortController();
  controllers.set(id, c);
  return c;
}

export function releaseController(id: string) {
  controllers.delete(id);
}

export function cancel(id: string): boolean {
  const c = controllers.get(id);
  if (!c) return false;
  c.abort();
  return true;
}

export const isAbort = (e: unknown) => e instanceof Error && (e.name === "AbortError" || (e as { code?: string }).code === "ABORT_ERR");
