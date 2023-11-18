#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deploy = exports.makeAgent = void 0;
require("@babel/polyfill");
require("fs-posix");
const client_s3_1 = require("@aws-sdk/client-s3");
const yargs_1 = __importDefault(require("yargs"));
const constants_1 = require("./constants");
const fs_extra_1 = require("fs-extra");
const klaw_1 = __importDefault(require("klaw"));
const pretty_error_1 = __importDefault(require("pretty-error"));
const stream_to_promise_1 = __importDefault(require("stream-to-promise"));
const ora_1 = __importDefault(require("ora"));
const chalk_1 = __importDefault(require("chalk"));
const path_1 = require("path");
const url_1 = require("url");
const fs_1 = __importDefault(require("fs"));
const util_1 = __importDefault(require("util"));
const minimatch_1 = require("minimatch");
const mime_1 = __importDefault(require("mime"));
const inquirer_1 = __importDefault(require("inquirer"));
const crypto_1 = require("crypto");
const is_ci_1 = __importDefault(require("is-ci"));
const utilities_1 = require("./utilities");
const async_1 = require("async");
const proxy_agent_1 = require("proxy-agent");
const node_http_handler_1 = require("@aws-sdk/node-http-handler");
const util_retry_1 = require("@aws-sdk/util-retry");
const lib_storage_1 = require("@aws-sdk/lib-storage");
const pe = new pretty_error_1.default();
const OBJECTS_TO_REMOVE_PER_REQUEST = 1000;
const promisifiedParallelLimit = util_1.default.promisify(async_1.parallelLimit);
const guessRegion = async (region) => {
    if (!region) {
        return undefined;
    }
    if (typeof region === 'string') {
        return region;
    }
    return region();
};
const isNoSuchBucket = (error) => "name" in error && error.name === 'NoSuchBucket';
const getBucketInfo = async (config, s3) => {
    try {
        const responseData = await s3.getBucketLocation({ Bucket: config.bucketName });
        const detectedRegion = await guessRegion((responseData === null || responseData === void 0 ? void 0 : responseData.LocationConstraint) || config.region || s3.config.region);
        return {
            exists: true,
            region: detectedRegion,
        };
    }
    catch (ex) {
        if (isNoSuchBucket(ex)) {
            return {
                exists: false,
                region: await guessRegion(config.region || s3.config.region),
            };
        }
        throw ex;
    }
};
const getParams = (path, params) => {
    let returned = {};
    for (const key of Object.keys(params)) {
        if ((0, minimatch_1.minimatch)(path, key)) {
            returned = Object.assign(Object.assign({}, returned), params[key]);
        }
    }
    return returned;
};
const listAllObjects = async (s3, bucketName, bucketPrefix) => {
    const list = [];
    let token = null;
    do {
        const response = await s3
            .listObjectsV2(Object.assign({ Bucket: bucketName, Prefix: bucketPrefix }, (token ? { ContinuationToken: token } : {})));
        if (response.Contents) {
            list.push(...response.Contents);
        }
        token = response.NextContinuationToken;
    } while (token);
    return list;
};
const createSafeS3Key = (key) => {
    if (path_1.sep === '\\') {
        return key.replace(/\\/g, '/');
    }
    return key;
};
const makeAgent = (proxy) => proxy
    ? new proxy_agent_1.ProxyAgent({ getProxyForUrl: () => proxy })
    : undefined;
