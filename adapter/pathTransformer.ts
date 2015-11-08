/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as utils from '../webkit/utilities';

interface IPendingBreakpoint {
    resolve: () => void;
    args: ISetBreakpointsArgs;
}

/**
 * Converts a local path from Code to a path on the target.
 */
export class PathTransformer implements IDebugTransformer {
    private _clientCWD: string;
    private _clientPathToWebkitUrl = new Map<string, string>();
    private _webkitUrlToClientPath = new Map<string, string>();
    private _pendingBreakpointsByUrl = new Map<string, IPendingBreakpoint>();

    public launch(args: ILaunchRequestArgs): void {
        this._clientCWD = args.cwd;
    }

    public attach(args: IAttachRequestArgs): void {
        this._clientCWD = args.cwd;
    }

    public setBreakpoints(args: ISetBreakpointsArgs): Promise<void> {
        return new Promise<void>(resolve => {
            if (args.source.path) {
                const url = utils.canonicalizeUrl(args.source.path);
                if (this._clientPathToWebkitUrl.has(url)) {
                    args.source.path = this._clientPathToWebkitUrl.get(url);
                    resolve();
                } else {
                    utils.Logger.log(`No target url cached for client url: ${url}, waiting for target script to be loaded.`);
                    args.source.path = url;
                    this._pendingBreakpointsByUrl.set(args.source.path, { resolve, args });
                }
            }
        });
    }

    public clearClientContext(): void {
        this._pendingBreakpointsByUrl = new Map<string, IPendingBreakpoint>();
    }

    public clearTargetContext(): void {
        this._clientPathToWebkitUrl = new Map<string, string>();
    }

    public scriptParsed(event: DebugProtocol.Event): void {
        const webkitUrl: string = event.body.scriptUrl;
        const clientPath = utils.webkitUrlToClientPath(this._clientCWD, webkitUrl);
        this._clientPathToWebkitUrl.set(clientPath, webkitUrl);
        event.body.scriptUrl = clientPath;

        if (this._pendingBreakpointsByUrl.has(clientPath)) {
            const pendingBreakpoint = this._pendingBreakpointsByUrl.get(clientPath);
            this._pendingBreakpointsByUrl.delete(clientPath);
            this.setBreakpoints(pendingBreakpoint.args).then(pendingBreakpoint.resolve);
        }
    }

    public stackTraceResponse(response: StackTraceResponseBody): void {
        response.stackFrames.forEach(frame => {
            // Try to resolve the url to a path in the workspace. If it's not in the workspace,
            // just use the script.url as-is.
            if (frame.source.path) {
                const clientPath = utils.webkitUrlToClientPath(this._clientCWD, frame.source.path);
                if (clientPath) {
                    frame.source.path = clientPath;
                }
            }
        });
    }
}
