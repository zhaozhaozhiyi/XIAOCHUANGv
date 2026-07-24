import { Readable } from "node:stream";

import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { ModelGatewayEndpoint } from "./model-gateway.types";
import { ModelGatewayService } from "./model-gateway.service";

function forwardResponseHeaders(reply: FastifyReply, response: Response) {
  const contentType = response.headers.get("content-type");
  const cacheControl = response.headers.get("cache-control");
  const requestId =
    response.headers.get("x-request-id") ||
    response.headers.get("request-id");

  if (contentType) reply.header("content-type", contentType);
  if (cacheControl) reply.header("cache-control", cacheControl);
  if (requestId) reply.header("x-model-gateway-request-id", requestId);
}

@ApiTags("internal-agent-runtime")
@Controller("internal/agent-runtime/model-gateway/v1")
export class ModelGatewayController {
  constructor(
    @Inject(ModelGatewayService)
    private readonly modelGatewayService: ModelGatewayService,
  ) {}

  @Post("chat/completions")
  chatCompletions(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.forward(
      "chat/completions",
      body,
      headers,
      request,
      reply,
    );
  }

  @Post("responses")
  responses(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    return this.forward("responses", body, headers, request, reply);
  }

  private async forward(
    endpoint: ModelGatewayEndpoint,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const abortController = new AbortController();
    let upstreamStream: Readable | null = null;
    let responseStarted = false;
    let responseCompleted = false;
    const abortWhenDisconnected = () => {
      if (!abortController.signal.aborted) abortController.abort();
      upstreamStream?.destroy();
    };
    const abortWhenResponseConnectionCloses = () => {
      if (!responseCompleted && !reply.raw.writableEnded) {
        abortWhenDisconnected();
      }
    };
    const cleanupDisconnectListeners = () => {
      request.raw.removeListener("aborted", abortWhenDisconnected);
      reply.raw.removeListener("close", abortWhenResponseConnectionCloses);
    };
    request.raw.once("aborted", abortWhenDisconnected);
    reply.raw.once("close", abortWhenResponseConnectionCloses);
    try {
      const upstream = await this.modelGatewayService.proxy({
        endpoint,
        body,
        headers,
        signal: abortController.signal,
      });
      if (!upstream.response.body) {
        reply.code(upstream.response.status);
        forwardResponseHeaders(reply, upstream.response);
        return reply.send();
      }

      reply.code(upstream.response.status);
      forwardResponseHeaders(reply, upstream.response);
      const stream = Readable.fromWeb(
        upstream.response.body as globalThis.ReadableStream<Uint8Array>,
      );
      upstreamStream = stream;
      const cleanup = () => {
        responseCompleted = true;
        cleanupDisconnectListeners();
      };
      stream.once("close", cleanup);
      stream.once("end", cleanup);
      stream.once("error", cleanup);
      responseStarted = true;
      return reply.send(stream);
    } finally {
      if (!responseStarted) {
        cleanupDisconnectListeners();
      }
    }
  }
}
