#!/usr/bin/env node
import '@babel/polyfill';
import 'fs-posix';
import { ProxyAgent } from 'proxy-agent';
export interface DeployArguments {
    yes?: boolean;
    bucket?: string;
    userAgent?: string;
}
export declare const makeAgent: (proxy?: string | undefined) => ProxyAgent | undefined;
export declare const deploy: ({ yes, bucket, userAgent }?: DeployArguments) => Promise<void>;
