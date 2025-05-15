import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as temp from "temp";
import {
    extractLinkRel,
    isSriTag,
    toHtmlWithSri,
    getContent,
    readLocalContent,
    fetchRemoteContent,
    calculateSha384,
    toSriScriptTag,
    handleUpdatedHtml,
    isImportMapTag,
    parseImportMap,
    extractImports,
    toSriImportMap,
    alterTag,
} from "../src/lib";

// Automatically track and clean up temporary files
temp.track();
global.fetch = vi.fn();

const stringToArrayBuffer = (str: string): ArrayBuffer => {
    const encoder = new TextEncoder();
    return encoder.encode(str).buffer;
};
const getTestFolderName = () =>
    `sri-to-dist-lib-${Math.random().toString(36).substring(7)}`;

describe("sri-to-dist-lib", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    afterEach(() => {});

    describe("isSriTag", () => {
        it("should identify link style as SRI tag", () => {
            const tag = '<link rel="style" />';
            expect(isSriTag(tag)).toBe(true);
        });
        it("should identify link stylesheet as SRI tag", () => {
            const tag = '<link rel="stylesheet" />';
            expect(isSriTag(tag)).toBe(true);
        });

        it("should identify link preload and style as SRI tag", () => {
            const tag = '<link rel="preload style"/>';
            expect(isSriTag(tag)).toBe(true);
        });

        it("should identify link preload and stylesheet as SRI tag", () => {
            const tag = '<link rel="preload stylesheet"/>';
            expect(isSriTag(tag)).toBe(true);
        });

        it("should identify link preload as style as SRI tag", () => {
            const tag = '<link rel="preload" as="style" />';
            expect(isSriTag(tag)).toBe(true);
        });

        it("should identify link preload as script as SRI tag", () => {
            const tag = '<link rel="preload" as="script" />';
            expect(isSriTag(tag)).toBe(true);
        });

        it("should not identify link preload as font as SRI tag", () => {
            const tag = '<link rel="preload" as="font" />';
            expect(isSriTag(tag)).toBe(false);
        });

        it("should identify link modulepreload as SRI tag", () => {
            const tag = '<link rel="modulepreload" />';
            expect(isSriTag(tag)).toBe(true);
        });

        it("should identify link modulepreload as script as SRI tag", () => {
            const tag = '<link rel="modulepreload" as="script" />';
            expect(isSriTag(tag)).toBe(true);
        });

        it("should not identify link author as SRI tag", () => {
            const tag = '<link rel="author"/>';
            expect(isSriTag(tag)).toBe(false);
        });

        it("should not identify meta as SRI tag", () => {
            const tag = '<meta charset="UTF-8">';
            expect(isSriTag(tag)).toBe(false);
        });
    });

    describe("isImportMapTag", () => {
        it("should identify script type importmap as importmap", () => {
            const tag = '<script type="importmap"></script>';
            expect(isImportMapTag(tag)).toBe(true);
        });
        it("should identify script type importmap as importmap with extra attributes", () => {
            const tag = '<script id="map" type="importmap" data-attr="generated-by-tool-x"></script>';
            expect(isImportMapTag(tag)).toBe(true);
        });
        it("should identify other script type as not an import map", () => {
            const tag = '<script type="other"></script>';
            expect(isImportMapTag(tag)).toBe(false);
        });
        it("should identify script with missing type as not an import map", () => {
            const tag = '<script></script>';
            expect(isImportMapTag(tag)).toBe(false);
        });
        it("should identify other type of tag not an import map", () => {
            const tag = '<link rel="author"/>';
            expect(isImportMapTag(tag)).toBe(false);
        });
        it("should identify other type of tag not an import map", () => {
            const tag = '<link rel="other" type="importmap"/>';
            expect(isImportMapTag(tag)).toBe(false);
        });
    });

    describe("parseImportMap", () => {
        it("should extract json in importmap", () => {
            const tag = '<script type="importmap">{"imports":{"app":"./app.js"}}</script>';
            expect(parseImportMap(tag)).toMatchObject({imports:{app: './app.js'}});
        });
        it("should extract json in importmap with extra attributes", () => {
            const tag = '<script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./app.js"}}</script>';
            expect(parseImportMap(tag)).toMatchObject({imports:{app: './app.js'}});
        });
        it("should throw if importmap is empty", () => {
            const tag = '<script type="importmap"></script>';
            expect(() => parseImportMap(tag)).toThrow(
                `Failed to parse import map for tag ${tag}`,
            );
        });
        it("should throw if importmap is self closed tag", () => {
            const tag = '<script type="importmap" />';
            expect(() => parseImportMap(tag)).toThrow(
                `Failed to parse import map for tag ${tag}`,
            );
        });
        it("should throw if content is not json", () => {
            const tag = '<script type="importmap">Not a json object</script>';
            expect(() => parseImportMap(tag)).toThrow(
                `Failed to parse import map for tag ${tag}`,
            );
        });
        it("should throw if content is wrong tag type", () => {
            const tag = '<link rel="other" type="importmap"/>';
            expect(() => parseImportMap(tag)).toThrow(
                `Failed to parse import map for tag ${tag}`,
            );
        });
    });
    describe("extractImports", () => {
        it("should extract imports from importmap", () => {
            const importMapJson = {
                imports: {
                    app: "./app.js"
                }
            };
            expect(extractImports(importMapJson)).toMatchObject(
                [{
                    src: "./app.js",
                    oldHash: undefined
                }]
            );
        });
        it("should extract imports with old integrity hash from importmap", () => {
            const importMapJson = {
                imports: {
                    app: "./app.js"
                },
                integrity:{
                    "./app.js": "sha384-test"
                }
            };
            expect(extractImports(importMapJson)).toMatchObject(
                [{
                    src: "./app.js",
                    oldHash: "sha384-test"
                }]
            );
        });
        it("should create empty list if imports is empty", () => {
            const importMapJson = {imports:{}};
            expect(extractImports(importMapJson)).toMatchObject(
                []
            );
        });
        it("should create empty list if no imports found", () => {
            const importMapJson = {};
            // @ts-ignore
            expect(extractImports(importMapJson)).toMatchObject(
                []
            );
        });
    });

    describe("toSriImportMap", () => {
        it("should create updated importmap tag with integrity object", () => {
            const tag = '<script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./app.js"}, "other":{"key": "value"}}</script>';
            const importMapJson = {
                imports: {
                    app: "./app.js"
                },
                other: {
                    key: "value"
                }
            };
            const newIntegrityMap = {
                "./app.js": "sha384-test"
            };
            expect(toSriImportMap(tag, importMapJson, newIntegrityMap)).toEqual(
                `<script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./app.js"},"other":{"key":"value"},"integrity":{"./app.js":"sha384-test"}}</script>`
            );
        });
        it("should create importmap tag with updated integrity object", () => {
            const tag = '<script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./app.js"}, "integrity":{"./app.js": "sha384-old"}, "other":{"key": "value"}}</script>';
            const importMapJson = {
                imports: {
                    app: "./app.js"
                },
                integrity: {
                    "./app.js": "sha384-old"
                },
                other: {
                    key: "value"
                }
            };
            const newIntegrityMap = {
                "./app.js": "sha384-test"
            };
            expect(toSriImportMap(tag, importMapJson, newIntegrityMap)).toEqual(
                `<script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./app.js"},"integrity":{"./app.js":"sha384-test"},"other":{"key":"value"}}</script>`
            );
        });
    });

    describe("extractLinkRel", () => {
        it("should return undefined for script tag", () => {
            const tag = '<script src="./app.js" />';
            expect(extractLinkRel(tag)).toBeUndefined();
        });

        it("should return undefined for link tag without rel", () => {
            const tag = "<link />";
            expect(extractLinkRel(tag)).toBeUndefined();
        });

        it("should extract rel value from link tag", () => {
            const tag = '<link rel="hello" />';
            expect(extractLinkRel(tag)).toBe("hello");
        });
    });

    describe("toHtmlWithSri", () => {
        it("should add integrity attributes to script tags", async () => {
            const baseUrl = "";
            // Note uses fixture app.js file from /example folder
            const htmlContent = `<html><head><title>index</title><script src="example/app.js"></head><body>Hello world!s</body></html>`;
            const result = await toHtmlWithSri(
                htmlContent,
                path.dirname(path.join(process.cwd(), "index.html")),
                baseUrl,
                false,
                false
            );

            const expected =
                '<html><head><title>index</title><script src="example/app.js" integrity="sha384-wU4WKzlcdNRZlPFH/ryF/H7DbuSWr8HLZh+p22IX9KQTcDXNAYiYBlK8Kw51nTgC" crossorigin="anonymous"></head><body>Hello world!s</body></html>';
            expect(result).toBe(expected);
        });

        it("should add integrity attributes to script tags when verifying valid integrity hash", async () => {
            const baseUrl = "";
            // Note uses fixture app.js file from /example folder
            const htmlContent = `<html><head><title>index</title><script src="example/app.js" integrity="sha384-wU4WKzlcdNRZlPFH/ryF/H7DbuSWr8HLZh+p22IX9KQTcDXNAYiYBlK8Kw51nTgC"></head><body>Hello world!s</body></html>`;
            const result = await toHtmlWithSri(
                htmlContent,
                path.dirname(path.join(process.cwd(), "index.html")),
                baseUrl,
                false,
                true
            );

            const expected =
                '<html><head><title>index</title><script src="example/app.js" integrity="sha384-wU4WKzlcdNRZlPFH/ryF/H7DbuSWr8HLZh+p22IX9KQTcDXNAYiYBlK8Kw51nTgC" crossorigin="anonymous"></head><body>Hello world!s</body></html>';
            expect(result).toBe(expected);
        });

        it("should raise when verifying non existing integrity hash", async () => {
            const baseUrl = "";
            // Note uses fixture app.js file from /example folder
            const htmlContent = `<html><head><title>index</title><script src="example/app.js"></head><body>Hello world!s</body></html>`;

            await expect(toHtmlWithSri(
                htmlContent,
                path.dirname(path.join(process.cwd(), "index.html")),
                baseUrl,
                false,
                true
            )).rejects.toThrow(
                "Missing hash for example/app.js, expected sha384-wU4WKzlcdNRZlPFH/ryF/H7DbuSWr8HLZh+p22IX9KQTcDXNAYiYBlK8Kw51nTgC",
            );
        });

        it("should raise when verifying wrong integrity hash", async () => {
            const baseUrl = "";
            // Note uses fixture app.js file from /example folder
            const htmlContent = `<html><head><title>index</title><script src="example/app.js" integrity="bad-hash"></head><body>Hello world!s</body></html>`;

            await expect(toHtmlWithSri(
                htmlContent,
                path.dirname(path.join(process.cwd(), "index.html")),
                baseUrl,
                false,
                true
            )).rejects.toThrow(
                "Invalid hash bad-hash for example/app.js, expected sha384-wU4WKzlcdNRZlPFH/ryF/H7DbuSWr8HLZh+p22IX9KQTcDXNAYiYBlK8Kw51nTgC",
            );
        });

        it("should add integrity to importmap script tags", async () => {
            const baseUrl = "";
            // Note uses fixture app.js file from /example folder
            const htmlContent = `<html><head><title>index</title><script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./example/app.js"}, "other":{"key": "value"}}</script></head><body>Hello world!s</body></html>`;
            const result = await toHtmlWithSri(
                htmlContent,
                path.dirname(path.join(process.cwd(), "index.html")),
                baseUrl,
                false,
                false
            );
            const expected =
                '<html><head><title>index</title><script id="map" type="importmap" data-attr="generated-by-tool-x">{"imports":{"app":"./example/app.js"},"other":{"key":"value"},"integrity":{"./example/app.js":"sha384-wU4WKzlcdNRZlPFH/ryF/H7DbuSWr8HLZh+p22IX9KQTcDXNAYiYBlK8Kw51nTgC"}}</script></head><body>Hello world!s</body></html>';
            expect(result).toBe(expected);
        });
    });

    describe("readLocalContent", () => {
        it("should read file content", () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const baseUrl = "";
            const src = "app.js";
            const filePath = path.join(tempDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const result = readLocalContent(src, baseDir, baseUrl);
            expect(result.toString()).toBe(localContent);
        });

        it("should read file content with relative src", () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const baseUrl = "";
            const src = "./app.js";
            const filePath = path.join(tempDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const result = readLocalContent(src, baseDir, baseUrl);
            expect(result.toString()).toBe(localContent);
        });

        it("should read file content with absolute src", () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const baseUrl = "";
            const src = "/app.js";
            const filePath = path.join(tempDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const result = readLocalContent(src, baseDir, baseUrl);
            expect(result.toString()).toBe(localContent);
        });

        it("should strip relative base url without trailing slash and read file", () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const baseUrl = "relative_base_url";
            const src = "relative_base_url/app.js";
            const filePath = path.join(tempDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const result = readLocalContent(src, baseDir, baseUrl);
            expect(result.toString()).toBe(localContent);
        });

        it("should strip relative base url with trailing slash and read file", () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const baseUrl = "relative_base_url/";
            const src = "relative_base_url/app.js";
            const filePath = path.join(tempDir, "app.js");
            const localContent = 'console.log("Hello World!");';
            fs.writeFileSync(filePath, localContent);

            const result = readLocalContent(src, baseDir, baseUrl);
            expect(result.toString()).toBe(localContent);
        });
    });

    describe("fetchRemoteContent", () => {
        it("should fetch remote JS content", async () => {
            const remoteContent = 'console.log("Hello from remote resource");';
            const expectedHeaders = {
                "Content-Type": "application/javascript",
            };
            (global.fetch as any).mockResolvedValueOnce({
                headers: new Headers(expectedHeaders),
                arrayBuffer: () => stringToArrayBuffer(remoteContent),
                ok: true,
            });

            const src = "http://example.com/app.js";
            const result = await fetchRemoteContent(src);
            expect(result.toString()).toBe(remoteContent);
            expect(global.fetch).toHaveBeenCalledWith(
                "http://example.com/app.js",
            );
        });

        it("should fetch remote CSS content", async () => {
            const remoteContent = "body{ background: hotpink;}";
            const expectedHeaders = {
                "Content-Type": "text/css",
            };
            (global.fetch as any).mockResolvedValueOnce({
                headers: new Headers(expectedHeaders),
                arrayBuffer: () => stringToArrayBuffer(remoteContent),
                ok: true,
            });
            const src = "http://example.com/styles.css";
            const result = await fetchRemoteContent(src);
            expect(result.toString()).toBe(remoteContent);
            expect(global.fetch).toHaveBeenCalledWith(
                "http://example.com/styles.css",
            );
        });

        it("should throw error for bad content type", async () => {
            const remoteContent =
                "<html><head><title>404</title></head><body>Not found</body></html>";
            const expectedHeaders = {
                "Content-Type": "text/html",
            };
            (global.fetch as any).mockResolvedValueOnce({
                headers: new Headers(expectedHeaders),
                arrayBuffer: () => stringToArrayBuffer(remoteContent),
                ok: true,
            });

            const src = "http://example.com/styles.css";
            await expect(fetchRemoteContent(src)).rejects.toThrow(
                "Unexpected content type",
            );
            expect(global.fetch).toHaveBeenCalledWith(
                "http://example.com/styles.css",
            );
        });
    });

    describe("getContent", () => {
        it("should get remote content with no base url", async () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const remoteContent = 'console.log("Hello from remote resource");';
            const expectedHeaders = {
                "Content-Type": "application/javascript",
            };

            (global.fetch as any).mockResolvedValueOnce({
                headers: new Headers(expectedHeaders),
                arrayBuffer: () => stringToArrayBuffer(remoteContent),
                ok: true,
            });

            const src = "http://example.com/app.js";
            const result = await getContent(src, baseDir, undefined);
            expect(result.toString()).toBe(remoteContent);
            expect(global.fetch).toHaveBeenCalledWith(
                "http://example.com/app.js",
            );
        });

        it("should get remote content with relative base url", async () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const baseUrl = "relative_base_url/";
            const remoteContent = 'console.log("Hello from remote resource");';
            const expectedHeaders = {
                "Content-Type": "application/javascript",
            };

            (global.fetch as any).mockResolvedValueOnce({
                headers: new Headers(expectedHeaders),
                arrayBuffer: () => stringToArrayBuffer(remoteContent),
                ok: true,
            });

            const src = "http://example.com/app.js";
            const result = await getContent(src, baseDir, baseUrl);
            expect(result.toString()).toBe(remoteContent);
            expect(global.fetch).toHaveBeenCalledWith(
                "http://example.com/app.js",
            );
        });

        it("should throw when trying to get remote content ad no-remote flag is set", async () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const filePath = path.join(baseDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const remoteContent = 'console.log("Hello from remote resource");';
            const expectedHeaders = {
                "Content-Type": "application/javascript",
            };
            (global.fetch as any).mockResolvedValueOnce({
                headers: new Headers(expectedHeaders),
                arrayBuffer: () => stringToArrayBuffer(remoteContent),
                ok: true,
            });

            const src = "http://example.com/app.js";
            const baseUrl = "http://other-example.com";
            await expect(getContent(src, baseDir, baseUrl, true)).rejects.toThrow(
                "Remote sri resources not allowed",
            );
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it("should get local content when base url matches remote url", async () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const filePath = path.join(baseDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const remoteContent = 'console.log("Hello from remote resource");';
            const expectedHeaders = {
                "Content-Type": "application/javascript",
            };
            (global.fetch as any).mockResolvedValueOnce({
                headers: new Headers(expectedHeaders),
                arrayBuffer: () => stringToArrayBuffer(remoteContent),
                ok: true,
            });

            const src = "http://example.com/app.js";
            const baseUrl = "http://example.com";
            const result = await getContent(src, baseDir, baseUrl);
            expect(result.toString()).toBe(localContent);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it("should get local content when local path matches base url", async () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const filePath = path.join(baseDir, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(filePath, localContent);

            const remoteContent = 'console.log("Hello from remote resource");';
            const expectedHeaders = {
                "Content-Type": "application/javascript",
            };
            (global.fetch as any).mockResolvedValueOnce({
                headers: new Headers(expectedHeaders),
                arrayBuffer: () => stringToArrayBuffer(remoteContent),
                ok: true,
            });

            const src = "relative_base/app.js";
            const baseUrl = "relative_base";
            const result = await getContent(src, baseDir, baseUrl);
            expect(result.toString()).toBe(localContent);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it("should get local content from nested directory", async () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const baseDir = tempDir;
            const nestedPath = path.join(tempDir, "nested");
            fs.mkdirSync(nestedPath);

            const nestedFilePath = path.join(nestedPath, "app.js");
            const localContent = 'console.log("Hello from local resource");';
            fs.writeFileSync(nestedFilePath, localContent);

            const remoteContent = 'console.log("Hello from remote resource");';
            const expectedHeaders = {
                "Content-Type": "application/javascript",
            };
            (global.fetch as any).mockResolvedValueOnce({
                headers: new Headers(expectedHeaders),
                arrayBuffer: () => stringToArrayBuffer(remoteContent),
                ok: true,
            });

            const src = "nested/app.js";
            const result = await getContent(src, baseDir, undefined);
            expect(result.toString()).toBe(localContent);
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe("calculateSha384", () => {
        it("should calculate correct hash for empty input", () => {
            const emptyInput = Buffer.from([]);
            const expectedEmpty =
                "OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb";
            expect(calculateSha384(emptyInput)).toBe(expectedEmpty);
        });

        it('should calculate correct hash for "hello world"', () => {
            const testInput = Buffer.from("hello world");
            const expectedHelloWorld =
                "/b2OdaZ/KfcBpOBAOF4uI5hjA+oQI5IRr5B/y7g1eLPkF8txzmRu/QgZ3YwIjeG9";
            expect(calculateSha384(testInput)).toBe(expectedHelloWorld);
        });
    });

    describe("alterTag", () => {
        it('should add crossorigin attribute to tag ending with ">"', () => {
            const result = alterTag('<script>', 'crossorigin', 'anonymous');
            expect(result).toBe('<script crossorigin="anonymous">');
        });

        it("should add crossorigin attribute to self-closing tag", () => {
            const result = alterTag('<script/>', 'crossorigin', 'anonymous');
            expect(result).toBe('<script crossorigin="anonymous"/>');
        });

        it("should add crossorigin attribute to start tag", () => {
            const result = alterTag('<script></script>', 'crossorigin', 'anonymous');
            expect(result).toBe('<script crossorigin="anonymous"></script>');
        });

        it("should add crossorigin attribute to start tag and leave content unchanged", () => {
            const result = alterTag('<script>console.log(`crossorigin="other"`);</script>', "crossorigin", "anonymous");
            expect(result).toBe('<script crossorigin="anonymous">console.log(`crossorigin="other"`);</script>');
        });

        it("should overwrite existing crossorigin attribute self closing tag", () => {
            const result = alterTag('<script crossorigin="other"/>', "crossorigin", "anonymous");
            expect(result).toBe('<script crossorigin="anonymous"/>');
        });

        it("should overwrite existing crossorigin attribute self non closing tag", () => {
            const result = alterTag('<script crossorigin="other">', "crossorigin", "anonymous");
            expect(result).toBe('<script crossorigin="anonymous">');
        });

        it("should overwrite existing crossorigin attribute in start tag", () => {
            const result = alterTag('<script crossorigin="other"></script>', "crossorigin", "anonymous");
            expect(result).toBe('<script crossorigin="anonymous"></script>');
        });

        it("should overwrite existing crossorigin attribute in start tag with content", () => {
            const result = alterTag('<script crossorigin="other">console.log(`crossorigin="other"`);</script>', "crossorigin", "anonymous");
            expect(result).toBe('<script crossorigin="anonymous">console.log(`crossorigin="other"`);</script>');
        });
    });

    describe("toSriScriptTag", () => {
        it("should add integrity attribute to self-closing tag", () => {
            const tag = '<script src="/app.js"/>';
            const integrity = "sha384-value";
            const expected =
                '<script src="/app.js" integrity="sha384-value" crossorigin="anonymous"/>';
            expect(toSriScriptTag(tag, integrity)).toBe(expected);
        });

        it("should add integrity attribute to tag", () => {
            const tag = '<script src="/app.js">';
            const integrity = "sha384-value";
            const expected =
                '<script src="/app.js" integrity="sha384-value" crossorigin="anonymous">';
            expect(toSriScriptTag(tag, integrity)).toBe(expected);
        });

        it("should add integrity attribute to tag not closing tag", () => {
            const tag = '<script src="/app.js"></script>';
            const integrity = "sha384-value";
            const expected =
                '<script src="/app.js" integrity="sha384-value" crossorigin="anonymous"></script>';
            expect(toSriScriptTag(tag, integrity)).toBe(expected);
        });

        it("should add integrity attribute to tag not closing for inline script tag", () => {
            const tag = '<script>console.log("hello test from within a <script> tag");</script>';
            const integrity = "sha384-value";
            const expected =
                '<script integrity="sha384-value" crossorigin="anonymous">console.log("hello test from within a <script> tag");</script>';
            expect(toSriScriptTag(tag, integrity)).toBe(expected);
        });
    });

    describe("handleUpdatedHtml", () => {
        it("should write to output file", () => {
            const tempDir = temp.mkdirSync(getTestFolderName());
            const outputPath = path.join(tempDir, "output.html");
            const updatedHtml = "updated html content";

            // Create a mock stdout
            const mockStdout = {
                write: vi.fn(),
            };
            handleUpdatedHtml(mockStdout as any, outputPath, updatedHtml);
            const content = fs.readFileSync(outputPath, "utf-8");
            expect(content).toBe(updatedHtml);
            expect(mockStdout.write).not.toHaveBeenCalled();
        });

        it("should write to stdout if output is undefined", () => {
            // Create a mock stdout
            const mockStdout = {
                write: vi.fn(),
            };
            const updatedHtml = "updated html content";
            handleUpdatedHtml(mockStdout as any, undefined, updatedHtml);
            expect(mockStdout.write).toHaveBeenCalledWith(`${updatedHtml}\n`);
        });
    });
});
