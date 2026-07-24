export type ModelGatewayEndpoint = "chat/completions" | "responses";

export type ModelGatewayUpstreamResponse = {
  response: Response;
  provider: string;
  model: string;
  configId: number;
};
