import * as assert from "node:assert/strict";
import { type ExecFileException, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "../dist/index.js");

describe("cli", () => {
    test("--help", async () => {
        const { stdout } = await execFileAsync("node", [CLI, "--help"]);
        assert.match(stdout, /HTML processing tool/);
    });

    describe("--input", () => {
        test("missing", async () => {
            await assert.rejects(
                execFileAsync("node", [CLI]),
                (err: unknown) => {
                    const error = err as ExecFileException;
                    assert.strictEqual(error.code, 1);
                    assert.ok(error.stderr);
                    assert.equal(
                        error.stderr,
                        "error: required option '-i, --input <file>' not specified\n",
                    );
                    return true;
                },
            );
        });

        test("--input unknown", async () => {
            await assert.rejects(
                execFileAsync("node", [CLI, "--input", "unknown"]),
                (err: unknown) => {
                    const error = err as ExecFileException;
                    assert.strictEqual(error.code, 1);
                    assert.ok(error.stderr);
                    assert.equal(
                        error.stderr,
                        "Error: Error: ENOENT: no such file or directory, open 'unknown'\n",
                    );
                    return true;
                },
            );
        });
    });

    test("example", async (t) => {
        const tempFile = path.join(tmpdir(), `sri-test-${randomUUID()}.html`);
        t.after(() => {
            fs.rm(tempFile, { force: true });
        });

        const { stdout } = await execFileAsync(
            "node",
            [
                CLI,
                "--input",
                path.join(__dirname, "../example/index.html"),
                "--output",
                tempFile,
                "--base-url",
                "https://baseurl.dintero.com",
            ],
            {
                cwd: path.join(__dirname, "../example"),
            },
        );

        assert.equal(stdout, "");
        assert.strictEqual(
            (await fs.readFile(tempFile)).toString(),
            (
                await fs.readFile(
                    path.join(__dirname, "../example/expected.html"),
                )
            ).toString(),
        );
    });
});
