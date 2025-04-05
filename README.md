# sri-to-dist

[![Actions Status](https://github.com/Dintero/sri-to-dist/workflows/CI/badge.svg?branch=master)](https://github.com/Dintero/sri-to-dist/actions?query=branch%3Amaster+workflow%3ACI+) [![npm latest version](https://img.shields.io/npm/v/@dintero/sri-to-dist/latest.svg)](https://www.npmjs.com/package/@dintero/sri-to-dist)

A tool to add subresource integrity (SRI) hashes to HTML files.

## Installation

```bash
npm install -g @dintero/sri-to-dist
# or
npx @dintero/sri-to-dist
```

## Usage

```bash
sri-to-dist -i input.html -o output.html
sri-to-dist --input input.html --output output.html --base-url https://example.com
```

### Options

- `-i, --input <file>`: Input HTML file (required)
- `-o, --output <file>`: Output HTML file (optional, defaults to stdout)
- `-b, --base-url <url>`: Base URL for resolving relative paths (optional)
- `-n, --no-remote <url>`: Optional flag, no remote sri files allowed
- `-v, --verify <url>`: Optional flag, verify that all sri resources from input have correct sha384 hashes

## License

MIT

## Security

Contact us at [security@dintero.com](mailto:security@dintero.com)


## Step 8: Build and test locally

```bash
npm install
npm run build
npm run test
npm link  # This makes your package available globally for testing
```

Now you can run:

```bash
sri-to-dist -i test.html
```

## Step 9: Publish to npm

```bash
npm login
npm publish
```

## Creating a new release

1. Enforce all commits to the master branch to be formatted according to the [Angular Commit Message Format](https://github.com/angular/angular/blob/master/CONTRIBUTING.md#-commit-message-format)
2. When merged to master, it will automatically be released with [semantic-release](https://github.com/semantic-release/semantic-release)
