import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const extractLinkRel = (scriptOrLinkTag: string): string | undefined => {
    const re = /<link\s+[^>]*rel="([^"]*)"/;
    const match = scriptOrLinkTag.match(re);
    return match ? match[1] : undefined;
};

const isSriTag = (scriptOrLinkTag: string): boolean => {
    const rel = extractLinkRel(scriptOrLinkTag);

    if (rel) {
        // Check link tags
        // Split by whitespace to handle multiple rel values
        const relValues = rel.split(/\s+/);

        // Check for critical resource types
        const criticalTypes = [
            "style",
            "stylesheet",
            "preload",
            "modulepreload",
        ];

        // If preload, check if it's preloading a style or script
        if (relValues.includes("preload")) {
            // Extract as attribute
            const asPattern = /as="([^"]*)"/;
            const asMatch = scriptOrLinkTag.match(asPattern);

            if (asMatch) {
                const asValue = asMatch[1];
                return asValue === "style" || asValue === "script";
            }

            if (relValues.includes("stylesheet")) {
                // handle case where rel contains both preload and stylesheet
                return true;
            }

            if (relValues.includes("style")) {
                // handle case where rel contains both preload and style
                return true;
            }

            // Do not calculate sri for other preload link tags
            return false;
        }

        // Check if link tag has sri rel
        for (const relValue of relValues) {
            if (criticalTypes.includes(relValue)) {
                return true;
            }
        }

        // Ignore other types of link tags
        return false;
    }

    // Check if it's a script tag
    if (scriptOrLinkTag.startsWith("<script")) {
        return true;
    }

    // Not a script tag
    return false;
};

export const isImportMapTag = (scriptOrLinkTag: string): boolean => {
    return (
        scriptOrLinkTag.startsWith("<script ") &&
        scriptOrLinkTag.includes('type="importmap"')
    );
};

type ImportMapJson = {
    imports: {
        [key: string]: string;
    };
    integrity?: {
        [src: string]: string;
    };
    scopes?: {
        [scope: string]: {
            [key: string]: string;
        };
    };
};

export const parseImportMap = (scriptOrLinkTag: string) => {
    // Extract content between script tags
    const contentRegex = /<script[^>]*>([\s\S]*?)<\/script>/;
    const contentMatch = scriptOrLinkTag.match(contentRegex);
    if (!contentMatch || !contentMatch[1]) {
        throw new Error(
            `Failed to parse import map for tag ${scriptOrLinkTag}`,
        );
    }

    try {
        const content = contentMatch[1].trim();
        // Parse the import map JSON
        const importMapJson = JSON.parse(content);
        if (typeof importMapJson !== "object" || Array.isArray(importMapJson)) {
            throw new Error(
                `Failed to parse import map for tag ${scriptOrLinkTag}`,
            );
        }
        return importMapJson as ImportMapJson;
    } catch (_error) {
        throw new Error(
            `Failed to parse import map for tag ${scriptOrLinkTag}`,
        );
    }
};

export const extractImports = (importMapJson: ImportMapJson) => {
    const imports = importMapJson.imports
        ? Object.keys(importMapJson.imports).map((key) => {
              const src = importMapJson.imports[key];
              return {
                  src,
                  oldHash: importMapJson.integrity?.[src],
              };
          })
        : [];
    return imports;
};

export const toSriImportMap = (
    tag: string,
    importMapJson: ImportMapJson,
    newIntegrityMap: ImportMapJson["integrity"],
) => {
    const newImportMap = JSON.stringify({
        ...importMapJson,
        integrity: newIntegrityMap,
    });
    return tag.replace(
        /<script([^>]*)>([\s\S]*?)<\/script>/,
        (_, attributes, _content) => {
            return `<script${attributes}>${newImportMap}</script>`;
        },
    );
};

