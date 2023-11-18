"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onPostBuild = exports.onPreBootstrap = void 0;
const constants_1 = require("./constants");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const utilities_1 = require("./utilities");
const buildCondition = (redirectPath) => {
    return {
        KeyPrefixEquals: (0, utilities_1.withoutLeadingSlash)(redirectPath),
    };
};
const buildRedirect = (pluginOptions, route) => {
    if (route.toPath.indexOf('://') > 0) {
        const url = new url_1.URL(route.toPath);
        return {
            ReplaceKeyWith: (0, utilities_1.withoutTrailingSlash)((0, utilities_1.withoutLeadingSlash)(url.href.replace(url.origin, ''))),
            HttpRedirectCode: route.isPermanent ? '301' : '302',
            Protocol: url.protocol.slice(0, -1),
            HostName: url.hostname,
        };
    }
    return {
        ReplaceKeyWith: (0, utilities_1.withoutTrailingSlash)((0, utilities_1.withoutLeadingSlash)(route.toPath)),
        HttpRedirectCode: route.isPermanent ? '301' : '302',
        Protocol: pluginOptions.protocol,
        HostName: pluginOptions.hostname,
    };
};
// converts gatsby redirects + rewrites to S3 routing rules
// https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-websiteconfiguration-routingrules.html
const getRules = (pluginOptions, routes) => routes
    .map(route => ({
    Condition: Object.assign({}, buildCondition(route.fromPath)),
    Redirect: Object.assign({}, buildRedirect(pluginOptions, route)),
}))
    // Disallow infinite redirects (child page to parent)
    // See https://github.com/gatsby-uc/gatsby-plugin-s3/issues/207
    .filter(rule => {
    var _a;
    return (!((_a = rule.Redirect.ReplaceKeyWith) === null || _a === void 0 ? void 0 : _a.startsWith(rule.Condition.KeyPrefixEquals || '')));
});
let params = {};
const onPreBootstrap = ({ reporter }, { bucketName }) => {
    if (!bucketName) {
        reporter.panic(`
      "bucketName" is a required option for gatsby-plugin-s3
      See docs here - https://github.com/jariz/gatsby-plugin-s3
      `);
        process.exit(1);
    }
    params = {};
};
exports.onPreBootstrap = onPreBootstrap;
// sort of (w)hack. https://i.giphy.com/media/iN5qfn8S2qVgI/giphy.webp
// the syntax that gatsby invented here does not work with routing rules.
// routing rules syntax is `/app/` not `/app/*` (it's basically prefix by default)
const normalisePath = (path) => {
    return path.endsWith('*')
        ? path.slice(0, -1)
        : path;
};
const onPostBuild = ({ store }, userPluginOptions) => {
    const pluginOptions = Object.assign(Object.assign({}, constants_1.DEFAULT_OPTIONS), userPluginOptions);
    const { redirects, pages, program } = store.getState();
    if (!pluginOptions.hostname !== !pluginOptions.protocol) {
        // If one of these is provided but not the other
        throw new Error(`Please either provide both 'hostname' and 'protocol', or neither of them.`);
    }
    let rewrites = [];
    if (pluginOptions.generateMatchPathRewrites) {
        rewrites = Array.from(pages.values())
            .filter((page) => !!page.matchPath && normalisePath(page.matchPath) !== page.path)
            .map(page => ({
            fromPath: normalisePath(page.matchPath),
            toPath: page.path,
        }));
    }
    if (pluginOptions.mergeCachingParams) {
        const prefixedCachingParams = Object.entries(constants_1.CACHING_PARAMS)
            .map(([key, val]) => [pluginOptions.bucketPrefix ? `${pluginOptions.bucketPrefix}/${key}` : key, val])
            .reduce((obj, [key, val]) => (Object.assign(Object.assign({}, obj), { [key]: val })), {});
        params = Object.assign(Object.assign({}, params), prefixedCachingParams);
    }
    params = Object.assign(Object.assign({}, params), pluginOptions.params);
    let routingRules = [];
    let slsRoutingRules = [];
    const temporaryRedirects = redirects
        .filter(redirect => redirect.fromPath !== '/')
        .filter(redirect => !redirect.isPermanent);
    const permanentRedirects = redirects
        .filter(redirect => redirect.fromPath !== '/')
        .filter(redirect => redirect.isPermanent);
    // Generate routing rules for all non-home pages
    if (pluginOptions.generateRoutingRules) {
        routingRules = [...getRules(pluginOptions, temporaryRedirects), ...getRules(pluginOptions, rewrites)];
        // Don't create routing rules for permanants if using redirect objects
        if (!pluginOptions.generateRedirectObjectsForPermanentRedirects) {
            routingRules.push(...getRules(pluginOptions, permanentRedirects));
        }
        if (routingRules.length > 50) {
            throw new Error(`${routingRules.length} routing rules provided, the number of routing rules 
in a website configuration is limited to 50.
Try setting the 'generateRedirectObjectsForPermanentRedirects' configuration option.`);
        }
        slsRoutingRules = routingRules.map(({ Redirect: redirect, Condition: condition }) => ({
            RoutingRuleCondition: condition,
            RedirectRule: redirect,
        }));
    }
    // Calculate permanant redirects
    let redirectObjects = [];
    if (pluginOptions.generateRedirectObjectsForPermanentRedirects) {
        redirectObjects = redirects
            .filter(redirect => redirect.fromPath !== '/')
            .filter(redirect => redirect.isPermanent);
    }
    // Home page is a special redirect
    if (pluginOptions.generateIndexPageForRedirect) {
        const indexRedirect = redirects
            .find(redirect => redirect.fromPath === '/');
        if (indexRedirect) {
            redirectObjects.push({
                fromPath: '/index.html',
                toPath: indexRedirect.toPath,
            });
        }
    }
    fs_1.default.writeFileSync(path_1.default.join(program.directory, './.cache/s3.routingRules.json'), JSON.stringify(routingRules));
    fs_1.default.writeFileSync(path_1.default.join(program.directory, './.cache/s3.sls.routingRules.json'), JSON.stringify(slsRoutingRules));
    if (redirectObjects.length > 0) {
        fs_1.default.writeFileSync(path_1.default.join(program.directory, './.cache/s3.redirectObjects.json'), JSON.stringify(redirectObjects));
    }
    fs_1.default.writeFileSync(path_1.default.join(program.directory, './.cache/s3.params.json'), JSON.stringify(params));
    fs_1.default.writeFileSync(path_1.default.join(program.directory, './.cache/s3.config.json'), JSON.stringify(pluginOptions));
};
exports.onPostBuild = onPostBuild;
//# sourceMappingURL=gatsby-node.js.map