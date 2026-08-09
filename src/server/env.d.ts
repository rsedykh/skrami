interface Env {
  BOARD: DurableObjectNamespace<import("./boardDO").BoardDO>;
  ASSETS: Fetcher;
  REGISTRY: KVNamespace;
  ADMIN_KEY?: string;
}