const toHtmlWithSri = async (
    htmlContent: string,
    baseDir: string,
    baseUrl?: string,
    noRemote?: boolean,
    verify?: boolean,
): Promise<string> => {
    // Find all script and link tags that should have integrity hashes
    const re =
        /<(script|link)\s+[^>]*(?:src|href)="?([^"]+)?"?[^>]*>(?:(.*?)<\/\1>)?|<script\s+[^>]*type="importmap"[^>]*>([\s\S]*?)<\/script>/g;

    let updatedHtml = htmlContent;
    const matches = htmlContent.matchAll(re);
    for (const match of matches) {
        const [scriptOrLinkTag, _, src] = match;
        // Skip non supported resources
        if (!isSriTag(scriptOrLinkTag)) {
            continue;
        }

        // Get content of script or link
        try {
            if (isImportMapTag(scriptOrLinkTag)) {
                const importMapJson = parseImportMap(scriptOrLinkTag);
                const imports = extractImports(importMapJson);
                const newIntegrityMap: ImportMapJson["imports"] = {};
                for (const { src, oldHash } of imports) {
                    const content = await getContent(
                        src,
                        baseDir,
                        baseUrl,
                        noRemote,
                    );
                    const hashHex = calculateSha384(content);
                    const integrity = `sha384-${hashHex}`;
                    if (verify) {
                        if (!oldHash) {
                            throw new Error(
                                `Missing hash for ${src}, expected ${integrity}`,
                            );
                        }
                        if (oldHash !== integrity) {
                            throw new Error(
                                `Invalid hash ${oldHash} for ${src}, expected ${integrity}`,
                            );
                        }
                    }
                    newIntegrityMap[src] = integrity;
                }
                const sriImportMapTag = toSriImportMap(
                    scriptOrLinkTag,
                    importMapJson,
                    newIntegrityMap,
                );
                updatedHtml = updatedHtml.replace(
                    scriptOrLinkTag,
                    sriImportMapTag,
                );
                continue;
            }

            const content = await getContent(src, baseDir, baseUrl, noRemote);
            // Calculate SHA-384 hash and create integrity attribute value
            const hashHex = calculateSha384(content);
            const integrity = `sha384-${hashHex}`;
            if (verify) {
                const oldHash = getIntegrityFromTag(scriptOrLinkTag);
                if (!oldHash) {
                    throw new Error(
                        `Missing hash for ${src}, expected ${integrity}`,
                    );
                }
                if (oldHash !== integrity) {
                    throw new Error(
                        `Invalid hash ${oldHash} for ${src}, expected ${integrity}`,
                    );
                }
            }
            // Create new script tag with integrity
            const sriScriptTag = toSriScriptTag(scriptOrLinkTag, integrity);

            // Replace in HTML
            updatedHtml = updatedHtml.replace(scriptOrLinkTag, sriScriptTag);
        } catch (error) {
            console.error(`Warning: Failed to process ${src}: ${error}`);
            throw error;
        }
    }

    return updatedHtml;
};

const getIntegrityFromTag = (tag: string): string | undefined => {
    const integrityPattern = /integrity="([^"]*)"/;
    const match = tag.match(integrityPattern);
    return match ? match[1] : undefined;
};

const getContent = async (
    src: string,
    baseDir: string,
    baseUrl?: string,
    noRemote?: boolean,
): Promise<Buffer> => {
    // Handle remote vs local content
    if (src.startsWith("http://") || src.startsWith("https://")) {
        // If remote_base_url is provided and src starts with it, treat it as local content
        if (baseUrl && src.startsWith(baseUrl)) {
            return readLocalContent(src, baseDir, baseUrl);
        }
        if (noRemote) {
            throw new Error("Remote sri resources not allowed");
        }
        return fetchRemoteContent(src);
    }
    // For relative src, read from file
    return readLocalContent(src, baseDir, baseUrl || "");
};

