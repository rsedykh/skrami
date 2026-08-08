interface Env {
  BOARD: DurableObjectNamespace<import("./boardDO").BoardDO>;
  ASSETS: Fetcher;
}
