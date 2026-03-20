# Akamai EdgeWorker: Early Hints via Link Header

## Background

**HTTP 103 Early Hints** is a provisional HTTP response status that allows a server to send resource hints to the browser before the final response is ready. The browser can use these hints to start preloading subresources — such as CSS, JavaScript, and fonts — while the server is still generating the page. This reduces perceived page load time by eliminating idle time in the browser.

**Akamai EdgeWorkers** are small TypeScript/JavaScript functions that run on Akamai's CDN edge nodes, executing within the request/response lifecycle before or after traffic reaches your origin server. They allow you to customize request handling at the edge without modifying your origin application.

**The challenge**: Akamai's built-in Early Hints behavior requires knowing which resources to hint at the moment a client request arrives at the edge — before the origin has been contacted. The `Link` header that drives Early Hints normally only comes back in the origin response, which is too late to send a 103 response. This EdgeWorker solves that by making a lightweight internal request to fetch the `Link` header from origin and caching it at the edge, so it is available immediately when future client requests arrive.

## Overview

This EdgeWorker intercepts client requests in the `onClientRequest` handler — the stage that fires when a request first arrives at the edge, before any cache lookup or origin contact. Because HTTP 103 Early Hints must be sent to the browser before the final response begins streaming, this is the only stage where Early Hints can be configured.

When a request arrives, the EdgeWorker checks its in-memory cache for a previously fetched `Link` header. If the cache is warm, it stores the cached value in a PMUSER variable (a user-defined variable in the Akamai delivery configuration, accessible to both EdgeWorker code and Property Manager rule logic). If the cache is cold or expired, it makes an internal HTTP subrequest to fetch a fresh `Link` header from origin, updates the cache, and then sets the PMUSER variable. Akamai's built-in Early Hints behavior in the delivery configuration reads that PMUSER variable and sends the HTTP 103 response to the browser.

## Features

- Makes an internal `httpRequest` to `request.url` to fetch the `Link` header from origin.
- Reads the `link` response header (if present) and stores it in a PMUSER variable (`PMUSER_PAGE_TYPE` by default).
- Uses a custom request header (`EW-Early-Hints: get_my_link_header`) to trigger special caching logic in the Akamai delivery configuration. The header value is configurable via the `PMUSER_EW_HINTS_HEADER` delivery config variable; `get_my_link_header` is only the default.
- Passes through the `authorization` header from the original request to the subrequest, if present.
- Handles errors gracefully and logs them for troubleshooting.
- **In-memory caching**: Caches the fetched `Link` header in the EdgeWorker process memory with a configurable TTL (default 30 seconds), avoiding a subrequest on every client request for a significant performance improvement.

## How It Works

1. **onClientRequest**: The EdgeWorker handler fires the moment a client request arrives at the edge — before cache lookup and before any origin contact. This is the only stage where Akamai Early Hints can be configured, because the 103 response must reach the browser before the 200 response begins.
2. **Link Header Extraction**: If the in-memory cache is cold or expired, the EdgeWorker makes an internal HTTP subrequest to the same URL. If the origin response contains a `link` header, its value is stored in the in-memory cache and then set on the PMUSER variable `PMUSER_PAGE_TYPE`.
3. **Early Hints**: The EdgeWorker only sets the PMUSER variable. Akamai's built-in Early Hints behavior (configured separately in Property Manager) reads that variable and sends the actual HTTP 103 response — including the `Link` preload headers — to the browser.
4. **Delivery Configuration Caching**: The delivery configuration should cache subrequest responses using `Request Type = EW_SUBREQUEST` (the Akamai request type that identifies `httpRequest` calls from an EdgeWorker, as opposed to real client requests) scoped to the `EW-Early-Hints` header. This means:
   - Cached responses are only served to the EdgeWorker's subrequests, not to normal client requests, so there is no cache collision.
   - **Cache ID modification** (adding `EW-Early-Hints` to the cache key) ensures that different header values produce separate cache entries.
   - **Pre-fresh cache** (stale-while-revalidate) serves a slightly stale cached object while refreshing it in the background, preventing latency spikes when the cache entry expires.
5. **Loop Prevention**: The `httpRequest` subrequest calls the original URL, but Akamai deliberately does not re-invoke EdgeWorker logic for subrequests. This is a platform-level behavior — no special code is required to prevent an infinite loop.
6. **EdgeWorker Memory Caching**: The `link` header value is cached in a single in-memory variable (`ewMemoryCache`) with a TTL timestamp. While the cache is valid, all incoming requests are served the same cached value without a subrequest. **Important**: this single-slot cache design assumes the same set of preload resources applies to all pages this EdgeWorker is active on. If different pages need different `Link` headers, the cached value from one page would be applied to all others. For per-URL Early Hints, a URL-keyed cache structure would be needed instead.

