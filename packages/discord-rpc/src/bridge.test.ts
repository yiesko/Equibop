/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, test } from "bun:test";

import type { RunningGame } from "@vencord/game-detection";
import { WebSocket, WebSocketServer } from "ws";

import { handleBridgeFrame, startBridgeGameDetection } from "./bridge";

function collect() {
    const games = new Map<string, RunningGame>();
    const changes: Array<[RunningGame, boolean]> = [];
    const onChange = (game: RunningGame, running: boolean) => changes.push([game, running]);
    return { games, changes, onChange };
}

const ACTIVE = JSON.stringify({
    activity: { application_id: "424242", name: "Fake Game", timestamps: { start: 1 } },
    pid: 1234,
    socketId: "424242",
    path: "/games/fakegame/bin"
});

const READY = JSON.stringify({ evt: "READY", data: { id: "0", username: "x" } });

describe("handleBridgeFrame", () => {
    test("READY is not an activity", () => {
        const { games, changes, onChange } = collect();
        handleBridgeFrame(READY, games, onChange);
        expect(changes).toEqual([]);
        expect(games.size).toBe(0);
    });

    test("active frame becomes a running game", () => {
        const { games, changes, onChange } = collect();
        handleBridgeFrame(ACTIVE, games, onChange);
        expect(changes).toEqual([[{ id: "424242", name: "Fake Game", pid: 1234, path: "/games/fakegame/bin" }, true]]);
        expect(games.get("424242")?.pid).toBe(1234);
    });

    test("clear removes the stored game", () => {
        const { games, changes, onChange } = collect();
        handleBridgeFrame(ACTIVE, games, onChange);
        changes.length = 0;
        handleBridgeFrame(JSON.stringify({ activity: null, pid: 1234, socketId: "424242" }), games, onChange);
        expect(changes).toEqual([[{ id: "424242", name: "Fake Game", pid: 1234, path: "/games/fakegame/bin" }, false]]);
        expect(games.size).toBe(0);
    });

    test("clear from a stale pid does not remove the new execution", () => {
        const { games, changes, onChange } = collect();
        handleBridgeFrame(ACTIVE, games, onChange);
        changes.length = 0;
        handleBridgeFrame(JSON.stringify({ activity: null, pid: 9999, socketId: "424242" }), games, onChange);
        expect(changes).toEqual([]);
        expect(games.get("424242")?.pid).toBe(1234);
    });

    test("frames without a usable path or identity are ignored", () => {
        const { games, changes, onChange } = collect();
        const noPath = JSON.stringify({
            activity: { application_id: "424242", name: "Fake Game" },
            pid: 1234,
            socketId: "424242"
        });
        const badPid = JSON.stringify({
            activity: { application_id: "424242", name: "Fake Game" },
            pid: 0,
            socketId: "424242",
            path: "/games/fakegame/bin"
        });
        handleBridgeFrame(noPath, games, onChange);
        handleBridgeFrame(badPid, games, onChange);
        handleBridgeFrame("not json", games, onChange);
        handleBridgeFrame(JSON.stringify({ foo: 1 }), games, onChange);
        expect(changes).toEqual([]);
        expect(games.size).toBe(0);
    });

    test("clear for an unknown game is ignored", () => {
        const { games, changes, onChange } = collect();
        handleBridgeFrame(JSON.stringify({ activity: null, pid: 1, socketId: "nope" }), games, onChange);
        expect(changes).toEqual([]);
    });
});

describe("startBridgeGameDetection lifecycle", () => {
    test("clears on a real disconnect, reconnects and replays, stop cancels reconnect", async () => {
        const server = new WebSocketServer({ port: 0 });
        await new Promise<void>(resolve => server.on("listening", resolve));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("no port");
        let connections = 0;
        const serverSockets: WebSocket[] = [];
        server.on("connection", socket => {
            connections++;
            serverSockets.push(socket);
        });

        const changes: Array<[RunningGame, boolean]> = [];
        const detection = startBridgeGameDetection({
            url: `ws://127.0.0.1:${address.port}`,
            onChange: (game, running) => changes.push([game, running])
        });

        // Give the client a moment to connect, then send READY + active.
        await new Promise(resolve => setTimeout(resolve, 100));
        serverSockets[0].send(READY);
        serverSockets[0].send(ACTIVE);
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(detection.getGames().map(g => g.id)).toEqual(["424242"]);
        expect(changes.some(([, running]) => running)).toBe(true);

        // A real socket close must clear this adapter's games.
        changes.length = 0;
        serverSockets[0].close();
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(detection.getGames()).toEqual([]);
        expect(changes).toEqual([[{ id: "424242", name: "Fake Game", pid: 1234, path: "/games/fakegame/bin" }, false]]);

        // Backoff is 1s for the first attempt: wait for the reconnect,
        // then a fresh READY + replay must restore the still-running game.
        await new Promise(resolve => {
            const deadline = Date.now() + 4000;
            const check = () =>
                connections >= 2 || Date.now() > deadline ? resolve(undefined) : setTimeout(check, 50);
            check();
        });
        expect(connections).toBe(2);
        serverSockets[1].send(READY);
        serverSockets[1].send(ACTIVE);
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(detection.getGames().map(g => g.id)).toEqual(["424242"]);

        // stop() closes the socket and must not reconnect afterwards.
        detection.stop();
        expect(detection.getGames()).toEqual([]);
        server.close();
        await new Promise(resolve => setTimeout(resolve, 1500));
        expect(connections).toBe(2);
        expect(detection.getGames()).toEqual([]);
    });
});
