import { describe, expect, it } from "vitest";
import { classifyPage } from "../src/bot/pages/classifier.ts";

describe("classifyPage", () => {
  it("classifies Queue-it wait view as queue", () => {
    expect(classifyPage("https://wait.thaiticketmajor.com/view/?c=ticketmasterasia&e=th15376308e02682965d")).toBe("queue");
  });

  it("classifies Gatekeeper inflow as queue", () => {
    expect(classifyPage("https://gatekeeper.thaiticketmajor.com/inflow/v2/?qid=th15376308e02682965d")).toBe("queue");
  });

  it("classifies Queue-it HTML markers as queue when URL is otherwise unknown", () => {
    expect(classifyPage("https://wait.thaiticketmajor.com/custom", `
      <script>window.queueViewModel = { customerId: "ticketmasterasia" };</script>
      <body data-pageid="before">QueueIt.Queue.InQueueView</body>
    `)).toBe("queue");
  });

  it("does not classify Gatekeeper CAPTCHA as page kind", () => {
    expect(classifyPage("https://gatekeeper.thaiticketmajor.com/stacks/sep/?ks=redacted", `
      <main aria-label="CAPTCHA verification"><h1>Verify You Are Human</h1></main>
    `)).toBe("unknown");
  });
});
