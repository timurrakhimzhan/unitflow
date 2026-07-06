#!/usr/bin/env node
/**
 * The unitflow MCP server: stdio MCP for the agent on one side, a WebSocket
 * hub for the in-app dev bridge on the other.
 *
 *   npx unitflow-mcp                # hub on ws://localhost:4477
 *   UNITFLOW_MCP_PORT=5000 npx unitflow-mcp
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { layer } from "./mcp.js";

/** The node `Stdio` implementation the monolith `effect` package leaves to
 * the platform: process streams in, process streams out. */
const stdioLive = Layer.succeed(
  Stdio.Stdio,
  Stdio.make({
    args: Effect.sync(() => process.argv.slice(2)),
    // A stdin read error is unrecoverable for a stdio server: die with it.
    stdin: Stream.orDie(
      Stream.fromAsyncIterable<Uint8Array, unknown>(process.stdin, (cause) => cause),
    ),
    stdout: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        Effect.sync(() => {
          process.stdout.write(chunk);
        }),
      ),
    stderr: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        Effect.sync(() => {
          process.stderr.write(chunk);
        }),
      ),
  }),
);

const port = process.env.UNITFLOW_MCP_PORT;

Effect.runFork(
  Layer.launch(
    layer({ ...(port === undefined ? {} : { port: Number(port) }) }).pipe(
      Layer.provide(stdioLive),
    ),
  ),
);
