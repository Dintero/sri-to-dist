import * as assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import {
    alterTag,
    calculateSha384,
    extractImports,
    extractLinkRel,
    fetchRemoteContent,
    getContent,
    handleUpdatedHtml,
    isImportMapTag,
    isSriTag,
    parseImportMap,
    readLocalContent,
    toHtmlWithSri,
    toSriImportMap,
    toSriScriptTag,
} from "../src/lib";

const stringToArrayBuffer = (str: string): ArrayBuffer => {
    const encoder = new TextEncoder();
    return encoder.encode(str).buffer;
};

describe("sri-to-dist-lib", () => {
    let mockFetch = mock.fn<typeof global.fetch>();
    let tempDir: string;

    beforeEach(() => {
        mockFetch = mock.fn();
        global.fetch = mockFetch;
        mock.method(console, "error", () => {});
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sri-to-dist-test-"));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        mock.restoreAll();
    });

    describe("isSriTag", () => {
        test("should identify link style as SRI tag", () => {
            const tag = '<link rel="style" />';
            assert.ok(isSriTag(tag));
        });
        test("should identify link stylesheet as SRI tag", () => {
            const tag = '<link rel="stylesheet" />';
            assert.ok(isSriTag(tag));
        });

        test("should identify link preload and style as SRI tag", () => {
            const tag = '<link rel="preload style"/>';
            assert.ok(isSriTag(tag));
        });

        test("should identify link preload and stylesheet as SRI tag", () => {
            const tag = '<link rel="preload stylesheet"/>';
            assert.ok(isSriTag(tag));
        });

        test("should identify link preload as style as SRI tag", () => {
            const tag = '<link rel="preload" as="style" />';
            assert.ok(isSriTag(tag));
        });

        test("should identify link preload as script as SRI tag", () => {
            const tag = '<link rel="preload" as="script" />';
            assert.ok(isSriTag(tag));
        });

        test("should not identify link preload as font as SRI tag", () => {
            const tag = '<link rel="preload" as="font" />';
            assert.equal(isSriTag(tag), false);
        });

        test("should identify link modulepreload as SRI tag", () => {
            const tag = '<link rel="modulepreload" />';
            assert.ok(isSriTag(tag));
        });

        test("should identify link modulepreload as script as SRI tag", () => {
            const tag = '<link rel="modulepreload" as="script" />';
            assert.ok(isSriTag(tag));
        });

        test("should not identify link author as SRI tag", () => {
            const tag = '<link rel="author"/>';
            assert.equal(isSriTag(tag), false);
        });

        test("should not identify meta as SRI tag", () => {
            const tag = '<meta charset="UTF-8">';
            assert.equal(isSriTag(tag), false);
        });
    });

    describe("isImportMapTag", () => {
        test("should identify script type importmap as importmap", () => {
            const tag = '<script type="importmap"></script>';
            assert.ok(isImportMapTag(tag));
        });

        test("should identify script type importmap as importmap with extra attributes", () => {
            const tag =
                '<script id="map" type="importmap" data-attr="generated-by-tool-x"></script>';
            assert.ok(isImportMapTag(tag));
        });

        test("should identify other script type as not an import map", () => {
            const tag = '<script type="other"></script>';
            assert.equal(isImportMapTag(tag), false);
        });

        test("should identify script with missing type as not an import map", () => {
            const tag = "<script></script>";
            assert.equal(isImportMapTag(tag), false);
        });

        test("should identify other type of tag not an import map", () => {
            const tag = '<link rel="author"/>';
            assert.equal(isImportMapTag(tag), false);
        });

        test("should identify other type of tag not an import map", () => {
            const tag = '<link rel="other" type="importmap"/>';
            assert.equal(isImportMapTag(tag), false);
        });
    });

    describe("parseImportMap", () => {
        test("should extract json in importmap", () => {
            const tag =
                '<script type="importmap">{"imports":{"app":"./app.js"}}</script>';
            assert.deepEqual(parseImportMap(tag), {
                imports: { app: "./app.js" },
            });
        });

        test("should extract json in importmap with extra attributes", () => {
            const tag =
                '<script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./app.js"}}</script>';
            assert.deepEqual(parseImportMap(tag), {
                imports: { app: "./app.js" },
            });
        });

        test("should throw if importmap is empty", () => {
            const tag = '<script type="importmap"></script>';
            assert.throws(
                () => parseImportMap(tag),
                (err) => {
                    assert.ok(err instanceof Error);
                    assert.equal(
                        err.message,
                        `Failed to parse import map for tag ${tag}`,
                    );
                    return true;
                },
            );
        });

        test("should throw if importmap is self closed tag", () => {
            const tag = '<script type="importmap" />';
            assert.throws(
                () => parseImportMap(tag),
                (err) => {
                    assert.ok(err instanceof Error);
                    assert.equal(
                        err.message,
                        `Failed to parse import map for tag ${tag}`,
                    );
                    return true;
                },
            );
        });

        test("should throw if content is not json", () => {
            const tag = '<script type="importmap">Not a json object</script>';
            assert.throws(
                () => parseImportMap(tag),
                (err) => {
                    assert.ok(err instanceof Error);
                    assert.equal(
                        err.message,
                        `Failed to parse import map for tag ${tag}`,
                    );
                    return true;
                },
            );
        });

        test("should throw if content is wrong tag type", () => {
            const tag = '<link rel="other" type="importmap"/>';
            assert.throws(
                () => parseImportMap(tag),
                (err) => {
                    assert.ok(err instanceof Error);
                    assert.equal(
                        err.message,
                        `Failed to parse import map for tag ${tag}`,
                    );
                    return true;
                },
            );
        });
    });

    describe("extractImports", () => {
        test("should extract imports from importmap", () => {
            const importMapJson = {
                imports: {
                    app: "./app.js",
                },
            };

            assert.deepEqual(extractImports(importMapJson), [
                {
                    src: "./app.js",
                    oldHash: undefined,
                },
            ]);
        });

        test("should extract imports with old integrity hash from importmap", () => {
            const importMapJson = {
                imports: {
                    app: "./app.js",
                },
                integrity: {
                    "./app.js": "sha384-test",
                },
            };
            assert.deepEqual(extractImports(importMapJson), [
                {
                    src: "./app.js",
                    oldHash: "sha384-test",
                },
            ]);
        });

        test("should create empty list if imports is empty", () => {
            const importMapJson = { imports: {} };
            assert.deepEqual(extractImports(importMapJson), []);
        });

        test("should create empty list if no imports found", () => {
            const importMapJson = {};
            // @ts-expect-error
            assert.deepEqual(extractImports(importMapJson), []);
        });
    });

    describe("toSriImportMap", () => {
        test("should create updated importmap tag with integrity object", () => {
            const tag =
                '<script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./app.js"}, "other":{"key": "value"}}</script>';
            const importMapJson = {
                imports: {
                    app: "./app.js",
                },
                other: {
                    key: "value",
                },
            };
            const newIntegrityMap = {
                "./app.js": "sha384-test",
            };
            assert.equal(
                toSriImportMap(tag, importMapJson, newIntegrityMap),
                `<script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./app.js"},"other":{"key":"value"},"integrity":{"./app.js":"sha384-test"}}</script>`,
            );
        });
        test("should create importmap tag with updated integrity object", () => {
            const tag =
                '<script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./app.js"}, "integrity":{"./app.js": "sha384-old"}, "other":{"key": "value"}}</script>';
            const importMapJson = {
                imports: {
                    app: "./app.js",
                },
                integrity: {
                    "./app.js": "sha384-old",
                },
                other: {
                    key: "value",
                },
            };
            const newIntegrityMap = {
                "./app.js": "sha384-test",
            };
            assert.equal(
                toSriImportMap(tag, importMapJson, newIntegrityMap),
                `<script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./app.js"},"integrity":{"./app.js":"sha384-test"},"other":{"key":"value"}}</script>`,
            );
        });
    });

    describe("extractLinkRel", () => {
        test("should return undefined for script tag", () => {
            const tag = '<script src="./app.js" />';
            assert.equal(extractLinkRel(tag), undefined);
        });

        test("should return undefined for link tag without rel", () => {
            const tag = "<link />";
            assert.equal(extractLinkRel(tag), undefined);
        });

        test("should extract rel value from link tag", () => {
            const tag = '<link rel="hello" />';
            assert.equal(extractLinkRel(tag), "hello");
        });
    });

    describe("toHtmlWithSri", () => {
        test("should add integrity attributes to script tags", async () => {
            const baseUrl = "";
            // Note uses fixture app.js file from /example folder
            const htmlContent = `<html><head><title>index</title><script src="example/app.js"></head><body>Hello world!s</body></html>`;
            const result = await toHtmlWithSri(
                htmlContent,
                path.dirname(path.join(process.cwd(), "index.html")),
                baseUrl,
                false,
                false,
            );

            const expected =
                '<html><head><title>index</title><script src="example/app.js" integrity="sha384-wU4WKzlcdNRZlPFH/ryF/H7DbuSWr8HLZh+p22IX9KQTcDXNAYiYBlK8Kw51nTgC" crossorigin="anonymous"></head><body>Hello world!s</body></html>';
            assert.equal(result, expected);
        });

        test("should add integrity attributes to script tags when verifying valid integrity hash", async () => {
            const baseUrl = "";
            // Note uses fixture app.js file from /example folder
            const htmlContent = `<html><head><title>index</title><script src="example/app.js" integrity="sha384-wU4WKzlcdNRZlPFH/ryF/H7DbuSWr8HLZh+p22IX9KQTcDXNAYiYBlK8Kw51nTgC"></head><body>Hello world!s</body></html>`;
            const result = await toHtmlWithSri(
                htmlContent,
                path.dirname(path.join(process.cwd(), "index.html")),
                baseUrl,
                false,
                true,
            );

            const expected =
                '<html><head><title>index</title><script src="example/app.js" integrity="sha384-wU4WKzlcdNRZlPFH/ryF/H7DbuSWr8HLZh+p22IX9KQTcDXNAYiYBlK8Kw51nTgC" crossorigin="anonymous"></head><body>Hello world!s</body></html>';
            assert.equal(result, expected);
        });

        test("should raise when verifying non existing integrity hash", async () => {
            const baseUrl = "";
            // Note uses fixture app.js file from /example folder
            const htmlContent = `<html><head><title>index</title><script src="example/app.js"></head><body>Hello world!s</body></html>`;

            await assert.rejects(
                () =>
                    toHtmlWithSri(
                        htmlContent,
                        path.dirname(path.join(process.cwd(), "index.html")),
                        baseUrl,
                        false,
                        true,
                    ),
                /Missing hash for example\/app.js, expected sha384-wU4WKzlcdNRZlPFH\/ryF\/H7DbuSWr8HLZh\+p22IX9KQTcDXNAYiYBlK8Kw51nTgC/,
            );
        });

        test("should raise when verifying wrong integrity hash", async () => {
            const baseUrl = "";
            // Note uses fixture app.js file from /example folder
            const htmlContent = `<html><head><title>index</title><script src="example/app.js" integrity="bad-hash"></head><body>Hello world!s</body></html>`;

            await assert.rejects(
                () =>
                    toHtmlWithSri(
                        htmlContent,
                        path.dirname(path.join(process.cwd(), "index.html")),
                        baseUrl,
                        false,
                        true,
                    ),
                /Invalid hash bad-hash for example\/app.js, expected sha384-wU4WKzlcdNRZlPFH\/ryF\/H7DbuSWr8HLZh\+p22IX9KQTcDXNAYiYBlK8Kw51nTgC/,
            );
        });

        test("should add integrity to importmap script tags", async () => {
            const baseUrl = "";
            // Note uses fixture app.js file from /example folder
            const htmlContent = `<html><head><title>index</title><script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./example/app.js"}, "other":{"key": "value"}}</script></head><body>Hello world!s</body></html>`;
            const result = await toHtmlWithSri(
                htmlContent,
                path.dirname(path.join(process.cwd(), "index.html")),
                baseUrl,
                false,
                false,
            );
            const expected =
                '<html><head><title>index</title><script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./example/app.js"},"other":{"key":"value"},"integrity":{"./example/app.js":"sha384-wU4WKzlcdNRZlPFH/ryF/H7DbuSWr8HLZh+p22IX9KQTcDXNAYiYBlK8Kw51nTgC"}}</script></head><body>Hello world!s</body></html>';
            assert.equal(result, expected);
        });
    });

    describe("readLocalContent", () => {
        test("should read file content", () => {
            const baseDir = tempDir;
            const baseUrl = "";
            const src = "app.js";
            const filePath = path.join(tempDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const result = readLocalContent(src, baseDir, baseUrl);
            assert.equal(result.toString(), localContent);
        });

        test("should read file content with relative src", () => {
            const baseDir = tempDir;
            const baseUrl = "";
            const src = "./app.js";
            const filePath = path.join(tempDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const result = readLocalContent(src, baseDir, baseUrl);
            assert.equal(result.toString(), localContent);
        });

        test("should read file content with absolute src", () => {
            const baseDir = tempDir;
            const baseUrl = "";
            const src = "/app.js";
            const filePath = path.join(tempDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const result = readLocalContent(src, baseDir, baseUrl);
            assert.equal(result.toString(), localContent);
        });

        test("should strip relative base url without trailing slash and read file", () => {
            const baseDir = tempDir;
            const baseUrl = "relative_base_url";
            const src = "relative_base_url/app.js";
            const filePath = path.join(tempDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const result = readLocalContent(src, baseDir, baseUrl);
            assert.equal(result.toString(), localContent);
        });

        test("should strip relative base url with trailing slash and read file", () => {
            const baseDir = tempDir;
            const baseUrl = "relative_base_url/";
            const src = "relative_base_url/app.js";
            const filePath = path.join(tempDir, "app.js");
            const localContent = 'console.log("Hello World!");';
            fs.writeFileSync(filePath, localContent);

            const result = readLocalContent(src, baseDir, baseUrl);
            assert.equal(result.toString(), localContent);
        });
    });

    describe("fetchRemoteContent", () => {
        test("should fetch remote JS content", async () => {
            const remoteContent = 'console.log("Hello from remote resource");';
            const expectedHeaders = {
                "Content-Type": "application/javascript",
            };

            mockFetch.mock.mockImplementationOnce(
                async () =>
                    ({
                        headers: new Headers(expectedHeaders),
                        arrayBuffer: () => stringToArrayBuffer(remoteContent),
                        ok: true,
                    }) as unknown as Response,
            );
            const src = "http://example.com/app.js";

            const result = await fetchRemoteContent(src);
            assert.equal(result.toString(), remoteContent);
            assert.equal(mockFetch.mock.calls.length, 1);
            assert.equal(
                mockFetch.mock.calls[0].arguments[0],
                "http://example.com/app.js",
            );
        });

        test("should fetch remote CSS content", async () => {
            const remoteContent = "body{ background: hotpink;}";
            const expectedHeaders = {
                "Content-Type": "text/css",
            };

            mockFetch.mock.mockImplementationOnce(
                async () =>
                    ({
                        headers: new Headers(expectedHeaders),
                        arrayBuffer: () => stringToArrayBuffer(remoteContent),
                        ok: true,
                    }) as unknown as Response,
            );

            const src = "http://example.com/styles.css";
            const result = await fetchRemoteContent(src);
            assert.equal(result.toString(), remoteContent);
            assert.equal(mockFetch.mock.calls.length, 1);
            assert.equal(
                mockFetch.mock.calls[0].arguments[0],
                "http://example.com/styles.css",
            );
        });

        test("should throw error for bad content type", async () => {
            const remoteContent =
                "<html><head><title>404</title></head><body>Not found</body></html>";
            const expectedHeaders = {
                "Content-Type": "text/html",
            };

            mockFetch.mock.mockImplementationOnce(
                async () =>
                    ({
                        headers: new Headers(expectedHeaders),
                        arrayBuffer: () => stringToArrayBuffer(remoteContent),
                        ok: true,
                    }) as unknown as Response,
            );

            const src = "http://example.com/styles.css";
            await assert.rejects(
                () => fetchRemoteContent(src),
                /Unexpected content type/,
            );

            assert.equal(mockFetch.mock.calls.length, 1);
            assert.equal(
                mockFetch.mock.calls[0].arguments[0],
                "http://example.com/styles.css",
            );
        });
    });

    describe("getContent", () => {
        test("should get remote content with no base url", async () => {
            const baseDir = tempDir;
            const remoteContent = 'console.log("Hello from remote resource");';
            const expectedHeaders = {
                "Content-Type": "application/javascript",
            };

            mockFetch.mock.mockImplementationOnce(
                async () =>
                    ({
                        headers: new Headers(expectedHeaders),
                        arrayBuffer: () => stringToArrayBuffer(remoteContent),
                        ok: true,
                    }) as unknown as Response,
            );

            const src = "http://example.com/app.js";
            const result = await getContent(src, baseDir, undefined);
            assert.equal(result.toString(), remoteContent);
            assert.equal(mockFetch.mock.calls.length, 1);
            assert.equal(
                mockFetch.mock.calls[0].arguments[0],
                "http://example.com/app.js",
            );
        });

        test("should get remote content with relative base url", async () => {
            const baseDir = tempDir;
            const baseUrl = "relative_base_url/";
            const remoteContent = 'console.log("Hello from remote resource");';
            const expectedHeaders = {
                "Content-Type": "application/javascript",
            };

            mockFetch.mock.mockImplementationOnce(
                async () =>
                    ({
                        headers: new Headers(expectedHeaders),
                        arrayBuffer: () => stringToArrayBuffer(remoteContent),
                        ok: true,
                    }) as unknown as Response,
            );

            const src = "http://example.com/app.js";
            const result = await getContent(src, baseDir, baseUrl);
            assert.equal(result.toString(), remoteContent);
            assert.equal(mockFetch.mock.calls.length, 1);
            assert.equal(
                mockFetch.mock.calls[0].arguments[0],
                "http://example.com/app.js",
            );
        });

        test("should throw when trying to get remote content ad no-remote flag is set", async () => {
            const baseDir = tempDir;
            const filePath = path.join(baseDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const src = "http://example.com/app.js";
            const baseUrl = "http://other-example.com";
            await assert.rejects(
                () => getContent(src, baseDir, baseUrl, true),
                /Remote sri resources not allowed/,
            );
            assert.equal(mockFetch.mock.calls.length, 0);
        });

        test("should get local content when base url matches remote url", async () => {
            const baseDir = tempDir;
            const filePath = path.join(baseDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const src = "http://example.com/app.js";
            const baseUrl = "http://example.com";
            const result = await getContent(src, baseDir, baseUrl);
            assert.equal(result.toString(), localContent);
            assert.equal(mockFetch.mock.calls.length, 0);
        });

        test("should get local content when local path matches base url", async () => {
            const baseDir = tempDir;
            const filePath = path.join(baseDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const src = "relative_base/app.js";
            const baseUrl = "relative_base";
            const result = await getContent(src, baseDir, baseUrl);
            assert.equal(result.toString(), localContent);
            assert.equal(mockFetch.mock.calls.length, 0);
        });

        test("should get local content from nested directory", async () => {
            const baseDir = tempDir;
            const nestedPath = path.join(tempDir, "nested");
            fs.mkdirSync(nestedPath);

            const nestedFilePath = path.join(nestedPath, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(nestedFilePath, localContent);

            const src = "nested/app.js";
            const result = await getContent(src, baseDir, undefined);
            assert.equal(result.toString(), localContent);
            assert.equal(mockFetch.mock.calls.length, 0);
        });
    });

    describe("calculateSha384", () => {
        test("should calculate correct hash for empty input", () => {
            const emptyInput = Buffer.from([]);
            const expectedEmpty =
                "OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb";
            assert.equal(calculateSha384(emptyInput), expectedEmpty);
        });

        test('should calculate correct hash for "hello world"', () => {
            const testInput = Buffer.from("hello world");
            const expectedHelloWorld =
                "/b2OdaZ/KfcBpOBAOF4uI5hjA+oQI5IRr5B/y7g1eLPkF8txzmRu/QgZ3YwIjeG9";
            assert.equal(calculateSha384(testInput), expectedHelloWorld);
        });
    });

    describe("alterTag", () => {
        test('should add crossorigin attribute to tag ending with ">"', () => {
            const result = alterTag("<script>", "crossorigin", "anonymous");
            assert.equal(result, '<script crossorigin="anonymous">');
        });

        test("should add crossorigin attribute to self-closing tag", () => {
            const result = alterTag("<script/>", "crossorigin", "anonymous");
            assert.equal(result, '<script crossorigin="anonymous"/>');
        });

        test("should add crossorigin attribute to start tag", () => {
            const result = alterTag(
                "<script></script>",
                "crossorigin",
                "anonymous",
            );
            assert.equal(result, '<script crossorigin="anonymous"></script>');
        });

        test("should add crossorigin attribute to start tag and leave content unchanged", () => {
            const result = alterTag(
                '<script>console.log(`crossorigin="other"`);</script>',
                "crossorigin",
                "anonymous",
            );
            assert.equal(
                result,
                '<script crossorigin="anonymous">console.log(`crossorigin="other"`);</script>',
            );
        });

        test("should overwrite existing crossorigin attribute self closing tag", () => {
            const result = alterTag(
                '<script crossorigin="other"/>',
                "crossorigin",
                "anonymous",
            );
            assert.equal(result, '<script crossorigin="anonymous"/>');
        });

        test("should overwrite existing crossorigin attribute self non closing tag", () => {
            const result = alterTag(
                '<script crossorigin="other">',
                "crossorigin",
                "anonymous",
            );
            assert.equal(result, '<script crossorigin="anonymous">');
        });

        test("should overwrite existing crossorigin attribute in start tag", () => {
            const result = alterTag(
                '<script crossorigin="other"></script>',
                "crossorigin",
                "anonymous",
            );
            assert.equal(result, '<script crossorigin="anonymous"></script>');
        });

        test("should overwrite existing crossorigin attribute in start tag with content", () => {
            const result = alterTag(
                '<script crossorigin="other">console.log(`crossorigin="other"`);</script>',
                "crossorigin",
                "anonymous",
            );
            assert.equal(
                result,
                '<script crossorigin="anonymous">console.log(`crossorigin="other"`);</script>',
            );
        });
    });

    describe("toSriScriptTag", () => {
        test("should add integrity attribute to self-closing tag", () => {
            const tag = '<script src="/app.js"/>';
            const integrity = "sha384-value";
            const expected =
                '<script src="/app.js" integrity="sha384-value" crossorigin="anonymous"/>';
            assert.equal(toSriScriptTag(tag, integrity), expected);
        });

        test("should add integrity attribute to tag", () => {
            const tag = '<script src="/app.js">';
            const integrity = "sha384-value";
            const expected =
                '<script src="/app.js" integrity="sha384-value" crossorigin="anonymous">';
            assert.equal(toSriScriptTag(tag, integrity), expected);
        });

        test("should add integrity attribute to tag not closing tag", () => {
            const tag = '<script src="/app.js"></script>';
            const integrity = "sha384-value";
            const expected =
                '<script src="/app.js" integrity="sha384-value" crossorigin="anonymous"></script>';
            assert.equal(toSriScriptTag(tag, integrity), expected);
        });

        test("should add integrity attribute to tag not closing for inline script tag", () => {
            const tag =
                '<script>console.log("hello test from within a <script> tag");</script>';
            const integrity = "sha384-value";
            const expected =
                '<script integrity="sha384-value" crossorigin="anonymous">console.log("hello test from within a <script> tag");</script>';
            assert.equal(toSriScriptTag(tag, integrity), expected);
        });
    });

    describe("handleUpdatedHtml", () => {
        test("should write to output file", () => {
            const outputPath = path.join(tempDir, "output.html");
            const updatedHtml = "updated html content";

            // Create a mock stdout
            const mockStdout = {
                write: mock.fn(),
            };
            handleUpdatedHtml(
                mockStdout as unknown as NodeJS.WriteStream,
                outputPath,
                updatedHtml,
            );
            const content = fs.readFileSync(outputPath, "utf-8");

            assert.equal(content, updatedHtml);
            assert.equal(mockStdout.write.mock.calls.length, 0);
        });

        test("should write to stdout if output is undefined", () => {
            // Create a mock stdout
            const mockStdout = {
                write: mock.fn(),
            };
            const updatedHtml = "updated html content";
            handleUpdatedHtml(
                mockStdout as unknown as NodeJS.WriteStream,
                undefined,
                updatedHtml,
            );

            assert.equal(mockStdout.write.mock.calls.length, 1);
            assert.deepStrictEqual(mockStdout.write.mock.calls[0].arguments, [
                `${updatedHtml}\n`,
            ]);
        });
    });
});
