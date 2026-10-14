import { describe, expect, it } from "vitest";
import { semaphore, sleep } from "../src/server/util";

describe("semaphore", () => {
  it("never runs more than the limit at once and finishes everything", async () => {
    const run = semaphore(3);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        run(async () => {
          peak = Math.max(peak, ++active);
          await sleep(Math.random() * 5);
          active--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("drops an aborted waiter without leaking its slot", async () => {
    const run = semaphore(1);
    const hold = run(() => sleep(20));
    const ac = new AbortController();
    const queued = run(async () => "never", ac.signal);
    ac.abort();
    await expect(queued).rejects.toThrow(/Aborted/);
    await hold;
    await expect(run(async () => "ok")).resolves.toBe("ok");
  });
});
