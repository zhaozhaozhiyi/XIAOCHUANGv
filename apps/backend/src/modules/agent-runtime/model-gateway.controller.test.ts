import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { ModelGatewayController } from "./model-gateway.controller";

function createController() {
  const service = {
    proxy: vi.fn(),
  };
  const controller = new ModelGatewayController(service as any);
  const request = {
    raw: new EventEmitter(),
  };
  const replyRaw = new EventEmitter() as EventEmitter & {
    writableEnded: boolean;
  };
  replyRaw.writableEnded = false;
  const reply = {
    raw: replyRaw,
    code: vi.fn(() => reply),
    header: vi.fn(() => reply),
    send: vi.fn((payload?: unknown) => payload),
  };
  return { controller, service, request, reply };
}

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

describe("ModelGatewayController", () => {
  it("aborts the upstream provider request when the model client disconnects before headers", async () => {
    const { controller, service, request, reply } = createController();
    let signal: AbortSignal | undefined;
    service.proxy.mockImplementation((input: { signal?: AbortSignal }) => {
      signal = input.signal;
      return new Promise((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(abortError()));
      });
    });

    const pending = controller
      .chatCompletions({}, {}, request as any, reply as any)
      .catch((error) => error);
    reply.raw.emit("close");

    expect(signal?.aborted).toBe(true);
    await expect(pending).resolves.toMatchObject({ name: "AbortError" });
    expect(request.raw.listenerCount("aborted")).toBe(0);
    expect(reply.raw.listenerCount("close")).toBe(0);
  });

  it("aborts and destroys the forwarded stream when the response connection drops mid-stream", async () => {
    const { controller, service, request, reply } = createController();
    let signal: AbortSignal | undefined;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    service.proxy.mockImplementation((input: { signal?: AbortSignal }) => {
      signal = input.signal;
      return Promise.resolve({
        response: new Response(upstreamBody, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
        provider: "openai",
        model: "project-model",
        configId: 99,
      });
    });

    const sent = await controller.responses(
      { stream: true },
      {},
      request as any,
      reply as any,
    );

    expect(sent).toBeInstanceOf(Readable);
    expect(signal?.aborted).toBe(false);
    reply.raw.emit("close");
    await new Promise((resolve) => setImmediate(resolve));

    expect(signal?.aborted).toBe(true);
    expect((sent as Readable).destroyed).toBe(true);
    expect(request.raw.listenerCount("aborted")).toBe(0);
    expect(reply.raw.listenerCount("close")).toBe(0);
  });

  it("does not cancel the provider stream after the response has finished normally", async () => {
    const { controller, service, request, reply } = createController();
    let signal: AbortSignal | undefined;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    service.proxy.mockImplementation((input: { signal?: AbortSignal }) => {
      signal = input.signal;
      return Promise.resolve({
        response: new Response(upstreamBody, { status: 200 }),
        provider: "openai",
        model: "project-model",
        configId: 99,
      });
    });

    const sent = await controller.responses(
      { stream: true },
      {},
      request as any,
      reply as any,
    );
    reply.raw.writableEnded = true;
    reply.raw.emit("close");

    expect(signal?.aborted).toBe(false);
    expect((sent as Readable).destroyed).toBe(false);
  });
});
