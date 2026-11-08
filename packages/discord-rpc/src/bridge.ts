/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { RunningGame } from "@vencord/game-detection";
import { WebSocket } from "ws";

export interface BridgeGameDetectionOptions {
    // JSON bridge endpoint speaking the consumer protocol
    // (READY / activity / clear frames). Any detector implementing
    // the same frames can be plugged in here without code changes:
    // point this at its bridge and select the external source.
    url: string;
    onChange(game: RunningGame, running: boolean): void;
}

interface BridgeActivity {
    application_id?: unknown;
    name?: unknown;
}

interface BridgeFrame {
    evt?: unknown;
    activity?: BridgeActivity | null;
    pid?: unknown;
    socketId?: unknown;
    path?: unknown;
}

function clearLocalGames(games: Map<string, RunningGame>, onChange: (game: RunningGame, running: boolean) => void) {
    for (const game of games.values()) onChange(game, false);
    games.clear();
}

/**
 * Feed one raw bridge frame through the adapter state. Exported for
 * tests; the socket lifecycle below is the only other caller.
 */
export function handleBridgeFrame(
    raw: string,
    games: Map<string, RunningGame>,
    onChange: (game: RunningGame, running: boolean) => void
) {
    let frame: BridgeFrame;
    try {
        frame = JSON.parse(raw);
    } catch {
        return;
    }
    if (!frame || typeof frame !== "object") return;

    // READY is the connection identity envelope, not an activity. A
    // fresh connection means the replay follows it, so drop whatever
    // this adapter still holds from a previous connection first.
    if (frame.evt === "READY") {
        clearLocalGames(games, onChange);
        return;
    }

    if (!Object.hasOwn(frame, "activity")) return;

    if (frame.activity === null) {
        const id = typeof frame.socketId === "string" ? frame.socketId : "";
        const current = games.get(id);
        if (!current) return;
        // A delayed clear for an old pid must not drop a new execution.
        if (Number.isInteger(frame.pid) && current.pid !== frame.pid) return;
        games.delete(id);
        onChange(current, false);
        return;
    }

    const activity = frame.activity;
    if (typeof activity?.application_id !== "string" || activity.application_id.length === 0) return;
    if (typeof activity?.name !== "string" || activity.name.length === 0) return;
    if (typeof frame.pid !== "number" || !Number.isInteger(frame.pid) || frame.pid <= 0) return;
    if (typeof frame.path !== "string" || frame.path.length === 0) return;

    const game: RunningGame = {
        id: activity.application_id,
        name: activity.name,
        pid: frame.pid,
        path: frame.path
    };
    games.set(game.id, game);
    onChange(game, true);
}

export function startBridgeGameDetection({ url, onChange }: BridgeGameDetectionOptions) {
    const games = new Map<string, RunningGame>();
    let stopped = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: NodeJS.Timeout | undefined;
    let reconnectAttempt = 0;

    const scheduleReconnect = () => {
        if (stopped) return;
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 10_000);
        reconnectAttempt++;
        reconnectTimer = setTimeout(connect, delay);
    };

    const onSocketLost = () => {
        clearLocalGames(games, onChange);
        scheduleReconnect();
    };

    function connect() {
        if (stopped) return;
        socket = new WebSocket(url);

        socket.on("open", () => {
            reconnectAttempt = 0;
        });

        socket.on("message", data => {
            handleBridgeFrame(data.toString(), games, onChange);
        });

        socket.on("error", error => {
            console.warn("[RPC:Bridge] Bridge connection failed:", error.message);
        });

        socket.on("close", onSocketLost);
    }

    connect();

    return {
        getGames: () => [...games.values()],
        stop() {
            stopped = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            socket?.close();
            clearLocalGames(games, onChange);
        }
    };
}
