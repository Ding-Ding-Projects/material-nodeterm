// Live transport proof for team canvas convergence.
//
// The broader convergence suite deliberately controls an in-memory async bus so it can enumerate
// precise interleavings. This file covers the seam that suite cannot: two production RpcClients
// exchange canvas casts and reflected events through authenticated loopback WebSockets, the real
// ServerPlatform, and the production canvas reflector. The only test control is pausing one real
// socket's inbound stream long enough to make a delete causally invisible to a concurrent drag.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import WebSocket, { type RawData, type WebSocketServer } from "ws";
import { initCanvasSync } from "../../src/core/canvas-sync";
import { initPlatform, resetPlatformForTests } from "../../src/core/platform";
import { presenceHub } from "../../src/core/presence/hub";
import {
  applyCanvasMutation,
  applyEdgeMutation,
  isCanvasMutation,
  type CanvasScene,
} from "../../src/shared/canvas-mutations";
import { createCanvasOrder } from "../../src/shared/canvas-order";
import { createCanvasPublisher } from "../../src/shared/canvas-publish";
import { IPC } from "../../src/shared/ipc";
import type {
  BridgeLink,
  CanvasMutation,
  CanvasNodeState,
} from "../../src/shared/types";
import type { FrameTransport } from "../../src/renderer/bridge/frame-transport";
import { buildCanvasApi, RpcClient } from "../../src/renderer/bridge/ws-bridge";
import { Auth } from "../../src/server/auth";
import { SESSION_COOKIE } from "../../src/server/http";
import { ServerPlatform } from "../../src/server/platform-server";
import { attachWsServer } from "../../src/server/ws";

const PROJECT = "live-ws-project";
const BARRIER = "test:canvas-sync-barrier";

const node = (id: string, x: number): CanvasNodeState =>
  ({
    id,
    kind: "terminal",
    title: id,
    color: "#ffffff",
    group: null,
    position: { x, y: 0 },
    size: { width: 320, height: 220 },
  }) as CanvasNodeState;

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** A real `ws` carrier adapted to the production RpcClient transport seam. */
class LoopbackWsTransport implements FrameTransport {
  readonly socket: WebSocket;
  private readonly readyPromise: Promise<void>;
  canvasCastCount = 0;

  constructor(url: string, cookie: string, origin: string) {
    this.socket = new WebSocket(url, { headers: { cookie, origin } });
    let opened = false;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.socket.once("open", () => {
        opened = true;
        resolve();
      });
      this.socket.once("error", (error) => {
        if (!opened) reject(error);
      });
    });
    // A teardown race must fail the test through its assertions, not crash the worker with an
    // unhandled EventEmitter error after the ready promise has already settled.
    this.socket.on("error", () => {});
  }

  send(json: string): void {
    const frame = JSON.parse(json) as { t?: string; method?: string };
    if (frame.t === "cast" && frame.method === IPC.canvasMut)
      this.canvasCastCount++;
    this.socket.send(json);
  }

  onMessage(listener: (data: string | Uint8Array) => void): void {
    this.socket.on("message", (data: RawData, isBinary: boolean) => {
      if (!isBinary) {
        listener(data.toString());
        return;
      }
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      listener(new Uint8Array(bytes));
    });
  }

  onClose(listener: () => void): void {
    this.socket.on("close", listener);
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  pauseInbound(): void {
    this.socket.pause();
  }

  resumeInbound(): void {
    this.socket.resume();
  }

  async close(): Promise<void> {
    this.resumeInbound();
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) =>
      this.socket.once("close", () => resolve()),
    );
    if (this.socket.readyState === WebSocket.CONNECTING)
      this.socket.terminate();
    else this.socket.close();
    const force = setTimeout(() => this.socket.terminate(), 250);
    force.unref?.();
    await closed;
    clearTimeout(force);
  }
}

/** Mirrors the production Canvas publish/apply effects around a real RPC canvas API. */
class LiveCanvasClient {
  nodes: CanvasNodeState[] = [];
  bridges: BridgeLink[] = [];
  ropes: BridgeLink[] = [];
  received = 0;
  peerApplied = 0;
  readonly receivedMutations: CanvasMutation[] = [];

  private readonly order: ReturnType<typeof createCanvasOrder>;
  private readonly publisher: ReturnType<typeof createCanvasPublisher>;
  private readonly canvas: ReturnType<typeof buildCanvasApi>["canvas"];
  private readonly unsubscribe: () => void;