const fetchRemoteContent = async (src: string): Promise<Buffer> => {
    try {
        // Using native fetch available in Node.js 18+
        const response = await fetch(src);

        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`);
        }

        // Check content type
        const contentType = response.headers.get("content-type") || "";

        // Verify content type is appropriate for scripts or stylesheets
        const validTypes = [
            "text/javascript",
            "application/javascript",
            "application/x-javascript",
            "text/css",
            "text/plain",
        ];

        if (!validTypes.some((type) => contentType.includes(type))) {
            throw new Error(
                `Unexpected content type '${contentType}' for resource '${src}'`,
            );
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (error) {
        throw new Error(
            `Failed to fetch remote content from '${src}': ${error}`,
        );
    }
};

const addTrailingSlashIfNotEmpty = (baseUrl: string): string => {
    if (baseUrl === "") return baseUrl;
    return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
};

const toLocalPath = (src: string, baseDir: string, baseUrl: string): string => {
    const baseWithTrailingSlash = addTrailingSlashIfNotEmpty(baseUrl);

    let localPath = src;
    if (src.startsWith(baseWithTrailingSlash)) {
        localPath = src.substring(baseWithTrailingSlash.length);
    } else if (src.startsWith(baseUrl)) {
        localPath = src.substring(baseUrl.length);
    }

    // Remove any slash from start at file path before reading local file
    const localPathWithoutStartingSlash = localPath.startsWith("/")
        ? localPath.substring(1)
        : localPath;
    return path.join(baseDir, localPathWithoutStartingSlash);
};

const readLocalContent = (
    src: string,
    baseDir: string,
    baseUrl: string,
): Buffer => {
    const filePath = toLocalPath(src, baseDir, baseUrl);
    try {
        return fs.readFileSync(filePath);
    } catch (error) {
        throw new Error(`Failed to read file at path '${filePath}': ${error}`);
    }
};

const calculateSha384 = (content: Buffer): string => {
    const hash = createHash("sha384").update(content).digest();
    return hash.toString("base64");
};

const handleUpdatedHtml = (
    stdout: NodeJS.WriteStream,
    outputPath?: string,
    updatedHtml?: string,
): void => {
    if (!updatedHtml) return;

    if (outputPath) {
        fs.writeFileSync(outputPath, updatedHtml);
    } else {
        stdout.write(`${updatedHtml}\n`);
    }
};

const toSriScriptTag = (tag: string, integrity: string): string => {
    // First handle the integrity attribute
    const integrityTag = alterTag(tag, "integrity", integrity);

    // Ensure crossorigin attribute is set
    return alterTag(integrityTag, "crossorigin", "anonymous");
};

const alterTag = (
    tag: string,
    param: "crossorigin" | "integrity",
    value: string,
) => {
    const hasParamRegex = new RegExp(`^<[^>]*\\s+${param}="[^"]*"`);
    const keyValue = `${param}="${value}"`;
    if (hasParamRegex.test(tag)) {
        // Replace param with new value if existing param is found in tag
        const replaceParamRegex = new RegExp(`${param}="[^"]*"`);
        return tag.replace(replaceParamRegex, keyValue);
    }
    const hasClosingTag = /<\/script[^>]*>$|<\/link[^>]*>$/.test(tag);
    if (hasClosingTag) {
        // Add param and value to the opening tag
        return tag.replace(/>(?!$)/, ` ${keyValue}>`);
    }
    if (tag.endsWith("/>")) {
        // Add param and value to self closing tag
        return tag.replace(/\/>$/, ` ${keyValue}/>`);
    }
    // No close tag and no self closing tag, add param and value to end of tag
    return tag.replace(/>$/, ` ${keyValue}>`);
};

export {
    extractLinkRel,
    isSriTag,
    toHtmlWithSri,
    getContent,
    readLocalContent,
    fetchRemoteContent,
    calculateSha384,
    toSriScriptTag,
    handleUpdatedHtml,
    alterTag,
};
