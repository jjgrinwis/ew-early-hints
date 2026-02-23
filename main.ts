import { logger } from "log";
import { httpRequest } from "http-request";

// var should match you PMUSER var defined in your delivery configuration.
const PMUSER_103_HINTS = "PMUSER_PAGE_TYPE";

// Simple in-memory EdgeWorker cache to avoid making httpRequest calls over and over again.
// ewMemoryTTL can be updated based on your needs. Will initialize during the init event, and it's local per EdgeWorker instance, not shared!
let ewMemoryCache = { expires: 0, data: "" };
const ewMemoryTTL = 30000; //milliseconds, so 30 seconds

// special header used to cache a non-cacheable page via the delivery configuration
// in the delivery configuration we enable caching, set fast cache pre-fresh and set cache key id using this request header to make it unique for EW httpRequest calls.
// also setting a short timeout to avoid waiting too long for the origin response.
const OPTIONS = {
  Headers: { earlyhints: "get_my_link_header" },
  timeout: 250,
};

/**
 * The early hints behavior only works in the onClientRequest stage, so we need to call the original endpoint but do some smart caching.
 * we don't want to double the number of requests to the origin, so we will cache the response when issued by this httpRequest EdgeWorker subrequest.
 **/

export async function onClientRequest(
  request: EW.EgressClientRequest,
): Promise<void> {
  // get timestamp in msec to compare with our cache expiration time, this is needed to avoid making httpRequest calls on every request and instead serve the link header from cache when possible.
  const TIMESTAMP = Date.now();

  // if cache has expired, fetch new link header from origin, otherwise use cached value
  if (TIMESTAMP > ewMemoryCache.expires) {
    try {
      // Attempt to retrieve the 'link' header from the origin response
      // getHeader will return an array of header values if the header is present, joining them into one list.
      const response = await httpRequest(request.url, OPTIONS);
      let linkHeader = response.getHeader("link")?.join(",");

      // if we have some response and a link header, update our cache, otherwise just use the old cached version.
      if (response.ok && linkHeader) {
        ewMemoryCache.data = linkHeader;
        ewMemoryCache.expires = TIMESTAMP + ewMemoryTTL;
        logger.debug(
          `Fetched link header from origin and updated cache: ${JSON.stringify(ewMemoryCache)}`,
        );
      }
    } catch (error) {
      logger.error(`Error fetching link header from origin: ${error}`);
    }
  }

  // serve from cache if we have a cached value, this will be the case for all requests until the cache expires, then we will attempt to fetch a new value from the origin via httpRequest
  if (ewMemoryCache.data) {
    request.setVariable(PMUSER_103_HINTS, ewMemoryCache.data);
  }
}