  constructor(
    readonly src: string,
    readonly rpc: RpcClient,
    readonly transport: LoopbackWsTransport,
  ) {
    this.canvas = buildCanvasApi(rpc).canvas;
    this.order = createCanvasOrder(src);
    this.publisher = createCanvasPublisher(
      (mutation) => {
        const stamped = this.order.stamp(mutation);
        if (!isCanvasMutation(stamped)) return false;
        this.order.onLocal(stamped);
        this.canvas.mutate(PROJECT, stamped);
        return true;
      },
      { src },
    );
    this.unsubscribe = this.canvas.onMutation((projectId, mutation) => {
      if (projectId !== PROJECT) return;
      this.received++;
      this.receivedMutations.push(mutation);
      if (!this.order.accept(mutation)) return;
      if (mutation.src !== this.src) this.peerApplied++;
      this.nodes = applyCanvasMutation(this.nodes, mutation);
      this.bridges = applyEdgeMutation(this.bridges, "bridge", mutation);
      this.ropes = applyEdgeMutation(this.ropes, "rope", mutation);

      // A peer mutation updates React state, which runs the publish effect again. `adopt` is the
      // production loop guard: the immediately-following publish must diff to nothing.
      const adopted = this.scene();
      this.publisher.adopt(adopted);
      this.publisher.publish(adopted);
    });
  }

  editNodes(next: CanvasNodeState[]): void {
    this.nodes = next;
    this.publisher.publish(this.scene());
  }

  editBridges(next: BridgeLink[]): void {
    this.bridges = next;
    this.publisher.publish(this.scene());
  }

  scene(): CanvasScene {
    return { nodes: this.nodes, bridges: this.bridges, ropes: this.ropes };
  }

  dispose(): void {
    this.unsubscribe();
    this.publisher.dispose();
  }
}

let tempDir = "";
let server: http.Server | null = null;
let wsServer: WebSocketServer | null = null;
let platform: ServerPlatform | null = null;
let transports: LoopbackWsTransport[] = [];
let clients: LiveCanvasClient[] = [];
let serverCasts: Array<{ sender: number; mutation: CanvasMutation }> = [];

async function drainRpc(): Promise<void> {
  // Requests on each socket are ordered after all casts that client produced while applying the
  // preceding reflected events. Two rounds also drain reflections produced before round one.
  for (let round = 0; round < 2; round++) {
    await Promise.all(clients.map((client) => client.rpc.request(BARRIER)));
  }
}

async function waitForDeliveries(
  perClient: number[],
  label: string,
): Promise<void> {
  await until(
    () => clients.every((client, index) => client.received >= perClient[index]),
    label,
  );
  await drainRpc();
}

beforeEach(async () => {
  expect(presenceHub.peers()).toHaveLength(0);
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodeterm-canvas-ws-"));
  const auth = new Auth(tempDir);
  platform = new ServerPlatform({
    userDataDir: tempDir,
    appVersion: "0.0.0-test",
  });
  initPlatform(platform);
  initCanvasSync();
  platform.handle(BARRIER, () => true);
  serverCasts = [];
  platform.onWithSender(IPC.canvasMut, (sender, _projectId, mutation) => {
    serverCasts.push({ sender, mutation: mutation as CanvasMutation });
  });

  server = http.createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  wsServer = attachWsServer(server, { platform, auth });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const cookie = `${SESSION_COOKIE}=${auth.createSession()}`;

  transports = [
    new LoopbackWsTransport(
      `ws://127.0.0.1:${address.port}/ws`,
      cookie,
      origin,
    ),
    new LoopbackWsTransport(
      `ws://127.0.0.1:${address.port}/ws`,
      cookie,
      origin,
    ),
  ];
  clients = transports.map((transport, index) => {
    const rpc = new RpcClient(transport);
    return new LiveCanvasClient(`live-client-${index + 1}`, rpc, transport);
  });
  await Promise.all(clients.map((client) => client.rpc.ready()));
  await until(
    () => presenceHub.peers().length === 2,
    "both loopback clients to join",
  );
});

afterEach(async () => {
  for (const client of clients) client.dispose();
  clients = [];
  await Promise.all(transports.map((transport) => transport.close()));
  transports = [];
  await until(
    () =>
      presenceHub.peers().length === 0 &&
      (platform?.clientIds().length ?? 0) === 0,
    "both loopback clients to detach",
  );
  if (wsServer) {
    await new Promise<void>((resolve, reject) =>
      wsServer!.close((error) => (error ? reject(error) : resolve())),
    );
    wsServer = null;
  }
  if (server?.listening) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  }
  server = null;
  resetPlatformForTests();
  platform = null;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  tempDir = "";
});

