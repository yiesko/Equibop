/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

import {
    CloseCode,
    createRpcServer,
    startBridgeGameDetection,
    startGameDetection,
    type DetectedGame
} from "discord-rpc";
import { SESSION_DATA_DIR } from "main/constants";
import { IpcCommands, IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";

import { sendRendererCommand } from "../ipcCommands";
import { Settings } from "../settings";
import { handle } from "../utils/ipcWrappers";

type GameDetection = {
    getGames(): DetectedGame[];
    stop(): void;
};

let server: ReturnType<typeof createRpcServer> | null = null;
let gameDetection: GameDetection | null = null;
let rendererReady = false;

function sendToRenderer(id: string, command: IpcCommands, data: unknown) {
    sendRendererCommand(command, data).catch(() => server?.close(id, CloseCode.Abnormal, "Renderer unavailable"));
}

function sendGame(game: unknown, running: boolean) {
    sendRendererCommand(IpcCommands.RPC_GAME, { game, running }).catch(() => {});
}

function startRpcServer() {
    server = createRpcServer({
        onConnect: client => sendToRenderer(client.id, IpcCommands.RPC_CONNECT, client),
        // Sent as json since objects from the bridge can't be relied on to be mutable, which Discord's handlers expect
        onRequest: (id, payload) =>
            sendToRenderer(id, IpcCommands.RPC_REQUEST, { id, payload: JSON.stringify(payload) }),
        onDisconnect: id => sendRendererCommand(IpcCommands.RPC_DISCONNECT, id).catch(() => {})
    });
}

function startSelectedGameDetection() {
    if (Settings.store.gameDetectionSource === "external") {
        gameDetection = startBridgeGameDetection({
            url: Settings.store.externalBridgeUrl,
            onChange: sendGame
        });
    } else {
        gameDetection = startGameDetection({
            nativePath: join(STATIC_DIR, `dist/game-detection-${process.arch}.node`),
            cachePath: join(SESSION_DATA_DIR, "arrpc-detectable-db.json"),
            onChange: sendGame
        });
    }
}

function start() {
    startRpcServer();
    startSelectedGameDetection();
}

function stopGameDetection() {
    gameDetection?.stop();
    gameDetection = null;
}

function stop() {
    if (!server) return;

    stopGameDetection();
    server.stop();
    server = null;

    sendRendererCommand(IpcCommands.RPC_RESET).catch(() => {});
}

handle(IpcEvents.RPC_READY, () => {
    rendererReady = true;

    if (server) {
        server.closeAll(CloseCode.Normal, "Renderer reloaded");
        gameDetection?.getGames().forEach(game => sendGame(game, true));
    } else if (Settings.store.arRPC) {
        start();
    }
});

handle(IpcEvents.RPC_SEND, (_, id: string, json: string) => server?.send(id, json));
handle(IpcEvents.RPC_CLOSE, (_, id: string, code: number, message?: string) => server?.close(id, code, message));

Settings.addChangeListener("arRPC", enabled => {
    if (!enabled) stop();
    else if (rendererReady && !server) start();
});

// Swapping the detection backend must not touch the RPC server or its
// clients, hence no RPC_RESET here: the old adapter only clears the
// games it published itself.
Settings.addChangeListener("gameDetectionSource", () => {
    if (!server) return;
    stopGameDetection();
    startSelectedGameDetection();
});

// A new bridge URL only matters for the external backend; reconnect
// against the new endpoint without touching the RPC server.
Settings.addChangeListener("externalBridgeUrl", () => {
    if (!server || Settings.store.gameDetectionSource !== "external") return;
    stopGameDetection();
    startSelectedGameDetection();
});
