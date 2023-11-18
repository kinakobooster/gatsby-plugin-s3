"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getS3WebsiteDomainUrl = exports.withTrailingSlash = exports.withoutTrailingSlash = exports.withoutLeadingSlash = void 0;
const withoutLeadingSlash = (s) => (s.startsWith('/') ? s.substring(1) : s);
exports.withoutLeadingSlash = withoutLeadingSlash;
const withoutTrailingSlash = (s) => (s.endsWith('/') ? s.substring(0, s.length - 1) : s);
exports.withoutTrailingSlash = withoutTrailingSlash;
const withTrailingSlash = (s) => (s.endsWith('/') ? s : `${s}/`);
exports.withTrailingSlash = withTrailingSlash;
const oldRegions = [
    'ap-northeast-1',
    'ap-southeast-1',
    'ap-southeast-2',
    'eu-west-1',
    'sa-east-1',
    'us-east-1',
    'us-gov-west-1',
    'us-west-1',
    'us-west-2',
];
// Inspired by Terraform implementation:
// https://git.io/fjr2Q
const getS3WebsiteDomainUrl = (region) => {
    // New regions uses different syntax for website endpoints
    // http://docs.aws.amazon.com/AmazonS3/latest/dev/WebsiteEndpoints.html
    if (oldRegions.includes(region)) {
        return `s3-website-${region}.amazonaws.com`;
    }
    return `s3-website.${region}.amazonaws.com`;
};
exports.getS3WebsiteDomainUrl = getS3WebsiteDomainUrl;
//# sourceMappingURL=utilities.js.map