describe("canvas sync over two live loopback WebSockets", () => {
  it("causal delete wins over a drag cast before that client receives the delete", async () => {
    const [a, b] = clients;
    a.editNodes([node("n1", 0), node("n2", 0)]);
    await waitForDeliveries([2, 2], "initial nodes to converge");
    expect(a.scene()).toEqual(b.scene());

    const receivedBefore = clients.map((client) => client.received);
    const castsBefore = serverCasts.length;
    b.transport.pauseInbound();

    a.editNodes(a.nodes.filter((item) => item.id !== "n1"));
    await until(
      () => serverCasts.length === castsBefore + 1,
      "delete to reach the reflector",
    );
    await until(
      () => a.received === receivedBefore[0] + 1,
      "delete echo to reach its sender",
    );
    expect(b.received).toBe(receivedBefore[1]);

    // B is still looking at n1, so this is a genuine concurrent drag produced without seeing the
    // delete. It reaches the reflector second while B's real socket remains read-paused.
    b.editNodes(
      b.nodes.map((item) => (item.id === "n1" ? node("n1", 50) : item)),
    );
    await until(
      () => serverCasts.length === castsBefore + 2,
      "stale drag to reach the reflector",
    );
    b.transport.resumeInbound();
    await waitForDeliveries(
      [receivedBefore[0] + 2, receivedBefore[1] + 2],
      "delete and drag reflections to reach both clients",
    );

    const reflected = a.receivedMutations.slice(receivedBefore[0]);
    const remove = reflected.find((mutation) => mutation.op === "remove");
    const drag = reflected.find((mutation) => mutation.op === "upsert");
    expect(remove?.seq).toBeTypeOf("number");
    expect(drag?.seq).toBeTypeOf("number");
    expect(remove!.seq!).toBeLessThan(drag!.seq!);
    expect(drag!.seen!).toBeLessThan(remove!.seq!);
    expect(a.nodes.map((item) => item.id)).toEqual(["n2"]);
    expect(b.nodes.map((item) => item.id)).toEqual(["n2"]);
    expect(a.scene()).toEqual(b.scene());
    expect(serverCasts).toHaveLength(castsBefore + 2);
  });

  it("creates then deletes an edge with one outbound cast per edit and no peer echo", async () => {
    const [a, b] = clients;
    a.editNodes([node("n1", 0), node("n2", 0)]);
    await waitForDeliveries([2, 2], "initial edge endpoints to converge");

    const castsBeforeCreate = serverCasts.length;
    const transportBeforeCreate = transports.reduce(
      (sum, item) => sum + item.canvasCastCount,
      0,
    );
    const receivedBeforeCreate = clients.map((client) => client.received);
    const peerAppliedBeforeCreate = clients.map((client) => client.peerApplied);
    const edge = { id: "edge-1", source: "n1", target: "n2" };

    a.editBridges([edge]);
    await waitForDeliveries(
      receivedBeforeCreate.map((count) => count + 1),
      "edge create reflection to reach both clients",
    );
    expect(serverCasts.length - castsBeforeCreate).toBe(1);
    expect(
      transports.reduce((sum, item) => sum + item.canvasCastCount, 0) -
        transportBeforeCreate,
    ).toBe(1);
    expect(a.peerApplied - peerAppliedBeforeCreate[0]).toBe(0);
    expect(b.peerApplied - peerAppliedBeforeCreate[1]).toBe(1);
    expect(a.bridges).toEqual([edge]);
    expect(b.bridges).toEqual([edge]);
    expect(a.scene()).toEqual(b.scene());

    const castsBeforeDelete = serverCasts.length;
    const transportBeforeDelete = transports.reduce(
      (sum, item) => sum + item.canvasCastCount,
      0,
    );
    const receivedBeforeDelete = clients.map((client) => client.received);
    const peerAppliedBeforeDelete = clients.map((client) => client.peerApplied);

    b.editBridges([]);
    await waitForDeliveries(
      receivedBeforeDelete.map((count) => count + 1),
      "edge delete reflection to reach both clients",
    );
    expect(serverCasts.length - castsBeforeDelete).toBe(1);
    expect(
      transports.reduce((sum, item) => sum + item.canvasCastCount, 0) -
        transportBeforeDelete,
    ).toBe(1);
    expect(a.peerApplied - peerAppliedBeforeDelete[0]).toBe(1);
    expect(b.peerApplied - peerAppliedBeforeDelete[1]).toBe(0);
    expect(a.bridges).toEqual([]);
    expect(b.bridges).toEqual([]);
    expect(a.scene()).toEqual(b.scene());
  });
});
