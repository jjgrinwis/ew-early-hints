# Akamai EdgeWorker: Early Hints via Link Header

## Overview

This EdgeWorker reads the `link` header from the origin response during the `onClientRequest` event. If the header is present, its value is stored in a PMUSER variable (`PMUSER_PAGE_TYPE`). This PMUSER var is used in the Early Hints behavior. You can only set Early Hints during the `onClientRequest` handler.

## Features

- Uses `request.url` to fetch content from origin using `httpRequest`.
- Reads the `link` header (if present) and sets it as a PMUSER variable.
- Uses a custom request header (`earlyhints: get_my_link_header`) to trigger special caching logic in the Akamai delivery configuration.
- Handles errors gracefully and logs them for troubleshooting.
- **In-memory caching**: Latest version uses caching in the EdgeWorker itself to avoid httpRequest calls on every request, resulting in huge performance increase.🔥

## How It Works

1. **onClientRequest**: When a client request is received, the EdgeWorker makes an internal HTTP request to the same URL, including a special header to trigger cache logic in the delivery configuration.
2. **Link Header Extraction**: If the origin response contains a `link` header, its value is stored in the PMUSER variable `PMUSER_PAGE_TYPE` in this example.
3. **Early Hints**: The PMUSER variable `PMUSER_PAGE_TYPE` is used to set the Early Hints behavior in the Akamai delivery configuration.
4. **Delivery Configuration Caching**: The delivery configuration should be set up to cache the response based on that special header and Request Type=EW_SUBREQUEST. This reduces origin load and is only used by the httpRequest from this EdgeWorker so no cache collision with normal HTTP request.
5. **Loop Prevention**: The `httpRequest` in the EdgeWorker will call the original URL but the EdgeWorker won't be triggered again as sub-requests don't trigger EdgeWorkers.
6. **EdgeWorker Memory Caching**: The link header is cached in the EdgeWorker with a TTL timestamp. If the TTL is not expired, the cached value is served; otherwise, a new version is fetched from the origin.

## Usage

1. **Get Started**: Clone this repo and run `npm install`.
2. **Install Akamai CLI**: Ensure the Akamai CLI is installed with the EdgeWorkers module and you are using the right credentials in `~/.edgerc`.
3. **Configure Delivery**: Ensure your Akamai delivery configuration starts this EdgeWorker and you setup caching with the special header and enables pre-fresh/caching as needed.
4. **Deploy EdgeWorker**: Build and deploy this EdgeWorker to the Akamai platform by running `npm run deploy:staging` or `npm run deploy:production`
5. **Test**: Use tools like `curl` to verify the `link` header is fetched and the PMUSER variable is set.

## Customization

- **Change PMUSER Variable**: Edit the `PMUSER_103_HINTS` constant.
- **Modify Request Headers**: Update the `OPTIONS.Headers` object.
- **Timeouts**: Adjust the `timeout` value in `OPTIONS` as needed.

## Error Handling

- All errors during the fetch are logged using the EdgeWorker logger.
- If the `link` header is missing or the response is not OK, the PMUSER variable is not set.

## Requirements

- npm installed
- Akamai EdgeWorkers enabled on your property.
- TypeScript and Akamai EdgeWorkers for development.

## License

ISC

## Author

jgrinwis@akamai.com

## Testing Early Hints with curl

To test Early Hints using curl, run the following command:

```
curl https://hostname.example.com -i -H 'sec-fetch-mode: navigate' -H 'user-agent: Chrome/111.0'
```

In the response, you should see `HTTP/2 103` indicating that Early Hints are being sent by the server.

## Debugging edgeworker

To get some logging from the EdgeWorker, first get a token

```
npm run generate-token
```

Get the EdgeWorker trace token and use it in the request header to get some debug output:

```
curl https://hostname.example.com -i -H "Akamai-EW-Trace: xxxx" -H "pragma:akamai-x-ew-debug-subs" -s -D - -o /dev/null
```
