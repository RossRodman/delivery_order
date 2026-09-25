import { NextResponse, type NextRequest } from "next/server";

/**
 * UX only (plan §5): page navigations without a session cookie go to /login.
 * Not a security boundary — every API handler authenticates itself.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("os_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: skip the API, Next internals, the login page, the service worker and static files.
  matcher: ["/((?!api|_next/static|_next/image|login|sw\\.js|manifest\\.webmanifest|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
