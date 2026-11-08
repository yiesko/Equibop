/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CheckedTextInput, Margins, Paragraph } from "@equicord/types/components";
import { Heading } from "@equicord/types/components/Heading";
import { Select } from "@equicord/types/webpack/common";

import { SimpleErrorBoundary } from "../SimpleErrorBoundary";
import { SettingsComponent } from "./Settings";

export const GameDetectionSourcePicker: SettingsComponent = ({ settings }) => {
    return (
        <SimpleErrorBoundary>
            <div>
                <Heading tag="h5" className={Margins.bottom8}>
                    Game detection source
                </Heading>
                <Paragraph className={Margins.bottom8}>
                    Built-in detection scans your processes itself. External delegates detection to a bridge speaking
                    the consumer protocol (READY / activity / clear over WebSocket). Equibop keeps owning its own RPC
                    server either way.
                </Paragraph>
                <Select
                    placeholder="Built-in"
                    options={[
                        { label: "Built-in", value: "builtin", default: true },
                        { label: "External", value: "external" }
                    ]}
                    closeOnSelect={true}
                    select={v => (settings.gameDetectionSource = v)}
                    isSelected={v => v === settings.gameDetectionSource}
                    serialize={s => s}
                />
                {settings.gameDetectionSource === "external" && (
                    <>
                        <Heading tag="h5" className={Margins.top16}>
                            External bridge URL
                        </Heading>
                        <Paragraph className={Margins.bottom8}>
                            JSON bridge endpoint of the detector, for example ws://127.0.0.1:1337?format=json. The used
                            port is the one reported in the detector's startup log when the first port was taken.
                        </Paragraph>
                        <CheckedTextInput
                            initialValue={settings.externalBridgeUrl}
                            onChange={v => (settings.externalBridgeUrl = v)}
                            validate={v =>
                                v.startsWith("ws://") || v.startsWith("wss://") || "Must be a ws:// or wss:// URL"
                            }
                            placeholder="ws://127.0.0.1:1337?format=json"
                        />
                    </>
                )}
            </div>
        </SimpleErrorBoundary>
    );
};
