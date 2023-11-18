import { BucketCannedACL, PutObjectCommandInput } from '@aws-sdk/client-s3';
import { Actions, Page, PluginOptions } from 'gatsby';
export declare const CACHE_FILES: {
    config: string;
    params: string;
    routingRules: string;
    redirectObjects: string;
};
export declare type GatsbyRedirect = Parameters<Actions['createRedirect']>[0];
export interface GatsbyState {
    redirects: GatsbyRedirect[];
    pages: Map<string, Page>;
    program: {
        directory: string;
    };
}
export declare type Params = {
    [k in string]: Partial<PutObjectCommandInput>;
};
export interface S3PluginOptions extends PluginOptions {
    bucketName: string;
    bucketPrefix?: string;
    region?: string;
    protocol?: 'http' | 'https';
    hostname?: string;
    params?: Params;
    acl?: null | BucketCannedACL;
    mergeCachingParams?: boolean;
    generateRoutingRules?: boolean;
    generateRedirectObjectsForPermanentRedirects?: boolean;
    generateIndexPageForRedirect?: boolean;
    generateMatchPathRewrites?: boolean;
    removeNonexistentObjects?: boolean;
    retainObjectsPatterns?: string[];
    customAwsEndpointHostname?: string;
    enableS3StaticWebsiteHosting?: boolean;
    parallelLimit?: number;
    maxRetries?: number;
    connectTimeout?: number;
    timeout?: number;
    fixedRetryDelay?: number;
    verbose?: boolean;
}
export declare const DEFAULT_OPTIONS: S3PluginOptions;
export declare const CACHING_PARAMS: Params;
