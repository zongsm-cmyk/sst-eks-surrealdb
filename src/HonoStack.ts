import { StackContext, Function, use } from "sst/constructs";
import { EksStack } from "./EksStack";

export function HonoStack({ stack }: StackContext) {
  const eks = use(EksStack);

  const honoService = new Function(stack, "HonoService", {
    handler: "examples/hono-service/index.handler",
    environment: {
      SURREALDB_URL: process.env.SURREALDB_URL || "ws://localhost:8000/rpc",
      SURREALDB_USER: process.env.SURREALDB_USER || "root",
      SURREALDB_PASS: process.env.SURREALDB_PASS || "root",
      SURREALDB_NS: process.env.SURREALDB_NS || "test",
      SURREALDB_DB: process.env.SURREALDB_DB || "test",
    },
    vpc: eks.vpc,
    timeout: "30 seconds",
  });

  stack.addOutputs({
    HonoFunctionArn: honoService.functionArn,
  });

  return {
    honoService,
  };
}
