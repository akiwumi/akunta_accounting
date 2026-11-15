// What the access check needs to know about the current HTTP request.
//
// In the app it comes from the session cookie and the headers the proxy sets
// (and signs). Tests, which have no HTTP request, supply it with
// runWithRequestInfo().

import { AsyncLocalStorage } from "node:async_hooks";

import { cookies, headers } from "next/headers";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import {
  REQUEST_METHOD_HEADER,
  REQUEST_PATH_HEADER,
  REQUEST_SIGNATURE_HEADER,
  verifyRequestLine
} from "@/lib/auth/signing";

export type RequestInfo = {
  sessionToken: string | null;
  /** Upper-case HTTP method, or null when it could not be verified. */
  method: string | null;
  /** Request pathname, or null when it could not be verified. */
  pathname: string | null;
};

const override = new AsyncLocalStorage<RequestInfo>();

/** Runs `fn` as if it were handling the given request. For tests and scripts only. */
export const runWithRequestInfo = <T>(info: RequestInfo, fn: () => Promise<T>): Promise<T> => override.run(info, fn);

export const getRequestInfo = async (): Promise<RequestInfo> => {
  const supplied = override.getStore();
  if (supplied) return supplied;

  const sessionToken = (await cookies()).get(AUTH_COOKIE_NAME)?.value ?? null;

  const headerList = await headers();
  const method = headerList.get(REQUEST_METHOD_HEADER);
  const pathname = headerList.get(REQUEST_PATH_HEADER);
  // Only the proxy can produce this signature. Without it the method and path
  // are unknown, which the access check treats as "not allowed to write".
  const verified = await verifyRequestLine(method, pathname, headerList.get(REQUEST_SIGNATURE_HEADER));

  return {
    sessionToken,
    method: verified && method ? method.toUpperCase() : null,
    pathname: verified ? pathname : null
  };
};