## Usage

1. **Get Started**: Clone this repo and run `npm install`.
2. **Install Akamai CLI**: Ensure the Akamai CLI is installed with the EdgeWorkers module (`akamai install edgeworkers`) and that your credentials are configured in `~/.edgerc`.
3. **Set IDs**: Create an EdgeWorker ID with `npm run create-id`, look up the Group ID with `npm run list-groups`, and set the EdgeWorker tier (`100` or `200`) in `package.json`. Tier 100 is the standard tier; Tier 200 offers higher CPU, memory, and network limits for more demanding workloads — check your Akamai contract to confirm which is available.
4. **Configure Delivery**: In your Akamai Property Manager (delivery configuration):
   - Activate this EdgeWorker only on relevant request paths (e.g., exclude static assets such as images and CSS, or exclude OIDC login flows where Early Hints is not useful).
   - Add a caching rule scoped to `Request Type = EW_SUBREQUEST` and the `EW-Early-Hints` request header, so subrequest responses are cached separately from normal client responses.
   - Enable **Cache ID Modification** using the `EW-Early-Hints` header to give subrequest cache entries their own cache key.
   - Enable **Prefresh Cache** (stale-while-revalidate) so the cache refreshes in the background rather than on a miss, keeping subrequest latency low.
   - Enable the Akamai **Early Hints** behavior and configure it to read from the PMUSER variable set by this EdgeWorker (e.g., `PMUSER_PAGE_TYPE`).
5. **Deploy EdgeWorker**: Build and deploy by running `npm run deploy:staging` or `npm run deploy:production`.
6. **Test**: Use `curl` to verify that the `Link` header is fetched and that the HTTP 103 response is returned. See the [Testing Early Hints with curl](#testing-early-hints-with-curl) section below.

## Customization

- **Change PMUSER Variable**: Edit the `PMUSER_103_HINTS` constant in `main.ts`. The string value must match the PMUSER variable name defined in your delivery configuration.
- **Modify Request Headers**: Update the `OPTIONS.headers` object in `main.ts`.
- **Timeouts**: Uncomment and adjust the `timeout` value in `OPTIONS` as needed (value is in milliseconds).
- **Cache TTL**: Adjust `ewMemoryTTL` in `main.ts` (default is `30000` ms / 30 seconds).

## Error Handling

- If the `httpRequest` subrequest throws an error, it is caught and logged via the EdgeWorker logger.
- If the subrequest succeeds but returns no `link` header (or a non-OK status), the in-memory cache is not updated.
- In both failure cases, if the cache already holds a value from a prior successful fetch, that cached value is still used and the PMUSER variable is still set. The PMUSER variable is only left unset when the cache is completely empty — i.e., no successful fetch has occurred during the lifetime of this EdgeWorker instance.

## Requirements

- Node.js with `npm` and `tsc` installed.
- Akamai EdgeWorkers enabled on your property.
- Akamai CLI with the edgeworkers module (`akamai install edgeworkers`).

## License

ISC

## Author

john@grinwis.com

## Testing Early Hints with curl

Akamai's Early Hints behavior is typically configured to fire only for browser navigation requests, not for API calls or programmatic fetches. The `sec-fetch-mode: navigate` header signals that this is a top-level browser navigation, and the `user-agent` header identifies the client as a browser. Without these headers, the delivery configuration may not trigger the Early Hints behavior and no HTTP 103 response will appear in the output.

```
curl https://hostname.example.com -i -H 'sec-fetch-mode: navigate' -H 'user-agent: Chrome/111.0'
```

In the response, you should see `HTTP/2 103` indicating that Early Hints are being sent by the server, followed by the `Link` preload headers, and then the final `HTTP/2 200` response.

## Debugging EdgeWorker

To get logging output from the EdgeWorker, first generate a trace token:

```
npm run generate-token
```

Then use the token in your request headers. `Akamai-EW-Trace: <token>` tells the Akamai edge to attach EdgeWorker execution logs to the response. `pragma: akamai-x-ew-debug-subs` enables extended debug response headers that show EdgeWorker variable values and execution status.

```
curl https://hostname.example.com -i -H "Akamai-EW-Trace: xxxx" -H "pragma:akamai-x-ew-debug-subs" -s -D - -o /dev/null
```