exports.makeAgent = makeAgent;
const deploy = async ({ yes, bucket, userAgent } = {}) => {
    const spinner = (0, ora_1.default)({ text: 'Retrieving bucket info...', color: 'magenta', stream: process.stdout }).start();
    let dontPrompt = yes;
    const uploadQueue = [];
    try {
        const config = await (0, fs_extra_1.readJson)(constants_1.CACHE_FILES.config);
        const params = await (0, fs_extra_1.readJson)(constants_1.CACHE_FILES.params);
        const routingRules = await (0, fs_extra_1.readJson)(constants_1.CACHE_FILES.routingRules);
        const redirectObjects = fs_1.default.existsSync(constants_1.CACHE_FILES.redirectObjects)
            ? await (0, fs_extra_1.readJson)(constants_1.CACHE_FILES.redirectObjects)
            : [];
        // Override the bucket name if it is set via command line
        if (bucket) {
            config.bucketName = bucket;
        }
        const maxRetries = config.maxRetries || constants_1.DEFAULT_OPTIONS.maxRetries;
        const s3 = new client_s3_1.S3({
            region: config.region,
            endpoint: config.customAwsEndpointHostname,
            customUserAgent: userAgent !== null && userAgent !== void 0 ? userAgent : '',
            requestHandler: new node_http_handler_1.NodeHttpHandler({
                httpAgent: (0, exports.makeAgent)(process.env.HTTP_PROXY),
                httpsAgent: (0, exports.makeAgent)(process.env.HTTPS_PROXY),
                requestTimeout: config.timeout,
                connectionTimeout: config.connectTimeout,
            }),
            logger: config.verbose ? console : undefined,
            retryStrategy: config.fixedRetryDelay
                ? new util_retry_1.ConfiguredRetryStrategy(maxRetries, config.fixedRetryDelay)
                : new util_retry_1.StandardRetryStrategy(maxRetries),
        });
        const { exists, region } = await getBucketInfo(config, s3);
        if (is_ci_1.default && !dontPrompt) {
            dontPrompt = true;
        }
        if (!dontPrompt) {
            spinner.stop();
            console.log((0, chalk_1.default) `
    {underline Please review the following:} ({dim pass -y next time to skip this})

    Deploying to bucket: {cyan.bold ${config.bucketName}}
    In region: {yellow.bold ${region !== null && region !== void 0 ? region : 'UNKNOWN!'}}
    Gatsby will: ${!exists
                ? (0, chalk_1.default) `{bold.greenBright CREATE}`
                : (0, chalk_1.default) `{bold.blueBright UPDATE} {dim (any existing website configuration will be overwritten!)}`}
`);
            const { confirm } = await inquirer_1.default.prompt([
                {
                    message: 'OK?',
                    name: 'confirm',
                    type: 'confirm',
                },
            ]);
            if (!confirm) {
                console.error('User aborted!');
                process.exit(1);
                return;
            }
            spinner.start();
        }
        spinner.text = 'Configuring bucket...';
        spinner.color = 'yellow';
        if (!exists) {
            const createParams = {
                Bucket: config.bucketName,
                ObjectOwnership: "BucketOwnerPreferred",
            };
            // If non-default region, specify it here (us-east-1 is default)
            if (config.region && config.region !== 'us-east-1') {
                createParams.CreateBucketConfiguration = {
                    LocationConstraint: config.region,
                };
            }
            await s3.createBucket(createParams);
            // Setup static hosting
            if (config.enableS3StaticWebsiteHosting) {
                const publicBlockConfig = {
                    Bucket: config.bucketName,
                };
                await s3.deletePublicAccessBlock(publicBlockConfig);
            }
            // Set public policy
            if (config.acl === undefined || config.acl === 'public-read') {
                await s3.putBucketPolicy({
                    Bucket: config.bucketName,
                    Policy: JSON.stringify({
                        "Version": "2012-10-17",
                        "Statement": [
                            {
                                "Sid": "PublicReadGetObject",
                                "Effect": "Allow",
                                "Principal": "*",
                                "Action": [
                                    "s3:GetObject"
                                ],
                                "Resource": [
                                    `arn:aws:s3:::${config.bucketName}/*`
                                ]
                            }
                        ]
                    })
                });
            }
        }
        if (config.enableS3StaticWebsiteHosting) {
            const websiteConfig = {
                Bucket: config.bucketName,
                WebsiteConfiguration: Object.assign({ IndexDocument: {
                        Suffix: 'index.html',
                    }, ErrorDocument: {
                        Key: '404.html',
                    } }, (routingRules.length ? { RoutingRules: routingRules } : {})),
            };
            await s3.putBucketWebsite(websiteConfig);
        }
        spinner.text = 'Listing objects...';
        spinner.color = 'green';
        const objects = await listAllObjects(s3, config.bucketName, config.bucketPrefix);
        const keyToETagMap = objects.reduce((acc, curr) => {
            if (curr.Key && curr.ETag) {
                acc[curr.Key] = curr.ETag;
            }
            return acc;
        }, {});
        spinner.color = 'cyan';
        spinner.text = 'Syncing...';
        const publicDir = (0, path_1.resolve)('./public');
        const stream = (0, klaw_1.default)(publicDir);
        const isKeyInUse = {};
        stream.on('data', ({ path, stats }) => {
            if (!stats.isFile()) {
                return;
            }
            uploadQueue.push((0, async_1.asyncify)(async () => {
                var _a, _b;
                let key = createSafeS3Key((0, path_1.relative)(publicDir, path));
                if (config.bucketPrefix) {
                    key = `${config.bucketPrefix}/${key}`;
                }
                const readStream = fs_1.default.createReadStream(path);
                const hashStream = readStream.pipe((0, crypto_1.createHash)('md5').setEncoding('hex'));
                const data = await (0, stream_to_promise_1.default)(hashStream);
                const tag = `"${data}"`;
                const objectUnchanged = keyToETagMap[key] === tag;
                isKeyInUse[key] = true;
                if (!objectUnchanged) {
                    try {
                        const upload = new lib_storage_1.Upload({
                            client: s3,
                            params: Object.assign({ Bucket: config.bucketName, Key: key, Body: fs_1.default.createReadStream(path), ACL: config.acl === null ? undefined : (_a = config.acl) !== null && _a !== void 0 ? _a : 'public-read', ContentType: (_b = mime_1.default.getType(path)) !== null && _b !== void 0 ? _b : 'application/octet-stream' }, getParams(key, params)),
                        });
                        upload.on('httpUploadProgress', evt => {
                            var _a, _b;
                            spinner.text = (0, chalk_1.default) `Syncing...
{dim   Uploading {cyan ${key}} ${(_a = evt.loaded) === null || _a === void 0 ? void 0 : _a.toString()}/${(_b = evt.total) === null || _b === void 0 ? void 0 : _b.toString()}}`;
                        });
                        await upload.done();
                        spinner.text = (0, chalk_1.default) `Syncing...\n{dim   Uploaded {cyan ${key}}}`;
                    }
                    catch (ex) {
                        console.error(ex);
                        process.exit(1);
                    }
                }
            }));
        });
        const base = config.protocol && config.hostname ? `${config.protocol}://${config.hostname}` : null;
        redirectObjects.forEach(redirect => uploadQueue.push((0, async_1.asyncify)(async () => {
            var _a;
            const { fromPath, toPath: redirectPath } = redirect;
            const redirectLocation = base ? (0, url_1.resolve)(base, redirectPath) : redirectPath;
            let key = (0, utilities_1.withoutLeadingSlash)(fromPath);
            if (key.endsWith('/')) {
                key = (0, path_1.join)(key, 'index.html');
            }
            key = createSafeS3Key(key);
            if (config.bucketPrefix) {
                key = (0, utilities_1.withoutLeadingSlash)(`${config.bucketPrefix}/${key}`);
            }
            const tag = `"${(0, crypto_1.createHash)('md5')
                .update(redirectLocation)
                .digest('hex')}"`;
            const objectUnchanged = keyToETagMap[key] === tag;
            isKeyInUse[key] = true;
            if (objectUnchanged) {
                // object with exact hash already exists, abort.
                return;
            }
            try {
                const upload = new lib_storage_1.Upload({
                    client: s3,
                    params: Object.assign({ Bucket: config.bucketName, Key: key, Body: redirectLocation, ACL: config.acl === null ? undefined : (_a = config.acl) !== null && _a !== void 0 ? _a : 'public-read', ContentType: 'application/octet-stream', WebsiteRedirectLocation: redirectLocation }, getParams(key, params)),
                });
                await upload.done();
                spinner.text = (0, chalk_1.default) `Syncing...
{dim   Created Redirect {cyan ${key}} => {cyan ${redirectLocation}}}\n`;
            }
            catch (ex) {
                spinner.fail((0, chalk_1.default) `Upload failure for object {cyan ${key}}`);
                console.error(pe.render(ex));
                process.exit(1);
            }
        })));
        await (0, stream_to_promise_1.default)(stream);
        await promisifiedParallelLimit(uploadQueue, config.parallelLimit);
        if (config.removeNonexistentObjects) {
            const objectsToRemove = objects
                .map(obj => ({ Key: obj.Key }))
                .filter(obj => {
                var _a;
                if (!obj.Key || isKeyInUse[obj.Key])
                    return false;
                for (const glob of (_a = config.retainObjectsPatterns) !== null && _a !== void 0 ? _a : []) {
                    if ((0, minimatch_1.minimatch)(obj.Key, glob)) {
                        return false;
                    }
                }
                return true;
            });
            for (let i = 0; i < objectsToRemove.length; i += OBJECTS_TO_REMOVE_PER_REQUEST) {
                const objectsToRemoveInThisRequest = objectsToRemove.slice(i, i + OBJECTS_TO_REMOVE_PER_REQUEST);
                spinner.text = `Removing objects ${i + 1} to ${i + objectsToRemoveInThisRequest.length} of ${objectsToRemove.length}`;
                await s3
                    .deleteObjects({
                    Bucket: config.bucketName,
                    Delete: {
                        Objects: objectsToRemoveInThisRequest,
                        Quiet: true,
                    },
                });
            }
        }
        spinner.succeed('Synced.');
        if (config.enableS3StaticWebsiteHosting) {
            const s3WebsiteDomain = (0, utilities_1.getS3WebsiteDomainUrl)(region !== null && region !== void 0 ? region : 'us-east-1');
            console.log((0, chalk_1.default) `
            {bold Your website is online at:}
            {blue.underline http://${config.bucketName}.${s3WebsiteDomain}}
            `);
        }
        else {
            console.log((0, chalk_1.default) `
            {bold Your website has now been published to:}
            {blue.underline ${config.bucketName}}
            `);
        }
    }
    catch (ex) {
        spinner.fail('Failed.');
        console.error(pe.render(ex));
        process.exit(1);
    }
};
exports.deploy = deploy;
yargs_1.default
    .command(['deploy', '$0'], "Deploy bucket. If it doesn't exist, it will be created. Otherwise, it will be updated.", args => args
    .option('yes', {
    alias: 'y',
    describe: 'Skip confirmation prompt',
    type: "boolean",
    boolean: true
})
    .option('bucket', {
    alias: 'b',
    describe: 'Bucket name (if you wish to override default bucket name)',
    type: "string"
})
    .option('userAgent', {
    describe: 'Allow appending custom text to the User Agent string (Used in automated tests)',
    type: "string"
}), async (argv) => (0, exports.deploy)(argv))
    .wrap(yargs_1.default.terminalWidth())
    .demandCommand(1, `Pass --help to see all available commands and options.`)
    .strict()
    .showHelpOnFail(true)
    .recommendCommands()
    .parse(process.argv.slice(2));
//# sourceMappingURL=bin.js.map